// *********************************************************
// CLASS: SFarmAccountant
// Shell farm accounting: turns borg_replay_log accesses into signed invoices
// the client can verify item by item, then tracks payment and disputes.
//
//   borg_replay_log --rate--> tblAccessLedger --package--> tblInvoice/tblInvoiceLine
//
// Schema and reasoning: mariadb/shellAccounting.sql, mariadb/ACCOUNTING.md
// *********************************************************
const fs = require('fs');
const crypto = require('crypto');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const bitcoin = require('bitcoinjs-lib');

const DAY_MS = 86400000;

class SFarmAccountant {
  constructor(peerTree) {
    this.net  = peerTree;
    this.cell = null;

    this.farmerMUID  = null;
    this.binding     = null;   // tblFarmerCell row proving this cell may bill for the farmer
    this.policy      = null;   // tblBillingPolicy row in force
    this.cardVersion = null;   // rate card version fetched for the current run

    this.priceServiceIp = null;
    this.invoiceDir     = 'invoices/';
    this.logHasPeerMUID = false;
    this.cycleTimer     = null;
    this.rateTimer      = null;
    this.busy           = false;

    this.stats = { rated:0, unratable:0, invoiced:0, billed:0, runs:0 };
  }
  attachCell(cell){
    this.cell = cell;
  }

  // ********************************
  // Lifecycle
  // ================================
  async start(opts = {}) {
    this.priceServiceIp = opts.priceServiceIp || this.priceServiceIp;
    this.farmerMUID     = opts.farmerMUID     || await this.loadFarmerMUID();

    if (!this.farmerMUID){
      console.error('SFarmAccountant.start():: no farmerMUID registered, accounting disabled');
      return false;
    }
    this.logHasPeerMUID = await this.columnExists('borg_replay_log','peerMUID');
    this.binding        = await this.loadBinding();
    this.policy         = await this.loadPolicy();

    if (!this.binding){
      console.error('SFarmAccountant.start():: no tblFarmerCell binding for this cell, cannot bill',
                    this.farmerMUID, this.net.peerMUID);
      return false;
    }
    fs.mkdirSync(this.invoiceDir, { recursive: true });

    const tick = Math.max(60_000, Math.min(this.policy.cycleMs, DAY_MS) / 24);
    this.rateTimer  = setInterval(() => { this.rateNewAccesses(); }, tick);
    this.cycleTimer = setInterval(() => { this.runCycle(); }, tick);
    return true;
  }
  stop(){
    if (this.rateTimer)  clearInterval(this.rateTimer);
    if (this.cycleTimer) clearInterval(this.cycleTimer);
    this.rateTimer  = null;
    this.cycleTimer = null;
  }

  // ********************************
  // DB helpers
  // ================================
  query(SQL, params = []) {
    return new Promise((resolve, reject) => {
      this.net.db.query(SQL, params, (err, result) => {
        if (err) { reject(err); return; }
        resolve(result);
      });
    });
  }
  async queryOne(SQL, params = []) {
    const rows = await this.query(SQL, params);
    return rows && rows.length ? rows[0] : null;
  }
  async columnExists(table, column) {
    const row = await this.queryOne(
      `SELECT count(*) AS n FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column]);
    return !!(row && row.n > 0);
  }
  async loadFarmerMUID() {
    const rows = await this.query(`SELECT farmerMUID FROM tblFarmer ORDER BY id`);
    if (!rows.length) return null;
    if (rows.length > 1){
      console.error('SFarmAccountant.loadFarmerMUID():: shared DB holds multiple farmers,',
                    'pass farmerMUID explicitly');
      return null;
    }
    return rows[0].farmerMUID;
  }
  loadBinding() {
    return this.queryOne(
      `SELECT * FROM tblFarmerCell
       WHERE farmerMUID = ? AND peerMUID = ? AND revokedAt IS NULL
       ORDER BY boundAt DESC LIMIT 1`,
      [this.farmerMUID, this.net.peerMUID]);
  }
  async loadPolicy() {
    const now = Date.now();
    const row = await this.queryOne(
      `SELECT * FROM tblBillingPolicy
       WHERE farmerMUID = ? AND effFrom <= ? AND (effTo IS NULL OR effTo > ?)
       ORDER BY effFrom DESC LIMIT 1`,
      [this.farmerMUID, now, now]);
    return row || this.defaultPolicy();
  }
  defaultPolicy() {
    return {
      farmerMUID : this.farmerMUID,
      cycleMs    : DAY_MS,
      cycleAnchor: 0,
      threshold  : '0',
      minInvoice : '0',
      graceMs    : 300000,
      dueMs      : 7 * DAY_MS,
      currency   : 'BTC'
    };
  }
  async account(borgHUID) {
    const row = await this.queryOne(
      `SELECT * FROM tblBillingAccount WHERE farmerMUID = ? AND borgHUID = ?`,
      [this.farmerMUID, borgHUID]);
    if (row) return row;

    const first = await this.queryOne(
      `SELECT MIN(tokTime) AS t FROM tblAccessLedger WHERE farmerMUID = ? AND borgHUID = ?`,
      [this.farmerMUID, borgHUID]);
    const from = (first && first.t) ? Number(first.t) : Date.now();

    await this.query(
      `INSERT IGNORE INTO tblBillingAccount (farmerMUID, borgHUID, billedThrough)
       VALUES (?, ?, ?)`,
      [this.farmerMUID, borgHUID, from]);

    return this.queryOne(
      `SELECT * FROM tblBillingAccount WHERE farmerMUID = ? AND borgHUID = ?`,
      [this.farmerMUID, borgHUID]);
  }

  // ********************************
  // Pricing: cache the network price list, price each access at its own tokTime
  // ================================
  async fetchRateCards(ip = this.priceServiceIp) {
    if (!ip){
      console.error('SFarmAccountant.fetchRateCards():: no pricing service address, using cache');
      return this.currentCardVersion();
    }
    const msg = { req:'sendRateCard', response:'sendRateCardReply' };
    const reply = await this.net.reqReplyObj.waitForReply(ip, msg);

    if (!reply || reply.result === 'timeout' || reply.result === 'xhrFail'){
      console.error('SFarmAccountant.fetchRateCards():: pricing service unreachable, using cache');
      return this.currentCardVersion();
    }
    const card = reply.result;
    if (!card || !Array.isArray(card.rates)){
      console.error('SFarmAccountant.fetchRateCards():: malformed price list');
      return this.currentCardVersion();
    }
    let stored = 0;
    for (const rate of card.rates){
      if (!this.verifyRateCard(rate, card)) {
        console.error('SFarmAccountant.fetchRateCards():: rejected unsigned/altered rate',
                      rate.service, rate.request);
        continue;
      }
      await this.query(
        `INSERT IGNORE INTO tblRateCard
         (cardVersion, service, request, unit, unitPrice, currency, minCharge,
          effFrom, effTo, publisherMUID, publisherPub, rateHash, rateSig, fetchedAt, fetchedFrom,
          createdAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [card.cardVersion, rate.service, rate.request ?? null, rate.unit,
         rate.unitPrice, rate.currency, rate.minCharge ?? 0,
         rate.effFrom, rate.effTo ?? null, card.publisherMUID, card.publisherPub,
         rate.rateHash, rate.rateSig, Date.now(), ip, Date.now()]);
      stored++;
    }
    this.cardVersion = Number(card.cardVersion);
    return stored ? this.cardVersion : this.currentCardVersion();
  }
  async currentCardVersion() {
    const row = await this.queryOne(`SELECT MAX(cardVersion) AS v FROM tblRateCard`);
    this.cardVersion = row && row.v !== null ? Number(row.v) : null;
    return this.cardVersion;
  }
  // A rate is only usable if the pricing service signed exactly these terms.
  verifyRateCard(rate, card) {
    const hash = this.canonicalHash({
      cardVersion: Number(card.cardVersion),
      service    : rate.service,
      request    : rate.request ?? null,
      unit       : rate.unit,
      unitPrice  : this.amt(rate.unitPrice),
      currency   : rate.currency,
      minCharge  : this.amt(rate.minCharge ?? 0),
      effFrom    : Number(rate.effFrom),
      effTo      : rate.effTo == null ? null : Number(rate.effTo)
    });
    if (hash !== rate.rateHash) return false;
    if (this.addressOf(card.publisherPub) !== card.publisherMUID) return false;
    return this.verifySig(card.publisherPub, hash, rate.rateSig);
  }
  // The card in force when the access happened -- never the card current now.
  rateFor(service, request, atTime) {
    return this.queryOne(
      `SELECT * FROM tblRateCard
       WHERE service = ? AND (request = ? OR request IS NULL)
         AND effFrom <= ? AND (effTo IS NULL OR effTo > ?)
       ORDER BY (request IS NULL), cardVersion DESC LIMIT 1`,
      [service, request ?? null, atTime, atTime]);
  }

  // ********************************
  // Rating: one ledger row per access, idempotent on replayKey
  // ================================
  async rateNewAccesses(limit = 5000) {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const peerCol = this.logHasPeerMUID ? 'l.peerMUID' : 'NULL';
      const rows = await this.query(
        `SELECT l.id, l.replayKey, l.tokTime, l.borgHUID, l.service, l.request,
                l.borgToken, l.borgTokenSig, l.signedPayload, ${peerCol} AS peerMUID
         FROM borg_replay_log l
         LEFT JOIN tblAccessLedger a ON a.replayKey = l.replayKey
         WHERE a.id IS NULL
         ORDER BY l.id LIMIT ${Number(limit)}`);

      const touched = new Map();
      for (const row of rows){
        const rated = await this.rateAccess(row);
        if (!rated) continue;
        const t = touched.get(row.borgHUID) || { amount:0, lines:0 };
        t.amount += Number(rated.amount);
        t.lines++;
        touched.set(row.borgHUID, t);
      }
      for (const [borgHUID, t] of touched){
        await this.account(borgHUID);
        await this.query(
          `UPDATE tblBillingAccount SET accrued = accrued + ?, accruedLines = accruedLines + ?
           WHERE farmerMUID = ? AND borgHUID = ?`,
          [this.amt(t.amount), t.lines, this.farmerMUID, borgHUID]);
      }
      for (const borgHUID of touched.keys()) await this.checkThreshold(borgHUID);
      return rows.length;
    }
    finally { this.busy = false; }
  }
  async rateAccess(row) {
    // A cell may only bill for accesses it served itself.
    const peerMUID = row.peerMUID || this.net.peerMUID;
    if (this.logHasPeerMUID && row.peerMUID && row.peerMUID !== this.net.peerMUID) return null;

    const rate = await this.rateFor(row.service, row.request, Number(row.tokTime));
    if (!rate){
      this.stats.unratable++;
      return null;
    }
    const quantity = this.quantityFor(row, rate);
    if (quantity === null){
      // Metered units need a measurement nobody signed for -- refuse to guess.
      this.stats.unratable++;
      return null;
    }
    const gross  = Number(quantity) * Number(rate.unitPrice);
    const amount = this.amt(Math.max(gross, Number(rate.minCharge)));

    const line = {
      replayKey : row.replayKey,
      tokTime   : Number(row.tokTime),
      service   : row.service,
      request   : row.request,
      quantity  : this.amt(quantity),
      unit      : rate.unit,
      unitPrice : this.amt(rate.unitPrice),
      amount    : amount,
      rateHash  : rate.rateHash,
      borgTokenSig : row.borgTokenSig
    };
    await this.query(
      `INSERT IGNORE INTO tblAccessLedger
       (replayKey, logId, farmerMUID, peerMUID, borgHUID, tokTime, service, request,
        quantity, unit, rateId, unitPrice, amount, currency, quantitySrc, leafHash, ratedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [row.replayKey, row.id, this.farmerMUID, peerMUID, row.borgHUID, line.tokTime,
       line.service, line.request, line.quantity, line.unit, rate.id, line.unitPrice,
       line.amount, rate.currency, rate.unit === 'access' ? 'token' : 'node',
       this.leafHash(line), Date.now()]);

    this.stats.rated++;
    return line;
  }
  quantityFor(row, rate) {
    // Only the access itself is proven by the client's token.  kbyte/second are
    // node-asserted, so they stay unratable until the client signs a completion
    // receipt -- billing an unprovable quantity is worse than not billing it.
    if (rate.unit === 'access') return 1;
    return null;
  }
  async checkThreshold(borgHUID) {
    const threshold = Number(this.policy.threshold);
    if (!(threshold > 0)) return null;

    const acct = await this.account(borgHUID);
    if (Number(acct.accrued) < threshold) return null;

    return this.issueFor(borgHUID, 'threshold');
  }

  // ********************************
  // Invoicing: daily cycle or accrual threshold, whichever fires first
  // ================================
  cycleIndex(now = Date.now()) {
    return Math.floor((now - Number(this.policy.cycleAnchor)) / Number(this.policy.cycleMs));
  }
  async runCycle(now = Date.now()) {
    const runKey = `daily:${this.cycleIndex(now)}`;
    const runId  = await this.claimRun(runKey, 'daily');
    if (!runId) return [];       // already issued for this cycle

    const issued = [];
    try {
      await this.fetchRateCards();
      await this.rateNewAccesses();

      const rows = await this.query(
        `SELECT borgHUID FROM tblBillingAccount
         WHERE farmerMUID = ? AND status = 'active' AND accrued > 0`,
        [this.farmerMUID]);

      for (const row of rows){
        const inv = await this.issueFor(row.borgHUID, 'daily', runId);
        if (inv) issued.push(inv);
      }
      await this.finishRun(runId, issued, 'done');
    }
    catch (err) {
      console.error('SFarmAccountant.runCycle():: failed', err);
      await this.finishRun(runId, issued, 'failed', String(err && err.message || err));
    }
    this.stats.runs++;
    return issued;
  }
  // tblInvoiceRun is the mutex: a retried tick, or a second cell of the same
  // farmer sharing this DB, cannot issue for a cycle that is already claimed.
  async claimRun(runKey, triggerType) {
    try {
      await this.query(
        `INSERT INTO tblInvoiceRun (farmerMUID, runKey, triggerType, cardVersion, startedAt)
         VALUES (?,?,?,?,?)`,
        [this.farmerMUID, runKey, triggerType, this.cardVersion, Date.now()]);
    }
    catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return null;
      throw err;
    }
    const row = await this.queryOne(
      `SELECT id FROM tblInvoiceRun WHERE farmerMUID = ? AND runKey = ?`,
      [this.farmerMUID, runKey]);
    return row ? row.id : null;
  }
  async finishRun(runId, issued, state, error = null) {
    const billed = issued.reduce((sum, inv) => sum + Number(inv.total), 0);
    await this.query(
      `UPDATE tblInvoiceRun
       SET finishedAt = ?, invoiceCount = ?, totalBilled = ?, state = ?, error = ?
       WHERE id = ?`,
      [Date.now(), issued.length, this.amt(billed), state, error, runId]);
  }
  async issueFor(borgHUID, triggerType = 'manual', runId = null) {
    const acct = await this.account(borgHUID);

    // Keyed on the invoice number about to be issued, so two cells racing on a
    // shared DB agree on one claim while a heavy client can still be invoiced
    // several times in a cycle.
    if (triggerType === 'threshold'){
      runId = await this.claimRun(`thresh:${borgHUID}:${Number(acct.lastSeq) + 1}`, 'threshold');
      if (!runId) return null;
    }

    const periodStart = Number(acct.billedThrough);
    const periodEnd   = Date.now() - Number(this.policy.graceMs);
    if (periodEnd <= periodStart) return null;

    const lines = await this.query(
      `SELECT * FROM tblAccessLedger
       WHERE farmerMUID = ? AND borgHUID = ? AND invoiceNo IS NULL
         AND tokTime >= ? AND tokTime < ?
       ORDER BY tokTime, id`,
      [this.farmerMUID, borgHUID, periodStart, periodEnd]);

    if (!lines.length) return null;

    const subtotal = lines.reduce((sum, l) => sum + Number(l.amount), 0);
    // Dust: leave the accesses open, they roll into the next run.
    if (triggerType === 'daily' && subtotal < Number(this.policy.minInvoice)) return null;

    const credits = await this.openCredits(borgHUID);
    const total   = Math.max(0, subtotal - credits);

    const invoiceNo = crypto.randomUUID();
    const now       = Date.now();
    const leaves    = lines.map(l => l.leafHash);
    const tree      = this.merkleTree(leaves);
    const rateProof = await this.rateProofFor(lines);

    const header = {
      invoiceNo, seq: Number(acct.lastSeq) + 1,
      farmerMUID : this.farmerMUID,
      signerMUID : this.net.peerMUID,
      borgHUID, netName: this.net.network || null,
      periodStart, periodEnd,
      lineCount  : lines.length,
      subtotal   : this.amt(subtotal),
      credits    : this.amt(credits),
      total      : this.amt(total),
      currency   : this.policy.currency,
      merkleRoot : tree.root,
      prevInvoiceNo  : acct.lastInvoiceNo,
      prevMerkleRoot : acct.lastMerkleRoot,
      payAddress : this.farmerMUID,
      bindHash   : this.binding.bindHash,
      rateHashes : rateProof.map(r => r.rateHash).sort()
    };
    const headerHash = this.canonicalHash(header);

    await this.query(
      `INSERT INTO tblInvoice
       (invoiceNo, seq, farmerMUID, signerMUID, borgHUID, netName, periodStart, periodEnd,
        lineCount, subtotal, credits, total, currency, merkleRoot, prevInvoiceNo,
        prevMerkleRoot, payAddress, issuerPubKey, invoiceSig, bindHash, bindProof,
        rateProof, headerHash, triggerType, runId, status, issuedAt, dueAt, createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'issued',?,?,?)`,
      [header.invoiceNo, header.seq, header.farmerMUID, header.signerMUID, borgHUID,
       header.netName, periodStart, periodEnd, header.lineCount, header.subtotal,
       header.credits, header.total, header.currency, header.merkleRoot,
       header.prevInvoiceNo, header.prevMerkleRoot, header.payAddress,
       this.net.publicKey, this.signHash(headerHash), header.bindHash,
       JSON.stringify(this.bindProof()), JSON.stringify(rateProof), headerHash,
       triggerType, runId, now, now + Number(this.policy.dueMs), now]);

    for (let i = 0; i < lines.length; i++){
      const l    = lines[i];
      const btok = this.parseJson(await this.borgTokenFor(l.replayKey)) || {};
      await this.query(
        `INSERT INTO tblInvoiceLine
         (invoiceNo, lineNo, replayKey, tokTime, service, request, quantity, unit,
          unitPrice, amount, rateHash, signedPayload, borgTokenSig, clientPubKey,
          leafHash, merklePath)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [invoiceNo, i + 1, l.replayKey, l.tokTime, l.service, l.request, l.quantity,
         l.unit, l.unitPrice, l.amount, await this.rateHashOf(l.rateId),
         btok.sesTok || null, btok.sesSig || null, btok.pubKey || null,
         l.leafHash, JSON.stringify(tree.paths[i])]);
    }
    // Stamp the ledger last, guarded on invoiceNo IS NULL so a concurrent run
    // cannot hand the same access to two invoices.
    const ids = lines.map(l => l.id);
    const stamped = await this.query(
      `UPDATE tblAccessLedger SET invoiceNo = ?
       WHERE invoiceNo IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
      [invoiceNo, ...ids]);

    if (stamped.affectedRows !== lines.length){
      await this.query(`UPDATE tblInvoice SET status = 'void' WHERE invoiceNo = ?`, [invoiceNo]);
      console.error('SFarmAccountant.issueFor():: lost race for ledger lines, invoice voided',
                    invoiceNo, stamped.affectedRows, lines.length);
      return null;
    }
    await this.query(
      `UPDATE tblBillingAccount
       SET billedThrough = ?, lastSeq = ?, lastInvoiceNo = ?, lastMerkleRoot = ?,
           accrued = GREATEST(accrued - ?, 0), accruedLines = GREATEST(accruedLines - ?, 0),
           outstanding = outstanding + ?, lastRunAt = ?
       WHERE farmerMUID = ? AND borgHUID = ?`,
      [periodEnd, header.seq, invoiceNo, header.merkleRoot, this.amt(subtotal),
       lines.length, this.amt(total), now, this.farmerMUID, borgHUID]);

    if (credits > 0) await this.applyCredits(borgHUID, invoiceNo);

    this.stats.invoiced++;
    this.stats.billed += total;

    await this.writePackage(invoiceNo);
    return { invoiceNo, borgHUID, seq: header.seq, total: header.total,
             lineCount: lines.length, triggerType };
  }
  async openCredits(borgHUID) {
    const row = await this.queryOne(
      `SELECT COALESCE(SUM(d.creditAmount),0) AS c
       FROM tblInvoiceDispute d JOIN tblInvoice i ON i.invoiceNo = d.invoiceNo
       WHERE i.farmerMUID = ? AND i.borgHUID = ? AND d.resolution = 'credited'
         AND d.creditAmount > 0 AND d.appliedTo IS NULL`,
      [this.farmerMUID, borgHUID]).catch(() => null);
    return row ? Number(row.c) : 0;
  }
  applyCredits(borgHUID, invoiceNo) {
    return this.query(
      `UPDATE tblInvoiceDispute d JOIN tblInvoice i ON i.invoiceNo = d.invoiceNo
       SET d.appliedTo = ?
       WHERE i.farmerMUID = ? AND i.borgHUID = ? AND d.resolution = 'credited'
         AND d.creditAmount > 0 AND d.appliedTo IS NULL`,
      [invoiceNo, this.farmerMUID, borgHUID]).catch(() => null);
  }
  async borgTokenFor(replayKey) {
    const row = await this.queryOne(
      `SELECT borgToken FROM borg_replay_log WHERE replayKey = ?`, [replayKey]);
    return row ? row.borgToken : null;
  }
  async rateHashOf(rateId) {
    const row = await this.queryOne(`SELECT rateHash FROM tblRateCard WHERE id = ?`, [rateId]);
    return row ? row.rateHash : null;
  }
  async rateProofFor(lines) {
    const ids = [...new Set(lines.map(l => l.rateId))];
    if (!ids.length) return [];
    return this.query(
      `SELECT cardVersion, service, request, unit, unitPrice, currency, minCharge,
              effFrom, effTo, publisherMUID, publisherPub, rateHash, rateSig
       FROM tblRateCard WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  bindProof() {
    const b = this.binding;
    return {
      farmerMUID: b.farmerMUID, peerMUID: b.peerMUID, peerPubKey: b.peerPubKey,
      boundAt: Number(b.boundAt), bindHash: b.bindHash,
      farmerSig: b.farmerSig, networkSig: b.networkSig
    };
  }

  // ********************************
  // Packaging and delivery
  // ================================
  async buildPackage(invoiceNo) {
    const invoice = await this.queryOne(`SELECT * FROM tblInvoice WHERE invoiceNo = ?`, [invoiceNo]);
    if (!invoice) return null;
    const lines = await this.query(
      `SELECT * FROM tblInvoiceLine WHERE invoiceNo = ? ORDER BY lineNo`, [invoiceNo]);

    return {
      invoice : {
        invoiceNo: invoice.invoiceNo, seq: Number(invoice.seq),
        farmerMUID: invoice.farmerMUID, signerMUID: invoice.signerMUID,
        borgHUID: invoice.borgHUID, netName: invoice.netName,
        periodStart: Number(invoice.periodStart), periodEnd: Number(invoice.periodEnd),
        lineCount: Number(invoice.lineCount), subtotal: this.amt(invoice.subtotal),
        credits: this.amt(invoice.credits), total: this.amt(invoice.total),
        currency: invoice.currency, merkleRoot: invoice.merkleRoot,
        prevInvoiceNo: invoice.prevInvoiceNo, prevMerkleRoot: invoice.prevMerkleRoot,
        payAddress: invoice.payAddress, bindHash: invoice.bindHash,
        rateHashes: this.parseJson(invoice.rateProof).map(r => r.rateHash).sort(),
        headerHash: invoice.headerHash, issuerPubKey: invoice.issuerPubKey,
        invoiceSig: invoice.invoiceSig, issuedAt: Number(invoice.issuedAt),
        dueAt: Number(invoice.dueAt)
      },
      bindProof : this.parseJson(invoice.bindProof),
      rateProof : this.parseJson(invoice.rateProof),
      lines : lines.map(l => ({
        lineNo: Number(l.lineNo), replayKey: l.replayKey, tokTime: Number(l.tokTime),
        service: l.service, request: l.request, quantity: this.amt(l.quantity),
        unit: l.unit, unitPrice: this.amt(l.unitPrice), amount: this.amt(l.amount),
        rateHash: l.rateHash, signedPayload: l.signedPayload,
        borgTokenSig: l.borgTokenSig, clientPubKey: l.clientPubKey,
        leafHash: l.leafHash, merklePath: this.parseJson(l.merklePath)
      }))
    };
  }
  async writePackage(invoiceNo) {
    const pkg = await this.buildPackage(invoiceNo);
    if (!pkg) return null;

    const body = JSON.stringify(pkg, null, 2);
    const file = `${this.invoiceDir}${invoiceNo}.json`;
    fs.writeFileSync(file, body);

    await this.query(`UPDATE tblInvoice SET packageHash = ? WHERE invoiceNo = ?`,
      [this.net.calculateHash(body), invoiceNo]);
    return file;
  }
  // Hand the package to the client over the peer network.  Delivery failure is
  // not a billing failure: the invoice stands and can be re-sent or pulled.
  async sendInvoice(invoiceNo, clientIp) {
    const pkg = await this.buildPackage(invoiceNo);
    if (!pkg) return false;

    const reply = await this.net.reqReplyObj.waitForReply(clientIp, {
      req: 'borgInvoice', response: 'borgInvoiceReply', invoice: pkg
    });
    if (!reply || reply.result === 'timeout' || reply.result === 'xhrFail'){
      console.error('SFarmAccountant.sendInvoice():: could not deliver', invoiceNo, clientIp);
      return false;
    }
    await this.query(`UPDATE tblInvoice SET status = 'sent', sentAt = ? WHERE invoiceNo = ?`,
      [Date.now(), invoiceNo]);
    return true;
  }

  // ********************************
  // Client responses
  // ================================
  async recordPayment(j) {
    const invoice = await this.queryOne(
      `SELECT * FROM tblInvoice WHERE invoiceNo = ? AND farmerMUID = ?`,
      [j.invoiceNo, this.farmerMUID]);
    if (!invoice) return { result:false, msg:'unknown invoice' };

    // The payer signs headerHash: that signature is its acceptance of the terms.
    if (j.payerSig && !this.verifySig(j.clientPubKey, invoice.headerHash, j.payerSig)){
      return { result:false, msg:'payerSig does not verify against headerHash' };
    }
    await this.query(
      `INSERT IGNORE INTO tblPayment
       (invoiceNo, borgHUID, amount, currency, method, txid, payerSig, confirmedAt, createdAt)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [j.invoiceNo, invoice.borgHUID, this.amt(j.amount), invoice.currency,
       j.method || 'onchain', j.txid || null, j.payerSig || null, j.confirmedAt || null,
       Date.now()]);

    const paid = await this.queryOne(
      `SELECT COALESCE(SUM(amount),0) AS p FROM tblPayment WHERE invoiceNo = ?`, [j.invoiceNo]);
    const status = Number(paid.p) >= Number(invoice.total) ? 'paid' : 'partpaid';

    await this.query(`UPDATE tblInvoice SET status = ? WHERE invoiceNo = ?`, [status, j.invoiceNo]);
    await this.query(
      `UPDATE tblBillingAccount SET outstanding = GREATEST(outstanding - ?, 0)
       WHERE farmerMUID = ? AND borgHUID = ?`,
      [this.amt(j.amount), this.farmerMUID, invoice.borgHUID]);

    return { result:true, status };
  }
  async recordDispute(j) {
    const invoice = await this.queryOne(
      `SELECT * FROM tblInvoice WHERE invoiceNo = ? AND farmerMUID = ?`,
      [j.invoiceNo, this.farmerMUID]);
    if (!invoice) return { result:false, msg:'unknown invoice' };

    await this.query(
      `INSERT INTO tblInvoiceDispute (invoiceNo, lineNo, reason, detail, payerSig, raisedAt)
       VALUES (?,?,?,?,?,?)`,
      [j.invoiceNo, j.lineNo ?? null, j.reason || 'other', j.detail || null,
       j.payerSig, Date.now()]);

    await this.query(`UPDATE tblInvoice SET status = 'disputed' WHERE invoiceNo = ?`, [j.invoiceNo]);
    return { result:true };
  }

  // ********************************
  // Verification.  The client runs the same code on the package it receives, so
  // whatever the seller signed is exactly what is checked here.
  // ================================
  static verifyPackage(pkg, expect = {}) {
    const acc = new SFarmAccountant({ peerMUID:null, publicKey:null });
    return acc.verifyPackage(pkg, expect);
  }
  verifyPackage(pkg, expect = {}) {
    const problems = [];
    const inv = pkg && pkg.invoice;
    if (!inv) return { ok:false, problems:['no invoice in package'] };

    if (expect.borgHUID && inv.borgHUID !== expect.borgHUID)
      problems.push(`invoice is not addressed to ${expect.borgHUID}`);

    // header integrity and issuer authority
    const header = {
      invoiceNo: inv.invoiceNo, seq: inv.seq, farmerMUID: inv.farmerMUID,
      signerMUID: inv.signerMUID, borgHUID: inv.borgHUID, netName: inv.netName,
      periodStart: inv.periodStart, periodEnd: inv.periodEnd, lineCount: inv.lineCount,
      subtotal: inv.subtotal, credits: inv.credits, total: inv.total,
      currency: inv.currency, merkleRoot: inv.merkleRoot,
      prevInvoiceNo: inv.prevInvoiceNo, prevMerkleRoot: inv.prevMerkleRoot,
      payAddress: inv.payAddress, bindHash: inv.bindHash, rateHashes: inv.rateHashes
    };
    if (this.canonicalHash(header) !== inv.headerHash) problems.push('headerHash does not match header');
    if (this.addressOf(inv.issuerPubKey) !== inv.signerMUID)
      problems.push('issuerPubKey is not the signerMUID');
    if (!this.verifySig(inv.issuerPubKey, inv.headerHash, inv.invoiceSig))
      problems.push('invoiceSig does not verify');

    // the signing cell must be bound to the farmer being paid
    const bind = pkg.bindProof;
    if (!bind) problems.push('no bindProof');
    else {
      const bindHash = this.canonicalHash({
        farmerMUID: bind.farmerMUID, peerMUID: bind.peerMUID,
        peerPubKey: bind.peerPubKey, boundAt: bind.boundAt
      });
      if (bindHash !== bind.bindHash)   problems.push('bindHash does not match binding');
      if (bind.bindHash !== inv.bindHash) problems.push('invoice cites a different binding');
      if (bind.peerMUID !== inv.signerMUID) problems.push('binding does not cover the signer');
      if (bind.farmerMUID !== inv.farmerMUID) problems.push('binding is for another farmer');
      if (inv.payAddress !== inv.farmerMUID) problems.push('payAddress is not the farmer');
      if (bind.farmerSig && !this.verifySig(bind.peerPubKey, bind.bindHash, bind.farmerSig) &&
          !expect.farmerPubKey)
        problems.push('binding not verifiable without the farmer pubkey');
      if (expect.farmerPubKey && !this.verifySig(expect.farmerPubKey, bind.bindHash, bind.farmerSig))
        problems.push('farmerSig on the binding does not verify');
    }

    // rates: signed by the pricing service, and in force when the access happened
    const rates = new Map();
    for (const r of (pkg.rateProof || [])){
      const hash = this.canonicalHash({
        cardVersion: Number(r.cardVersion), service: r.service,
        request: r.request ?? null, unit: r.unit, unitPrice: this.amt(r.unitPrice),
        currency: r.currency, minCharge: this.amt(r.minCharge ?? 0),
        effFrom: Number(r.effFrom), effTo: r.effTo == null ? null : Number(r.effTo)
      });
      if (hash !== r.rateHash){ problems.push(`rate ${r.service} hash mismatch`); continue; }
      if (expect.publisherMUID && this.addressOf(r.publisherPub) !== expect.publisherMUID){
        problems.push(`rate ${r.service} signed by an unexpected publisher`); continue;
      }
      if (!this.verifySig(r.publisherPub, hash, r.rateSig)){
        problems.push(`rate ${r.service} signature does not verify`); continue;
      }
      rates.set(r.rateHash, r);
    }

    // lines
    const lines = pkg.lines || [];
    if (lines.length !== inv.lineCount) problems.push('lineCount does not match lines');

    let sum = 0;
    const seen = new Set();
    for (const l of lines){
      const where = `line ${l.lineNo}`;

      if (seen.has(l.replayKey)) problems.push(`${where}: duplicate replayKey ${l.replayKey}`);
      seen.add(l.replayKey);

      // the client's own signature is what makes the item undeniable
      if (l.signedPayload !== `${inv.borgHUID}-${this.reqTimeOf(l)}-${this.reqIdOf(l)}`)
        problems.push(`${where}: signedPayload is not this client's token`);
      if (l.replayKey !== `${inv.borgHUID}:${this.reqIdOf(l)}`)
        problems.push(`${where}: replayKey does not match the signed token`);
      if (this.addressOf(l.clientPubKey) !== inv.borgHUID)
        problems.push(`${where}: clientPubKey is not this client`);
      if (!this.verifySig(l.clientPubKey, this.hash(l.signedPayload), l.borgTokenSig))
        problems.push(`${where}: client signature does not verify`);

      if (l.tokTime < inv.periodStart || l.tokTime >= inv.periodEnd)
        problems.push(`${where}: tokTime outside the invoiced period`);

      const rate = rates.get(l.rateHash);
      if (!rate) problems.push(`${where}: cites a rate not proven in the package`);
      else {
        if (rate.service !== l.service) problems.push(`${where}: rate is for another service`);
        if (this.amt(rate.unitPrice) !== this.amt(l.unitPrice))
          problems.push(`${where}: charged ${l.unitPrice}, card says ${rate.unitPrice}`);
        if (Number(rate.effFrom) > l.tokTime ||
            (rate.effTo != null && Number(rate.effTo) <= l.tokTime))
          problems.push(`${where}: rate was not in force at tokTime`);
        const expectAmt = this.amt(Math.max(Number(l.quantity) * Number(l.unitPrice),
                                            Number(rate.minCharge ?? 0)));
        if (expectAmt !== this.amt(l.amount))
          problems.push(`${where}: amount ${l.amount} != ${expectAmt}`);
      }
      if (this.leafHash(l) !== l.leafHash) problems.push(`${where}: leafHash does not match the line`);
      if (this.foldPath(l.leafHash, l.merklePath) !== inv.merkleRoot)
        problems.push(`${where}: merkle path does not reach merkleRoot`);

      sum += Number(l.amount);
    }
    if (this.amt(sum) !== this.amt(inv.subtotal))
      problems.push(`subtotal ${inv.subtotal} != sum of lines ${this.amt(sum)}`);
    if (this.amt(Number(inv.subtotal) - Number(inv.credits)) !== this.amt(inv.total))
      problems.push('total is not subtotal - credits');

    if (expect.prevMerkleRoot !== undefined && inv.prevMerkleRoot !== expect.prevMerkleRoot)
      problems.push('does not chain onto the previous invoice');
    if (expect.lastSeq !== undefined && inv.seq !== Number(expect.lastSeq) + 1)
      problems.push(`sequence gap: expected ${Number(expect.lastSeq) + 1}, got ${inv.seq}`);

    return { ok: problems.length === 0, problems, total: inv.total, payAddress: inv.payAddress };
  }
  reqIdOf(line){
    const parts = String(line.signedPayload || '').split('-');
    return parts.slice(2).join('-');
  }
  reqTimeOf(line){
    return String(line.signedPayload || '').split('-')[1];
  }

  // ********************************
  // Hashing, merkle, signing
  // ================================
  hash(txt){
    return crypto.createHash('sha256').update(txt).digest('hex');
  }
  // Canonical form: keys sorted, decimals fixed to 8 places, no whitespace --
  // so seller and client hash byte-identical JSON.
  canonical(obj){
    if (obj === null || obj === undefined) return 'null';
    if (Array.isArray(obj)) return `[${obj.map(v => this.canonical(v)).join(',')}]`;
    if (typeof obj === 'object')
      return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${this.canonical(obj[k])}`).join(',')}}`;
    return JSON.stringify(obj);
  }
  canonicalHash(obj){
    return this.hash(this.canonical(obj));
  }
  amt(v){
    return Number(v).toFixed(8);
  }
  leafHash(line){
    return this.canonicalHash({
      replayKey : line.replayKey,
      tokTime   : Number(line.tokTime),
      service   : line.service,
      request   : line.request ?? null,
      quantity  : this.amt(line.quantity),
      unit      : line.unit,
      unitPrice : this.amt(line.unitPrice),
      amount    : this.amt(line.amount),
      rateHash  : line.rateHash,
      borgTokenSig : line.borgTokenSig
    });
  }
  merkleTree(leaves){
    if (!leaves.length) return { root: this.hash(''), paths: [] };

    const paths = leaves.map(() => []);
    let level   = leaves.slice();
    let groups  = leaves.map((_, i) => [i]);   // leaf indices under each node

    while (level.length > 1){
      const next = [];
      const nextGroups = [];
      for (let i = 0; i < level.length; i += 2){
        const left  = level[i];
        const right = (i + 1 < level.length) ? level[i + 1] : level[i];
        const lg    = groups[i];
        const rg    = (i + 1 < level.length) ? groups[i + 1] : groups[i];

        for (const idx of lg) paths[idx].push({ side:'right', hash:right });
        if (i + 1 < level.length) for (const idx of rg) paths[idx].push({ side:'left', hash:left });

        next.push(this.hash(left + right));
        nextGroups.push(lg.concat(i + 1 < level.length ? rg : []));
      }
      level  = next;
      groups = nextGroups;
    }
    return { root: level[0], paths };
  }
  foldPath(leafHash, path){
    return (path || []).reduce((acc, step) =>
      step.side === 'right' ? this.hash(acc + step.hash) : this.hash(step.hash + acc), leafHash);
  }
  signHash(hash){
    return this.net.signingKey.sign(hash, 'base64').toDER('hex');
  }
  verifySig(pubKeyHex, hash, sigHex){
    if (!pubKeyHex || !sigHex) return false;
    try { return ec.keyFromPublic(pubKeyHex, 'hex').verify(hash, sigHex); }
    catch { return false; }
  }
  addressOf(pubKeyHex){
    try {
      return bitcoin.payments.p2pkh({ pubkey: Buffer.from(pubKeyHex, 'hex') }).address;
    }
    catch { return null; }
  }
  parseJson(txt){
    if (txt === null || txt === undefined) return null;
    if (typeof txt === 'object') return txt;
    try { return JSON.parse(txt); }
    catch { return null; }
  }
}
module.exports.SFarmAccountant = SFarmAccountant;
