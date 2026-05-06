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

function toMySQLDate(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

// ---------------------------------------------------------
// Matching Engine (pure, deterministic, no side effects)
// ---------------------------------------------------------
const Decimal = require('decimal.js');

function matchBuyAgainstBook(buy, sells) {

  // Convert buy fields to Decimal
  const buyMaxPrice       = new Decimal(buy.maxPrice);
  buy.origAmount          = new Decimal(buy.origAmount);
  buy.remainingQuote      = new Decimal(buy.remainingQuote);
  let   buyRemainingQuote = buy.origAmount.minus(buy.remainingQuote);
  let   buyRemainingAmt   = buy.origAmount.minus(buy.remainingQuote);
  let   buyFilledDate     = null;

  const updatedSells = [];
  const fills = [];

  // Iterate through sells in price-time priority
  for (const sell of sells) {

    // Convert sell fields to Decimal
    const sellMinPrice      = new Decimal(sell.minPrice);
    const sellOrigAmt       = new Decimal(sell.origBase);
    sell.remainingBase      = new Decimal(sell.remainingBase);

    let   sellRemainingBase = sellOrigAmt.minus(sell.remainingBase);

    console.log(`matchBuyAgainstBook():: buy vs sell:`,buy,sell);
    console.log(`matchBuyAgainstBook():: remaining to buy:`,buyRemainingQuote, `of: ${buy.origAmount}`);
    console.log(`matchBuyAgainstBook():: seller has : ${sellRemainingBase} to sell`);
    // Stop if buy is fully consumed
    if (buyRemainingQuote.lte(0)) {
      console.log(`matchBuyAgainstBook():: remaining to buy:`,buyRemainingQuote, `of: ${buy.origAmount} BREAK`);      
      break;
    }
    // Price check: buy must meet or exceed sell
    console.log(`matchBuyAgainstBook():: buyMaxPrice: ${buyMaxPrice}, sellMinPrice: ${sellMinPrice}`);
    if (buyMaxPrice.lt(sellMinPrice)) {
      updatedSells.push(sell);
      continue;
    }

    // Compute how much base the buy can afford at this price
    const buyAffordableBase = buyRemainingQuote; //buyRemainingQuote.div(buyMaxPrice);

    console.log(`matchBuyAgainstBook():: can buy: ${buyRemainingQuote}/${buyMaxPrice} = `,buyAffordableBase);
    
    // Fill amount = min(sellRemainingBase, buyAffordableBase)
    const fillBase = Decimal.min(sellRemainingBase, buyRemainingQuote);

    console.log(`matchBuyAgainstBook():: filledAmt is `,fillBase);

    // If no fill possible, continue
    if (fillBase.lte(0)) {
      updatedSells.push(sell);
      continue;
    }

    // Quote spent = base * price
    const fillQuote = fillBase.mul(buyMaxPrice);
    
    console.log(`matchBuyAgainstBook():: filledQuote is `,fillQuote);    

    // Update remaining amounts
    buyRemainingQuote  = buyRemainingQuote.minus(fillQuote);
    buyRemainingAmt    = buyRemainingAmt.minus(fillBase);
    sellRemainingBase  = sellRemainingBase.minus(fillBase);
    let totalSold      = sellOrigAmt.plus(sell.remainingBase);
    buyFilledDate      = buy.origAmount.minus(fillBase).lte(0) ? new Date(Date.now()) : null;

    console.log(`buyRemainingQuote: ${buyRemainingQuote},sellRemainingBase: ${sellRemainingBase},totalSold: ${totalSold}, buyFilledDate: ${ buyFilledDate}`);  

    // Record fill
    fills.push({
      buyId    : buy.id,
      sellId   : sell.id,
      price    : buyMaxPrice.toString(),   // execution price
      baseAmt  : fillBase.toString(),
      quoteAmt : fillQuote.toString(),
      newBuyRemaining  : buyRemainingAmt,
      newSellRemaining : sellRemainingBase,
      buyFilledAmt     : fillBase,
      buyFilled        : buy.origAmount.minus(fillBase).lte(0) ? new Date(Date.now()) : null  ,
      sellFilledAmt    : totalSold,
      sellFilled       : totalSold.gte(sellOrigAmt) ? new Date(Date.now()) : null  
    });

    // Update sell object for return
    updatedSells.push({
      ...sell,
      remainingBase : sellRemainingBase.toString(),
      filledAmt     : totalSold.toString(),
      filled        : totalSold.gte(sellOrigAmt) ? new Date(Date.now()) : null  
    });
  }
  // Updated buy object
  const updatedBuy = {
    ...buy,
    remainingQuote : buyRemainingAmt.toString(),
    filled         : buyFilledDate
  };

  return {
    updatedBuy,
    updatedSells,
    fills
  };
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
             mborMax AS maxPrice, mborAmt AS origAmount, mborFillAmt AS remainingQuote,
             mborFilled AS filled
      FROM tblmrkBuyOrder
      WHERE mborFilled IS NULL AND mborTradeCanceled IS NULL
      ORDER BY mborID ASC
    `, (err, rows) => {
      if (err) return console.error("SQL load buys error:", err);
      this.buys = rows;
      console.log(`loadOrderBookFromSQL():: buy orders `,this.buys);
    });

    this.db.query(`
      SELECT msorID AS id, msorUID AS userId, msorToken AS token,
             msorMin AS minPrice, msorAmtGP AS origBase, msorAllocated as remainingBase,
             msorFilled AS filled
      FROM tblmrkSellOrder
      WHERE msorFilled IS NULL AND msorTradeCanceled IS NULL
      ORDER BY msorID ASC
    `, (err, rows) => {
      if (err) return console.error("SQL load sells error:", err);
      this.sells = rows;
      console.log(`loadOrderBookFromSQL():: sell orders `,this.sells);
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
      maxPrice : new Decimal(maxPrice),
      remainingQuote: new Decimal(quoteAmt),
      filled: 'null'
    };
    let msg = {
      req      : 'handlePlaceBuy',
      response : 'handlePlaceBuyResult',
      order    : order
    }
    console.log(`doHandlePlaceBuy():: bcasting: `,msg);

    let doTry = await this.net.bcastMgr.getReplies(msg);
    if (doTry.result === 'OK' || doTry.result === 'NOBODY') {
      await this.handlePlaceBuy('localhost',msg);
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
      INSERT INTO tblmrkBuyOrder (mborUID, mborToken, mborMax, mborAmt,mborDate) VALUES (?, ?, ?, ?, ?)`;

    const params = [order.userId, order.token,order.maxPrice, order.remainingQuote,toMySQLDate(Date.now()) ];
    console.log(`handlePlaceBuy():: `,sql,params);
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
      userId    : userId,
      token     : token,
      minPrice  : minPrice,
      totalBase : baseQty,
      allocated : "0.000000000",
      filled    : false
    };

    let msg = {
      req      : 'handlePlaceSell',
      response : 'handlePlaceSellResult',
      order    : order
    }
    let doTry = await this.net.bcastMgr.getReplies(msg);
    if (doTry.result === 'OK' || doTry.result === 'NOBODY') {
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
    const sql = `INSERT INTO tblmrkSellOrder (msorUID, msorToken, msorMin, msorAmtGP,msorAllocated,msorDate) VALUES (?, ?, ?, ?, ?, ?)`;

    const params = [order.userId,order.token, order.minPrice,order.totalBase,order.allocated,toMySQLDate(Date.now())];

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
    if (doTry.result === 'OK' || doTry === 'NOBODY') {
      this.handleMatchNow('localhost',msg)
      return true;
    }
    else {
      // broadcast backout transaction... doTry.reqId;
      return false;
    }
  }
  async matchNow() {
    console.log(`matchNow():: Begin `);
    // Prevent matching during rejoin
    if (this.ordBookStatus !== 'ready') {
      console.log("Skipping match — node still synchronizing");
      return false;
    }

    console.log(`matchNow():: Buys `,this.buys);
    // Find next buy order to match
    const buy = this.buys.find(b => !b.filled);
    if (!buy) return false;

     console.log(`matchNow():: Sells `,this.sells);
     const sells = this.sells.filter(s => !s.filled);

    // Run deterministic matching engine
    const result = matchBuyAgainstBook(buy, sells);

    console.log(`matchNow():: post match buy   `,buy);
    console.log(`matchNow():: post match sells `,sells);
    console.log(`matchNow():: post match result`,result);

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
      req      : 'applyMatchResults',
      response : 'applyMatchResultsResult',
      result   : result 
    };

    const doTry = await this.bcastMgr.getReplies(msg);

    if (doTry.result === 'OK' || doTry === 'NOBODY') {
      // Apply locally (initiator)
      this.applyMatchResultsLocal(result);
      return true;
    }

    // TODO: rollback broadcast
    return false;
  }
  async handleApplyMatchResults(remIp, j) {
    const result = j.result;

    const reply = {
      reqId: j.reqId,
      response: 'applyMatchResultsResult',
      result: 'OK'
    };

    // Apply to SQL
    const ok = await this.applyMatchResultsSQL(result);
    if (!ok) {
      reply.result = 'FAIL_MATCH_SQL';
    }
    else {

      // Apply to memory
      this.applyMatchResultsLocal(result);

      if (remIp === 'localhost') return 'OK';
    }

    this.net.sendReply(remIp, reply);
    return true;
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
    console.log(`applyMatchResultsSQL():: Begin`, fills.length);
    return new Promise((resolve) => {

      let conn = this.db;
      conn.beginTransaction(async (err) => {
          if (err) {
            console.error("BEGIN error:", err);
            conn.release();
            return resolve(false);
          }
          try {
            console.log(`applyMatchResultsSQL():: Bigin`, fills.length);
            for (const f of fills) {

              // BUY update
              await new Promise((res, rej) => {
                conn.query(`UPDATE tblmrkBuyOrder SET mborAmt = ?,mborFillAmt = ?, mborFilled = ? WHERE mborID = ?`,
                [f.newBuyRemaining, f.buyFilledAmt,f.sellFilled, f.buyId ], (err) => err ? rej(err) : res());
              });

              // SELL update
              await new Promise((res, rej) => {
                conn.query(`UPDATE tblmrkSellOrder SET msorAmtGP = ?, msorFilled = ?, msorAllocated = ? WHERE msorID = ?`,
                [f.newSellRemaining,f.sellFilled,f.sellFilledAmt, f.sellId], (err) => err ? rej(err) : res());
              });

              // Fill log insert
              await new Promise((res, rej) => {
                conn.query(`INSERT INTO tblmrkFillsLog (mflgBID, mflgSID, mflgPrice, mflgAmtGP, mflgDate) VALUES (?, ?, ?, ?, ?)`,
                [f.buyId, f.sellId, f.price,f.buyFilledAmt, new Date(Date.now())], (err) => err ? rej(err) : res());
              });

            } // end for each fill

            // If we got here, everything succeeded
            conn.commit((err) => {
              conn.release();
              if (err) {
                console.error("COMMIT error:", err);
                return resolve(false);
              }
              resolve(true);
            });

          } catch (err) {
            console.error("MATCH SQL ERROR, ROLLBACK:", err);

            conn.rollback(() => {
              conn.release();
              resolve(false);
            });
          }

        }); // beginTransaction
    }); // Promise
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

      case 'match':
        return this.handleMatch(res);

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
    this.organism.matchNow();

    res.writeHead(200);
    res.end(JSON.stringify({ ok: true,msg : 'matching complete' }));
  }
}

module.exports.BTraderOrganObj = BTraderOrganObj;
module.exports.BTraderReceptor = BTraderReceptor;

