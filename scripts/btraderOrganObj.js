/*
 * Distributed Borg-Trader Organism
 * Core matching + order handling organ
 */

const PtreeReceptor = require('./ptreeReceptorObj');
const db = require('./btraderDB');
const crypto = require('crypto');

// ---------------------------------------------------------
// Deterministic Decimal Math (9 decimal fixed precision)
// ---------------------------------------------------------
const D = (x) => BigInt(Math.round(Number(x) * 1e9));
const U = (x) => (Number(x) / 1e9).toFixed(9);

function toMySQLDate(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Convert UUID string (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
 * into a 16-byte Buffer for MySQL BINARY(16)
 */

function uuidToBin(uuid) {
  const hex = uuid.replace(/-/g, '');
  return Buffer.from(hex, 'hex');
}

/**
 * Convert 16-byte Buffer from MySQL BINARY(16)
 * back into canonical UUID string
 */
function binToUuid(buffer) {
  const hex = buffer.toString('hex');

  return (
    hex.substring(0, 8) + '-' +
    hex.substring(8, 12) + '-' +
    hex.substring(12, 16) + '-' +
    hex.substring(16, 20) + '-' +
    hex.substring(20)
  );
}

/**
 * Generate a crypto-random UUID and return BINARY(16)
 */
function randomUuidBin() {
  return uuidToBin(crypto.randomUUID());
}

// ---------------------------------------------------------
// Matching Engine (pure, deterministic, no side effects)
// ---------------------------------------------------------
const Decimal = require('decimal.js');

function matchBuyAgainstBook(buy, sells) {

  // Convert buy fields to Decimal
  const buyMaxPrice       = new Decimal(buy.mborMax);
  buy.mborAmt             = new Decimal(buy.mborAmt);
  buy.mborFillAmt         = new Decimal(buy.mborFillAmt);
  let   buyFillAmt        = buy.mborAmt.minus(buy.mborFillAmt);
  let   buyRemainingAmt   = buyFillAmt;
  let   buyFilledDate     = null;

  const updatedSells = [];
  const fills = [];

  // Iterate through sells in price-time priority
  for (const sell of sells) {

    // Convert sell fields to Decimal
    const sellMinPrice  = new Decimal(sell.msorMin);
    const sellOrigAmt   = new Decimal(sell.msorAmtGP);
    sell.msorAllocated  = new Decimal(sell.msorAllocated);

    let sellRemaining = sellOrigAmt.minus(sell.msorAllocated);

    console.log(`matchBuyAgainstBook():: buy vs sell:`,buy,sell);
    console.log(`matchBuyAgainstBook():: remaining to buy:`,buyRemainingAmt, `of: ${buy.mborAmt}`);
    console.log(`matchBuyAgainstBook():: seller has : ${sellRemaining} to sell`);
    // Stop if buy is fully consumed
    if (buyRemainingAmt.lte(0)) {
      console.log(`matchBuyAgainstBook():: remaining to buy:`,buyRemainingAmt, `of: ${buy.msorAmtGP} BREAK`);      
      break;
    }
    // Price check: buy must meet or exceed sell
    console.log(`matchBuyAgainstBook():: buyMaxPrice: ${buyMaxPrice}, sellMinPrice: ${sellMinPrice}`);
    if (buyMaxPrice.lt(sellMinPrice)) {
      updatedSells.push(sell);
      continue;
    }

    // Compute how much base the buy can afford at this price
    const buyAvailable = Decimal.min(sellRemaining,buyRemainingAmt); 

    console.log(`matchBuyAgainstBook():: can buy: min(${sellRemaining},${buyRemainingAmt}) at price: ${buyMaxPrice} = `,buyAvailable);
    
    // Fill amount = min(sellRemainingBase, buyAffordableBase)
    const fillAmt  = Decimal.min(sellRemaining, buyRemainingAmt);

    console.log(`matchBuyAgainstBook():: mborFillAmt is `,fillAmt);

    // If no fill possible, continue
    if (fillAmt.lte(0)) {
      updatedSells.push(sell);
      continue;
    }

    // Quote spent = base * price
    const fillPrice = buyMaxPrice;
    
    console.log(`matchBuyAgainstBook():: filledAmt is `,fillAmt, `price:`,fillPrice);    

    // Update remaining amounts
    buyRemainingAmt    = buyRemainingAmt.minus(fillAmt);
    sellRemaining      = sellRemaining.minus(fillAmt);
    let totalSold      = sellOrigAmt.minus(sellRemaining);
    buyFilledDate      = buyRemainingAmt.lte(0) ? new Date(Date.now()) : null;

    console.log(`buyRemainingAmt: ${buyRemainingAmt},sellRemaining: ${sellRemaining},totalSold: ${totalSold}, buyFilledDate: ${ buyFilledDate}`);  

    // Record fill
    fills.push({
      buyId    : buy.mborTranId,
      sellId   : sell.msorTranId,
      price    : buyMaxPrice.toString(),   // execution price
      baseAmt  : fillAmt.toString(),
      quoteAmt : fillPrice.toString(),
      newBuyRemaining  : buyRemainingAmt.toString(),
      newSellRemaining : sellRemaining.toString(),
      buyFilledAmt     : fillAmt.toString(),
      buyFilled        : buyFilledDate,
      sellFilledAmt    : totalSold.toString(),
      sellFilled       : totalSold.gte(sellOrigAmt) ? new Date(Date.now()) : null  
    });

    // Update sell object for return
    updatedSells.push({
      ...sell,
      msorAllocated : sellRemaining.toString(),
      filledAmt     : totalSold.toString(),
      msorFilled    : totalSold.gte(sellOrigAmt) ? new Date(Date.now()) : null  
    });
  }
  // Updated buy object
  const updatedBuy = {
    ...buy,
    mborFillAmt : buyRemainingAmt.toString(),
    mborFilled  : buyFilledDate
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
      SELECT mborID,mborTranId, mborUID, mborToken,mborMax, mborAmt, mborFillAmt, mborFilled FROM tblmrkBuyOrder
      WHERE mborFilled IS NULL AND mborTradeCanceled IS NULL
      ORDER BY mborID ASC
    `, (err, rows) => {
      if (err) return console.error("SQL load buys error:", err);
      this.buys = rows;
      this.buys.forEach((buy) => {buy.mborTranId = binToUuid(buy.mborTranId);});
      console.log(`loadOrderBookFromSQL():: buy orders `,this.buys);
    });

    this.db.query(`
      SELECT msorID,msorTranId, msorUID, msorToken, msorMin, msorAmtGP, msorAllocated, msorFilled FROM tblmrkSellOrder
      WHERE msorFilled IS NULL AND msorTradeCanceled IS NULL
      ORDER BY msorID ASC
    `, (err, rows) => {
      if (err) return console.error("SQL load sells error:", err);
      this.sells = rows;
      this.sells.forEach((sell) => {sell.msorTranId = binToUuid(sell.msorTranId);});
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
      mborID         : this.buys.length + 1,
      mborTranId     : crypto.randomUUID(), 
      mborUID        : userId,
      mborToken      : token,
      mborMax        : new Decimal(maxPrice),
      mborAmt        : new Decimal(quoteAmt),
      mborFillAmt    : new Decimal("0.000000000"),
      mborFilled     : null,
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
    const o = j.order;

    // 1. Insert into SQL (with error handling)
    const sql = `
      INSERT INTO tblmrkBuyOrder (mborTranId,mborUID, mborToken, mborMax, mborAmt,mborDate,mborFillAmt) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    const params = [uuidToBin(o.mborTranId),o.mborUID, o.mborToken,o.mborMax, o.mborAmt,toMySQLDate(Date.now()),o.mborFillAmt ];
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
    o.msorID = insertId;

    // 3. Update in-memory order book
    this.buys.push(o);

    // 4. Local initiator does not send reply
    if (remIp === 'localhost') {
      return 'OK';
    }

    // Remote peer → send success reply
    const reply = {
      reqId: j.reqId,
      response: 'placeBuyOrderResult',
      result: 'OK',
      jsonResData: { orderId: o.msorTranId }
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
      msorID        : this.sells.length + 1,
      msorTranId    : crypto.randomUUID(),
      msorUID       : userId,
      msorToken     : token,
      msorMin       : minPrice,
      msorAmtGP     : baseQty,
      msorAllocated : "0.000000000",
      msorFilled    : null
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
    const o = j.order;

    // 1. Insert into SQL (with error handling)
    const sql = `INSERT INTO tblmrkSellOrder (msorTranId,msorUID, msorToken, msorMin, msorAmtGP,msorAllocated,msorDate) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    const params = [uuidToBin(o.msorTranId),o.msorUID,o.msorToken, o.msorMin,o.msorAmtGP,o.msorAllocated,toMySQLDate(Date.now())];

    console.log(`handlePlaceSell():: `,sql,params);

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
    o.msorID = insertId;

    // 3. Update in-memory order book
    this.sells.push(o);

    // 4. Local initiator does not send reply
    if (remIp === 'localhost') {
      return 'OK';
    }

    // Remote peer → send success reply
    const reply = {
      reqId: j.reqId,
      response: 'placeSellOrderResult',
      result: 'OK',
      jsonResData: { orderId: o.msorID }
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

    const doTry = await this.net.bcastMgr.getReplies(msg);

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
            return resolve(false);
          }
          try {
            console.log(`applyMatchResultsSQL():: Bigin`, fills.length);
            for (const f of fills) {

              // BUY update
              await new Promise((res, rej) => {
                conn.query(`UPDATE tblmrkBuyOrder SET mborFillAmt = mborAmt - ?, mborFilled = ? WHERE mborTranId = ?`,
                [f.newBuyRemaining, f.buyFilled, uuidToBin(f.buyId) ], (err) => err ? rej(err) : res());
              });

              // SELL update
              await new Promise((res, rej) => {
                conn.query(`UPDATE tblmrkSellOrder SET msorFilled = ?, msorAllocated = msorAmtGP - ? WHERE msorTranId = ?`,
                [f.sellFilled, f.newSellRemaining, uuidToBin(f.sellId) ], (err) => err ? rej(err) : res());
              });

              // Fill log insert
              await new Promise((res, rej) => {
                conn.query(`INSERT INTO tblmrkFillsLog (mflgTranId,mflgBTranId, mflgSTranId, mflgPrice, mflgAmtGP, mflgDate) VALUES (?, ?, ?, ?, ?, ?)`,
                [randomUuidBin(),uuidToBin(f.buyId), uuidToBin(f.sellId), f.price,f.buyFilledAmt, new Date(Date.now())], (err) => err ? rej(err) : res());
              });

            } // end for each fill

            // If we got here, everything succeeded
            conn.commit((err) => {
              if (err) {
                console.error("COMMIT error:", err);
                return resolve(false);
              }
              resolve(true);
            });

          } catch (err) {
            console.error("MATCH SQL ERROR, ROLLBACK:", err);

            conn.rollback(() => {
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

