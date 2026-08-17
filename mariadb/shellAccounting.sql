-- shellFarmer accounting / billing schema
-- Derives verifiable invoices from borg_replay_log.
--
-- Flow:  borg_replay_log  --rate-->  tblAccessLedger  --package-->  tblInvoice + tblInvoiceLine
--                                                                        |
--                                                     signed package --> client --> tblPayment
--
-- Every step is idempotent and keyed on borg_replay_log.replayKey, so re-running
-- the rater or re-issuing an invoice can never double-bill an access.

USE shellFarmer;

-- ---------------------------------------------------------------------------
-- Farmer <-> cell binding, written at provisioning time.  The farmer address is
-- the payout identity supplied by the owner when the node is registered; the
-- cell signs with its own peerMUID key.  This row is what lets a client check
-- that the cell signing an invoice is authorized to collect for that farmer,
-- so a compromised cell cannot redirect payment to an address of its choosing.
-- One farmer may own many cells.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tblFarmerCell (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  farmerMUID    VARCHAR(84) NOT NULL,           -- tblFarmer.farmerMUID, payout identity
  peerMUID      VARCHAR(100) NOT NULL,          -- cell signing identity
  peerPubKey    VARCHAR(200) NOT NULL,
  nodeIP        VARCHAR(84) NULL,

  bindHash      CHAR(64) NOT NULL,              -- sha256(farmerMUID|peerMUID|peerPubKey|boundAt)
  farmerSig     VARCHAR(200) NULL,              -- owner signature over bindHash
  networkSig    VARCHAR(200) NULL,              -- provisioning cell(s) signature over bindHash
  boundAt       BIGINT NOT NULL,
  revokedAt     BIGINT NULL,                    -- set on decommission / eviction

  UNIQUE KEY unique_binding (farmerMUID, peerMUID, boundAt),
  KEY idx_peer (peerMUID, revokedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------------
-- Rate card.  Immutable, signed, and versioned by effective window so an old
-- invoice can always be re-checked against the rate that was in force.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tblRateCard (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  farmerMUID    VARCHAR(84) NOT NULL,           -- seller (payout identity)
  peerMUID      VARCHAR(100) NULL,              -- NULL = applies to all the farmer's cells
  service       VARCHAR(100) NOT NULL,          -- matches borg_replay_log.service
  request       VARCHAR(100) NULL,              -- NULL = default rate for the service
  unit          ENUM('access','kbyte','second') NOT NULL DEFAULT 'access',
  unitPrice     DECIMAL(24,8) NOT NULL,
  currency      VARCHAR(12) NOT NULL DEFAULT 'BTC',
  minCharge     DECIMAL(24,8) NOT NULL DEFAULT 0,

  effFrom       BIGINT NOT NULL,                -- ms epoch, inclusive
  effTo         BIGINT NULL,                    -- ms epoch, exclusive; NULL = open

  rateHash      CHAR(64) NOT NULL,              -- sha256 of canonical rate JSON
  rateSig       VARCHAR(200) NOT NULL,          -- seller signature over rateHash
  issuerPubKey  VARCHAR(200) NOT NULL,

  createdAt     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_rate (farmerMUID, peerMUID, service, request, effFrom),
  KEY idx_lookup (farmerMUID, service, request, effFrom, effTo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------------
-- Rated access ledger.  One row per billable access, created by the rater from
-- borg_replay_log.  unique_access makes rating replay-safe; invoiceNo is set
-- when the line is packaged and never cleared.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tblAccessLedger (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  replayKey     VARCHAR(200) NOT NULL,          -- borg_replay_log.replayKey
  logId         BIGINT NOT NULL,                -- borg_replay_log.id
  farmerMUID    VARCHAR(84) NOT NULL,           -- seller: owner of the serving cell
  peerMUID      VARCHAR(100) NOT NULL,          -- cell that served it
  borgHUID      VARCHAR(100) NOT NULL,          -- payer: client MUID
  tokTime       BIGINT NOT NULL,
  service       VARCHAR(100),
  request       VARCHAR(100),

  quantity      DECIMAL(24,8) NOT NULL DEFAULT 1,
  unit          ENUM('access','kbyte','second') NOT NULL DEFAULT 'access',
  rateId        BIGINT NOT NULL,
  unitPrice     DECIMAL(24,8) NOT NULL,         -- copied from rate at rating time
  amount        DECIMAL(24,8) NOT NULL,         -- quantity * unitPrice, min applied
  currency      VARCHAR(12) NOT NULL DEFAULT 'BTC',

  quantitySrc   ENUM('token','node','receipt') NOT NULL DEFAULT 'node',
                                                -- provenance of quantity: signed by
                                                -- client (token/receipt) or asserted
                                                -- by the node (node = not provable)
  leafHash      CHAR(64) NOT NULL,              -- sha256 of canonical line JSON
  invoiceNo     CHAR(36) NULL,
  ratedAt       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_access (replayKey),
  KEY idx_open (borgHUID, invoiceNo, tokTime),
  KEY idx_rate (rateId),
  CONSTRAINT fk_ledger_rate FOREIGN KEY (rateId) REFERENCES tblRateCard(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------------
-- Invoice header.  merkleRoot commits to every line; invoiceSig is the seller's
-- signature over the canonical header, so the whole package is self-verifying
-- offline.  prevInvoiceNo/prevMerkleRoot chain a client's invoices so a seller
-- cannot quietly re-issue or drop a past period.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tblInvoice (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  invoiceNo     CHAR(36) NOT NULL,              -- uuid
  seq           BIGINT NOT NULL,                -- per (farmerMUID,borgHUID), starts at 1
  farmerMUID    VARCHAR(84) NOT NULL,           -- seller of record
  signerMUID    VARCHAR(100) NOT NULL,          -- cell that issued and signed it
  borgHUID      VARCHAR(100) NOT NULL,
  netName       VARCHAR(100) NULL,

  periodStart   BIGINT NOT NULL,                -- ms epoch, inclusive
  periodEnd     BIGINT NOT NULL,                -- ms epoch, exclusive
  lineCount     INT NOT NULL,
  subtotal      DECIMAL(24,8) NOT NULL,
  credits       DECIMAL(24,8) NOT NULL DEFAULT 0,
  total         DECIMAL(24,8) NOT NULL,
  currency      VARCHAR(12) NOT NULL DEFAULT 'BTC',

  merkleRoot    CHAR(64) NOT NULL,
  prevInvoiceNo CHAR(36) NULL,
  prevMerkleRoot CHAR(64) NULL,

  payAddress    VARCHAR(100) NOT NULL,          -- = farmerMUID unless the farmer overrides
  issuerPubKey  VARCHAR(200) NOT NULL,          -- signerMUID pubkey
  invoiceSig    VARCHAR(200) NOT NULL,          -- signerMUID signature over headerHash
  bindHash      CHAR(64) NOT NULL,              -- tblFarmerCell binding proving authority
  bindProof     TEXT NOT NULL,                  -- JSON: binding row + farmerSig/networkSig
  headerHash    CHAR(64) NOT NULL,

  status        ENUM('draft','issued','sent','partpaid','paid','disputed','void')
                NOT NULL DEFAULT 'draft',
  issuedAt      BIGINT NULL,
  dueAt         BIGINT NULL,
  sentAt        BIGINT NULL,
  packageHash   CHAR(64) NULL,                  -- sha256 of the delivered .json package

  createdAt     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_invoice (invoiceNo),
  UNIQUE KEY unique_seq (farmerMUID, borgHUID, seq),
  UNIQUE KEY unique_period (farmerMUID, borgHUID, periodStart, periodEnd),
  KEY idx_status (status, dueAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------------
-- Invoice lines.  Immutable snapshot: carries its own copy of the client's
-- borgToken proof so the package the client receives needs nothing from the
-- seller's DB to be verified.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tblInvoiceLine (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  invoiceNo     CHAR(36) NOT NULL,
  lineNo        INT NOT NULL,                   -- 1..lineCount, merkle leaf order
  replayKey     VARCHAR(200) NOT NULL,
  tokTime       BIGINT NOT NULL,
  service       VARCHAR(100),
  request       VARCHAR(100),

  quantity      DECIMAL(24,8) NOT NULL,
  unit          ENUM('access','kbyte','second') NOT NULL,
  unitPrice     DECIMAL(24,8) NOT NULL,
  amount        DECIMAL(24,8) NOT NULL,
  rateHash      CHAR(64) NOT NULL,

  -- client-side proof, copied verbatim from borg_replay_log
  signedPayload TEXT NOT NULL,                  -- sesTok: MUID-reqTime-reqId
  borgTokenSig  VARCHAR(200) NOT NULL,          -- client signature over sha256(sesTok)
  clientPubKey  VARCHAR(200) NOT NULL,          -- from borgToken.pubKey

  leafHash      CHAR(64) NOT NULL,
  merklePath    TEXT NOT NULL,                  -- JSON array of {side,hash}

  UNIQUE KEY unique_line (invoiceNo, lineNo),
  UNIQUE KEY unique_line_access (invoiceNo, replayKey),
  KEY idx_invoice (invoiceNo),
  CONSTRAINT fk_line_invoice FOREIGN KEY (invoiceNo)
    REFERENCES tblInvoice(invoiceNo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------------
-- Client responses: payment, and per-line dispute.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tblPayment (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  invoiceNo     CHAR(36) NOT NULL,
  borgHUID      VARCHAR(100) NOT NULL,
  amount        DECIMAL(24,8) NOT NULL,
  currency      VARCHAR(12) NOT NULL DEFAULT 'BTC',
  method        ENUM('onchain','channel','credit') NOT NULL DEFAULT 'onchain',
  txid          VARCHAR(100) NULL,
  payerSig      VARCHAR(200) NULL,              -- client signature over headerHash = accept
  confirmedAt   BIGINT NULL,
  createdAt     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_txid (invoiceNo, txid),
  KEY idx_invoice (invoiceNo),
  CONSTRAINT fk_pay_invoice FOREIGN KEY (invoiceNo)
    REFERENCES tblInvoice(invoiceNo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tblInvoiceDispute (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  invoiceNo     CHAR(36) NOT NULL,
  lineNo        INT NULL,                       -- NULL = whole invoice
  reason        ENUM('unknown_access','bad_signature','wrong_rate','wrong_quantity',
                     'duplicate','other') NOT NULL,
  detail        TEXT NULL,
  payerSig      VARCHAR(200) NOT NULL,          -- client signature over dispute JSON
  raisedAt      BIGINT NOT NULL,
  resolution    ENUM('open','credited','rejected','withdrawn') NOT NULL DEFAULT 'open',
  resolvedAt    BIGINT NULL,
  creditAmount  DECIMAL(24,8) NOT NULL DEFAULT 0,

  KEY idx_invoice (invoiceNo, resolution),
  CONSTRAINT fk_dispute_invoice FOREIGN KEY (invoiceNo)
    REFERENCES tblInvoice(invoiceNo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------------
-- Needed on borg_replay_log for billing: which cell served the access, and how
-- much work it was.  Without peerMUID a shared DB (as in test/selfrepair) mixes
-- every cell's accesses into one table with no way to attribute them; the
-- farmer is then resolved through tblFarmerCell.
-- ---------------------------------------------------------------------------
-- ALTER TABLE borg_replay_log
--   ADD COLUMN peerMUID VARCHAR(100) NULL AFTER borgHUID,
--   ADD COLUMN bytesIn  BIGINT NULL,
--   ADD COLUMN bytesOut BIGINT NULL,
--   ADD COLUMN msgHash  CHAR(64) NULL,
--   ADD KEY idx_node_time (peerMUID, tokTime DESC);
