/*
 * Distributed Borg-Trader Organism
 * Core matching + order handling organ
 */

const PtreeReceptor = require('./ptreeReceptorObj');

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

    // TEMPORARY IN-MEMORY ORDER BOOK (SQL later)
    this.buys = [];
    this.sells = [];
  }

  attachReceptor(inReceptor) {
    this.receptor = inReceptor;
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

      default:
        return false;
    }
  }

  // ---------------------------------------------------------
  // P2P RPC handler
  // ---------------------------------------------------------
  async handleReq(remIp, j) {
    switch (j.req) {
      default:
        return false;
    }
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
      this.handlePlaceBuy('localhost',msg)
      return true;
    }
    else {
      // broadcast backout transaction... doTry.reqId;
      return false;
    }
  }
  async handlePlaceBuy(remIp, j) {
    let order = j.order;
    this.buys.push(order);

    const reply = {
      reqId: j.reqId,
      response: 'placeBuyOrderResult',
      result: 'OK',
      jsonResData: { orderId: order.id }
    };

    if (remIp === 'localhost'){
      return 'OK';
    }

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
      this.handlePlaceBuy('localhost',msg)
      return true;
    }
    else {
      // broadcast backout transaction... doTry.reqId;
      return false;
    }
  }
  async handlePlaceSell(j) {
    let order = j.order;
    this.sells.push(order);

    const reply = {
      reqId: j.reqId,
      response: 'placeSellOrderResult',
      result: 'OK',
      jsonResData: { orderId: order.id }
    };

    if (j.remIp === 'localhost'){
      return true;
    } else {
      this.net.sendReply(remIp, reply);
      return true;
    }
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

