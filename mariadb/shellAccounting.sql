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

-- borg_replay_log was created without an explicit charset, so on MariaDB 11 it
-- lands on the server default (utf8mb4_uca1400_ai_ci) while the tables below are
-- utf8mb4_general_ci like the rest of shellFarmer.  Joining replayKey across the
-- two then fails with "Illegal mix of collations", so align the log first.
ALTER TABLE borg_replay_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

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
-- Local cache of the network pricing service's published price list.  The node
-- fetches the current card at the start of an invoicing run and stores it
-- verbatim with the publisher's signature; rows are never edited, a price change
-- arrives as a new cardVersion.  The rater resolves the card whose effective
-- window contains each access's tokTime -- NOT the card current at invoicing
-- time -- so an access is always charged the price that was in force when it
-- happened, and an old invoice stays re-verifiable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tblRateCard (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  cardVersion   BIGINT NOT NULL,                -- publisher's monotonic version
  service       VARCHAR(100) NOT NULL,          -- matches borg_replay_log.service
  request       VARCHAR(100) NULL,              -- NULL = default rate for the service
  unit          ENUM('access','kbyte','second') NOT NULL DEFAULT 'access',
  unitPrice     DECIMAL(24,8) NOT NULL,
  currency      VARCHAR(12) NOT NULL DEFAULT 'BTC',
  minCharge     DECIMAL(24,8) NOT NULL DEFAULT 0,

  effFrom       BIGINT NOT NULL,                -- ms epoch, inclusive
  effTo         BIGINT NULL,                    -- ms epoch, exclusive; NULL = open

  publisherMUID VARCHAR(100) NOT NULL,          -- pricing service identity
  publisherPub  VARCHAR(200) NOT NULL,
  rateHash      CHAR(64) NOT NULL,              -- sha256 of canonical rate JSON
  rateSig       VARCHAR(200) NOT NULL,          -- publisher signature over rateHash
  fetchedAt     BIGINT NOT NULL,                -- when this cell cached it
  fetchedFrom   VARCHAR(100) NULL,              -- IP/MUID the card was served by

  createdAt     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_rate (cardVersion, service, request),
  KEY idx_lookup (service, request, effFrom, effTo)
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
  rateProof     TEXT NOT NULL,                  -- JSON: every rate card cited by a line,
                                                -- with publisher sigs, so the package is
                                                -- verifiable without the pricing service
  headerHash    CHAR(64) NOT NULL,

  triggerType   ENUM('daily','threshold','manual','final') NOT NULL DEFAULT 'daily',
  runId         BIGINT NULL,                    -- tblInvoiceRun that produced it
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
-- Invoicing policy: daily cycle OR accrual threshold, whichever fires first.
-- Published/held per farmer; thresholds keep a heavy client from running up an
-- unbounded unbilled balance between daily runs, and minInvoice stops the daily
-- cycle from emitting dust invoices that cost more to settle than they are
-- worth (those accesses simply stay open and roll into the next run).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tblBillingPolicy (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  farmerMUID    VARCHAR(84) NOT NULL,
  cycleMs       BIGINT NOT NULL DEFAULT 86400000,   -- daily
  cycleAnchor   BIGINT NOT NULL,                    -- ms epoch of cycle boundary 0
  threshold     DECIMAL(24,8) NOT NULL,             -- accrued unbilled amount that
                                                    -- forces an invoice early
  minInvoice    DECIMAL(24,8) NOT NULL DEFAULT 0,   -- below this, defer to next cycle
  graceMs       BIGINT NOT NULL DEFAULT 300000,     -- exclude accesses newer than this
                                                    -- so in-flight writes are not split
  dueMs         BIGINT NOT NULL DEFAULT 604800000,  -- dueAt = issuedAt + dueMs
  currency      VARCHAR(12) NOT NULL DEFAULT 'BTC',
  effFrom       BIGINT NOT NULL,
  effTo         BIGINT NULL,

  UNIQUE KEY unique_policy (farmerMUID, effFrom)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------------
-- Per-client billing account: the watermark that makes periods contiguous and
-- gap-free, plus the running accrual the threshold test reads.  billedThrough is
-- the exclusive end of the last issued period and becomes the next
-- periodStart, so no access can be billed twice or skipped, whichever trigger
-- fires.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tblBillingAccount (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  farmerMUID    VARCHAR(84) NOT NULL,
  borgHUID      VARCHAR(100) NOT NULL,
  billedThrough BIGINT NOT NULL,                -- exclusive; next periodStart
  lastSeq       BIGINT NOT NULL DEFAULT 0,
  lastInvoiceNo CHAR(36) NULL,
  lastMerkleRoot CHAR(64) NULL,
  accrued       DECIMAL(24,8) NOT NULL DEFAULT 0,  -- rated but uninvoiced
  accruedLines  INT NOT NULL DEFAULT 0,
  outstanding   DECIMAL(24,8) NOT NULL DEFAULT 0,  -- issued but unpaid
  lastRunAt     BIGINT NULL,
  status        ENUM('active','suspended','closed') NOT NULL DEFAULT 'active',

  UNIQUE KEY unique_account (farmerMUID, borgHUID),
  KEY idx_due (status, accrued)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------------
-- One row per invoicing run, taken before any invoice is written.  unique_run
-- is the mutex: two cells sharing a DB, or a retried cron tick, cannot both
-- issue for the same cycle.  A run also records the rate card version it
-- fetched, so a run is reproducible.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tblInvoiceRun (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  farmerMUID    VARCHAR(84) NOT NULL,
  runKey        VARCHAR(120) NOT NULL,          -- 'daily:<cycleIndex>' | 'thresh:<borgHUID>:<cycleIndex>'
  triggerType   ENUM('daily','threshold','manual','final') NOT NULL,
  cardVersion   BIGINT NULL,                    -- pricing card fetched for this run
  startedAt     BIGINT NOT NULL,
  finishedAt    BIGINT NULL,
  invoiceCount  INT NOT NULL DEFAULT 0,
  totalBilled   DECIMAL(24,8) NOT NULL DEFAULT 0,
  state         ENUM('running','done','failed') NOT NULL DEFAULT 'running',
  error         TEXT NULL,

  UNIQUE KEY unique_run (farmerMUID, runKey)
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
  appliedTo     CHAR(36) NULL,                  -- invoice the credit was taken off

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
