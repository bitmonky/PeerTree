#!/usr/bin/env node
/*
 * SFarmAccountant test suite.
 *
 * Drives the real class against a real MariaDB carrying the real schema, with a
 * stub in place of the cell (DB handle, keys, hash, req/reply) and a stub in
 * place of the network pricing service.  Accesses are minted the way
 * verifyLogin() mints them -- a client-signed sesTok written to borg_replay_log
 * -- so what the rater reads here is byte-identical to production.
 *
 * The suite asserts the two properties the design rests on:
 *   idempotency  -- rating and invoicing can be retried or raced without ever
 *                   double-billing or skipping an access
 *   verifiability -- a client holding only the JSON package can prove every
 *                   line, and any tampering with it is detected
 *
 * Usage:  test/accounting/run.sh          (starts MariaDB, loads schema, runs this)
 *         DB_HOST=... node suite.js       (against an existing DB)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const mysql = require('mysql2');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const bitcoin = require('bitcoinjs-lib');

const { SFarmAccountant } = require(process.env.SCRIPTS
  ? path.join(process.env.SCRIPTS, 'sFarmAccountant.js')
  : '../../scripts/sFarmAccountant.js');

const DAY_MS = 86400000;
const MIN_MS = 60000;

const log = [];
let failed = 0;
let current = '';

function say(line){ console.log(line); log.push(line); }
function scenario(name){ current = name; say(`\n== ${name}`); }
function ok(cond, what){
  if (cond) { say(`   pass  ${what}`); return true; }
  failed++;
  say(`   FAIL  ${what}`);
  return false;
}
function eq(got, want, what){
  return ok(String(got) === String(want), `${what} (got ${got}, want ${want})`);
}
function problemsInclude(res, fragment, what){
  const hit = res.problems.some(p => p.includes(fragment));
  return ok(!res.ok && hit, `${what} -- ${hit ? 'detected' : 'problems: ' + JSON.stringify(res.problems)}`);
}

// ---------------------------------------------------------------- identities
const hash = txt => crypto.createHash('sha256').update(txt).digest('hex');
const addressOf = pubHex =>
  bitcoin.payments.p2pkh({ pubkey: Buffer.from(pubHex, 'hex') }).address;

function identity(){
  const key = ec.genKeyPair();
  const pub = key.getPublic('hex');
  return { key, pub, muid: addressOf(pub), sign: h => key.sign(h, 'base64').toDER('hex') };
}

// -------------------------------------------------------------- cell stub
class FakeCell {
  constructor(db, id, priceCard){
    this.db         = db;
    this.peerMUID   = id.muid;
    this.publicKey  = id.pub;
    this.signingKey = id.key;
    this.network    = 'testNet';
    this.priceCard  = priceCard;
    this.sent       = [];

    this.reqReplyObj = {
      waitForReply: async (ip, msg) => {
        if (msg.req === 'sendRateCard') return { result: this.priceCard };
        if (msg.req === 'borgInvoice') { this.sent.push({ ip, msg }); return { result: { ack:true } }; }
        return { result: 'timeout' };
      }
    };
  }
  calculateHash(txt){ return hash(txt); }
}

// --------------------------------------------------------- pricing service
// Publishes the same signed card shape the network pricing service will:
// versioned rates with an effective window, each signed over its canonical hash.
function publishCard(publisher, cardVersion, rates){
  const acc = new SFarmAccountant({});
  const card = { cardVersion, publisherMUID: publisher.muid, publisherPub: publisher.pub, rates: [] };
  for (const r of rates){
    const rate = {
      service: r.service, request: r.request ?? null, unit: r.unit || 'access',
      unitPrice: r.unitPrice, currency: r.currency || 'BTC', minCharge: r.minCharge ?? 0,
      effFrom: r.effFrom, effTo: r.effTo ?? null
    };
    rate.rateHash = acc.canonicalHash({
      cardVersion: Number(cardVersion), service: rate.service, request: rate.request,
      unit: rate.unit, unitPrice: acc.amt(rate.unitPrice), currency: rate.currency,
      minCharge: acc.amt(rate.minCharge), effFrom: Number(rate.effFrom),
      effTo: rate.effTo == null ? null : Number(rate.effTo)
    });
    rate.rateSig = publisher.sign(rate.rateHash);
    card.rates.push(rate);
  }
  return card;
}

// ------------------------------------------------------------------ db glue
function connect(){
  return new Promise((resolve, reject) => {
    const con = mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'shellfarmer',
      password: process.env.DB_PASS || 'shellfarmer',
      database: process.env.DB_NAME || 'shellFarmer',
      dateStrings: 'date',
      multipleStatements: true,
      supportBigNumbers: true
    });
    con.connect(err => err ? reject(err) : resolve(con));
  });
}
const q = (con, SQL, params = []) => new Promise((resolve, reject) =>
  con.query(SQL, params, (err, res) => err ? reject(err) : resolve(res)));
const q1 = async (con, SQL, params = []) => (await q(con, SQL, params))[0];

async function waitForDB(tries = 60){
  for (let i = 0; i < tries; i++){
    try { return await connect(); }
    catch (err) { await new Promise(r => setTimeout(r, 1000)); }
  }
  throw new Error('database never came up');
}

async function resetTables(con){
  await q(con, `SET FOREIGN_KEY_CHECKS = 0`);
  for (const t of ['tblInvoiceDispute','tblPayment','tblInvoiceLine','tblInvoice','tblInvoiceRun',
                   'tblAccessLedger','tblBillingAccount','tblBillingPolicy','tblRateCard',
                   'tblFarmerCell','tblFarmer','borg_replay_log'])
    await q(con, `TRUNCATE TABLE ${t}`);
  await q(con, `SET FOREIGN_KEY_CHECKS = 1`);
}

// The billing columns the accountant wants on the log (commented out in
// shellAccounting.sql until the cell writes them) -- applied here so the
// per-cell attribution path is exercised.
async function addPeerMUIDColumn(con){
  const row = await q1(con,
    `SELECT count(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'borg_replay_log' AND column_name = 'peerMUID'`);
  if (row.n > 0) return;
  await q(con, `ALTER TABLE borg_replay_log ADD COLUMN peerMUID VARCHAR(100) NULL AFTER borgHUID`);
}

// ------------------------------------------------------- access minting
// Mints an access exactly as peerTree.verifyLogin() records one: sesTok is
// '<Address>-<reqTime>-<reqId>', signed by the client over sha256(sesTok).
async function access(con, client, cell, opts = {}){
  const reqTime = opts.tokTime ?? Date.now();
  const reqId   = opts.reqId   ?? crypto.randomUUID();
  const sesTok  = `${client.muid}-${reqTime}-${reqId}`;
  const sesSig  = opts.badSig ? client.sign(hash(sesTok + 'x')) : client.sign(hash(sesTok));
  const token   = { Address: client.muid, reqTime, reqId, sesTok, sesSig, pubKey: client.pub };

  const cols = ['replayKey','tokTime','borgHUID','service','request','borgToken','borgTokenSig',
                'signedPayload','peerMUID'];
  await q(con,
    `INSERT INTO borg_replay_log (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    [`${client.muid}:${reqId}`, reqTime, client.muid, opts.service || 'cronoTreeCell',
     opts.request || 'getShard', JSON.stringify(token), sesSig, sesTok,
     opts.peerMUID ?? cell.muid]);
  return { replayKey: `${client.muid}:${reqId}`, tokTime: reqTime };
}

// ------------------------------------------------------------------ helpers
async function bindCell(con, farmer, cell, boundAt){
  const acc = new SFarmAccountant({});
  const bindHash = acc.canonicalHash({
    farmerMUID: farmer.muid, peerMUID: cell.muid, peerPubKey: cell.pub, boundAt
  });
  await q(con,
    `INSERT INTO tblFarmerCell (farmerMUID, peerMUID, peerPubKey, nodeIP, bindHash, farmerSig, boundAt)
     VALUES (?,?,?,?,?,?,?)`,
    [farmer.muid, cell.muid, cell.pub, '198.51.100.11', bindHash, farmer.sign(bindHash), boundAt]);
  return bindHash;
}
async function setPolicy(con, farmerMUID, p = {}){
  await q(con, `DELETE FROM tblBillingPolicy WHERE farmerMUID = ?`, [farmerMUID]);
  await q(con,
    `INSERT INTO tblBillingPolicy
     (farmerMUID, cycleMs, cycleAnchor, threshold, minInvoice, graceMs, dueMs, currency, effFrom)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [farmerMUID, p.cycleMs ?? DAY_MS, p.cycleAnchor ?? 0, p.threshold ?? 0,
     p.minInvoice ?? 0, p.graceMs ?? 0, p.dueMs ?? 7 * DAY_MS, p.currency ?? 'BTC', 0]);
}
const clone = o => JSON.parse(JSON.stringify(o));

// The header hash exactly as the accountant computes it, for forging attempts.
function rehash(inv){
  const acc = new SFarmAccountant({});
  return acc.canonicalHash({
    invoiceNo: inv.invoiceNo, seq: inv.seq, farmerMUID: inv.farmerMUID,
    signerMUID: inv.signerMUID, borgHUID: inv.borgHUID, netName: inv.netName,
    periodStart: inv.periodStart, periodEnd: inv.periodEnd, lineCount: inv.lineCount,
    subtotal: inv.subtotal, credits: inv.credits, total: inv.total,
    currency: inv.currency, merkleRoot: inv.merkleRoot, prevInvoiceNo: inv.prevInvoiceNo,
    prevMerkleRoot: inv.prevMerkleRoot, payAddress: inv.payAddress,
    bindHash: inv.bindHash, rateHashes: inv.rateHashes
  });
}

// ------------------------------------------------------------------- suite
async function main(){
  const con = await waitForDB();
  await q(con, `USE ${process.env.DB_NAME || 'shellFarmer'}`);
  await addPeerMUIDColumn(con);
  await resetTables(con);

  const publisher = identity();          // network pricing service
  const farmer    = identity();          // payout identity, set at provisioning
  const cell      = identity();          // the serving cell
  const otherCell = identity();          // another cell sharing this DB
  const alice     = identity();          // client
  const bob       = identity();          // client

  const now  = Date.now();
  const card = publishCard(publisher, 1, [
    { service:'cronoTreeCell', request:null, unit:'access', unitPrice:'0.00000100',
      minCharge:'0.00000100', effFrom: now - 30 * DAY_MS },
    { service:'cronoTreeCell', request:'getShard', unit:'access', unitPrice:'0.00000500',
      minCharge:0, effFrom: now - 30 * DAY_MS },
    { service:'cronoTreeCell', request:'bigStream', unit:'kbyte', unitPrice:'0.00000010',
      minCharge:0, effFrom: now - 30 * DAY_MS }
  ]);

  await q(con, `INSERT INTO tblFarmer (farmerMUID) VALUES (?)`, [farmer.muid]);
  await bindCell(con, farmer, cell, now - 30 * DAY_MS);
  await setPolicy(con, farmer.muid, { threshold: 0, minInvoice: 0, graceMs: 0 });

  const net = new FakeCell(con, cell, card);
  const acc = new SFarmAccountant(net);
  acc.invoiceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoices-')) + '/';

  // ------------------------------------------------------------------
  scenario('startup: farmer, binding and policy resolve from the DB');
  const started = await acc.start({});
  ok(started === true, 'start() succeeded');
  eq(acc.farmerMUID, farmer.muid, 'farmerMUID read from tblFarmer');
  ok(!!acc.binding, 'tblFarmerCell binding found for this cell');
  ok(acc.logHasPeerMUID === true, 'peerMUID column on borg_replay_log detected');
  eq(acc.policy.graceMs, 0, 'policy loaded from tblBillingPolicy');
  acc.stop();

  // ------------------------------------------------------------------
  scenario('pricing: signed cards are cached, altered cards refused');
  eq(await acc.fetchRateCards('198.51.100.9'), 1, 'card version 1 cached');
  eq((await q1(con, `SELECT count(*) AS n FROM tblRateCard`)).n, 3, 'all three signed rates stored');

  const tampered = clone(card);
  tampered.cardVersion = 2;
  tampered.rates[0].unitPrice = '0.00009999';        // price changed, sig not re-made
  const bent = new FakeCell(con, cell, tampered);
  const acc2 = new SFarmAccountant(bent);
  acc2.farmerMUID = farmer.muid;
  await acc2.fetchRateCards('198.51.100.9');
  const v2 = await q1(con,
    `SELECT count(*) AS n FROM tblRateCard WHERE cardVersion = 2 AND service = 'cronoTreeCell' AND request IS NULL`);
  eq(v2.n, 0, 'altered rate rejected, not cached');

  // ------------------------------------------------------------------
  scenario('rating: one ledger row per access, retry-safe, request rate wins');
  const t0 = now - 3 * 60 * MIN_MS;
  for (let i = 0; i < 4; i++) await access(con, alice, cell, { tokTime: t0 + i * MIN_MS });
  await access(con, bob, cell, { tokTime: t0 });
  await access(con, alice, cell, { tokTime: t0 + 5 * MIN_MS, request: 'ping' });   // default rate
  await access(con, alice, cell, { tokTime: t0 + 6 * MIN_MS, request: 'bigStream' }); // metered
  await access(con, alice, otherCell, { tokTime: t0 + 7 * MIN_MS, peerMUID: otherCell.muid });

  await acc.rateNewAccesses();
  await acc.rateNewAccesses();          // rerun: must be a no-op

  eq((await q1(con, `SELECT count(*) AS n FROM tblAccessLedger`)).n, 6,
     'six accesses rated (metered and other-cell access not billed)');
  eq((await q1(con,
       `SELECT count(*) AS n FROM (SELECT replayKey FROM tblAccessLedger
         GROUP BY replayKey HAVING count(*) > 1) d`)).n, 0, 'no access rated twice');
  eq((await q1(con, `SELECT count(*) AS n FROM tblAccessLedger WHERE peerMUID <> ?`,
       [cell.muid])).n, 0, "another cell's access is not billed by this cell");
  eq((await q1(con, `SELECT count(*) AS n FROM tblAccessLedger WHERE unit <> 'access'`)).n, 0,
     'metered access left unrated: no client-signed measurement');
  eq((await q1(con, `SELECT amount FROM tblAccessLedger WHERE request = 'getShard' LIMIT 1`)).amount,
     '0.00000500', 'getShard charged its own rate');
  eq((await q1(con, `SELECT amount FROM tblAccessLedger WHERE request = 'ping' LIMIT 1`)).amount,
     '0.00000100', 'ping falls back to the service default rate');

  const aliceAcct = await q1(con,
    `SELECT accrued, accruedLines FROM tblBillingAccount WHERE borgHUID = ?`, [alice.muid]);
  eq(aliceAcct.accruedLines, 5, 'accrual counts every rated line, not one per run');
  eq(aliceAcct.accrued, '0.00002100', 'accrued = 4 x getShard + 1 x default');

  // ------------------------------------------------------------------
  scenario('daily cycle: one invoice per client per cycle, rerun issues nothing');
  const issued = await acc.runCycle();
  eq(issued.length, 2, 'one invoice each for alice and bob');
  const again = await acc.runCycle();
  eq(again.length, 0, 'second run in the same cycle is blocked by the run mutex');

  eq((await q1(con, `SELECT count(*) AS n FROM tblInvoice WHERE status <> 'void'`)).n, 2,
     'exactly two live invoices');
  eq((await q1(con, `SELECT count(*) AS n FROM tblAccessLedger WHERE invoiceNo IS NULL`)).n, 0,
     'every rated access is now on an invoice');

  const aliceInv = await q1(con,
    `SELECT * FROM tblInvoice WHERE borgHUID = ? ORDER BY seq DESC LIMIT 1`, [alice.muid]);
  eq(aliceInv.total, '0.00002100', 'invoice total matches the accrual');
  eq(aliceInv.lineCount, 5, 'five lines invoiced');
  eq(aliceInv.triggerType, 'daily', 'trigger recorded as daily');

  const acctAfter = await q1(con,
    `SELECT * FROM tblBillingAccount WHERE borgHUID = ?`, [alice.muid]);
  eq(acctAfter.accrued, '0.00000000', 'accrual cleared by invoicing');
  eq(acctAfter.outstanding, '0.00002100', 'invoice moved into outstanding');
  eq(acctAfter.billedThrough, aliceInv.periodEnd, 'watermark advanced to periodEnd');

  // ------------------------------------------------------------------
  scenario('client verification: the package proves itself offline');
  const pkgFile = `${acc.invoiceDir}${aliceInv.invoiceNo}.json`;
  ok(fs.existsSync(pkgFile), 'package written to disk');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  ok(!!pkg.bindProof && Array.isArray(pkg.rateProof) && Array.isArray(pkg.lines),
     'package carries the binding, rate proofs and lines');

  const good = SFarmAccountant.verifyPackage(pkg, {
    borgHUID: alice.muid, publisherMUID: publisher.muid, farmerPubKey: farmer.pub, lastSeq: 0
  });
  ok(good.ok, `package verifies: ${JSON.stringify(good.problems)}`);
  eq(good.total, '0.00002100', 'verifier agrees on the amount payable');
  eq(good.payAddress, farmer.muid, 'payable to the farmer address, not the cell');

  ok(!SFarmAccountant.verifyPackage(pkg, { borgHUID: bob.muid }).ok,
     "another client's package is rejected");

  // ------------------------------------------------------------------
  scenario('tampering: every field a seller could inflate is caught');
  const cases = [
    ['line amount raised', p => { p.lines[0].amount = '0.00500000'; }, 'amount'],
    ['quantity inflated', p => { p.lines[0].quantity = '9.00000000'; }, 'leafHash'],
    ['unit price raised', p => { p.lines[0].unitPrice = '0.00009000'; }, 'leafHash'],
    ['subtotal raised', p => { p.invoice.subtotal = '0.09000000'; }, 'headerHash'],
    ['total raised', p => { p.invoice.total = '0.09000000'; }, 'headerHash'],
    ['payout redirected', p => { p.invoice.payAddress = otherCell.muid; }, 'headerHash'],
    ['line dropped', p => { p.lines.pop(); }, 'lineCount'],
    ['line duplicated', p => { p.lines.push(clone(p.lines[0])); }, 'duplicate replayKey'],
    ['merkleRoot swapped', p => { p.invoice.merkleRoot = hash('nope'); }, 'headerHash'],
    ['client signature forged', p => { p.lines[0].borgTokenSig = p.lines[1].borgTokenSig; }, 'leafHash'],
    ['rate proof stripped', p => { p.rateProof = []; }, 'rate not proven'],
    ['rate price rewritten', p => { p.rateProof[0].unitPrice = '0.00009000'; }, 'hash mismatch'],
    ['binding forged', p => { p.bindProof.farmerMUID = otherCell.muid; }, 'bindHash'],
    // a cell of this farmer that was never bound re-issues the whole invoice in
    // its own name: header rebuilt, re-hashed and re-signed, so only the
    // provisioning-time binding exposes it
    ['invoice forged by an unbound cell of the same farmer', p => {
        p.invoice.signerMUID   = otherCell.muid;
        p.invoice.issuerPubKey = otherCell.pub;
        p.invoice.headerHash   = rehash(p.invoice);
        p.invoice.invoiceSig   = otherCell.sign(p.invoice.headerHash);
      }, 'binding does not cover the signer']
  ];
  for (const [what, bend, expectFragment] of cases){
    const bad = clone(pkg);
    bend(bad);
    problemsInclude(SFarmAccountant.verifyPackage(bad, {
      borgHUID: alice.muid, publisherMUID: publisher.muid, farmerPubKey: farmer.pub
    }), expectFragment, what);
  }

  // a package with a stale rate: charged a price that was not yet in force
  const stale = clone(pkg);
  stale.rateProof.forEach(r => { r.effFrom = Date.now() + DAY_MS; r.rateHash = 'x'; });
  problemsInclude(SFarmAccountant.verifyPackage(stale, { borgHUID: alice.muid }),
                  'hash mismatch', 'rate window rewritten');

  // ------------------------------------------------------------------
  scenario('threshold: a heavy client is invoiced before the daily run');
  await setPolicy(con, farmer.muid, { threshold: '0.00001000', minInvoice: 0, graceMs: 0 });
  acc.policy = await acc.loadPolicy();

  // after the watermark: an access older than billedThrough is already covered
  for (let i = 0; i < 3; i++) await access(con, bob, cell, { tokTime: Date.now() });
  await acc.rateNewAccesses();
  eq((await q1(con,
       `SELECT count(*) AS n FROM tblInvoice WHERE borgHUID = ? AND triggerType = 'threshold'`,
       [bob.muid])).n, 1, 'threshold invoice issued during rating');

  const bobInv = await q1(con,
    `SELECT * FROM tblInvoice WHERE borgHUID = ? AND triggerType = 'threshold'`, [bob.muid]);
  eq(bobInv.seq, 2, 'threshold invoice continues the sequence');
  const bobPkg = JSON.parse(fs.readFileSync(`${acc.invoiceDir}${bobInv.invoiceNo}.json`, 'utf8'));
  const chained = SFarmAccountant.verifyPackage(bobPkg, {
    borgHUID: bob.muid, publisherMUID: publisher.muid, farmerPubKey: farmer.pub,
    prevMerkleRoot: bobInv.prevMerkleRoot, lastSeq: 1
  });
  ok(chained.ok, `threshold package verifies and chains: ${JSON.stringify(chained.problems)}`);
  eq(bobInv.periodStart, (await q1(con,
       `SELECT periodEnd FROM tblInvoice WHERE borgHUID = ? AND seq = 1`, [bob.muid])).periodEnd,
     'periods are contiguous: no gap, no overlap');

  // ------------------------------------------------------------------
  scenario('watermark: an access logged behind billedThrough is never billed');
  const behind = await access(con, bob, cell, { tokTime: bobInv.periodStart - MIN_MS });
  await acc.rateNewAccesses();
  await acc.issueFor(bob.muid, 'manual');
  eq((await q1(con, `SELECT invoiceNo FROM tblAccessLedger WHERE replayKey = ?`,
       [behind.replayKey])).invoiceNo, 'null',
     'a late write behind the watermark stays uninvoiced -- what graceMs exists to prevent');

  // ------------------------------------------------------------------
  scenario('dust: minInvoice defers a tiny period instead of billing it');
  await setPolicy(con, farmer.muid, { threshold: 0, minInvoice: '1.00000000', graceMs: 0 });
  acc.policy = await acc.loadPolicy();
  await access(con, alice, cell, { tokTime: Date.now() });
  await acc.rateNewAccesses();
  const dust = await acc.runCycle(Date.now() + DAY_MS);     // next cycle, so the mutex is free
  eq(dust.length, 0, 'no dust invoice issued');
  eq((await q1(con,
       `SELECT count(*) AS n FROM tblAccessLedger WHERE invoiceNo IS NULL AND borgHUID = ?`,
       [alice.muid])).n, 1, 'the access stays open and rolls into the next run');

  // ------------------------------------------------------------------
  scenario('payment: signed acceptance settles the invoice');
  const payerSig = alice.sign(aliceInv.headerHash);
  const paid = await acc.recordPayment({
    invoiceNo: aliceInv.invoiceNo, amount: '0.00001000', clientPubKey: alice.pub,
    payerSig, method: 'onchain', txid: 'tx-part'
  });
  eq(paid.status, 'partpaid', 'partial payment leaves the invoice part paid');

  const bogus = await acc.recordPayment({
    invoiceNo: aliceInv.invoiceNo, amount: '0.00001100', clientPubKey: alice.pub,
    payerSig: alice.sign(hash('something else')), txid: 'tx-bogus'
  });
  ok(bogus.result === false, 'payment with a signature over the wrong header is refused');

  const full = await acc.recordPayment({
    invoiceNo: aliceInv.invoiceNo, amount: '0.00001100', clientPubKey: alice.pub,
    payerSig, txid: 'tx-rest'
  });
  eq(full.status, 'paid', 'invoice marked paid once the total is covered');
  eq((await q1(con, `SELECT outstanding FROM tblBillingAccount WHERE borgHUID = ?`,
       [alice.muid])).outstanding, '0.00000000', 'outstanding cleared');

  // ------------------------------------------------------------------
  scenario('dispute: an accepted credit comes off the next invoice');
  await acc.recordDispute({
    invoiceNo: bobInv.invoiceNo, lineNo: 1, reason: 'wrong_rate',
    detail: 'charged getShard rate for a ping', payerSig: bob.sign(hash('dispute'))
  });
  eq((await q1(con, `SELECT status FROM tblInvoice WHERE invoiceNo = ?`,
       [bobInv.invoiceNo])).status, 'disputed', 'invoice flagged disputed');

  await q(con,
    `UPDATE tblInvoiceDispute SET resolution = 'credited', creditAmount = '0.00000400',
     resolvedAt = ? WHERE invoiceNo = ?`, [Date.now(), bobInv.invoiceNo]);

  await setPolicy(con, farmer.muid, { threshold: 0, minInvoice: 0, graceMs: 0 });
  acc.policy = await acc.loadPolicy();
  for (let i = 0; i < 2; i++) await access(con, bob, cell, { tokTime: Date.now() });
  await acc.rateNewAccesses();
  const credited = await acc.issueFor(bob.muid, 'manual');
  ok(!!credited, 'credit invoice issued');

  const credInv = await q1(con,
    `SELECT * FROM tblInvoice WHERE invoiceNo = ?`, [credited.invoiceNo]);
  eq(credInv.credits, '0.00000400', 'open credit applied to the new invoice');
  eq(credInv.total, (Number(credInv.subtotal) - 0.000004).toFixed(8),
     'total is subtotal less the credit');
  const credPkg = JSON.parse(fs.readFileSync(`${acc.invoiceDir}${credInv.invoiceNo}.json`, 'utf8'));
  ok(SFarmAccountant.verifyPackage(credPkg, {
       borgHUID: bob.muid, publisherMUID: publisher.muid, farmerPubKey: farmer.pub
     }).ok, 'credited package still verifies');
  eq((await q1(con,
       `SELECT count(*) AS n FROM tblInvoiceDispute
         WHERE appliedTo IS NULL AND resolution = 'credited'`)).n, 0,
     'credit cannot be applied twice');

  // ------------------------------------------------------------------
  scenario('unbound cell: a cell with no binding refuses to bill');
  const rogue = new SFarmAccountant(new FakeCell(con, otherCell, card));
  ok((await rogue.start({})) === false, 'start() refuses without a tblFarmerCell binding');

  // ------------------------------------------------------------------
  scenario('delivery: package handed to the client over the peer network');
  ok(await acc.sendInvoice(credInv.invoiceNo, '198.51.100.20'), 'invoice delivered');
  eq(net.sent.length, 1, 'one borgInvoice request sent');
  eq((await q1(con, `SELECT status FROM tblInvoice WHERE invoiceNo = ?`,
       [credInv.invoiceNo])).status, 'sent', 'invoice marked sent');

  // ------------------------------------------------------------------
  say(`\n${failed ? 'FAILED' : 'OK'}: ${failed} failure(s)`);
  writeReport();
  con.destroy();
  process.exit(failed ? 1 : 0);
}

function writeReport(){
  const file = process.env.REPORT || path.join(__dirname, 'report.txt');
  try { fs.writeFileSync(file, log.join('\n') + '\n'); }
  catch (err) { console.error('could not write report:', err.message); }
}

main().catch(err => {
  say(`\nsuite crashed in "${current}": ${err.stack || err}`);
  writeReport();
  process.exit(1);
});
