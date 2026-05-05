/*
 * Distributed Borg-Trader Organism
 * Core matching + order handling organ
 */

const PtreeReceptor = require('./ptreeReceptorObj');
const db = require('./btraderDB');

// ---------------------------------------------------------
// Deterministic Decimal Math (9 decimal fixed precision)
// ---------------------------------------------------------
const D = (x) => BigInt(Math.round(Number(x) * 1e9));
const U = (x) => (Number(x) / 1e9).toFixed(9);

// ---------------------------------------------------------
// Matching Engine (pure, deterministic, no side effects)
// ---------------------------------------------------------
function matchBuyAgainstBook(buy, sells) {
  const fills = [];
  const updatedSells = sells.map(s => ({ ...s }));

  let remainingQuote = D(buy.remainingQuote);
  const maxPrice = D(buy.maxPrice);

  const eligible = updatedSells
    .filter(s =>
      s.token === buy.token &&
      s.userId !== buy.userId &&
      !s.filled &&
      D(s.price) <= maxPrice &&
      D(s.totalBase) > D(s.allocated)
    )
    .sort((a, b) => {
      const pa = D(a.price), pb = D(b.price);
      if (pa !== pb) return Number(pa - pb);
      const aa = D(a.allocated), ab = D(b.allocated);
      if (aa !== ab) return Number(ab - aa);
      return a.id - b.id;
    });

  for (const s of eligible) {
    if (remainingQuote <= 0n) break;

    const price = D(s.price);
    const allocated = D(s.allocated);
    const totalBase = D(s.totalBase);

    const remainingBase = totalBase - allocated;
    if (remainingBase <= 0n) continue;

    let buyBaseQty = remainingQuote / price;
    if (buyBaseQty > remainingBase) buyBaseQty = remainingBase;
    if (buyBaseQty <= 0n) continue;

    const quoteAmt = buyBaseQty * price;

    s.allocated = U(allocated + buyBaseQty);
    if (allocated + buyBaseQty >= totalBase) s.filled = true;

    remainingQuote -= quoteAmt;

    fills.push({
      buyId    : buy.id,
      sellId   : s.id,
      token    : buy.token,
      price    : s.price,
      baseQty  : U(buyBaseQty),
      quoteAmt : U(quoteAmt),
      buyerId  : buy.userId,
      sellerId : s.userId,
    });
  }

  const updatedBuy = {
    ...buy,
    remainingQuote: U(remainingQuote),
    filled: remainingQuote <= 0n
  };

  return { updatedBuy, updatedSells, fills };
}

// ---------------------------------------------------------
// Organism Object
// ---------------------------------------------------------
class BTraderOrganObj {
  constructor(peerTree, reset) {
    this.reset     = reset;
    this.isRoot    = null;
    this.status    = 'starting';
    this.net       = peerTree;
    this.receptor  = null;
    this.db        = db.getConnection();
    this.ordBookStatus = 'startup';
    this.ordBookStart();

    // GET ORDER BOOK
    this.loadOrderBookFromSQL();
  }

  attachReceptor(inReceptor) {
    this.receptor = inReceptor;
  }
  async loadOrderBookFromSQL() {

    this.db.query(`
      SELECT mborID AS id, mborUID AS userId, mborToken AS token,
             mborMax AS maxPrice, mborAmt AS remainingQuote,
             mborFilled AS filled
      FROM tblmrkBuyOrder
      WHERE mborFilled IS NULL AND mborTradeCanceled IS NULL
      ORDER BY mborID ASC
    `, (err, rows) => {
      if (err) return console.error("SQL load buys error:", err);
      this.buys = rows;
    });

    this.db.query(`
      SELECT msorID AS id, msorUID AS userId, msorToken AS token,
             msorMin AS minPrice, msorAmtGP AS remainingBase,
             msorFilled AS filled
      FROM tblmrkSellOrder
      WHERE msorFilled IS NULL AND msorTradeCanceled IS NULL
      ORDER BY msorID ASC
    `, (err, rows) => {
      if (err) return console.error("SQL load sells error:", err);
      this.sells = rows;
    });
  }
  async ordBookStart(){
    console.log(`BTraderOrganObj.ordBookStart():: starting`);
    if (this.net.rnet.r.lnode === 1){
      this.ordBookStatus = 'ready';
      return;
    }

    let doTry = await this.requestSnapshotFromPeer();
    if (doTry.result === 'OK') {
      this.applyOrderBookSnapshot(doTry.snapshot);
    }
  }
  applyOrderBookSnapshot(snapshot) {

    // Replace local state
    this.buys        = snapshot.buys  || [];
    this.sells       = snapshot.sells || [];
    this.fills       = snapshot.fills || [];
    this.lastMatchId = snapshot.lastMatchId || 0;

    this.ordBookStatus = 'ready';   // safe to match again
    return true;
  }
  // ---------------------------------------------------------
  // Broadcast handler (future: market events)
  // ---------------------------------------------------------
  async handleBCast(j) {
    let remIp = j.remIp;
 
    switch (j.req) {
      case 'placeBuyOrder':
        return await this.handlePlaceBuy(remIp, j);

      case 'placeSellOrder':
        return await this.handlePlaceSell(remIp, j);

      case 'matchNow':
        return await this.handleMatchNow(remIp, j);

      case 'applyMatchResults':
        return await this.handleApplyMatchResults(remIp, j);

      default:
        return false;
    }
  }

  // ---------------------------------------------------------
  // P2P RPC handler
  // ---------------------------------------------------------
  async handleReq(remIp, j) {
    switch (j.req) {
      case 'getOrderBookSnapshot':
        return this.getOrderBookSnapshot(remIp, j);

      default:
        return false;
    }
  }

  async requestSnapshotFromPeer() {
    const msg = {
      req      : 'getOrderBookSnapshot',
      response : 'getOrderBookSnapshotResult'
    };

    // Pick any healthy peer
    const peerIp = this.net.getRandomPeerIp();

    return await this.net.reqReply.waitForReply(peerIp, msg);
  }
  getOrderBookSnapshot(remIp,j) {

    const snapshot = {
      buys:  this.buys,
      sells: this.sells,
      fills: this.fills,                   
      lastMatchId: this.lastMatchId || 0
    };

    const reply = {
      reqId: j.reqId,
      response: 'getOrderBookSnapshotResult',
      result: 'OK',
      snapshot
    };

    this.net.sendReply(remIp, reply);
    return true;
  }
  // ---------------------------------------------------------
  // BUY ORDER
  // ---------------------------------------------------------
  async doHandlePlaceBuy(j){
    const { userId, token, maxPrice, quoteAmt } = j.data;
    const order = {
      id: this.buys.length + 1,
      userId,
      token,
      maxPrice,
      remainingQuote: quoteAmt,
      filled: false
    };
    let msg = {
      req      : 'handlePlaceBuy',
      response : 'handlePlaceBuyResult',
      order    : order
    }
    let doTry = await this.bcastMgr.getReplies(msg);
    if (doTry.result === 'OK') {
      await this.handlePlaceBuy('localhost',msg)
      await this.matchNow();
      return true;
    }
    else {
      // broadcast backout transaction... doTry.reqId;
      return false;
    }
  }
  async handlePlaceBuy(remIp, j) {
    const order = j.order;

    // 1. Insert into SQL (with error handling)
    const sql = `
      INSERT INTO tblmrkBuyOrder (mborUID, mborToken, mborMax, mborAmt) VALUES (?, ?, ?, ?)`;

    const params = [order.userId, order.token,order.maxPrice, order.remainingQuote ];

    let insertId = null;

    try {
      insertId = await new Promise((resolve, reject) => {
        this.db.query(sql, params, (err, result) => {
          if (err) return reject(err);
          resolve(result.insertId);
        });
      });
    } 
    catch (err) {
      console.error("SQL ERROR (Buy Insert):", err);

      // Remote peer → send FAIL reply
      if (remIp !== 'localhost') {
        const reply = {
          reqId: j.reqId,
          response: 'placeBuyOrderResult',
          result: 'FAIL',
          error: 'SQL_INSERT_FAILED'
        };
        this.net.sendReply(remIp, reply);
      }
      return false;
    }

    // 2. SQL succeeded → update order ID
    order.id = insertId;

    // 3. Update in-memory order book
    this.buys.push(order);

    // 4. Local initiator does not send reply
    if (remIp === 'localhost') {
      return 'OK';
    }

    // Remote peer → send success reply
    const reply = {
      reqId: j.reqId,
      response: 'placeBuyOrderResult',
      result: 'OK',
      jsonResData: { orderId: order.id }
    };

    this.net.sendReply(remIp, reply);
    return true;
  }

  // ---------------------------------------------------------
  // SELL ORDER
  // ---------------------------------------------------------
  async doHandlePlaceSell(j) {
    const { userId, token, minPrice, baseQty } = j.data;

    const order = {
      id: this.sells.length + 1,
      userId,
      token,
      price: minPrice,
      totalBase: baseQty,
      allocated: "0.000000000",
      filled: false
    };

    let msg = {
      req      : 'handlePlaceSell',
      response : 'handlePlaceSellResult',
      order    : order
    }
    let doTry = await this.bcastMgr.getReplies(msg);
    if (doTry.result === 'OK') {
      await this.handlePlaceSell('localhost',msg);
      return true;
    }
    else {
      // broadcast backout transaction... doTry.reqId;
      return false;
    }
  }
  async handlePlaceSell(remIp, j) {
    const order = j.order;

    // 1. Insert into SQL (with error handling)
    const sql = `INSERT INTO tblmrkSellOrder (msorUID, msorToken, msorMin, msorAmtGP) VALUES (?, ?, ?, ?)`;

    const params = [order.userId,order.token, order.minPrice,order.remainingBase];

    let insertId = null;

    try {
      insertId = await new Promise((resolve, reject) => {
        this.db.query(sql, params, (err, result) => {
          if (err) return reject(err);
          resolve(result.insertId);
        });
      });
    } 
    catch (err) {
      console.error("SQL ERROR (Sell Insert):", err);

      // Remote peer → send FAIL reply
      if (remIp !== 'localhost') {
        const reply = {
          reqId: j.reqId,
          response: 'placeSellOrderResult',
          result: 'FAIL',
          error: 'SQL_INSERT_FAILED'
        };
        this.net.sendReply(remIp, reply);
      }
      return false;
    }

    // 2. SQL succeeded → update order ID
    order.id = insertId;

    // 3. Update in-memory order book
    this.sells.push(order);

    // 4. Local initiator does not send reply
    if (remIp === 'localhost') {
      return 'OK';
    }

    // Remote peer → send success reply
    const reply = {
      reqId: j.reqId,
      response: 'placeSellOrderResult',
      result: 'OK',
      jsonResData: { orderId: order.id }
    };

    this.net.sendReply(remIp, reply);
    return true;
  }

  // ---------------------------------------------------------
  // MATCHING TRIGGER
  // ---------------------------------------------------------
  async doHandleMatchNow(j) {
    let msg = {
      req      : 'handleMatchNow',
      response : 'handleMatchNowResult',
    }
    let doTry = await this.bcastMgr.getReplies(msg);
    if (doTry.result === 'OK') {
      this.handleMatchNow('localhost',msg)
      return true;
    }
    else {
      // broadcast backout transaction... doTry.reqId;
      return false;
    }
  }
  async matchNow(remIp, j) {

    // Prevent matching during rejoin
    if (this.rejoinMode) {
      this.log("Skipping match — node still synchronizing");
      return false;
    }

    // Find next buy order to match
    const buy = this.buys.find(b => !b.filled);
    if (!buy) return false;

    const sells = this.sells.filter(s => !s.filled);

    // Run deterministic matching engine
    const result = this.matchBuyAgainstBook(buy, sells);

    if (!result || result.fills.length === 0) {
      return true; // nothing to match
    }

    // Apply fills to SQL + memory
    const ok = await this.applyMatchResultsSQL(result);
    if (!ok) {
      console.error("SQL error applying match results");
      return false;
    }

    // Broadcast results to other nodes
    const msg = {
      req: 'applyMatchResults',
      response: 'applyMatchResultsResult',
      result
    };

    const doTry = await this.bcastMgr.getReplies(msg);

    if (doTry.result === 'OK') {
      // Apply locally (initiator)
      this.applyMatchResultsLocal(result);
      return true;
    }

    // TODO: rollback broadcast
    return false;
  }
  async handleMatchNow(remIp, j) {
    const fills = [];

    for (let i = 0; i < this.buys.length; i++) {
      const buy = this.buys[i];
      if (buy.filled) continue;

      const result = matchBuyAgainstBook(buy, this.sells);

      this.buys[i] = result.updatedBuy;
      this.sells = result.updatedSells;
      fills.push(...result.fills);
    }

    const reply = {
      reqId: j.reqId,
      response: 'matchNowResult',
      result: 'OK',
      jsonResData: { fills }
    };
    
    if (remIp === 'localhost'){
      return true;
    } else {
      this.net.sendReply(remIp, reply);
      return true;
    }
  }
  async applyMatchResultsSQL(result) {
    const fills = result.fills;

    try {
      for (const f of fills) {

        // Update BUY order
        await new Promise((resolve, reject) => {
          this.db.query(`UPDATE tblmrkBuyOrder SET mborAmt = ?, mborFilled = ? WHERE mborID = ?`,
          [f.newBuyRemaining, f.buyFilled, f.buyId],
          (err) => err ? reject(err) : resolve());
        });

        // Update SELL order
        await new Promise((resolve, reject) => {
          this.db.query(`UPDATE tblmrkSellOrder SET msorAmt = ?, msorFilled = ? WHERE msorID = ?`,
          [f.newSellRemaining, f.sellFilled, f.sellId],
          (err) => err ? reject(err) : resolve());
        });

        // Insert fill log
        await new Promise((resolve, reject) => {
          this.db.query(`INSERT INTO tblmrkFillsLog (mflBuyID, mflSellID, mflPrice, mflBaseAmt, mflQuoteAmt) VALUES (?, ?, ?, ?, ?)`,
          [f.buyId,f.sellId,f.price, f.baseAmt,f.quoteAmt],
          (err) => err ? reject(err) : resolve());
        });
      } 
      return true;
    } 
    catch (err) {
      console.error("SQL MATCH ERROR:", err);
      return false;
    }
  }
  applyMatchResultsLocal(result) {
    const fills = result.fills;

    for (const f of fills) {

      // Update BUY in memory
      const buy = this.buys.find(b => b.id === f.buyId);
      if (buy) {
        buy.remainingQuote = f.newBuyRemaining;
        buy.filled = f.buyFilled;
      }

      // Update SELL in memory
      const sell = this.sells.find(s => s.id === f.sellId);
      if (sell) {
        sell.remainingBase = f.newSellRemaining;
        sell.filled = f.sellFilled;
      }
    }
  }

}

// ---------------------------------------------------------
// Receptor: HTTP API
// ---------------------------------------------------------
class BTraderReceptor extends PtreeReceptor {
  constructor(peerTree, port) {
    super(peerTree, port);
    this.organism = peerTree;
  }

  async handleReq(j, res) {
    switch (j.msg.req) {

      case 'buy':
        return this.handleBuy(j.msg.data, res);

      case 'sell':
        return this.handleSell(j.msg.data, res);

      case 'qryOrders':
        return this.handleQryOrders(res);

      default:
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Unknown request' }));
    }
  }

  handleBuy(data, res) {
    this.organism.doHandlePlaceBuy({
      req: 'placeBuyOrder',
      data
    });

    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
  }

  handleSell(data, res) {
    this.organism.doHandlePlaceSell({
      req: 'placeSellOrder',
      data
    });

    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
  }

  handleMatch(res) {
    this.organism.doHandleMatchNow({
      req: 'matchNow',
      data: {}
    });

    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
  }
}

module.exports.BTraderOrganObj = BTraderOrganObj;
module.exports.BTraderReceptor = BTraderReceptor;

