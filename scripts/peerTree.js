/*
Dust Removed: Date: Dec 28, 2022
*/

const EventEmitter = require('events');
const https = require('https');
const fs = require('fs');
const qs = require('querystring');
const crypto = require('crypto');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const bitcoin = require('bitcoinjs-lib');

console.error('running::',process.title);
// Create a writable stream to your desired file
const errorLog = fs.createWriteStream(process.title+'NodeErrors.log', { flags: 'a' });

/*
********************
Override Date clase so that all nodes use one unifide time dictated By the root node.
Capture the real Date constructor and real Date.now
********************
*/

const RealDate = Date;
const realNow = RealDate.now;

let peerTCorrection = 0;

// Override the Date constructor
function CorrectedDate(...args) {
  if (args.length === 0) {
    return new RealDate(realNow() + peerTCorrection);
  }
  return new RealDate(...args);
}

// Copy static methods
CorrectedDate.now = () => realNow() + peerTCorrection;
CorrectedDate.UTC = RealDate.UTC;
CorrectedDate.parse = RealDate.parse;

// Preserve prototype so instanceof still works
CorrectedDate.prototype = RealDate.prototype;

// Install the override
Date = CorrectedDate;console.error('running::',process.title);

function parseChronyOffset(output) {
  // Find the line containing "Last offset"
  const match = output.match(/Last offset\s*:\s*([+-]?\d+\.?\d*)\s*seconds/i);
  if (!match) {
    throw new Error("Could not parse chronyc tracking output");
  }

  const seconds = parseFloat(match[1]);
  const milliseconds = Math.round(seconds * 1000);

  return milliseconds;
}


/*
 ::End Time Overide code 
*/

/*
// Override console.error
console.error = function (...args) {
  const message = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  if (typeof args[0] === 'string') {
    if (args[0].startsWith('process.on()::')){
      const err = new Error(message);
      errorLog.write('\n'+process.title+' '+logTimestamp()+' - '+erFormat(err.stack)+'\n');
      return;
    }
  }
  errorLog.write('\n'+process.title+' '+logTimestamp()+' - '+message+'\n');
};
*/

function erFormat(er){
  const lines = er.split("\n");

  // Remove ONLY the leading "Error: " at the start of line[0]

  if (lines[0].startsWith("Error: ")) {
    lines[0] = lines[0].slice("Error: ".length);
  }

  const filtered = lines.filter(line =>
    !(
      line.includes("at console.error") ||
      line.includes("at main") ||
      line.includes("at process.processTicksAndRejections")
    )
  );

  return filtered.join("\n");
}
function logTimestamp() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').replace('Z', '');
}
process.on('uncaughtException', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port is already in use. Exiting...`);
    }
    errorLog.write("\nUNCAUGHT_exception: " + err.stack + "\n", () => {
      errorLog.end(() => {
        process.exit(1);
      });
    });
});

process.on('unhandledRejection', (reason, promise) => { // Updated

    // Print the full stack if available
    if (reason && reason.stack) {
        console.error('process.on():: unhandledRejection',reason.stack);
    } else {
        console.error('process.on():: unhandledRejection NoStack',reason);
    }
    errorLog.end(() => {
       process.exit(1);
    });
});

var   defPulse            = 5*1000;
const maxPacket           = 300000000;
const maxNetErrors        = 5;
const verifyRootTimer     = 3500;
const joinWaitForDropTime = 60*1000;

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

/* Server Response CODES:
200 'OK'
errors:

501  Timeout msg was not handled - retry
522 NetREQ   - Node Busy retry;
552 netREPLY - Node Busy retry;

413  netREQ/netReply To much data msg rejected - Fatal
520 netREQ   Fatal, malformed JSON in msg
521 netREQ   Fatal, no msg wrapper
523 netREQ   Fatal, ptreeId not matching
550 netREPLY Fatal, malformed JSON in msg
551 netREPLY Fatal, no msg wrapper

Send Msg Error CODES:

xTime  - retry (server may be busy or disconected);
xError - retry server failed to respond
*/
const srvFatal = [413,520,521,523,550,551,500];
const srvBusy  = [501,522,552,'xTime','xError'];

function clone(value, seen = new WeakMap()) {
  // Handle primitives
  if (value === null || typeof value !== "object") {
    return value;
  }

  // Handle circular references
  if (seen.has(value)) {
    return seen.get(value);
  }

  // Handle Date
  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  // Handle RegExp
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags);
  }

  // Handle Array
  if (Array.isArray(value)) {
    const arr = [];
    seen.set(value, arr);
    for (const item of value) {
      arr.push(clone(item, seen));
    }
    return arr;
  }

  // Handle Map
  if (value instanceof Map) {
    const map = new Map();
    seen.set(value, map);
    for (const [k, v] of value.entries()) {
      map.set(clone(k, seen), clone(v, seen));
    }
    return map;
  }

  // Handle Set
  if (value instanceof Set) {
    const set = new Set();
    seen.set(value, set);
    for (const v of value.values()) {
      set.add(clone(v, seen));
    }
    return set;
  }

  // Handle Typed Arrays
  if (ArrayBuffer.isView(value)) {
    return new value.constructor(value);
  }

  // Handle plain objects (preserve prototype)
  const clonedObj = Object.create(Object.getPrototypeOf(value));
  seen.set(value, clonedObj);

  for (const key of Reflect.ownKeys(value)) {
    clonedObj[key] = clone(value[key], seen);
  }

  return clonedObj;
}
function sleep(ms){
  return new Promise(resolve=>{
    setTimeout(resolve,ms)
  });
}
function makeErr(code, msg) {
  const e = new Error(msg);
  e.code = code;
  return e;
}

/*
 * ======================================================================================
 * PtreeGenRequestHandler
 * ======================================================================================
 * Handles the full lifecycle of sending a PeerTree request and waiting for the correct
 * response. This organ provides:
 *
 *   • xhrFail handling
 *   • deterministic timeouts
 *   • strict validation of request.action → response.response pairing
 *   • reqId-based identity matching to prevent cross-talk between concurrent requests
 *
 * --------------------------------------------------------------------------------------
 * USAGE:
 *   Build a request message, then call:
 *
 *       const msg = {
 *         req      : 'someReqName',        // REQUIRED  – unique request action
 *         response : 'someReqResponse',    // REQUIRED  – expected reply action
 *         field1   : data,
 *         ... more JSON fields
 *       };
 *
 *       const mres = await this.reqReplyObj.waitForReply(ip, msg,<optional timeout in ms... Default 1500>);
 *
 *   The returned object will be one of:
 *       { result: 'xhrFail' }
 *       { result: 'timeout' }
 *       { result: ...the JSON reply you expect... }
 *
 * --------------------------------------------------------------------------------------
 * RESPONSE CONSTRUCTION (on the receiving peer):
 *
 *       const reply = {
 *         response : 'someReqResponse',    // REQUIRED – must match msg.response exactly
 *         result   : {                     // REQUIRED – missing result triggers timeout
 *           field : someData,
 *           ... more fields
 *         }
 *       };
 *
 *       this.net.sendReplyCX(j.remIp, reply);
 *
 * --------------------------------------------------------------------------------------
 * NOTES:
 *   • reqId is automatically assigned if missing.
 *   • reqId ensures deterministic matching of request ↔ response.
 *   • If response.response does not match msg.response, the reply is ignored.
 *   • If no valid reply arrives before timeout, the promise resolves with {status:'timeout'}.
 *   • All listeners are cleaned up deterministically (success, fail, or timeout).
 *
 * ======================================================================================
 */

class PtreeGenRequestHandler {
  constructor(net) {
    this.net = net;
  }

  waitForReply(ip, req, timeout = 10000) {
    return new Promise((resolve) => {

      const action   = req.req;
      const response = req.response;

      if (req.reqId === undefined) {
        req.reqId = crypto.randomUUID();
      }

      req.req = action;
      const reqId = req.reqId;

      let timer;
      let failListener, replyListener, sendOKListener;

      // -------------------------
      // DELIVERED PATH
      // -------------------------
      this.net.on('xhrPostOK', sendOKListener = (j) => {
        if (j.reqId === reqId) {
          console.error('mkyReplyObj::xhrPostOK :',action,timeout,reqId);
          this.net.removeListener('xhrPostOK', sendOKListener);

          // ------------------------------------------
          // TIMEOUT only set after confirming delivery
          // ------------------------------------------
          timer = setTimeout(() => {
            console.error('mkyReplyObj::timeoutTick:',action,timeout,reqId);
            this.net.removeListener('xhrFail', failListener);
            this.net.removeListener('peerTReply', replyListener);
            this.net.removeListener('xhrPostOK', sendOKListener);
            resolve({ result: 'timeout' });
          }, timeout);
        }
      });

      // -------------------------
      // FAILURE PATH
      // -------------------------
      this.net.on('xhrFail', failListener = (j) => {
        if (j.toHost === ip && j.req === action) {
          console.error('mkyReplyObj::xhrFail :',j.xhrError,action,timeout,reqId);
          clearTimeout(timer);

          this.net.removeListener('xhrFail', failListener);
          this.net.removeListener('peerTReply', replyListener);
          this.net.removeListener('xhrPostOK', sendOKListener);

          resolve({ result: 'xhrFail' });
        }
      });

      // -------------------------
      // SUCCESS PATH
      // -------------------------
      this.net.on('peerTReply', replyListener = (j) => {
        if (
          j.response === response &&
          j.remIp === ip &&
          j.reqId === reqId
        ) {
          clearTimeout(timer);

          this.net.removeListener('xhrFail', failListener);
          this.net.removeListener('peerTReply', replyListener);
          this.net.removeListener('xhrPostOK', sendOKListener);

          resolve(j);
        }
      });

      // -------------------------
      // SEND THE REQUEST
      // -------------------------
      this.net.sendMsgCX(ip, req);
    });
  }
}
// NodeHealthTracker.js

class NodeHealthMgr {
  constructor({
    windowMs = 60_000,        // sliding window size
    cleanupIdleMs = 120_000,  // remove nodes idle for 2 minutes
    healthyThreshold = 0.05,  // <5% error rate = healthy
    emaAlpha = 0.2            // smoothing factor
  } = {}) {

    this.windowMs = windowMs;
    this.cleanupIdleMs = cleanupIdleMs;
    this.healthyThreshold = healthyThreshold;
    this.emaAlpha = emaAlpha;

    this.nodes = new Map(); // ip -> stats
  }

  // Ensure node exists
  _get(ip) {
    if (!this.nodes.has(ip)) {
      this.nodes.set(ip, {
        history: [],        // {ts, result}
        lastFailTs: 0,
        lastActivityTs: Date.now(),
        ema: 0
      });
    }
    return this.nodes.get(ip);
  }

  // Remove old events from sliding window
  _prune(stats) {
    //console.log(`_prune()::`,stats);
    const cutoff = Date.now() - this.windowMs;
    stats.history = stats.history.filter(e => e.ts >= cutoff);
  }

  // Update exponential moving average
  _updateEMA(stats, resultType) {
    //console.log(`_updateEMA`,stats,resultType);

    const x = (resultType === "success") ? 0 : 1;
    stats.ema = this.emaAlpha * x + (1 - this.emaAlpha) * stats.ema;
  }

  // Public API: record a POST result
  recordPostResult(ip, resultType) {
    const stats = this._get(ip);

    stats.history.push({
      ts: Date.now(),
      result: resultType
    });

    stats.lastActivityTs = Date.now();

    if (resultType !== "success") {
      stats.lastFailTs = Date.now();
    }

    this._prune(stats);
    this._updateEMA(stats, resultType);

    this._cleanupAll();
  }

  // Compute error rate for a node
  errorRate(ip) {
    const stats = this._get(ip);
    this._prune(stats);

    const total = stats.history.length;
    if (total === 0) return 0;

    const fails = stats.history.filter(e => e.result !== "success").length;
    return fails / total;
  }

  // Determine if a node is failing
  isNodeFailing(ip) {
    const stats = this._get(ip);
    const rate = this.errorRate(ip);

    return (
      rate > 0.3 ||          // short-term failure
      stats.ema > 0.5 ||     // long-term degradation
      (Date.now() - stats.lastFailTs < 2000) // recent hard fail
    );
  }

  // Remove nodes that are healthy + idle
  _cleanupNode(ip) {
    const stats = this.nodes.get(ip);
    if (!stats) return;

    this._prune(stats);

    const total = stats.history.length;
    const fails = stats.history.filter(e => e.result !== "success").length;
    const rate = total === 0 ? 0 : fails / total;

    const idleTooLong = (Date.now() - stats.lastActivityTs) > this.cleanupIdleMs;
    const healthy = rate < this.healthyThreshold && stats.ema < this.healthyThreshold;

    if (idleTooLong && healthy) {
      this.nodes.delete(ip);
    }
  }

  // Cleanup all nodes
  _cleanupAll() {
    for (const ip of this.nodes.keys()) {
      this._cleanupNode(ip);
    }
  }
}

//export default NodeHealthMgr;
// ******************************************************************
// CLASS: MkyRouting
// Handles the netorks routing tables  so peers 
// can broadcast messages to all other nodes on the network.
//          
// The peers form a tree structure  where new nodes are  
// added left to right first node is root of tree.  Each 
// node keeps a list of the roots peer group and its own peer group.
// 
// Nodes that leave or timeout are replaced by the last node to join
// Messages that can not be sent are pushed onto a que and
// are delivered as soon as the conection returns or the node 
// is replaced.
// *******************************************************************
class MkyRouting {
   constructor(myIp,net){
     this.myIp       = myIp;
     this.net        = net;
     this.coldStart  = true;

     this.cronoT     = new CronoTimeMgr;
     this.lastRootGenerationSeen = 0;
     this.rootGeneration  = 1;
     this.nodeHealthMgr = new NodeHealthMgr();

     this.initialize();
     this.startTimers();
   }
   initialize(){
     this.newNode    = null;
     this.err        = null;
     this.eTime      = null;
     this.status     = 'startup'
     this.startJoin  = null;
     this.joinQue    = new Map;
     this.dropIps    = [];
     this.dropQueue  = [];        // for node drops initiate by none Root Parent
     this.dropQuePIR = [];        // for node drop Parent Node is Root 
     this.rootMap    = new Map();
     this.waitForNetTimer = null;
     this.joinReqFails    = 0;
     this.joinTicket      = null; 
     this.r = {
       rootLock   : false,
       pCount     : 0,
       sysTime    : Date.now(),
       ptreeId    : crypto.randomUUID(), // unique identifier of best branch of the network (new nodes need to join the largest healthy branch).
       rootNodeIp : this.myIp,           // Top of the network routing table plus each nodes peer group.
       rootRTab   : 'na',
       myNodes    : [],                  // forwarding ips for each nodes peer group.
       lastNode   : this.myIp,
       leftNode   : null,
       rightNode  : null,
       myParent   : null,
       nextParent : null,
       mylayer    : 1,
       nodeNbr    : 0,    // node sequence number 1,2,3 ... n
       nlayer     : 1,    // nlayers in the network 1,2,3 ... n
       lnode      : 1,    // number of the last node in.
       lnStatus   : 'OK', // used for routing updates. 'OK' or 'moving'
       nextPNbr   : 1
     }
     
     if (this.cronoT){ this.cronoT.reset(); }

   }
   startTimers() {
     this.procJoinQue();
     setTimeout(() =>  {this.verifyRoot();},3*1000);
     setTimeout(() =>  {this.scanNodesRight();},65*1000);

     this.clockPulseDef = 90 * 1000;  
     this.clockPulse    = this.clockPulseDef;
     if (process.title == 'cronoTreeCell'){
       console.error(`clock starting timeSynPulse();`);
       setTimeout(() => this.timeSyncPulse(), this.clockPulse);
     }
     else { // Use time info from the cronoTreeCell network
       this.applyCronoTreeTime();
     }
   }
   simulateOutage(mode){
     if (mode == 'startSim'){
       this.simulation = true;
       console.error('MkyRouting.simulateOutage():: simulated outage started!');
     }
     else {
       this.simulation = false;
       console.error('MkyRouting.simulateOutage():: simulated outage stopping!');
     }
   }
   getCronoTreeTime(){
     // Only used by cronoTreeCell cells.
     if ((this.status == 'root' || 'this.status == online') && !this.err){
       return {cronoTreeSystemClock : {rootTime: Date.now(),rootGeneration: this.rootGeneration}}
     }
     else {
       return {cronoTreeSystemClock : {rootTime: 'unavailable',nodeStatus : this.status, err : this.err}}
     }
   }
   timeSyncPulse() {
     this.r.sysTime = Date.now(); // set webMonitor display value to show network virtual time;

     if (this.status === 'root') {
       // Root broadcasts authoritative time
       this.bcast({checkSystemClock : {rootTime: this.r.sysTime,rootGeneration: this.rootGeneration}});
     }
     else if (this.status === 'online') {
       // Non-root: only sync if we have real data
       if (this.lastRootTime) {
         // Non-root: apply correction using last known root time
         this.r.sysTime = this.lastRootTime;
         this.applyClockDiscipline(this.lastRootTime, this.lastRootGenerationSeen);
       }
     }  
     setTimeout(() => this.timeSyncPulse(), this.clockPulse);
   }
   async applyCronoTreeTime(){
     // Only executed by none cronoTree cells
     try {
       let j = await this.requestCronoTime();
       if (j.cronoTreeSystemClock.rootTime !== 'unavailable') {
         const localTime = realNow();
         const drift = j.cronoTreeSystemClock.rootTime - localTime;
         peerTCorrection = drift;
       }
     }
     catch(err) {console.error(`MkyRouting.applyCronoTreeTime():: rejected: ${err.message}`);}

     setTimeout(() => this.applyCronoTreeTime(), this.clockPulse);
   }
   async requestCronoTime() {
     const msg = {msg:{req:'sendCronoTime'}};
     const body = JSON.stringify(msg);

     const options = {
       hostname: 'localhost',
       port: 13397,
       path: '/netReq',
       method: 'POST',
       rejectUnauthorized: false,   // allow self‑signed cert
       headers: {
         'Connection': 'close',
         'Content-Type': 'application/json',
         'Content-Length': Buffer.byteLength(body, 'utf8')
       },
       timeout: 3500   // 1.5s timeout — adjust as needed
     };

     return new Promise((resolve, reject) => {
       const req = https.request(options, (res) => {
         let data = '';

         res.on('data', chunk => data += chunk);
         res.on('end', () => {
           try {
             resolve(JSON.parse(data));
           } catch (err) {
             reject(new Error(`Invalid JSON response: ${data}`));
           }
         });
       });

       req.on('timeout', () => {
         req.destroy();
         reject(new Error('Request timed out'));
       });

       req.on('error', reject);

       req.write(body);
       req.end();
     });
   }
   async applyClockDiscipline(rootTime, rootGeneration) {
     // To be executed by cronoTree cells only
     try {
       const localTime = realNow();
       const drift = rootTime - localTime;
       peerTCorrection = drift;

       // Track root generation changes
       if (rootGeneration > (this.lastRootGenerationSeen || 0)) {
         this.lastRootGenerationSeen = rootGeneration;
         console.error(`mkyRouting.applyClockDiscipline():: New root generation detected: ${rootGeneration}`);
       }

       // Ignore tiny drift
       if (Math.abs(drift) < 20) return;

       console.error(`mkyRouting.applyClockDiscipline():: Clock drift detected: ${drift} ms`);

       // Never move clock backwards
       if (drift < 0) {
          console.error("mkyRouting.applyClockDiscipline():: Local clock ahead of root. NO System Update!.");
          //this.slowClockSlightly();
          return;
       }

       // Small drift: slew
       if (drift < 500) {
         await this.runClockCommand("chronyc makestep");
         let step = await this.runClockCommand("chronyc tracking");
         peerTCorrection = peerTCorrection - parseChronyOffset(step);        
         console.error(`mkyRouting.applyClockDiscipline():: Applying small slew correction. step: ${step} pTCorrection is now: ${peerTCorrection}`);
         return;
       }

       // Medium drift: step forward
       if (drift < 2000) {
         console.error("Applying moderate clock forward correction.");

         const before = realNow();
         const targetSec = Math.floor(rootTime / 1000);

         await this.runClockCommand(`date -s "@${targetSec}"`);

         const after = targetSec * 1000;
         const delta = after - before;

         peerTCorrection = peerTCorrection - delta;
         console.error(`mkyRouting.applyClockDiscipline():: Applying moderate correction. targetSec: ${targetSec} pTCorrection is now: ${peerTCorrection}`);
       }

       // Large drift: emergency correction
       const before = realNow();
       const targetSec = Math.floor(rootTime / 1000);

       console.error(`EMERGENCY: Large drift detected. Forcing clock forward to: ${new Date(targetSec * 1000)}`);

       await this.runClockCommand(`date -s "@${targetSec}"`);

       const after = targetSec * 1000;
       const delta = after - before;

       peerTCorrection = peerTCorrection - delta;
       console.error(`mkyRouting.applyClockDiscipline():: Applying moderate correction. targetSec: ${targetSec} pTCorrection is now: ${peerTCorrection}`);

     } catch (err) {
       console.error("Clock discipline error:", err);
     }
   }

   // Execute a system command
   runClockCommand(cmd) {
     return new Promise((resolve, reject) => {
       //console.error(`mkyRouting.runClockCommand():: Clock Change Simulated... ${cmd}`);
       //resolve(`simulated update:${cmd}`);
       //return;
       require("child_process").exec(cmd, (error, stdout, stderr) => {
         if (error) {
           console.error(`mkyRouting.runClockCommand():: Clock command failed: ${cmd}`, stderr);
           return reject(error);
         }
         console.error(`mkyRouting.runClockCommand():: Clock command executed: ${cmd}`);
         resolve(stdout);
       });
     });
   }
   doRTabCompare(rootNode, lastNode) {
     // Deep clone so we don't mutate originals
     const r1 = JSON.parse(JSON.stringify(rootNode));
     const r2 = JSON.parse(JSON.stringify(lastNode));

     // --- 1. Remove volatile time fields ---
     this.stripTimeFields(r1);
     this.stripTimeFields(r2);

     r1.myNodes.forEach((node) =>{
       node.rtab = 'na';
     });
     console.error('doRTabCompare():: Setting myNodes rtabs equal:',r1 ,r2);
     
     // --- 2. Deep structural comparison ---
     return JSON.stringify(r1) === JSON.stringify(r2);
   }

   stripTimeFields(obj) {
     // Remove known time fields
     delete obj.sysTime;

     // If myNodes exists, strip time fields inside nested rtabs
     if (Array.isArray(obj.myNodes)) {
       obj.myNodes = obj.myNodes.map(n => {
         const cleaned = { ...n };

         if (cleaned.rtab && cleaned.rtab !== 'na') {
           // Remove time fields from nested rtab
           cleaned.rtab = { ...cleaned.rtab };
           this.stripTimeFields(cleaned.rtab);
         }

         return cleaned;
      });
    }
  }
  validatePeerTree(nodes) {
     if (!Array.isArray(nodes) || nodes.length === 0) return {errCode:0,msg:"node NOT array or zero length"};
     if ( nodes.length === 1) return  {errCode:false,msg:"only one node"};
     let root     = nodes[0];
     let lastNode = nodes[nodes.length -1];

     if (root.rtab.lnode != nodes.length){
       return {errCode:1,msg:"-- node count not matching root.lnode value --"};
     }

     if (root.rtab.lastNode != lastNode.ip){
       return {errCode:2,msg:"-- root lastnode not consistant --"};
     }

     if (lastNode.rtab.rightNode != null){
       return {errCode:3,msg:"-- lastnode.rtab.rightNode is NOT null --"};
     }
     if (root.rtab.leftNode != null){
       return {errCode:4,msg:"-- root.rtab.leftNode is NOT null --"};
     }
     if (root.rtab.myParent != null){
       return {errCode:5,msg:"-- root.myParent is NOT null --"};
     }
     if (!this.doRTabCompare(root.rtab,lastNode.rtab.rootRTab)){
       return {errCode:6,msg:"-- root and last node rtab to rtab.rootRTab not matching --"};
     }    
     return {errCode:false,msg:"healthy"};
   }
/*
     // Extract rtabs
     const rtabs = nodes.map(n => n.rtab);

    // --- 1. Validate nodeNbr sequence ---
    const nbrs = rtabs.map(r => r.nodeNbr);
    const maxNbr = Math.max(...nbrs);

    // Must be exactly 1..N with no gaps
    for (let i = 1; i <= maxNbr; i++) {
      if (!nbrs.includes(i)) return {errCode:1,msg:"Validate nodeNbr sequence"};
    }

    // --- 2. Validate lnode matches actual count ---
    const lnode = rtabs[0].lnode;
    if (lnode !== nodes.length) return {errCode:2,msg:"Validate lnode matches actual count"};

    // --- 3. Validate lastNode is correct ---
    const lastNodeIp = rtabs[0].lastNode;
    const lastNode = rtabs.find(r => r.ip === lastNodeIp || r.nodeNbr === lnode);
    if (!lastNode) return {errCode:3,msg:"Validate lastNode is correct"};

    // --- 4. Validate left/right chain integrity ---
    // Build chain by following rightNode from root
    const root = rtabs.find(r => r.mylayer === 1);
    if (!root) return {errCode:4,msg:"Validate left/right chain integrity"};

    let chain = [];
    let current = root;

    while (current) {
      chain.push(current.ip);
      if (!current.rightNode) break;

      const next = rtabs.find(r => r.ip === current.rightNode);
      if (!next) continue;  //return  {errCode:4.1,msg:"Validate left/right chain integrity right"};

      // Validate back-link
      if (next.leftNode !== current.ip) return  {errCode:4.2,msg:"Validate left/right chain integrity left"};

      current = next;
    }

    // Chain length must match lnode
    if (chain.length !== lnode) return {errCode:4.2,msg:"Chain length must match lnode"};

    // --- 5. Validate parent pointers ---
    for (const r of rtabs) {
      if (r.mylayer === 1) {
        // Root must have no parent
        if (r.myParent !== null) return {errCode:5.1,msg:"Root must have no parent"};
          continue;
      }

      const parent = rtabs.find(p => p.ip === r.myParent);
      if (!parent) return {errCode:5.2,msg:"Not Parent"};

      // Parent must be exactly one layer above
      if (parent.mylayer !== r.mylayer - 1) return {errCode:5.3,msg:"Parent must be exactly one layer above"};
    }

    // --- 6. Validate nlayer consistency ---
    const maxLayer = Math.max(...rtabs.map(r => r.mylayer));
    for (const r of rtabs) {
      if (r.nlayer !== maxLayer) return {errCode:6,msg:"Validate nlayer consistency"};
    }

    return {errCode:false,msg:"healthy"};
  }
*/
   async scanNodesRight(){
     console.error('MkyRouting.scanNodesRight()::START node scan',this.myIp,this.r.rootNodeIp);
         
     if (this.myIp == this.r.rootNodeIp){
       const testTime = Date.now();
       const nodes = [];
       var  node = {
          ip          : this.myIp,
          status      : this.status,
          err         : this.err,
          eTime       : this.eTime,
          coldStart   : this.coldStart,
          lastRootGen : this.lastRootGenerationSeen,
          rootGen     : this.rootGeneration,
          rtab        : this.r
       };
       var j = null;
       let n = 1;
       while (node && node !== 'offline' && n <= this.r.lnode) {
         nodes.push(node);
         j = await this.getNodeRight(node.rtab.rightNode);
         console.error('scanNodesRight():: getNodeRight result: ',j);
         if (j) node = j.sendNodeDataResult; 
         else   node = null;
         n++;
       }
       this.r.pCount = n -1;
       if (n === 1) {
         this.r.pCount = 1;
       } 
       let networkHealthy = this.validatePeerTree(nodes);

       //console.error('MkyRouting.scanNodesRight():: nodeScanResult::',nodes);
       console.error('MkyRouting.scanNodesRight():: scanTime: ',Date.now() - testTime);
       console.error('MkyRouting.scanNodesRight():: nodesBuffer ByteSize: ',Buffer.byteLength(JSON.stringify(nodes), 'utf8'));
       console.error('MkyRouting.scanNodesRight():: finalNode::',j);
       console.error('MkyRouting.scanNodesRight():: networkIsHealthy ::', networkHealthy);
     }
     setTimeout(() => { this.scanNodesRight();},60*1000);
   }
   getNodeRight(ip){
     //console.error('getNodeRight():: inIP ',ip);
     return new Promise( (resolve,reject)=>{
       if (!ip) {resolve(null); return;}
       const reqId = crypto.randomUUID();
       var rtListen = null;
       var rtLFail  = null;
       const gtime = setTimeout( ()=>{
         console.error('MkyRouting.getNodeRight():: timeout', ip);
         this.net.removeListener('peerTReply', rtListen);
         this.net.removeListener('xhrFail', rtLFail);
         resolve(null);
       },800);
       
       this.net.on('peerTReply', rtListen = (j)=>{
         //console.error('MkyRouting.getNodeRight():: heard', j);
         if (j.sendNodeDataResult && j.remIp == ip && reqId == j.reqId){
           clearTimeout(gtime);
           resolve(j);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
       this.net.on('xhrFail', rtLFail = (j)=>{
         if (j.sendNodeDataResult && j.remIp == ip){
           console.error('MkyRouting.getNodeRight():: xhrFailed ', j);
           clearTimeout(gtime);
           resolve (null);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
       const req = {
         req   : 'sendNodeData',
         reqId : reqId
       }
       this.net.sendMsgCX(ip,req);
     });
   }
   routingReady(){
     return new Promise( async (resolve,reject)=>{
       await this.init();
       resolve(true);
     });
   }
   async verifyRoot(){
     if (this._verifyRootTimer) {
       clearTimeout(this._verifyRootTimer);
       this._verifyRootTimer = null;
     }

     if (this.status == 'root') {
       console.error('MkyRouting.verifyRoot():: BorgUsage::',this.net.uStats);
       const rmap = await this.findWhoIsRoot();
       if (rmap.size){
         const rInfo = this.getMaxRoot();
         console.error('MkyRouting.verifyRoot():: VERIFIED best root to follow is:',rInfo);  
         if (rInfo === null || this.r.rootNodeIp === rInfo.jroot.rip){
           console.error('MkyRouting.verifyRoot():: OK I am still Root:',this.myIp,rInfo);
         }
         else {
           console.error('MkyRouting.verifyRoot():: Better Root Option Availble shutting down to join:',this.myIp,rInfo);
           this.bcast({rootDeath : 'migrateToHealthyRoot',bestRootIp:rInfo.jroot.rip});
           this.net.setNodeBackToStartup(`Best Network Tree Root has changed! Shutting down to join ${rInfo.jroot.rip} .`,rInfo.jroot.rip);
         }   
       }
     }
     this._verifyRootTimer = setTimeout(() => {
        this.verifyRoot();
     },verifyRootTimer);
   }
   // ********************************************************************
   // Search any previously known nodes and request the whoIsRoot response.
   // =====================================================================
   findWhoIsRoot(i=0){
     this.rootMap.clear(); 
     return new Promise( async (resolve,reject)=>{
       var jroot = null;
       while ( i < this.net.PTnodes.length){
         console.log(`i:${i} PTnode.length: ${this.net.PTnodes.length} node data:`,this.net.PTnodes[i]);
         const tryIp  = this.net.PTnodes[i].ip;
         const status = this.net.PTnodes[i].lastState;
         console.log(`this.status`,this.status,`status[i]`,status);
         i = i +1;
         if (this.status == 'startup' || this.status == 'tryJoining' || ((this.status == 'online' || this.status == 'root') && status == 'online')){
           if (tryIp != this.myIp){
             jroot = await this.whoIsRoot(tryIp);
             console.log (`jroot`,jroot);
             if (jroot){
               var map = this.rootMap.get(jroot.rip);
               if (map)
                 map.count++;
               else {
                 if (jroot.rip)
                   this.rootMap.set(jroot.rip,{count:1,jroot:jroot,pCount:jroot.pCount});
               }
             }
           }
         }
       } 
       if (this.rootMap.size === 0) {
         console.error('MkyRouting.findWhoIsRoot():: RootMap::',this.rootMap);
       }
       console.error('MkyRouting.findWhoIsRoot():: RootMap::',this.rootMap);
       resolve(this.rootMap); 
     });
   }
   // ****************************************************
   // Request whoIsRoot response.
   // ====================================================
   whoIsRoot(ip){
     return new Promise( (resolve,reject)=>{
       var rtListen = null;
       var rtLFail  = null;
       const gtime = setTimeout( ()=>{
         console.error(`MkyRouting.whoIsRoot():: timeout`, ip);
         this.net.removeListener('peerTReply', rtListen);
         this.net.removeListener('xhrFail', rtLFail);
         resolve(null);
       },15*1000);

       this.net.on('peerTReply', rtListen = (j)=>{
         console.log(`whoIsRoot():: heard `,j);
         if (j.whoIsRootReply && j.remIp == ip){
           clearTimeout(gtime);
           if (j.whoIsRootReply == 'notready'){
             console.error(`MkyRouting.whoIsRoot()::  ${ip} Reply::status not ready: `,j.remIp);
             resolve(null);
           }
           else if (j.whoIsRootReply == 'deadnode'){
             console.error(`MkyRouting.whoIsRoot()::  ${ip} Reply::status deadnode: `,j.remIp);
             resolve(null);
           }
           else {
             console.error(`MkyRouting.whoIsRoot():: this.rootFound`,j.whoIsRootReply);
             resolve(j.whoIsRootReply);
           }
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
       this.net.on('xhrFail', rtLFail = (j)=>{
         if (j.req == 'whoIsRoot?'){
           clearTimeout(gtime);
           console.error(`MkyRouting.whoIsRoot():: ${ip} xhrFail::this.rootFound`);
           resolve (null);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
  
       const req = {
         req  : 'whoIsRoot?'
       }
       console.error('MkyRouting.whoIsRoot():: sending message to'+ip,req);
       this.net.sendMsgCX(ip,req);
     });
   }
   // ***********************************************
   // Notify Root That A Node Is Dropping
   // ===============================================
   async notifyRootDropingNode(node){
      if (this.status === 'root') {
         return await this.rootDropChild(node);
      }
     
      // Send Node DropRequest
      const msg = {
        req      : 'rootDropThisNode',
        response : 'rootDropThisNodeResult',
        parent   : this.myIp,
        node     : node
      };
      console.error('MkyRouting.notifyRootDropingNode():: send request to root',msg);

      return  await this.net.reqReplyObj.waitForReply(this.r.rootNodeIp, msg);
   }
   async rootDropThisNode(j){
       let result = false;
       
       //...

       // SendResults Of Node Drop
       const reply = {
         response : 'rootDropThisNodeResult',
         reqId    : j.reqId,
         result   : result
       };
       this.net.sendReplyCX(j.remIp,reply);
       return;
   }
   async getRootLock(){
      let lockTimer   = Date.now();
      let maxLockTime = 60*1000;

      while (this.r.rootLock === true){
        if (Date.now() - lockTimer  > maxLockTime) {
          this.r.rootLock = false;
          console.log('getRootLock():: Took Too Long... giving up.');
          let newRoot = await this.rootDeathGetNewBestRoot();
          this.bcast({rootDeath : 'migrateToHealthyRoot',bestRootIp:newRoot});
          this.net.setNodeBackToStartup('GetRootLock Failed');
          return 'FATAL_ERROR_GETLOCK';
        }
        await sleep(500);
      }
      return this.r.rootLock = true;
   }
   async rootDropChild(node){

     // Set rootLock.
     console.log('rootDropChild():: try to get lock',node);
     let lock = await this.getRootLock();
     if (lock !== true) {
       this.dropQuePIR.push(node);
       return 'QUEUED';
     }
     try {
       await this.PIR_doDropCNode(node);
     } finally {
       // Update internal state
       this.r.rootLock = false;
     }
     return 'OK';
   }
   async PIR_doDropCNode(node) {

     // Block mulitple attempts to remove the same node.
     console.log(`rootDropChild():: begin dropping node`,node);
     if (this.dropIps.includes(node)){
         console.log('Node Has Been Dropped! ingoring drop:',this.r.myNodes,node);
         return 'OK'
     }

     //Case 1. Only two nodes in the network.
          
     if (this.r.lnode === 2 && this.r.lastNode === node){
       console.log('MkyRouting.rootDropChild():: Case 1. Only two nodes in the network',node);

         
       this.r.rootNodeIp = this.myIp;  // Top of the network routing table plus each nodes peer group.
       this.r.rootRTab   = 'na';
       this.r.myNodes    = [];         // forwarding ips for each nodes peer group.
       this.r.lastNode   = this.myIp;
       this.r.leftNode   = null;
       this.r.rightNode  = null;
       this.r.myParent   = null;
       this.r.nextParent = this.myIp;
       this.r.mylayer    = 1;
       this.r.nodeNbr    = 1;          // node sequence number 1,2,3 ... n
       this.r.nlayer     = 1;          // nlayers in the network 1,2,3 ... n
       this.r.lnode      = 1;          // number of the last node in.
       this.r.lnStatus   = 'OK';       // used for routing updates. 'OK' or 'moving'
       this.r.nextPNbr   = 1;
       this.r.pCount     = 1;

       this.dropIps = [];
       return 'OK';
     }
       

     // Case 2. Node  to drop is last node.
       
     if (this.r.lastNode === node ){
       let newLastNode = this.r.myNodes[this.r.myNodes.length -2];
       this.r.myNodes.pop();
       this.r.lnode--;
       console.log('newLastNode',node,this.r.myNodes,newLastNode);
       this.r.lastNode = newLastNode.ip;
       const reply = await this.notifyNewLastNode(newLastNode.ip);
       console.log(`MkyRouting.rootDropChild():: notifyNewLastNode ${newLastNode.ip} reply:`,reply);
       if (reply?.result !== 'OK'){
         console.log('MkyRouting.rootDropChild():: Failed At Case 2');
         this.net.setNodeBackToStartup('MkyRouting.rootDropChild():: Failed At Case 2');
         return 'FATAL_ERROR';
       }
       // Inform the network that a new last node exists.
       if (this.r.lnode > 2) {
         console.log(`console.log('MkyRouting.rootDropChild():: bcast: `,{lnodeNewLastNode : newLastNode.ip, newLastNodeNbr: this.r.lnode});
         this.bcast({lnodeNewLastNode : newLastNode.ip, newLastNodeNbr: this.r.lnode});
       }
       return 'OK'
     }  

     // Case 3. tell Last Node to move to the dead node spot.
     const dropIndex = this.r.myNodes.findIndex(n => n.ip === node);

     if (dropIndex >= 0){
       console.log(`myNodes Case 3. node ${node} dropIndex ${dropIndex}`,this.r.myNodes);
       const lastNode = this.r.myNodes[this.r.myNodes.length - 1];
       const hotRtab  = this.r.myNodes[dropIndex].rtab;

       // Update Child Node Pointer and remove the last node pointer. 
       this.r.myNodes[dropIndex].ip = lastNode.ip;
       this.r.myNodes.pop();

       // Tell last node to move into dropIndex
       console.log('rootDropChild():: rootSaysMoveTo',lastNode.ip,dropIndex,hotRtab);
       const reply = await this.rootSaysMoveTo(lastNode.ip,hotRtab);

       if (reply?.result?.result?.result !== 'OK') {
         console.log('rootDropChild():: Failed At Case 3',reply);
         let newRoot = await this.rootDeathGetNewBestRoot();
         this.bcast({rootDeath : 'migrateToHealthyRoot',bestRootIp:newRoot});
         this.net.setNodeBackToStartup('Case 3 failure');
         return 'FATAL_ERROR';
       }

       // Update internal state
       this.r.rootLock = false;
     }
   }
   async rootDeathGetNewBestRoot(){
     let newRoot = this.myIp;
     const rmap = await this.findWhoIsRoot();
     if (rmap.size) {
       newRoot = this.getMaxRoot();

       if (!newRoot){ newRoot = this.myIp;}
       else {newRoot = newRoot.jroot.rip;}
     }
     return newRoot;
   }
   async notifyNewLastNode(ip){
      // tell node to become last node.
      const msg = {
        req       : 'rootSaysYourLastNode',
        response  : 'rootSaysYourLastNodeResult',
        rootRTab  : this.r
      };
      console.log('MkyRouting.notifyNewLastNode():: sending',msg);

      return  await this.net.reqReplyObj.waitForReply(ip, msg);
   }
   async rootSaysYourLastNode(j){
     this.r.rightNode  = null;
     this.r.lastNode   = this.myIp;
     this.r.lnode      = this.r.nodeNbr;
     this.r.rootRTab   = j.rootRTab;

     // SendResults Of Change Request
     const reply = {
       response : 'rootSaysYourLastNodeResult',
       reqId    : j.reqId,
       result   : 'OK'
     };
     console.log(`rootSaysYourLastNode():: sending `,reply);     
     this.net.sendReplyCX(j.remIp,reply);
     return;
   }
   async rootSaysMoveTo(ip,hotRtab){
      // tell lastNode to replace dead node.
      if (hotRtab?.rootLock) hotRtab.rootLock = false;
      const msg = {
        req        : 'rootSaysLastMoveTo',
        response   : 'rootSaysLastMoveToResult',
        hotRtab    : hotRtab
      };
      console.log(`MkyRouting.rootSaysMoveTo()::  sending to: ${ip} `,msg);

      return  await this.net.reqReplyObj.waitForReply(ip, msg);
   } 
   async rootSaysLastMoveTo(j) {
     let response = 'OK';
     let newLastNodeIp  = this.r.leftNode;
     let newLastNodeNbr = this.r.nodeNbr -1;

     this.r = j.hotRtab;
     if (this.r.rightNode === this.myIp){ // X? - needs to check for this.r NOT == 'na'
       this.r.rightNode = null;
       this.r.lnode     = this.r.nodeNbr;
       newLastNodeIp    = this.myIp;
     }
     else {
       this.r.lnode    = newLastNodeNbr;
       this.r.lastNode = newLastNodeIp;
     }

     console.log('rootSaysLastMoveTo():: heard!!! rootSaysLastMoveTo',j);

     response = await this.doAddMeToYourRight(this.r.leftNode);
     console.log('rootSaysLastMoveTo():: resonse: ',response);
     console.log('rootSaysLastMoveTo():: rightNode is ',this.r.rightNode);
     if (response?.result === 'OK' && this.r.rightNode){
       response = await this.doAddMeToYourLeft(this.r.rightNode);
       console.log('doAddMeToYourLeft',response);
     }

     // Inform the network that a new last node exists.
     console.log('rootSaysLastMoveTo():: final response ',response);
     if (response?.result?.result === 'OK') {
       this.bcast({lnodeNewLastNode : newLastNodeIp, newLastNodeNbr: newLastNodeNbr});
     }
     
     // SendResults Of Change Request
     const reply = {
       response : 'rootSaysLastMoveToResult',
       reqId    : j.reqId,
       result   : response
     };

     this.net.sendReplyCX(j.remIp,reply);
     return;
   }
   async doAddMeToYourRight(ip){
      const msg = {
        req        : 'peerAddMeToYourRight',
        response   : 'peerAddMeToYourRightResult',
      };
      console.log(`MkyRouting.doAddMeToYourRight():: sending to: ${ip} `,msg);

      return  await this.net.reqReplyObj.waitForReply(ip, msg);
   }
   async peerAddMeToYourRight(j){
     this.r.rightNode  = j.remIp;

     // Prepare SendResults Of Change Request
     const reply = {
       response : 'peerAddMeToYourRightResult',
       reqId    : j.reqId,
       result   : 'OK'
     };
     console.log(`peerAddMeToYourRight():: heard from: ${j.remIp} `,j);
     // Try to back propagate changes to rtab 
     reply.result = await this.tryBackPropagateRTab(j);
     
     // send results reply
     this.net.sendReplyCX(j.remIp,reply);
     return;
   }
   async tryBackPropagateRTab(j){
     console.log(`tryBackPropagateRTab():: starting: myParent :`,this.r.myParent,j);
     let result = 'OK';
     if (this.r.myParent != null){
       result = await this.backPropRTabChange(this.r.myParent,this.net.dropChildRTabs(clone(this.r)));
     }
     else {
       // Top of tree .
       const index  = this.r.myNodes.findIndex(n => n.ip === j.remIp);
       console.log(`tryBackPropagateRTab():: index: ${index} child: ${j.remIp} `);
       if (index >= 0){
         const child  = this.r.myNodes[index];
         child.rtab   = j.rtab;
         result = 'OK';
       }
       else {
         // Root rtab is corrupt send rootDeath bcast. X?
         result = 'ROOT_FAIL';
         let newRoot = await this.rootDeathGetNewBestRoot();
         this.bcast({rootDeath : 'migrateToHealthyRoot',bestRootIp:newRoot});
         this.net.setNodeBackToStartup('Back Propagation Root failure child not found');
       }
     }
     return result;
   }
   async doAddMeToYourLeft(ip){
      const msg = {
        req        : 'peerAddMeToYourLeft',
        response   : 'peerAddMeToYourLeftResult',
      };
      console.log('MkyRouting.doAddMeToYourLeft():: sending',msg);

      return  await this.net.reqReplyObj.waitForReply(ip, msg);
   }
   async peerAddMeToYourLeft(j){
     this.r.leftNode  = j.remIp;

     // SendResults Of Change Request
     const reply = {
       response : 'peerAddMeToYourLeftResult',
       reqId    : j.reqId,
       result   : 'OK'
     };
     // Try to back propagate changes to rtab
     reply.result = await this.tryBackPropagateRTab(j);

     this.net.sendReplyCX(j.remIp,reply);
     return;
   }
   async backPropRTabChange(ip,rtab){
      const msg = {
        req        : 'parentUpdateMyRTab',
        response   : 'parentUpdateMyRTabResult',
        rtab       : rtab,
        childIp    : this.myIp
      };
      console.log(`MkyRouting.backPropRTabChange():: sending to: ${ip} `,msg);

      return  await this.net.reqReplyObj.waitForReply(ip, msg);
   }
   async parentUpdateMyRTab(j){
     // Prepare reply object
     const reply = {
       response : 'parentUpdateMyRTabResult',
       reqId    : j.reqId,
       result   : 'FAIL_CHILD_NOTFOUND'
     };
     
     // attempt update of child rtab
     const index  = this.r.myNodes.findIndex(n => n.ip === j.childIp);
     if (index >= 0){
       const child  = this.r.myNodes[index];
       console.log(`parentUpdateMyRTab():: child info is: `,child);
       child.rtab   = j.rtab;
       reply.result = 'OK';
     }

     // Send Reply
     console.log(`MkyRouting.parentUpdateMyRTab():: sending to: ${j.remIp} `,reply);
     this.net.sendReplyCX(j.remIp,reply);
     return;
   }
   /*
     const reqId = crypto.randomUUID();   // Unique ID for THIS attempt
     return new Promise((resolve,reject)=>{
       console.error('MkyRouting.notifyRootDropingNode():: Start',node);
       if (node == this.r.rootNodeIp){
         resolve('IsRoot');
         return;
       }
       //*check to see if myIp is the root ndode.
       if (this.myIp != this.r.rootNodeIp && node != this.net.getNetRootIp()){
         const toIp = this.net.getNetRootIp();
         const req = {
           req  : 'rootStatusDropNode',
           node : node,
           reqId : reqId
         }
         var rtListen = null;
         var rtLFail  = null;
         const gtime = setTimeout( ()=>{
           console.error('MkyRouting.notifyRootDropingNode():: timeout', node);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
           resolve(null);
         },2500);

         this.net.on('peerTReply', rtListen = (j)=>{
           if (j.resultRootStatusDropNode && j.remIp == toIp){
             console.error('MkyRouting.notifyRootDropingNode():: j = ',j);
             clearTimeout(gtime);
             if (j.resultRootStatusDropNode == 'busy')
               resolve('busy');
             else {
               resolve(j.resultRootStatusDropNode);
             }
             this.net.removeListener('peerTReply', rtListen);
             this.net.removeListener('xhrFail', rtLFail);
           }
         });
         this.net.on('xhrFail', rtLFail = (j)=>{
           if (j.req == 'rootStatusDropNode' && j.remIp == toIp){
             clearTimeout(gtime);
             resolve (null);
             this.net.removeListener('peerTReply', rtListen);
             this.net.removeListener('xhrFail', rtLFail);
           }
         });

         this.net.sendMsgCX(toIp,req);
       }
       else {
         console.error('MkyRouting.notifyRootDropingNode():: Root is Is Root set join que block');
         this.startJoin = 'waitForDrop';
         resolve('IAmRoot');
       }
     });
   }
   */
   // ***********************************************
   // Notify Root That The Node Request Is Complete
   // ===============================================
   notifyRootDropComplete(){
     //*check to see if myIp is the root node.
     if (this.myIp != this.net.getNetRootIp()){
       const req = {
         req  : 'rootStatusDropComplete'
       }
       this.net.sendMsgCX(this.net.getNetRootIp(),req);
     }
     else {
       console.error('MkyRouting.notifyRootDropingNode():: Root is Is Root: Clearing Wait For Drop');
       this.clearWaitForDrop();
     }
   }
   clearWaitForDrop(){
     if (this.startJoin == 'waitForDrop'){
       if (this.dropTimer){
         clearTimeout(this.dropTimer);
       }
       console.error('MkyRouting.clearWaitForDrop():: cleared');
       this.startJoin = null;
     }
   }
   // ****************************************************
   // handles directly the first 2*maxPees peers to join
   // ====================================================
   async addNewNodeReq(ip){
     return new Promise(async(resolve,reject)=>{
       console.error('MkyRouting.addNewNodeReq():: Add by REQUESST',ip);
       if (this.inMyNodesList(ip)){
         console.error('MkyRouting.addNewNodeReq():: inMyNodesListError:',ip);
         resolve(false);
         return;
       }

       const oldLastNodeIp = this.r.lastNode;
       if (!oldLastNodeIp){
         console.error('MkyRouting.addNewNodeReq():: PROBLEM!!! oldLastNodeIp::',oldLastNodeIp);
         process.exit();
       }
       const prevNextParent = this.r.nextParent;
       const oldNextPNbr    = this.r.nextPNbr;
       const newNextPNbr    = this.getMyParentNbr(this.r.lnode+1);
       console.error('MkyRouting.addNewNodeReq():: NextPNbr::',oldNextPNbr,newNextPNbr);

       if ( this.r.myNodes.length < this.net.maxPeers){
         var node = {ip : ip,nbr : this.r.lnode+1, pgroup : [],rtab : 'na'}
         this.r.myNodes.push(node);
         this.incCounters();
         this.r.lastNode        = ip;
         this.newNode           = clone(this.r);
         this.newNode.leftNode  = oldLastNodeIp;
         this.newNode.rightNode = null;
         this.newNode.myParent  = this.myIp;
         this.newNode.mylayer   = this.getNthLayer(this.net.maxPeers,this.r.lnode);
         resolve(true);
         return;
       }   
       // Node Is Full Set Up Next Parent Pointer To Start Adding New Nodes  
       // ***************************************************

       if (this.r.nextParent == this.r.rootNodeIp){
         console.error('MkyRouting.addNewNodeReq():: Updating NextParent To: ',this.r.rightNode);
         this.r.nextParent = this.r.rightNode;
       }
       
       const danglingNode = await this.findWhoHasChild(ip);
       console.error('MkyRouting.addNewNodeReq():: dangleCheck:',danglingNode,ip);
       if (danglingNode){
         if(danglingNode != 'noBody'){
           this.net.sendMsgCX(danglingNode,{req : "dropDanglingNode", ip : ip});
           console.error('MkyRouting.addNewNodeReq():: Sending:dropDangle',danglingNode,{req : "dropDanglingNode", ip : ip});
           resolve(false);
           return;
         }
       }
       if (ip == this.r.lastNode){
         console.error('MkyRouting.addNewNodeReq():: newNode is same as LastNode For:',ip);
         resolve(false);
         return;
       }

       var nextParent = await this.getNextParent(prevNextParent,oldNextPNbr,newNextPNbr);

       if (!nextParent){
         console.error('MkyRouting.addNewNodeReq():: getNodeIpByNbr:Failed For:',newNextPNbr);
         resolve(false);
         return;
       }
 
       this.nextpIp = await this.nextParentAddChild(ip,this.r.lnode+1,nextParent);
       console.log('MkyRouting.addNewNodeReq():: nextParentAddChild ->', this.nextpIp); 

       if (!this.nextpIp){
         console.error('MkyRouting.addNewNodeReq():: nextParentAddChild:Failed For:',ip,newNextPNbr);
         resolve(false);
         return;
       }
       this.r.nextPNbr = newNextPNbr;
       this.incCounters();
       this.r.nextParent = nextParent;

       this.r.lastNode = ip;
       if (this.r.lnode == 2){
         this.r.rightNode = ip;
       }
       this.newNode           = clone(this.r);
       this.newNode.myParent  = nextParent;
       this.newNode.leftNode  = oldLastNodeIp;
       this.newNode.rightNode = null;
       this.newNode.mylayer   = this.getNthLayer(this.net.maxPeers,this.r.lnode);
       console.error('MkyRouting.addNewNodeReq():: NewNODE::lookslike:',this.newNode);
       resolve(true);
       return;
     });
   }
   getNextParent(ip,oldNextPNbr,newNextPNbr){
     return new Promise(async(resolve,reject) => {
       console.error('MkyRouting.GetNextParent():: ',ip,oldNextPNbr,newNextPNbr);
       if (oldNextPNbr == newNextPNbr){
          resolve(ip);
          return;
       }
       if (ip == this.myIp){
         console.error('MkyRouting.getNextParent():: THISISME');
         resolve(this.r.rightNode);
         return;
       }
       const j = await this.getNodeRight(ip);
       console.error('MkyRouting.getNextParent():: SENDNODEDATA::gave',j,ip);
       if (j) resolve(j.sendNodeDataResult.rtab.rightNode);
       else {
         console.error('MkyRouting.getNextParent():: SENDNODEDATA::Failed Shuttion down');
         this.net.setNodeBackToStartup('Failed on MkyRouting.getNextParent()::');
         resolve(null);
       } 
     });
   }
   getMyParentNbr(nodeNbr) {
     if (nodeNbr === 1) return 1 //null; // root has no parent
     return Math.floor((nodeNbr - 2) / this.net.maxPeers) + 1;
   }
   lastNode(maxP, L) {
     if (this.net.maxPeers === 1) {
       return L;
     }
     return (Math.pow(this.net.maxPeers, L) - 1) / (this.net.maxPeers - 1);
   }
   findWhoHasChild(ip){
     return new Promise((resolve,reject)=>{
       var errListener = null;
       var repListener = null;
       const reqId = crypto.randomUUID();


       // Set Time out for responses.
       const hTimer = setTimeout( ()=>{
         this.net.removeListener('peerTReply', repListener);
         this.net.removeListener('xhrFail', errListener);
         resolve('noBody');
       },2500);

       //catch errors.
       this.net.on('xhrFail',errListener = (j)=>{
         if (j.reqId === reqId){
           clearTimeout(hTimer);
           this.net.removeListener('xhrFail', errListener);
           this.net.removeListener('peerTReply', repListener);
           resolve(null);
         }
       });

       // Listen for responses.
       this.net.on('peerTReply',repListener  = (j)=>{
         if (j.resultWhoHasChild && j.reqId === reqId){ 
           clearTimeout(hTimer);
           console.error('MkyRouting.findWhoHasChild():: gotBack:', j.resultWhoHasChild);
           resolve (j.resultWhoHasChild);
           this.net.removeListener('xhrFail', errListener);
           this.net.removeListener('peerTReply', repListener);
         }
       });
 
       this.bcast({findWhoHasChild : {ip:ip,reqId}});
     });
   }
   async nextParentAddChild(ip,nbr,nextParent){

     // check if it can be handled localy
     if (this.r.nextParent === this.myIp && this.r.myNodes.length < this.net.maxPeers) {
       var node = {ip : ip,nbr : nbr, pgroup : [],rtab : 'na'};
       this.r.myNodes.push(node);
       this.r.lnode = nbr;
       this.r.lastNode = ip;

       // Remove New Node Ip from dropped nodes list;
       let newNodex = this.dropIps.indexOf(ip);
       if (newNodex !== -1) {
         this.dropIps.splice(newNodex, 1);
       }
       if ( this.r.myNodes.length < this.net.maxPeers) {return this.myIp;}
       else { return this.r.rightNode;}
     } 

     const msg = {
       req      : 'rootSaysAddChild',
       response : 'rootSaysAddChildResult',
       ip       : ip,
       nbr      : nbr
     };

     let reply = await this.net.reqReplyObj.waitForReply(nextParent, msg);
     console.log(`MkyRouting.nextParentAddChild():: child ${ip}, parent: ${nextParent} -> reply: `,reply);
     if (reply?.result === 'OK'){
        return reply?.resultNextParentAddChildIp;
     }
     return false;
   }     
   async rootSaysAddChild(j){
     let result = 'OK';
     let rip    = 'NULL';

     console.error('MkyRouting.rootSaysAddChild():: Got Request:ReplyTO '+j.remIp,j);
     this.parentSaveState = this.saveState();

     if (this.r.myNodes.length < this.net.maxPeers){
       var node = {ip : j.ip,nbr : j.nbr, pgroup : [],rtab : 'na'};
       this.r.myNodes.push(node);
       this.r.lnode = j.nbr;
       this.r.lastNode = j.ip;

       // Remove New Node Ip from dropped nodes list;
       let newNodex = this.dropIps.indexOf(j.ip);
       if (newNodex !== -1) {
         this.dropIps.splice(newNodex, 1);
       }
     } else { result = 'FAILED_ParentFull';}

     // X? Check if the parents child nodes are all filled.
     // if yes get the ip of the next node right.
     if (this.r.myNodes.length == this.net.maxPeers) { rip = this.r.rightNode; }
     else { rip = this.myIp;}

     const reply = {
       response : 'rootSaysAddChildResult',
       result   : result,
       resultNextParentAddChildIp : rip
     };

     console.error(`MkyRouting.rootSaysAddChild():: sending reply `,j.remIp, reply);
     this.net.endResCX(j.remIp,JSON.stringify(reply));
   }
/*   return new Promise((resolve,reject)=>{
       const reqId = crypto.randomUUID();
       //create error and reply listeners
       var errListener = null;
       var repListener = null;
       this.net.on('xhrFail',errListener = (j)=>{
         if (j.remIp == nextParent && j.req == 'nextParentAddChildIp'){
           this.net.removeListener('xhrFail', errListener);
           this.net.removeListener('peerTReply', repListener);
           resolve(null);
         }
       });
       this.net.on('peerTReply',repListener  = (j)=>{
         if (j.resultNextParentAddChildIp && j.remIp == nextParent){ // && j.remIp == ip){
           console.error('MkyRouting.nextParentAddChild():: gotBack:', j.resultNextParentAddChildIp);
           this.net.removeListener('xhrFail', errListener);
           this.net.removeListener('peerTReply', repListener);
           resolve (j.resultNextParentAddChildIp);
         }
       });
       var req = {req : 'nextParentAddChildIp',ip:ip,nbr:nbr,reqId:reqId};
       this.net.sendMsgCX(nextParent,req);
     });
   }
*/  
   getMyLayer(maxPeers, nodeNbr) {
     let layer = 1;
     let cumulative = 1; // end of layer 1
     while (nodeNbr > cumulative) {
       layer++;
       cumulative += Math.pow(maxPeers, layer - 1);
     }
     return layer;
   }
   getMyLayer(maxPeers,nodeNbr){
     let start = 1;
     let end   = 1;
     let layer = 1;
     while (nodeNbr >= start){
       end = Math.pow(maxPeers,layer -1);
       start = start + end;
       layer ++;
     }
     return layer-1;
   }
   // ***********************************************
   // update pgroup routes at request of child node
   // ===============================================
   updatePeerRouting(j){
     this.r.myNodes.forEach( n =>{
       if (n.ip == j.remIp) 
         n.pgroup = j.newRoute;
     });
     if (this.iAmRootLayerNode())
       this.bcastRootTableUpdate();
   }
   // *************************************
   // Remove routing info for removed node
   // =====================================
   dropNode(ip){
     console.error('MkyRouting.dropNode():: starting for',ip);
     if (this.r.lnode <= this.net.maxPeers){
       var rUpdate = false;
       this.r.rootNodes.forEach( (n, index, object)=>{
         n.pgroup.forEach( (n, index, object)=>{
           if (n.ip == ip){
             console.error('MkyRouting.dropNode():: splice pgroup: '+n.nbr,ip);
             object.splice(index,1);
             rUpdate = true;
           }
         }); 
         if (n.ip == ip){
           console.error('MkyRouting.dropNode():: splice child: '+n.nbr,ip);
           object.splice(index,1)
           rUpdate = true;
         }
       });
       if (rUpdate)
         console.error('MkyRouting.dropNode():: bcastRootUpdate ',this.r.rootNodes);
         this.bcastRootTableUpdate();
     }
     this.r.myNodes.forEach( (n, index, object)=>{
       if (n.ip == ip){
         console.error('MkyRouting.dropNode():: dropping child node',ip);
         object.splice(index,1);
         if(this.r.mylayer == 1){
           console.error('MkyRouting.dropNode():: bcastRootUpdate:childNodes ',this.r.myNodes);
           this.bcastRootTableUpdate();
         }
       }
     });
   }
   // **********************************************************
   // Calculate what layer a node is in
   // ==========================================================
   
   getNthLayer(maxPeers,n){
     return this.getMyLayer(maxPeers,n);
   }
   // **********************************************************
   // Increment node and layer counters when adding peer nodes
   // ==========================================================
   incCounters(){
     this.r.lnode++;
     this.r.nlayer = this.getNthLayer(this.net.maxPeers,this.r.lnode);
   }
   // **************************************************************
   // Decrement node and layer counter when removing peer nodes
   // ===========================================================
   decCounters(){
     this.r.lnode--;
     this.r.nlayer = this.getNthLayer(this.net.maxPeers,this.r.lnode);
   }
   // ************************************************************
   // Network Start Up:
   // Look For node file if not found use rootIp as default join
   // ============================================================
   init(bestRootIp=null){
     console.error(`MkyRouting.init():: startup path: ${bestRootIp ? 'migration' : 'normal'}`, bestRootIp);
     return new Promise(async (resolve,reject)=>{
       const doWait = true;
       const rtab = await this.net.readNodeFile(doWait);
       var   jroot = null;
       var   rInfo = null;
       if (!rtab) 
         console.error('MkyRouting.init():: NETWORK starting... I am a Genisis node!', this.net.PTnodes);
       else 
         if (Array.isArray(rtab))
           if (rtab.length > 0)
             this.net.PTnodes = rtab;

       console.error('MkyRouting.init():: nodesFile', this.net.nodesFile,this.net.PTnodes);
       
       if (bestRootIp){
         resolve( await this.doMakeJoinRequest(bestRootIp));
         return;
       }     
       
       if (this.net.PTnodes.length > 0){
	 const rmap = await this.findWhoIsRoot();
         rInfo = this.getMaxRoot();
         
         console.error('MkyRouting.init():: findingRoot:',rInfo?.count,rInfo?.jroot?.rip);
         
         if (!rInfo){ 
           console.error('MkyRouting.init():: No Root Ip Provided:');
           jroot = this.myIp;
         }
         else {
           jroot = rInfo.jroot.rip;
           this.net.rootIp = jroot;
           this.net.maxPeers = rInfo.jroot.maxPeers;
         }
       } 
       if (this.myIp != jroot && jroot !== null){
         resolve( await this.doMakeJoinRequest(jroot));
         return;
       }    
       else{ 
         this.r.rootNodeIp = this.myIp;
         this.r.nextParent = this.myIp;
         this.status = 'root';
         this.r.nodeNbr = 1;
         console.error("MkyRouting.init():: I am alone :(");
       }
       resolve(true);
     });	     
   }
   async doMakeJoinRequest(rip) {
     const reqId = crypto.randomUUID();

     const msg = {
       req: 'joinReq',
       reqId: reqId
     };

     console.error("MkyRouting.init():: New Node Sending Join.. req to:", rip, this.myIp, msg);

     this.net.sendMsgCX(rip, msg);

     const joinRes = await this.resultFromJoinReq(rip, reqId);
     console.error('MkyRouting.init():: joinRes::', joinRes);

     if (joinRes === 'joinSuccess') {
       this.status = 'online';
       let reply   = {resultFromJoin : 'Thanks',reqId : reqId};
       this.net.endResCX(rip,JSON.stringify(reply));
       return;
     }

     let reply = {resultFromJoin : 'FAILED',reqId : reqId};
     this.net.endResCX(rip,JSON.stringify(reply));

     console.error('MkyRouting.init():: FAILED Join', joinRes);
     this.net.setNodeBackToStartup(`Init join request Failed with: ${joinRes}`);
   }
   resultFromJoinReq(ip, reqId) {
     return new Promise((resolve) => {
       let done = false;
       let jres = null;

       const finish = (value) => {
         if (done) return;
         done = true;
       
         clearTimeout(gtime);
         this.net.removeListener('peerTReply', onReply);
         this.net.removeListener('xhrFail', onFail);

         resolve(value);
       };
        
        const onReply = async (j) => {
         if (j.addResult && j.remIp === ip && j.reqId === reqId) {
           jres = await this.processMyJoinResponse(j);

           if (jres !== 'joinWait') {
             finish(jres);
           } else {
             this.status = 'waitingToJoin';
           }
         }
       };

       const onFail = (j) => {
         if (j.req === 'joinReq' && j.remIp === ip && j.reqId === reqId) {
           finish('xhrFail');
         }
       };


       // -------------------------
       // TIMEOUT LOOP (fixed)
       // -------------------------
       let gtime;
       let gInterval = 35*1000; // initial wait for 3 seconds then switch to 500ms. 
       const tick = () => {
         gtime = setTimeout( async () => {
           // test root status periodically while waiting.
           const msg = {
             req      : 'joinWaitOK?',
             response : 'joinWaitOKReply',
             ticketId : reqId
           };
           let reply = await this.net.reqReplyObj.waitForReply(ip, msg); 
           console.log(`resultFromJoinReq():: wait reply: `,reply);
           if (reply?.result?.status !== 'keepWaiting') {
             if (this.status === 'online') {
               finish('joinSuccess');
               return
             }
             console.error('resultFromJoinReq():: keepWaiting Terminated: ',reply);
             this.net.setNodeBackToStartup('my join request Timeout: lost contact with root');
             finish('joinTimeout');
           } else {
             if (this.status === 'waitingToJoin') {  //keep looping till status changes.
               gInterval = 500;
               tick(); // extend timer another 500ms
             }
           }
         }, gInterval);
       };
       
       tick(); // Start monitering the root nodes progress on the join.

       this.net.on('peerTReply', onReply);
       this.net.on('xhrFail', onFail);
     });
   }
   async keepWaiting(ticketId){
   }
   getMaxRoot(){
    let bestIp = null;
    let bestData = null;

    for (const [ip, data] of this.rootMap.entries()) {
      if (!bestData) {
        bestIp = ip;
        bestData = data;
        continue;
      }

      // Compare by count first
      if (data.count > bestData.count) {
        bestIp = ip;
        bestData = data;
        continue;
      }

      // If counts tie, compare by lnode
      if (data.count === bestData.count && data.lnode > bestData.lnode) {
        bestIp = ip;
        bestData = data;
      }
    }
    if (!bestIp) {
      return null;
    }
    return this.rootMap.get(bestIp);
  } 

   // *************************************************
   // check to see if i am a root node in the network
   // =================================================
   iAmRootLayerNode(){
     if (this.r.mylayer == 1){
       return true;
     }
     return false;
   }
   // *************************************************
   // check to see if i am the root node in the network
   // =================================================
   iAmTheRootNode(){
     if (this.r.nodeNbr == 1 && this.status == 'root'){
       return true;
     }
     return false;
   }
   // ******************************************************
   // Must Call this any time the main root table is chainged
   // =======================================================
   bcastRootTableUpdate(){
     console.error('Sending bcast rootTabUpdate...');
     this.bcast({
       rootTabUpdate : {
         rootIp      : this.r.rootNodeIp,
         lastNodeIp  : this.r.lastNode,
         lastNodeNbr : this.r.lnode
       }
     });
   }

   // **********************************************************
   // Used to send broadcast message to all peers on the network
   // ==========================================================
   bcast(msg){
     msg.ptreeId = this.r.ptreeId;
     //console.error(`MkyRouting.bcast():: this.r`,msg);
     const bc = {
       req     : 'bcast',
       msg     : msg,
       reroute : false
     }
     //console.error('MkyRouting.bcast():: Constructed ',bc);
     this.net.sendMsgCX(this.r.rootNodeIp,bc);
     this.forwardMsg(bc);
   }       
   // *************************************************
   // forwards 'bcast' messages down the tree
   // =================================================
   forwardMsg(msg){
     if (this.r.myNodes){
       for (var node of this.r.myNodes){
         if (node.ip != this.myIp){
           // Do not try to send drop msgs to dead node.
           if (msg.msg.simReplaceNode){
             if (msg.msg.simReplaceNode.ip != node.ip){
               this.net.sendMsgCX(node.ip,msg);
             }
           }
           else { 
             this.net.sendMsgCX(node.ip,msg);
           }
         }
       }
     }
   }
   // *************************************************
   // Route Past Unresponsive node while it is being replaced
   // =================================================
   routePastNode(msg){
     //console.error('MkyRouting.routePastNode():: msg: ',msg);
     if (!msg.req == 'bcast'){
       return false;
     }

     if (this.r.myNodes){
       for (var node of this.r.myNodes){
         if (node.ip == msg.toHost){
           if (node.rtab != 'na'){
             if (Array.isArray(node.rtab.myNodes)) {
               for (var p of node.rtab.myNodes){
                 //console.error('MkyRouting.routePastNode():: Send BCAST past node ',p.ip);
                 this.net.sendMsgCX(p.ip,msg);
               }
             } 
           }
         }
       }
     }
     return true;
   }
   // *******************************************************
   // Check If Ip is in either the root table or my peer group
   // If yes return the node number of the node.
   // ======================================================
   inMyNodesList(ip){
     // Last node has root as child.
     if (this.myIp == this.r.lastNode && ip == this.r.rootNodeIp )
       return 1;

     if (!this.r.myNodes)
       return false;

     if (Array.isArray(this.r.myNodes)) {
       for (var node of this.r.myNodes){
         if (node.ip == ip)
           return node.nbr;
       }
     } 
     return false;
   }
   // ******************************************************************
   // checks to see if the node is the parent of the node to be dropped
   // ==================================================================
   notMyNode(ip){
     // last node check
     if (this.myIp == this.r.lastNode && this.r.rootNodeIp == ip){
       console.error('MkyRouting.notMyNode():: Last Node Check Root Node Drop::OK',ip);
       return false;
     }
     // all other nodes check
     if (Array.isArray(this.r.myNodes)) {
       for (var node of this.r.myNodes)
         if (node.ip == ip)
           return false;
     }
     console.error('MkyRouting.notMyNode():: true for ',ip);
     return true;
   }
   // ********************************
   // Replace Node 
   // ================================
   dropLastNode(nodes,nbr){
     console.error('MkyRouting.dropLastNode():: start drop last node',nodes); 
     if (!nodes || !Array.isArray(nodes))
       return;
 
     nodes.forEach( (n,index,object)=>{
       if (n.pgroup){
         n.pgroup.forEach( (p,pindex,pobject)=>{
           if(p.nbr == nbr)
             pobject.splice(pindex,1);
         }); 
       }
       if (n.nbr == nbr){
         object.splice(index,1);
         console.error('MkyRouting.dropLastNode():: spliced',nbr);
       }
     });
   }
   // ***********************************************
   // set last node active to root settings
   // ===============================================
   becomeRoot(){
     console.error('MkyRouting.becomeRoot():: becoming root node:replacing:'+this.myIp+'-',this.net.rootIp);
     this.initialize();
     this.net.doHotStartInitialize();

     this.net.rootIp   = this.myIp;
     this.status       = 'root';  
     this.net.msgMgr.remove(this.net.rootIp);

     if (this.cronoT) this.cronoT.reset();
     this.verifyRoot();
   }
   // ***********************************************
   // last node replaces root node if root node is inactive
   // ===============================================
   lnodeReplaceRoot(ip,nbr){
     console.error('MkyRouting.lnodeRplaceRoot():: lnodeReplaceRoot: '+ip,nbr);
     return new Promise( async (resolve,reject)=>{
       this.dropIps.push(ip);  // ?? is this redundent?

       const rip            = this.myIp;
       const dropNbr        = this.r.lnode;
       const newLastNodeIp  = this.r.leftNode;
       const saveNextParent = this.r.nextParent;
       const saveNextPNbr   = this.r.nextPNbr;

       // Notify Parent This Node Is Moving and needs to be dropped.
       if (ip != this.r.myParent){
         if (this.r.myParent != ip){
           const req = {
             req : 'dropMeAsChildLastNode',
             ip  : this.myIp
           }
           console.error('lnodeReplaceRoot():: MoveTo::sending:'+this.r.myParent,req);
           this.net.sendMsgCX(this.r.myParent,req);
         }
         else {
           console.error('MkyRouting.lnodeReplaceRoot():: Popping newRTab',this.r.rootRTab.myNodes);
           if (Array.isArray(this.r.rootRTab)){
             this.r.rootRTab.pop(); 
           }
         }
       }

       console.error('MkyRouting.lnodeReplaceRoot():: Cloning RootRTab',this.r.rootRTab);

       // Check If There is a valid working copy of the root nodes rtab in this.r.rootRTab if not go off line.
       if (this.r.rootRTab == 'na' || !this.r.rootRTab){
         this.net.setNodeBackToStartup('Last Node Can Not Replace Root... rootRTab corrupt');
         resolve(false);
         return;
       }
       this.r = clone(this.r.rootRTab);

       // If last node is in the old root routing table remove it (double check lastnode is not left in rtab).
       this.dropLastNode(this.r.myNodes,this.r.lnode);

       this.r.lnode--;
       this.r.lastNode   = newLastNodeIp;
       this.r.rootRTab   = 'na';
       this.r.rootNodeIp = this.myIp;
       this.r.nextParent = saveNextParent;
       this.r.nextPNbr   = saveNextPNbr;

       console.error('MkyRouting.lnodeReplaceRoot():: ROOTDROPED::rtab is now:',this.r);
       this.status = 'root';
       this.r.rootNodeIp = this.myIp;
       this.net.msgQue = [];
       this.net.msgMgr.remove(this.net.rootIp);
       this.net.resetErrorsCntAll();

       if (this.r.rightNode){
         console.error('MkyRouting.lnodeReplaceRoot():: Sending To:',this.r.rightNode,{req : "addMeToYourLeft", ip : this.myIp});
         this.net.sendMsgCX(this.r.rightNode,{req : "addMeToYourLeft", ip : this.myIp});
       }

       this.r.myNodes.forEach((child)=>{
         console.error('MkyRouting.lnodeReplaceRoot():: Sending To:',child.ip,{req : "addMeAsYourParent", ip : this.myIp});
         this.net.sendMsgCX(child.ip,{req : "addMeAsYourParent", ip : this.myIp});
       });

       this.startJoin = null;
       this.err = null;
       console.error('MkyRouting.lnodeReplaceRoot():: looksLike:',this.r,' For:',ip,nbr);
       console.error('MkyRouting.lnodeReplaceRoot():: I am now root... starting joinQue!');
       resolve(true);
     });
   }
   // ***************************************************
   // send message to last node to replace a failing node
   // ===================================================
   // ip  : ip of the dead node.
   // nbr : node number of the dead node.
   
   sendMoveRequestToLastNode(ip,nbr){
     console.error('MkyRouting.sendMoveRequestToLastNode():: Sending lastNodeMoveTo To:',this.r.lastNode,' for:'+ip,nbr);
     return new Promise( async (resolve,reject)=>{
       var holdLastNodeIp  = this.r.lastNode;
       var holdLastNodeNbr = this.r.lnode;

       //Case 1. Only two nodes in the network.

       if (this.r.nodeNbr == 1 && this.r.lnode == 2 && nbr == 2){
         this.becomeRoot();
         resolve(null);
         return;
       }
       if (this.r.nodeNbr == 2 && this.r.lnode == 2 && nbr == 1){
         console.error('node2 becoming root');
         this.becomeRoot();
         resolve(null);
         return;
       }

       // Case 2. I am last node and Root is dropping last node will become root.
       if (this.myIp == this.r.lastNode && nbr == 1){
         console.error('MkyRouting.sendMoveRequestToLastNode():: Case 2. dropping Root moving last node to replace root');
         await this.lnodeReplaceRoot(ip,nbr);
         this.bcastRootTableUpdate();
         resolve(null);
         return;
       }

       // Prepair To Drop Last Node.
       var lnodeIp  = this.r.lastNode;
       let dropRTab = this.getMyChildRTab(ip); 
       console.error('MkyRouting.sendMoveRequestToLastNode():: Droping Node',ip,' RTab looks like:',dropRTab);

       //Case 3. Last Node is dropping.
       if (ip == holdLastNodeIp){
         console.error('MkyRouting.sendMoveRequestToLastNode():: Case 3.');
         // Change my child node list to point to the last nodes Ip
         if (dropRTab.leftNode) lnodeIp = dropRTab.leftNode;
         this.updateMyChildNodes(ip,nbr,lnodeIp,3);

         this.r.lnode--;
         this.r.lastNode = lnodeIp;
         
         // If the last node is being dropped broadcast message to 
         // network to update their routing tables. 

         this.bcastRootTableUpdate();
         resolve(null);
         return;
       }
       //case 4. I am Root Droping A child node.
       if (this.r.nodeNbr == 1){
         console.error('MkyRouting.sendMoveRequestToLastNode():: Executing Case 4.',ip,nbr);
         this.r.lnode --;
         
         if (Array.isArray(dropRTab.myNodes)) {
           dropRTab.myNodes.forEach((child)=>{
             if (child.ip == this.r.lastNode){
               console.error('MkyRouting.sendMoveRequestToLastNode():: Case 4. droping last node from RTAB',dropRTab.myNodes);
               dropRTab.myNodes.pop();
               return;
             }
           });
         }
         this.r.lastNode = await this.lastNodeBecome(this.r.lastNode,dropRTab,ip);
         if (this.r.lastNode === null) {
           console.error('MkyRouting.sendMoveRequestToLastNode():: Case 4 failed on lastNodeBecomes() ',holdLastNodeIp,dropRTab,ip);
           this.net.setNodeBackToStartup(`Root Attempt To Drop Child Node Failed on Case 4 : ${this.r.lastNode}`);
           resolve('Case4Fail');
           return;
         }
         if (this.r.lastNode == ip){
           this.r.lastNode = holdLastNodeIp;
         }   
         
         try {
           if (this.r.myNodes[this.r.myNodes.length -1].ip == holdLastNodeIp){
             console.error('MkyRouting.sendMoveRequestToLastNode():: Case 4. Pop',holdLastNodeIp,this.r.myNodes[this.r.myNodes.length -1].ip);
             this.r.myNodes.pop();
           }
         }
         catch(e) {
           console.error('MkyRouting.sendMoveRequestToLastNode():: debug ',this.r.myNodes, holdLastNodeIp,e);
         } 

         this.myChildSetNewIp(lnodeIp,ip);
         this.bcastRootTableUpdate();
         resolve(null);
         return;
       }

       //case 5 parent node is not root or last node 
       console.error('MkyRouting.sendMoveRequestToLastNode():: Case: 5',ip,nbr);

       let attempt = 0;
       let success = false;
       const maxAttempts = 5;
       
       let reply = { result: null };
       
       while (attempt < maxAttempts) {       
         var newLeftIp = dropRTab.leftNode;
         lnodeIp = this.r.lastNode;

         if (dropRTab.rightNode == lnodeIp){
           console.error('MkyRouting.sendMoveRequestToLastNode():: Setting dropRTab.rightnode to null');
           dropRTab.rightNode = null;
         }
         console.error('MkyRouting.sendMoveRequestToLastNode():: Last Node Ip Remains: ',lnodeIp);

         if (Array.isArray(dropRTab.myNodes)) {
           dropRTab.myNodes.forEach((child)=>{
             if (child.ip == lnodeIp){
               dropRTab.myNodes.pop();
             }
           });
         }
         dropRTab.lnode = holdLastNodeNbr -1;
         this.r.lnode --;
         this.r.lastNode = lnodeIp;
         
         // update my child nodes before sending move request
         this.updateMyChildNodes(ip,nbr,lnodeIp,5);

         // Start Check Status of Lastnode
         const msg = {
           req      : 'lastNodeMoveTo',
           response : 'lastNodeMoveToReply',
           dropIp   : ip,
           newRTab  : dropRTab
         };
         console.error('MkyRouting.sendMoveRequestToLastNode():: lastNodeMoveTo::request looks like this',msg);

         reply = await this.net.reqReplyObj.waitForReply(lnodeIp, msg);
         console.error(reply,msg,lnodeIp); 
         //var mres = await this.getLastNodeStatus(lnodeIp,req);
         console.error('MkyRouting.sendMoveRequestToLastNode():: attempt::',attempt,reply);

         if (reply?.result?.status === 'moveOK') {
           lnodeIp = reply.result.newLastIp;
           this.r.lastNode = lnodeIp;
           success = true;
           break;
         }

         await sleep(1000);
         attempt++;
       }
       if (!success){
         console.error('MkyRouting.sendMoveRequestToLastNode():: Case 5 failed lastNodeBecome() ',holdLastNodeIp,dropRTab,ip);
         this.net.setNodeBackToStartup(`Root Attempt To Drop Child Node Failed on Case 5 : ${this.r.lastNode}`);
         resolve('Case5Fail');
         return;
       }
       let child = this.r.myNodes[this.net.maxPeers -1];
       if (child){
         if (child.nbr == holdLastNodeNbr) {
           this.r.myNodes.pop();
         }
       }
       this.bcastRootTableUpdate();
       resolve(holdLastNodeIp);
     });
   }
   myChildSetNewIp(newIp,replaceIp){
     this.r.myNodes.forEach((child)=>{
       if (child.ip == replaceIp)
         child.ip = newIp;
     });
   }
   getMyChildRTab(ip){
     var childRTab = null;
     this.r.myNodes.forEach((child)=>{
       if (child.ip == ip){
         childRTab = child.rtab;
       }
     });
     return childRTab;
   }
   async lastNodeBecome(lastNodeIp, dropRTab, dropIp) {
     let attempt = 0;
     const maxAttempts = 5;

     let reply = { result: null };

     while (attempt < maxAttempts) {

       const msg = {
         req      : 'lastNodeMoveTo',
         response : 'lastNodeMoveToReply',
         dropIp   : dropIp,
         newRTab  : dropRTab
       };

       reply = await this.net.reqReplyObj.waitForReply(lastNodeIp, msg);

       console.error('MkyRouting.lastNodeBecome()::  attempt', attempt, reply);

       if (reply?.result?.status === 'moveOK') {
         return reply.result.newLastIp;
       }

       await sleep(1000);
       attempt++;
     }

     // deterministic failure return
     return null;
   }

   updateMyChildNodes(dropIp,dropNbr,newIp,isCase){
     console.error('MkyRouting.updateMyChildNodes():: dropIp:'+dropIp+',dropNbr:'+dropNbr+',newIp:',newIp);
     //if last node is dropping remove the last child in the list.
     if (dropNbr == this.r.lnode){
       console.error('DONTDROP::lnode',isCase);
       if (isCase == 3){
         this.r.myNodes.pop();
       }
     }
     //Update the current child to the new last Node ip.
     this.r.myNodes.forEach((node)=>{
       if (node.ip == dropIp){
         node.ip = newIp;
       }
     });

   }
   async updateMyChildNToNewIp(ip,nodeNbr,lnodeIp){
     console.error('MkyRouting.updateMyChildNToNewIp():: '+nodeNbr+' From:'+ip+ ' To:',lnodeIp);

     //If the node to drop is the last remove it from my child nodes 
     // change last node number and return;
     if (nodeNbr == this.r.lnode){
       const node = {
         ip : ip,
         nbr : nodeNbr,
         lnode : lnodeIp
       }
       this.updateToNewLastNode(node);
       this.r.lnode = this.r.lnode -1;
       this.r.lastNode = lnodeIp;
       console.error('MkyRouting.updateMyChildNToNewIp():: dropingLastNode:',ip);
       return;
     }

     this.r.lnode    = this.r.lnode -1;
     this.r.lastNode = lnodeIp;

     this.r.myNodes.forEach((node)=>{
       if (node.nbr == nodeNbr){
         node.ip = lnodeIp;
         if (nodeNbr > this.r.lnode){
           node.nbr = this.r.lnode;
         }
         console.error('MkyRouting.updateMyChildNToNewIp():: myNodes'+nodeNbr,ip);
       }
     });
   }
   // ******************************************************
   // last node moves position to replace the dropped  node
   // ******************************************************
   async lastNodeMoveTo(j){
     console.error('MkyRouting.lastNodeMoveTo():: J',j);

     if (this.r == 'na'){
       console.error('MkyRouting.lastNodeMoveTo():: CRITICALL:: this.r is na!',);
       this.net.setNodeBackToStartup(`LastNode routing table not useable : ${this.r}`);
       return;
     }

     // If Currently Moving Send 'moving' status.
     if (this.r.lnStatus == 'moving'){
       var reply = {
         response : 'lastNodeMoveToReply',
         result   : {
           targetIP : j.dropIp,
           time     : Date.now(),
           status   : 'moving'
         }
       };
       this.net.sendReplyCX(j.remIp,reply);
       return;
     }
     
     this.r.lnStatus = 'moving';

     // Notify Parent This Node Is Moving and needs to be dropped.
     if (j.remIp != this.r.myParent){
       if (this.r.myParent != j.dropIp){
         const req = {
           req : 'dropMeAsChildLastNode',
           ip  : this.myIp
         }
         console.error('MkyRouting.lastNodeMoveTo():: sending:'+this.r.myParent,req);
         this.net.sendMsgCX(this.r.myParent,req);
       }
     }

     var newLastNodeIp = this.r.leftNode;
     console.error('MkyRouting.lastNodeMoveTo():: Checking: newLastNodeIp:',newLastNodeIp,' j.dropIp:',j.dropIp);
     if (newLastNodeIp == j.dropIp){
       newLastNodeIp = this.myIp;
       console.error('MkyRouting.lastNodeMoveTo():: Updating second last node:adjusting new last node',newLastNodeIp);
     }
     this.r = clone(this.net.dropChildRTabs(j.newRTab));

     console.error('MkyRouting.lastNodeMoveTo():: Sending To:',this.r.leftNode,{req : "addMeToYourRight", ip : this.myIp,nbr : this.r.nodeNbr});
     this.net.sendMsgCX(this.r.leftNode,{req : "addMeToYourRight", ip : this.myIp,nbr : this.r.nodeNbr});

     if (this.r.rightNode){
       console.error('MkyRouting.lastNodeMoveTo():: Sending To:',this.r.rightNode,{req : "addMeToYourLeft", ip : this.myIp});
       this.net.sendMsgCX(this.r.rightNode,{req : "addMeToYourLeft", ip : this.myIp});
     } 

     if (Array.isArray(this.r.myNodes)) {
       this.r.myNodes.forEach((child) => {
         console.error('MkyRouting.lastNodeMoveTo():: Sending To:', child.ip, { req: "addMeAsYourParent", ip: this.myIp });
         this.net.sendMsgCX(child.ip, { req: "addMeAsYourParent", ip: this.myIp });
       });
     } else {
       console.error('MkyRouting.lastNodeMoveTo():: .: Error: myNodes is not an array', this.r);
       this.net.setNodeBackToStartup(`My Nodes Not An Array...`);
       return;
     }
 
     console.error('MkyRouting.lastNodeMoveTo():: I am Now:',this.r);
     if (this.r !== 'na'){
       this.r.lnStatus = 'OK';
     }
     var reply = {
       response : 'lastNodeMoveToReply',
       result   : {
         targetIP : j.dropIp,
         time     : Date.now(),
         status   : 'moveOK',
         newLastIp: newLastNodeIp 
       }
     }

     this.net.sendReplyCX(j.remIp,reply);
     return;
   }
   // ************************************************
   // All nodes accept the last node update your last node 
   // to the new last node
   // ================================================
   updateToNewLastNode(node){
     this.dropIps.push(node.ip);
     console.error("MkyRouting.updateToNewLastNode():: \n",node);
     this.r.lastNode = node.lnode;
     this.r.lnode = node.nbr;
     if (this.r.nodeNbr == this.r.lnode){
       this.r.rightNode = null;
     }     

     for (let i = this.r.myNodes.length - 1; i >= 0; i--) {
       if (this.r.myNodes[i].ip === node.ip) {
         this.r.myNodes.splice(i, 1);
       }
     }
   }
   simReplaceNode(node){ 
     console.error('MkyRouting.simReplaceNode():: simReplace\n',node);
     this.updateToNewLastNode(node);
     return;
   }
   // ***********************************************
   // Query the network for a nodes number using its ip
   // ===============================================
   getNodeIpByNbr(nbr){
     return new Promise( (resolve,reject)=>{
       var ipListen = null;
       if (this.r.nodeNbr == nbr){
         resolve(this.myIp);
         return;
       }
       this.bcast({peerSendIp : nbr});
       const gtime = setTimeout( ()=>{
         console.error('MkyRouting.getNodeIpByNbr():: get Node by nbr timed out',nbr);
         this.net.removeListener('peerTReq',ipListen);
         resolve(null);
       },4*1000);  
                  
       this.net.on('peerTReq', ipListen = (res,j)=>{
         if (j.responseSendIp){
           this.net.endResCX(res,'{"result":"Thanks"}');
           console.error('MkyRouting.getNodeIpByNbr():: Got Response to BCAST peerSendIp '+nbr,j.responseSendIp);
           this.responseSendIp = j.responseSendIp;
           clearTimeout(gtime);
           resolve(j.responseSendIp);
           this.net.removeListener('peerTReq',ipListen);
         }
       });
     });
   }
   responseWhoHasNodeIp(rootIp,ip){
     console.error('MkyRouting.responseWhoHasNodeIp():: '+this.net.rootIp,ip);
     console.error('rootIp:',rootIp);
     if (this.isMyChild(ip)){
       this.net.sendMsgCX(this.net.rootIp,{responseWhoHasIp: this.myIp});
     }	     
   }

   // ***********************************************
   // Send Nodes Ip to The host that requeste it nbr
   // ===============================================

   respondToIpByNbrRequest(j,toIp){
     console.error('MkyRouting.respondToIpByNbr():: \n',j,toIp);  
     if (this.r.nodeNbr == j.peerSendIp)
       this.net.sendMsgCX(toIp,{responseSendIp : this.myIp});
   }
   // *****************************************************************
   // Handles all network join requests
   // =================================================================
   async procJoinQue() {
     try {
       // Clear previous timeout if it exists
       if (this.procT) {
         clearTimeout(this.procT);
         this.procT = null;
       }

       // Process one queued join
       if (this.joinQue.size > 0) {
         const [jIp, req] = this.joinQue.entries().next().value;
         this.joinQue.delete(jIp);

         try {
           await this.handleJoins(jIp, req.j);
         } catch (err) {
           console.error("procJoinQue() handleJoins error:", err);
         }
       }
     } catch (err) {
       console.error("procJoinQue() outer error:", err);
     }
     this.procT = setTimeout(() => {
       this.procJoinQue();
     }, 1000);
   }
   async handleJoins(remIp,j){
     console.error('handleJoins()::start:',remIp,this.joinQue,j);
     const reqId  = j.reqId;

     if (this.status !== 'root'){
       this.net.endResCX(remIp,`{"addResult":"sorryTryNewRoot","reqId":"${reqId}"}`);
       return;
     }
     // Check If The Node Is Busy. If yes que the join request.
 
     if (this.r.rootLock){    
       console.log('MkyRouting.handleJoins():: locked Sending AddResult:reJoinQued:',remIp);
       this.joinQue.set(remIp, { jIp: remIp, j: j, joinTicket:j.reqId, status: "waiting" });
       this.net.endResCX(remIp,`{"addResult":"reJoinQued","reqId":"${reqId}"}`);
       return;
     }
     try {
       var joinFailed  = null;
       const saveState = this.saveState();
       var rollbck     = null;

       this.startJoin  = remIp;
       this.r.rootLock = true;
       this.joinTicket = j.reqId;

       // check for routing table errors
       if (this.isMyChild(remIp)){
         this.net.endResCX(remIp,`{"addResult":"sorryTryNewRoot","reqId":"${reqId}"}`);
         this.net.setNodeBackToStartup(`joining error:  isMyChild failure. restart required`);
         return;
       } 
       if (this.r.lastNode == remIp){
         this.net.endResCX(remIp,`{"addResult":"sorryTryNewRoot","reqId":"${reqId}"}`);
         this.net.setNodeBackToStartup(`joining error:  isMyLastNode failure. restart required`);
         return;
       }

       let checkTree = await this.findWhoHasChild(remIp);
       if (checkTree === null){
         //lost contact with network;
         this.net.endResCX(remIp,`{"addResult":"sorryTryNewRoot","reqId":"${reqId}"}`);
         this.net.setNodeBackToStartup(`joining error:  checkTree failure. lost contact with network`);
         return;
       }
       else if (checkTree !== 'noBody'){
         this.net.endResCX(remIp,`{"addResult":"sorryTryNewRoot","reqId":"${reqId}"}`);
         this.net.setNodeBackToStartup(`joining error:  checkTree corrupt tree.`);
         return;
       }

       const addRes = await this.addNewNodeReq(j.remIp);

       if (addRes){
         this.net.pulseRate = defPulse; 

         // Remove New Node Ip from dropped nodes list 
         // If it is on the list.

         let newNodex = this.dropIps.indexOf(j.remIp);
         if (newNodex !== -1) {
           this.dropIps.splice(newNodex, 1);
         }

         console.error('MkyRouting.handleJoins():: Sending AddResult::', {addResult : 'OK',newNode : this.newNode});

         const reply = {addResult : 'OK',newNode : this.newNode,reqId : reqId}
   
         if (this.newNode.leftNode === remIp){
           this.net.endResCX(remIp,JSON.stringify({addResult:"sorryTryNewRoot",msg:"newNode.left conflict ",reqId:reqId}));
           this.net.setNodeBackToStartup(`joining error:  newNode.left conflict.`);
           return;
         }

         this.net.endResCX(remIp,JSON.stringify(reply));
         this.newNode = null;
         const addRes = await this.resultFromJoiningNode(reqId);
         console.error('MkyRouting.handleJoins():: addNewNODE Result',addRes);
         if (addRes){
           rollbck = await this.notifyNetWorkNewNode(j.remIp,this.r.rootNodeIp,reqId);
           console.error('MkyRouting.handleJoins():: notifyNetworkNewNode is: -> ',rollbck);
         }
         else {
           rollbck = await this.restoreState(saveState,reqId);
           if (!rollbck) {
             this.net.setNodeBackToStartup(`Join Rollbck Failed:timeout addResult: ${addRes}`);
             return;
           }
         }
         this.startJoin = false;
       }
       else {
         console.error('MkyRouting.handleJoins():: Node Not Added');
         // Rollback any changes here.
         rollbck = await this.restoreState(saveState,reqId);
       
         this.net.endResCX(remIp,JSON.stringify({addResult : 'Node Not Added', why : addRes,reqId:reqId}));
         this.startJoin = false;
         if (!rollbck) {this.net.setNodeBackToStartup(`Join Rollbck Failed on: addRes: ${addRes}`);}
       }
     } finally {
       this.joinTicket = null;
       this.r.rootLock = false;
     }
   }
   notifyNetWorkNewNode(remIp,rootIp,reqId){
     return new Promise((resolve,reject)=>{
       var rtListen = null;
       var rtLFail  = null;
       const gtime = setTimeout( ()=>{
         console.error('MkyRouting.notifyNetWorkNewNode():: timeout');
         this.net.removeListener('peerTReply', rtListen);
         this.net.removeListener('xhrFail', rtLFail);
         resolve(null);
       },5800);

       this.net.on('peerTReply', rtListen = (j)=>{
         //console.error(`MkyRouting.notifyNetWorkNewNode():: peerTReplys heard::\n`,j);
         if (j.resultFromJoinBCast && j.reqId == reqId){
           console.error('MkyRouting.notifyNetWorkNewNode():: Last Node Replied: ',j);
           clearTimeout(gtime);
           resolve(true);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
       this.net.on('xhrFail', rtLFail = (j)=>{
         if (j.reqId == reqId){
           console.error('MkyRouting.notifyNetWorkNewNode():: addNode Fails on bcastNewNode:',j);
           clearTimeout(gtime);
           resolve(false);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
       console.error(JSON.stringify({newNode:remIp, rootUpdate:rootIp, reqId:reqId}));
       this.bcast({newNode:remIp, rootUpdate:rootIp, reqId:reqId});
     });
   }
   resultFromJoiningNode(reqId){
     return new Promise((resolve,reject)=>{
       var rtListen = null;
       var rtLFail  = null;
       const gtime = setTimeout( ()=>{
         console.error('MkyRouting.resultFromJoiningNode():: timeout');
         this.net.removeListener('peerTReply', rtListen);
         this.net.removeListener('xhrFail', rtLFail);
         resolve(null);
       },2800);

       this.net.on('peerTReply', rtListen = (j)=>{
         if (j.resultFromJoin && j.reqId == reqId){
           console.error('MkyRouting.resultFromJoiningNode():: Reply:',j);
           clearTimeout(gtime);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
           if (j.resultFromJoin === 'Thanks') { resolve(true);}
           else {resolve(false);}
         }
       });
       this.net.on('xhrFail', rtLFail = (j)=>{
         if (j.addResult && j.reqId == reqId){
         console.error('MkyRouting.resultFromJoiningNode():: addFailxhr:',j);
         clearTimeout(gtime);
           resolve(false);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
     });
   }
   async myHealthCheck() {
      const msg = {
        req      : 'myHealthCheck',
        response : 'myHealthCheckReply'
      };
      let reply = await this.net.reqReplyObj.waitForReply(this.r.rootNodeIp, msg);
      console.log(`myHealthCheck():: root reply:`,reply);
      if ( reply?.status === 'OK' && this.r.ptreeId === reply.ptreeId) {
        return true;
      }
      console.error('MkyRouting.myHealthCheck():: Failed reply ->',reply);
      return false;
   }

   saveState(){
     const state = {
       dropIps : clone(this.dropIps),
       rootMap : new Map(this.rootMap),
       r       : clone(this.r) 
     } 
     return state;
   }
   restoreState(state,reqId=null){
     return new Promise((resolve,reject)=>{
       this.dropIps    = clone(state.dropIps);
       this.rootMap    = new Map(state.rootMap);
       this.r          = clone(state.r);   
       if(!reqId) {
         resolve(true);
         return;
       }
       if (!this.nextpIp){
         resolve(true);
         return;
       }
       this.net.sendMsgCX(this.nextpIp,{req : "nextpRestoreState", reqId : reqId});

       this.nextpIp = null;
       console.error('MkyRouting.restoreState():: To:',this.dropIps,this.rootMap,this.r);
       var rtListen = null;
       var rtLFail  = null;
       const gtime = setTimeout( ()=>{
         console.error('MkyRouting..restoreState():: timeout');
         this.net.removeListener('peerTReply', rtListen);
         this.net.removeListener('xhrFail', rtLFail);
         resolve(false);
       },2800);

       this.net.on('peerTReply', rtListen = (j)=>{
         if (j.nextpRestoreStateReply && j.reqId == reqId){
           console.error('MkyRouting.restoreState():: Reply:',j);
           clearTimeout(gtime);
           resolve(true);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
       this.net.on('xhrFail', rtLFail = (j)=>{
         if (j.nextpRestoreState && j.reqId == reqId){
         console.error('MkyRouting.restoreState():: request faild: ',j);
         clearTimeout(gtime);
           resolve(false);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
     });
   }
   async getRootPCount() {
     if (this.myIp === this.r.rootNodeIp) {
        return this.r.pCount;
     }
     const msg = {
       req      : 'sendPCount',
       response : 'sendPCountReply'
     };
     const reply = await this.net.reqReplyObj.waitForReply(this.r.rootNodeIp, msg);
     if (reply?.result === 'timeout' || reply?.result === 'xhrFail'){
       return 0;
     }
     return reply?.result?.pCount ?? 0; 
   }
   // ********************************
   // Handler for incoming http request
   // ================================   
   async handleReq(remIp,j){
     //console.error(`MkyRouting.handleReq():: got req `,j);
     var dropTimer = null;
     this.net.resetErrorsCnt(j.remIp);
     if (j.req == 'joinReq'){
       console.error ('MkyRouting.handleReq():: Starting:qued',remIp,j);
       this.joinQue.set(remIp, { jIp: remIp, j: j, joinTicket:j.reqId, status: "waiting" });
       return true;
     }
     if (j.req == 'rootStatusDropNode'){
       if (!this.startJoin){
         this.startJoin = 'waitForDrop';
         this.dropTimer = setTimeout( ()=>{
           console.error('MkyRouting.handleReq():: dropTimer expired'); 
           this.clearWaitForDrop();
         },5000);
         this.net.endResCX(remIp,JSON.stringify({resultRootStatusDropNode : 'OK'}));
       }
       else {
         this.net.endResCX(remIp,JSON.stringify({resultRootStatusDropNode : 'busy'}));
       }
       return true;
     }
     if (j.req == 'rootStatusDropComplete'){
       this.clearWaitForDrop();
       return;
     }
     if (j.req == 'dropMeAsChildLastNode'){
       console.error('MkyRouting.handleReq():: GOT REQUEST::',this.r,j);
       this.r.myNodes.forEach((child,index, object)=>{
         if (j.ip == child.ip){
           object.splice(index,1);
         }
       });
     }
     if (j.req == 'lastNodeMoveTo'){
       this.lastNodeMoveTo(j);
       return true;
     }
     if (j.req === 'sendPCount'){
       const reply = {
         response : 'sendPCountReply',
         reqId    : j.reqId,
         result : {
           pCount : this.r.pCount
         }
       }
       this.net.endResCX(remIp,JSON.stringify(reply));
     }
     if (j.req === 'joinWaitOK?') {
       let wait = 'STOP';

       // 1. Check the active join ticket
       if (this.joinTicket === j.ticketId) {
         wait = 'keepWaiting';
       } else {
         // 2. Check queued joins
         const entry = this.joinQue.get(j.remIp);

         if (!entry) {
           console.log("No join entry for IP", j.remIp);
         } else if (entry.joinTicket !== j.ticketId) {
           console.log("Ticket mismatch, removing stale entry", entry.joinTicket, j.ticketId);
           this.joinQue.delete(j.remIp);   // <-- remove invalid entry
         } else {
           wait = 'keepWaiting';
         }
       }

       const reply = {
         response : 'joinWaitOKReply',
         reqId    : j.reqId,
         result   : { status: wait }
       };

       this.net.endResCX(remIp, JSON.stringify(reply));
       return true;
     }
     if (j.req == 'sendNodeData'){
       if (this.status == 'online' || this.status == 'root'){
         const qres = {
           sendNodeDataResult : {
             ip          : this.myIp,
             status      : this.status,
             err         : this.err,  
             eTime       : this.eTime,
             coldStart   : this.coldStart,
             lastRootGen : this.lastRootGenerationSeen,
             rootGen     : this.rootGeneration,
             rtab        : this.r
           },
           reqId : j.reqId
         }
         console.error('MkyRouting.handleReq():: sendNodeData: ',qres);
         this.net.endResCX(remIp,JSON.stringify(qres));
       }
       else {
         console.error('MkyRouting.handleReq():: sendNodeData: ',`{"sendNodeDataResult":"offline","reqId":"${j.req.reqId}","status":${this.status},"error":${this.err}}`);
         this.net.endResCX(remIp,`{"sendNodeDataResult":"offline","reqId":"${j.req.reqId}","status":${this.status},"error":${this.err}}`);
       }
       return true;
     }
     if (j.req == 'whoIsRoot?'){
       if ((this.status == 'online' || this.status == 'root')) {
         
         let healthy = true;
         if (this.myIp != this.r.rootNodeIp){
           healthy = await this.myHealthCheck();
         } 
         console.log(`handleRequest():: ${j.req} myHealth is `,healthy);
         if (healthy){
           const qres = {
             whoIsRootReply : {
               rip      : this.r.rootNodeIp,
               maxPeers : this.net.maxPeers,
               reportBy : this.myIp,
               rtab     : this.r,
               pCount   : await this.getRootPCount()
             }
           } 
           //console.error('responce stringify: ',JSON.stringify(qres))
           this.net.endResCX(remIp,JSON.stringify(qres)); 
           return true;
         }
         if (healthy === false){ 
           // This node needs to restart!
           console.error('MkyRouting.handleReq():: myHealthCheck failed... shutting down\n',j);
           this.net.endResCX(remIp,JSON.stringify({whoIsRootReply:'deadnode'}));
           this.net.setNodeBackToStartup('whoIsRootFailed HealthCheck');
         }
       }
       // Final Path Root Reply 'notReady'
       this.net.endResCX(remIp,'{"whoIsRootReply":"notready"}');
       return true;
     }
     if (j.req == 'myHealthCheck'){
       console.error(`MkyRouting.handleReq():: myHealthCheck reply is: {"response":"myHealthCheckReply","result":"OK","reqId":"${j.reqId}"} to is: ${remIp}`);
       console.error(`MkyRouting.handleReq():: myHealthCheck reply state is: {"status": ${this.status},"err":"${this.err}"} to is: ${remIp}`);
       if (this.status === 'root'){
         this.net.endResCX(remIp,JSON.stringify({response:"myHealthCheckReply",status:"OK",reqId:j.reqId}));
       }
       else {
         this.net.endResCX(remIp,JSON.stringify({response:"myHealthCheckReply",status:{nodeStatus:this.status,errState:this.err},reqId:j.reqId}));
       }
       return true;
     }
     if (j.req === 'parentSaysRDropNode'){
       await this.parentSaysRDropNode(j);
       return true;
     }
     if (j.req === 'pushingRTabToParent'){
       this.pushingRTabToParent(j);
       return true;
     }
     if (j.req === 'peerAddMeToYourLeft'){
       this.peerAddMeToYourLeft(j);
       return true;
     }
     if (j.req === 'parentUpdateMyRTab'){
        this.parentUpdateMyRTab(j); 
     }
     if (j.req === 'peerAddMeToYourRight'){
       this.peerAddMeToYourRight(j);
       return true;
     }
     if (j.req === 'rootSaysLastMoveTo'){
       this.rootSaysLastMoveTo(j);
       return true;
     }
     if (j.req === 'rootSaysYourLastNode'){
       this.rootSaysYourLastNode(j);
       return true;
     }
     if (j.req === 'rootDropThisNode'){
        this.rootDropThisNode(j);
        return true;
     }
     if (j.req === 'pRouteUpdate'){
       this.updatePeerRouting(j);
       this.net.endResCX(remIp,'{"result":"OK"}');
       return true;
     }
     if (j.req == 'addMeToYourRight'){
       if (j.nbr != this.r.nodeNbr+1){
         this.net.endResCX(remIp,`{"resultAddMeRight":"invalid nodeNbr","reqId":"${j.reqId}"`);
         return true;
       }
       this.r.rightNode = j.remIp;
       this.net.endResCX(remIp,`{"resultAddMeRight":"OK","reqId":"${j.reqId}"}`);
       return true;
     }
     if (j.req == 'nextpRestoreState'){
       this.nexpIp = null;
       this.restoreState(this.parentSaveState);
       this.net.endResCX(remIp,'{"nextpRestoreStateReply":"OK","reqId":"${j.reqId}"}');
       return true;
     }
     if (j.req == 'addMeToYourLeft'){
       this.r.leftNode = j.remIp;
       return true;
     }
     if (j.req == 'addMeAsYourParent'){
       this.r.myParent = j.remIp;
       return true;
     }
     if (j.req == 'dropDanglingNode'){
       console.error('MkyRouting.handleReq():: gotRequest::dropDanglingNode',j);
       return true;
     }
     if (j.req == 'rootSaysAddChild'){
       this.rootSaysAddChild(j);
       return true;
     }
     return false;
   }
   // *****************************************
   // Handle Direct Responses from http request 
   // =========================================
   async handleReply(j){
     return false;
   }
   async processMyJoinResponse(j){ 
     return new Promise(async(resolve,reject) => {
       console.error('MkyRouting.processMyJoinResponse():: Processing ',this.status, j.addResult,'\n');
       const reqId = j.reqId;

       let addFails = ['Node Not Added', 'timedOut','sorryTryNewRoot'];
       if ( addFails.includes(j.addResult)){
         console.error(`MkyRouting.processMyJoinResponse():: JOINREQFAILS on: ${j.addResult}`);
         this.net.setNodeBackToStartup(`my join request failed with: ${j.addResult}`);
         resolve('sorryTryNewRoot');
         return;
       }
       if (j.addResult === 'reJoinQued' || j.addResult === 'wait'){
         console.error('MkyRouting.processMyJoinResponse():: Join Request Qued And Waiting');
         resolve('joinWait');     
         return;
       }

       console.error(`MkyRouting.processMyJoinResponse():: addResult for reqId: ${j.addResult} ${j.reqId}`);
       this.r.ptreeId = j.ptreeId;
       var myLeft = j.newNode.leftNode;
       
       console.error(`MkyRouting.processMyJoinResponse():: addResult: ${j.addResult} to IP = ${myLeft} : myIp ${this.myIp} : myNbr ${j.newNode.lnode}`); 
       this.net.sendMsgCX(myLeft,{req : "addMeToYourRight", ip : this.myIp,nbr : j.newNode.lnode, reqId : reqId});
       const addMeRight = await this.resultAddMeRight(reqId);
       if (!addMeRight){
         this.net.setNodeBackToStartup('my join request failed on resultAddMeRight.');
         resolve('addRightFailed');
         return;
       }

       this.r.leftNode = myLeft;
       this.r.rightNode = null;
       this.r = j.newNode;
       this.r.myNodes = [];
       this.r.nodeNbr = this.r.lnode;
       this.newNode = null;
       this.status = 'online';
   
       if (this.r.myParent !== null){
         let sendRTab = await this.pushRTabToParent();
         console.log(`processMyJoinResponse():: pushRTabToParent`,sendRTab);
         if (sendRTab?.result !== 'OK'){
           resolve('pushRTabFailed');
           return;
         }
       } 
       resolve('joinSuccess');
     });
   }
   async pushRTabToParent(){
      // Send my routing table to my parent node.
      const msg = {
        req       : 'pushingRTabToParent',
        response  : 'pushingRTabToParentResult',
        rootRTab  : clone(this.r)
      };
      console.log(`MkyRouting.notifyNewLastNode():: sending to: ${this.r.myParent} `,msg);

      return  await this.net.reqReplyObj.waitForReply(this.r.myParent, msg);
   }
   async pushingRTabToParent(j){
     let index  = this.r.myNodes.findIndex(n => n.ip === j.remIp);
     let result = 'OK';

     if (index === -1) { result = 'pushRTabFAILD';}
     else { this.r.myNodes[index].rtab = this.net.dropChildRTabs(j.rootRTab);} 

     // SendResults Of Change Request
     const reply = {
       response : 'pushingRTabToParentResult',
       reqId    : j.reqId,
       result   : result
     };

     this.net.sendReplyCX(j.remIp,reply);
     return;
   }
   resultAddMeRight(reqId){
     return new Promise((resolve,reject)=>{
       var rtListen = null;
       var rtLFail  = null;
       console.error(`MkyRouting.resultAddMeRight():: reqId ->` ,reqId);
       const gtime = setTimeout( ()=>{
         console.error('MkyRouting.resultAddMeRight():: timeout');
         this.net.removeListener('peerTReply', rtListen);
         this.net.removeListener('xhrFail', rtLFail);
         resolve(null);
       },2800);

       this.net.on('peerTReply', rtListen = (j)=>{
         if (j.resultAddMeRight && j.reqId == reqId){
           console.error('MkyRouting.resultAddMeRight():: Reply:',j.resultAddMeRight);
           clearTimeout(gtime);
           if (j.resultAddMeRight == 'OK')resolve(true);
           else resolve(false);

           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
       this.net.on('xhrFail', rtLFail = (j)=>{
         if (j.req == 'addMeToYourRight' && j.reqId == reqId){
         console.error('MkyRouting.resultAddMeRight():: Failxhr:\n',j,'\n');
         clearTimeout(gtime);
           resolve(false);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
     });
   }
   // ***************************************************
   // Handle Broadcasts From the network
   // ==================================================
   handleBcast(j){
     //console.error('MkyRouting.handleBcast():: Broadcast Recieved: ',j);
     if (j.msg.newNode){
       this.addNewNodeBCast(j.msg.newNode,j.msg.rootUpdate,j.msg.reqId);
       return true;
     }
     if (j.remIp == this.myIp){
       //console.error('MkyRouting.handleBcast():: Ingore Broad Cast To Self',j);
       return true;
     }
     if (j.msg.rootDeath) {
       this.net.setNodeBackToStartup(`Heard Root Death - Migrating To new root: ${j.msg.bestRootIp}`,j.msg.bestRootIp);
       return true;
     }
     if (j.msg.lnodeNewLastNode){
       if (this.myIp === j.msg.lnodeNewLastNode){
         this.r.rightNode = null;
         this.r.lastNode  = this.myIp;
         this.r.lnode     = this.r.nodeNbr;
         this.r.lnStatus  = 'OK';
         console.log(`handleBcast():: heard I am new last node: ${this.myIp} `, j.msg,this.r);
         return true;
       }
       this.r.lastNode = j.msg.lnodeNewLastNode;
       this.r.lnode    = j.msg.newLastNodeNbr;
       console.log(`handleBcast():: heard There is a new last node: ${this.myIp} `, j.msg,this.r);
       return true;
     }
     if (j.msg.whoHasNodeIp){
       this.responseWhoHasNodeIp(j.remIp,j.msg.whoHasNodeIp);	     
       return true;
     }
     if (j.msg.checkSystemClock){
       this.lastRootTime = j.msg.checkSystemClock.rootTime;
       this.lastRootGenerationSeen = j.msg.checkSystemClock.rootGeneration;
       return true;
     }
     if (j.msg.simReplaceNode){
       console.error('MkyRouting.handleBcast():: got simReplaceNode',j.msg.simReplaceNode);
       this.simReplaceNode(j.msg.simReplaceNode);
       this.err = false; //this.node.clearError(j.msg.simReplaceNode.ip);
       this.notifyRootDropComplete();
       clearTimeout(this.eTime);
       return true;
     }
     if (j.msg.removeNode){
      //console.error('MkyRouting.handleBcast():: Bcast remove Node',j.msg.removeNode);
       this.dropNode(j.msg.removeNode);
       return true;
     }
     // Root Table Update... only update if a current root node 
     // sent the message.  
     if (j.msg.rootTabUpdate){

       console.error('MkyRouting.handleBcast():: Updating Root Tables',j.msg.rootTabUpdate,j.msg);
       this.r.rootNodeIp = j.msg.rootTabUpdate.rootIp;       
       this.r.lastNode   = j.msg.rootTabUpdate.lastNodeIp;
       this.r.lnode      = j.msg.rootTabUpdate.lastNodeNbr;
       if (this.r.nodeNbr == this.r.lnode){
         this.r.rightNode = null;
       }
       this.r.myNodes.forEach((child,index,object)=>{
         if (child.nbr > this.r.lnode){
           console.error('MkyRouting.handleBcast():: droping dangling node from child nodes',j);
           this.r.rightNode = null;
         }
       });
       return true;
     }
     if (j.msg.newLastHost){
       console.error('MkyRouting.handleBcast():: Acting on bcast updating last host to ',j.msg.newLastHost);
       if (this.r.lastNode == j.msg.newLastHost)
         return true;
       this.decCounters();
       this.r.lastNode = j.msg.newLastHost;
       return true;
     }
     if (j.msg.peerSendIp){
       this.respondToIpByNbrRequest(j.msg,j.remIp);
       return true;
     }
     if (j.msg.findWhoHasChild){
       const fres = this.r.myNodes.some(child => child.ip === j.msg.findWhoHasChild.ip);

       if (fres) {
         this.net.sendMsgCX(j.remIp, { resultWhoHasChild: this.myIp,reqId:j.msg.findWhoHasChild.reqId });
       }
       return true;
     }
     return false;
   }
   /*
    *******************************************************************
    * Handles undelivered http request from offline or slow to respond peers
    * when sendPostMsg fails to send it sets msg.xhrError to the response code and then -> emit('xhrFailedTry',msg)
    * this fires handleError(msg);
    * handleError uses this to detect failing nodes and remove them
    * failed post will be tried 5 times with 500 ms waits using the msgQue
    * if all five attempts fail then node is removed.
    *
    * ====================================================================
   */
   async handleSendMsgErrors(j){
     
     // Ignore whoIsRoot? checks.
     if (j.req === 'whoIsRoot?'){
       console.error(`MkyRouting.handleError():: Invalid this.status : ${this.status}`);
       return 'FailedSend';
     }

     //Track and check Node Health 
     this.nodeHealthMgr.recordPostResult(j.toHost, "transport");
     const nodeIsFailing = this.nodeHealthMgr.isNodeFailing(j.toHost);

     this.net.setContactsStatusTo(j.toHost,j.xhrError);

     console.log(`MkyRouting.handleSendMsgErrors():: node: ${j.toHost} Error rate:`, this.nodeHealthMgr.errorRate(j.toHost));
     console.log(`MkyRouting.handleSendMsgErrors():: node: ${j.toHost} isFailing :`   ,  nodeIsFailing);

     // route broadcasts past the unresponsive node.

     if (j.req == 'bcast'){
       this.routePastNode(j);
       return 'Re-routed';
     }

     // Check if the node has exceeded the fail node threshhold
     // NOTE only the parent can drop if it is.

     if (nodeIsFailing){
       this.doHandleUnresponsiveNode(j);
       return 'FailedSend';
     }

     if (j.errCount >= 5){
       console.log('MkyRouting.handleSendMsgErrors():: msg.errCount exceeded giving up',this.net.formatMsg(j));
       return 'FailedSend';
     }

     // Check for msg type to see if it should be retried.
     if (!(j.hasOwnProperty('ping') || j.hasOwnProperty('pingResult'))) {
       if (j.req != 'whoIsRoot?' && j.req != 'addMeToYourRight'){
         console.log('MkyRouting.handleSendMsgErrors():: re-queing errored message',this.net.formatMsg(j));
         this.net.queMsg(j);
         return 'Retry';
       }
     } 
     
     return 'FailedSend';
     
   }
   async doHandleUnresponsiveNode(j){
       console.error(`MkyRouting.handleError():: Err Count Exceeded max ${maxNetErrors} errros`,j.toHost);

       // Step 1 -  check to see if this node is online
       const myStat = await this.net.checkInternet();
       console.error('MkyRouting.doHandleUnresponsiveNode():: MyStat',myStat);
       if (!myStat){
         console.error('MkyRouting.doHandleUnresponsiveNode():: Its Me... Going to restart mode');
         this.net.setNodeBackToStartup('Its Me Error');
         return;
       }

       // Step 1 - Parent Check. Only Parent Nodes Can Drop A Node.
       if (this.notMyNode(j.toHost)){
         console.error('MkyRouting.doHandleUnresponsiveNode():: Not My Node To Drop::',j.toHost);
         return;
       }

       // Step 3 - Check to see if the Node is already being dropped.
       if (this.dropIps.includes(j.toHost)){
         console.error('MkyRouting.doHandleUnresponsiveNode():: Node Aready Dropped:',j.toHost);
         return;
       }

       //  Begin Drop.
       this.err = true;

       // Check if the parent is Root
       if (this.status === 'root') {
         console.log('doHandleUnresponsiveNode():: parent is root - drop cause by:',j);
         await this.rootDropChild(j.toHost);
         this.err = false;
         return;
       }

       // Parent node but not root
       console.log('doHandleUnresponsiveNode():: parent but NOT root - drop cause by:',j);
       await this.parentSaysRootDropNode(j.toHost);
       this.err = false;
       return;
   }
   async parentSaysRootDropNode(nodeIp){
      // tell root node to initiate drop of my child node.
      const msg = {
        req       : 'parentSaysRDropNode',
        response  : 'parentSaysRDropNodeResult',
        nodeIp    : nodeIp
      };
      console.log(`MkyRouting.parentSaysRootDropNode():: sending to root: ${this.r.rootNodeIp}`,msg);

      return  await this.net.reqReplyObj.waitForReply(this.r.rootNodeIp, msg);
   }
   async parentSaysRDropNode(j){
      console.log(`MkyRouting.parentSaysRDropNode():: got msg: `,j);

      // Try to get rootLock.
      console.log('parentSaysRDropNode():: try to get lock',j);
      let lock = await this.getRootLock();
      if (lock !== true) {
        console.log("parentSaysRDropNode():: root busy, enqueue drop request", j);
        this.dropQueue.push(j);
        return 'QUEUED';
      }
      try {
        await this.doParentSaysDropNode(j);
      } finally {
        this.r.rootLock = null;
        this._processDropQueue();
      }
      return;
   }
   async doParentSaysDropNode(j){
        
        console.log(`rootDropChild():: begin dropping node`,j);

        // Prepare SendResults for Drop Request
        const reply = {
          response : 'parentSaysRDropNodeResult',
          reqId    : j.reqId,
          result   : 'OK'
        };

        // Block mulitple attempts to remove the same j.
        if (this.dropIps.includes(j.nodeIp)){
          console.log('Node Has Been Dropped! ingoring drop:',this.r.myNodes,j);
          this.net.sendReplyCX(j.remIp,reply);
          return;
        }

        console.log(`MkyRouting.parentSaysRDropNode():: sending `,reply);
        this.net.sendReplyCX(j.remIp,reply);
        return;
   }
/*
       const oldLastNodeIP = this.r.lastNode;
       console.error('MkyRouting.handleError():: setting this.err to: ',this.err);
       this.dropIps.push(j.toHost);
       var notifyRRes = null;
       var trys = 0;

       const success = new Set(['OK', 'IsRoot', 'IAmRoot']);

       while (!success.has(notifyRRes) && trys < 10) {
         notifyRRes = await this.notifyRootDropingNode(j.toHost);

         if (!success.has(notifyRRes)) {
           trys++;
           console.error('MkyRouting.handleError():: Root Response was:', notifyRRes, 'Trys:', trys);
           await sleep(1500);
         }
       }

       if (notifyRRes === null || notifyRRes == 'busy'){
         //this.net.setNodeBackToStartup('notifyRRes Not OK');
         console.error('MkyRouting.handleError():: no response from root... shutting down:',j.toHost);
         this.net.setNodeBackToStartup('Lost Contact With Root... shutting down');
         return;
       }
       console.error('MkyRouting.handleError():: Root Response was:',notifyRRes);

       // Get nodeNbr of the node to drop.
       const nbr = this.inMyNodesList(j.toHost);
       console.error('MkyRouting.handleError():: inMyNodesList::retured',nbr);
       if(nbr){
         console.error('MkyRouting.handleError():: await this.sendMoveRequestToLastNode(',j.toHost,nbr,')');
         var nIp = await this.sendMoveRequestToLastNode(j.toHost,nbr);
         console.error('MkyRouting.handleError():: nIp is now',nIp);

         // If nIp is null move opperation is completed.
         if(!nIp){
           if (this.r.nextParent == j.toHost){
             this.r.nextParent = oldLastNodeIP;
             console.error(`MkyRouting.handleError():: nextParent changed from removed ${j.toHost} to: ${oldLastNodeIP}`);
           }
           this.err = false; //this.node.clearError(j.toHost);
           this.notifyRootDropComplete();
           console.error(`MkyRouting.handleError():: node removed ${nIp} setting this.err to: ${this.err}`);
           //clearTimeout(this.eTime);
         }
       }
   }
*/
   async _processDropQueue() {
     if (this.dropQueue.length === 0) return;

     // Try to get lock again
     let lock = await this.getRootLock();
     if (lock !== true) return; // still busy or root death triggered

     const next = this.dropQueue.shift();

     try {
       await this.doParentSaysDropNode(next);
     } finally {
       this.r.rootLock = false;
       // Continue processing until queue is empty or lock fails
       this._processDropQueue();
     }
   }
   // Parent Is Root Drop Que
   async PIR_processDropQueue() {
     if (this.dropQuePIR.length === 0) return;

     // Try to get lock again
     let lock = await this.getRootLock();
     if (lock !== true) return; // still busy or root death triggered

     const next = this.dropQuePIR.shift();

     try {
       await this.PIR_doDropCNode(next);
     } finally {
       this.r.rootLock = false;
       // Continue processing until queue is empty or lock fails
       this.PIR_processDropQueue();
     }
   }
   addNewNodeBCast(ip,rUpdate,reqId){
     console.error('MkyRouting.addNewNodeBCast():: Add by BROADCAST '+ip,rUpdate);
     if (this.startJoin){
       this.startJoin = false;
     }
     if (this.inMyNodesList(ip)){
       console.error('MkyRouting.addNewNodeBCast():: inMyNodesList true');
       return false;
     }

     if (ip == this.myIp){
       console.error('MkyRouting.addNewNodeBCast():: Join BCast Confirmed ',ip,rUpdate,reqId,this.r.rootNodeIp);
       const reply = {resultFromJoinBCast : 'newLNodeOK',reqId : reqId};
       this.net.endResCX(this.r.rootNodeIp,JSON.stringify(reply));
       return false;
     }

     if (rUpdate)
       this.r.rootNodeIp = rUpdate;
     
     this.r.lastNode = ip;
     this.incCounters();
     return false;
   }
   // ****************************************
   // Check if ip is in my child nodes list
   // ========================================
   isMyChild(ip){
     if (this.myIp == this.r.lastNode && this.r.nodeNbr > 1 && ip == this.r.rootNodeIp ){
       return this.r.rootNodeIp;
     }
     if (!this.r.myNodes || !Array.isArray(this.r.myNodes)){
       return null;
     }

     for (var node of this.r.myNodes){
       if (node.ip == ip)
         return node.nbr;
     }
     return null;
   }
}
/*
Keeps track of expected hop times between the node and its peers.
*/
class CronoTimeMgr {
  constructor() {
    this.linkTMap     = new Map();
    this.maxLog       = 35;
    this.maxDeviation = 1 * 1000;   // 1 second
    this.minSamples   = 8;
    this.normalT      = 500;        // default expected RTT
  }

  addLinkTimeMgr(ip, lastT) {
    const stats = {
      avrgT: this.normalT,
      lastT: lastT,
      rollTLog: [lastT]
    };

    this.linkTMap.set(ip, stats);
  }

  updateLinkTimeMgr(ip, lastT) {
    const stats = this.linkTMap.get(ip);

    if (stats) {
      if (this.filterOutDeviations(stats, lastT)) {
        return; // ignore outlier
      }

      stats.rollTLog.push(lastT);

      if (stats.rollTLog.length > this.maxLog) {
        stats.rollTLog.shift();
      }

      stats.avrgT = this.average(stats.rollTLog);
      stats.lastT = lastT;
      return;
    }

    // If peer not found, create it
    this.addLinkTimeMgr(ip, lastT);
    console.error(this.LinkTMap);
  }

  average(aList) {
    if (aList.length === 0) return 0;
    let sum = 0;
    for (const n of aList) sum += n;
    return sum / aList.length;
  }

  filterOutDeviations(stats, lastT) {
    // Enough samples to trust the average?
    if (stats.rollTLog.length > this.minSamples) {
      if (Math.abs(lastT - stats.avrgT) > this.maxDeviation) {
        return true;
      }
    }

    // Reject extreme values compared to normal baseline
    if (Math.abs(lastT - this.normalT) > this.maxDeviation) {
      return true;
    }

    return false;
  }
  reset(){
    this.linkTMap.clear();
  }
}

// *********************************************************
// CLASS: gPowQue
// A Proof of work class Que Managerk.
//
class gPowQue {
   constructor(){
     this.POWnodes = [];
   }
   push(ip,work,diff,reqId){
     var node = {
       ip    : ip,
       work  : work,
       diff  : diff,
       reqId : reqId
     }
     if (this.inList(ip,reqId) === null) {
       this.POWnodes.push(node);
     }
     return this.pop();
   }
   remove(ip,reqId){
     var breakFor = {};
     try {
       this.POWnodes.forEach( (n, index, object)=>{
         if (n.ip == ip && n.reqId == reqId){
           object.splice(index,1)
           console.error("gPowQue.remove():: Job IP Removed:",ip);
         }
       });
     }
     catch(e){}
   }
   inList(ip,reqId){
     var isIn = null;
     var breakFor = {};
     try {
       this.POWnodes.forEach( (n)=>{
         if (n.ip == ip && n.reqId == reqId){
           isIn = n;
           throw breakFor;
         }
       });
     }
     catch(e){}
     return isIn;
   }
   pop(){
     return this.POWnodes.pop();
   }
   list(){
    //console.error('gPowQue.list():: Network MsgQue Status: ');
     this.POWnodes.forEach( (n)=>{
      //console.error(n);
     });
   }
}
// *********************************************************
// CLASS: gPowKey
// A Proof of work class used for selection of random nodes from the PeerTree
// 
class gPowKey {
  constructor(myIP,net) {
    this.net     = net;
    this.nonce   = 0;
    this.hash    = "";
    this.ip      = myIP;
    this.remIP   = null;
    this.que     = new gPowQue();
    this.isMining = false;
    this.stopMining = null;
  }
  async doPow(difficulty,work,remIP,reqId=null) {
    console.error('gPowKey.doPow():: Doing POW for:',remIP);
    var work = this.que.push(remIP,work,difficulty,reqId);
    while(work){
      console.error('While Working');
      this.work = work.work;
      this.remIP = work.ip;
      this.reqId = work.reqId;
      this.isMining = true;
      this.stopMining = false;
      this.repeatHash(work.diff);
      work = this.que.pop();
    }
  }
  doStop(remIP,reqId=null){
    console.error('gPowKey.doStop():: Do Stop Initiated:'+this.remIP+'|',remIP);
    if (this.remIP == remIP){
      console.error('gPowKey.doStop():: OPTION STOPPING:'+this.remIP+'|',remIP);
      this.stopMining = true;
    }
    else {
      console.error('gPowKey.doStop():: OPTION REMOVE FROM QUE:'+this.remIP+'|',remIP);
      this.que.remove(remIP,reqId);
    }
  }
  signMsg(stok) {
    const sig = this.signingKey.sign(this.calculateHash(stok), 'base64');
    const hexSig = sig.toDER('hex');
    return hexSig;
  }
  async calculateHash() {
    var data = this.ip + this.work + this.nonce;
    var hash = crypto.createHash('sha256').update(data).digest('hex');
    return hash;
  }
  async repeatHash(difficulty){
    if (!this.stopMining && this.hash.substring(0, difficulty) !== Array(difficulty + 1).join('0')) {
      this.nonce = Math.floor(Math.random() * Math.floor(9999999999999));
      this.hash = await this.calculateHash();
      if (this.stopMining){
        console.error('gPowKey.repeatHash():: HALT intiated:',this.remIP);
      }
      else {
        var timeout = setTimeout( ()=>{this.repeatHash(difficulty);},1);
      }
    }
    else {
     console.error('gPowKey.repeatHash():: this.stopMining:',this.stopMining);
     if(!this.stopMining){
        var qres = {
          req   : 'pNodeListGenIP',
          reqId : this.reqId,
          work  : this.work,
          wIP   : this.ip,
          nonce : this.nonce,
          hash  : this.hash
        }
        this.net.sendReply(this.remIP,qres);
      }
      this.stopMining = false;
      this.isMining = false;

    }
  }
}
// *********************************************************
// CLASS: MkyMsgQmgr
// A Que for messages to nodes that have timed out or 
// have errors.
// *********************************************************
class MkyMsgQMgr {
   constructor(que){
     this.nodes = [];   
   }
   add(ip) {
     for (const n of this.nodes) {
       if (n.ip === ip) {
         n.nMsg++;
         return;
       }
     }
     this.nodes.push({ ip, nMsg: 1 });
   }
   kill(ip){
     for (let i = 0; i < this.nodes.length; i++) {
       const n = this.nodes[i];
       if (n.ip === ip) {
         this.nodes.splice(i, 1);
       }
     }
   }
   remove(ip) {
     for (let i = 0; i < this.nodes.length; i++) {
       const n = this.nodes[i];
       if (n.ip === ip) {
         if (n.nMsg <= 1) {
           this.nodes.splice(i, 1);
           console.error(`MkyMsgQue.remove():: node last msg removed: ${ip}`);
         } else {
           n.nMsg--;
         }
         return;
       }
     }
   }
   count(ip) {
     let total = 0;
     for (const n of this.nodes) {
       if (n.ip === ip) total += n.nMsg;
     }
     return total;
   }
   list(){
    //console.error('MkyMsgQue.list():: Status: ');
     this.nodes.forEach( (n)=>{
      //console.error('MkyMsgQue.list()::', n);
     });
   }
}
// *********************************************************
// CLASS: PeerTreeNet
// Provides peer network for applications to send, recieve and broadcast 
// JSON messages using https.
// *********************************************************
class PeerTreeNet extends  EventEmitter {
   constructor (options,network=null,port=1336,wmon=1339,maxPeers=2,portals=[]){
      super(); 
      this.reqReplyObj  = new PtreeGenRequestHandler(this);
      this.borgIOSkey='default';
      this.nodeType  = 'router';
      this.pulseRate = defPulse;	   
      this.minPulse  = 350;    // fastest allowed heartbeat (ms)
      this.maxPulse  = 5000;   // slowest allowed heartbeat (ms)

      this.maxPeers = maxPeers;
      this.rootIp   = null;
      this.isRoot   = false;
      this.peerMUID = null;
      this.server   = null;
      this.port     = port;
      this.wmon     = wmon;
      this.options  = options;
      this.PTnodes  = [];
      this.doHotStartInitialize();
      this.processMsgQue();
      this.replyQueSend();
      this.sendingReq   = false;
      this.lastActive   = null;
      this.portals      = portals;
      this.loginsFile   = `keys/borg-${network}-ReceptorLog.json`;
      this.logins       = this.loadLoginsFromFile();
      this.uStats = {
         requests : 0,
         data     : 0
      }
   } 
   doHotStartInitialize(){
      this.msgQue   = [];
      this.rQue     = [];
      this.msgMgr   = new MkyMsgQMgr();
   } 
   verifyLogin(j){
     console.error('PeerTreeNet.verifyLogin():: verify:->',j);
     const tokTime = Number(j.sesTok.replace(j.ownMUID,''));
     if (isNaN(tokTime)){
        return {result:false,msg:'Invalid Signature Token'};
     }

     if (!j.pubKey) {
       console.error('PeerTreeNet.verifyLogin():: pubkey is missing',j.pubKey);
       return {result:false,msg:'Public Key Is Misssing'};
     }

     if (!j.sig || j.sig.length === 0) {
       return {result:false,msg:'No signature found'};
     }

     // Prevent replay attacks
     const lastAttempt = this.logins.get(j.ownMUID);
     if (lastAttempt && tokTime <= lastAttempt) {
       return { result: false, msg: 'Replay attack detected: tokTime must be newer' };
     }

     // Store the latest timestamp
     this.logins.set(j.ownMUID, tokTime);
     this.saveLoginsToFile();

     // check public key matches the remotes address
     var mkybc = bitcoin.payments.p2pkh({ pubkey: Buffer.from(''+j.pubKey, 'hex') });
     if (j.ownMUID !== mkybc.address){
       console.error('PeerTreeNet.verifyLogin():: remote wallet address does not match publickey',j.ownMUID);
       return {result:false,msg:'No Address Not Matching Public Key:'+mkybc.address+'-'+j.ownMUID};
     }
     const publicKey = ec.keyFromPublic(j.pubKey, 'hex');
     const msgHash   = calculateHash(j.sesTok);
     const rj = {
       result : publicKey.verify(msgHash, j.sig),
       msg : 'keyVerificationComplete'
     };
     return rj;
   }
   saveLoginsToFile() {
     fs.writeFileSync(this.loginsFile, JSON.stringify(Object.fromEntries(this.logins), null, 2));
     console.error('PeerTreeNet.saveLoginsToFile():: Logins saved to file.');
   }   
   loadLoginsFromFile() {
     try {
        const data = fs.readFileSync(this.loginsFile, 'utf-8');
        return new Map(Object.entries(JSON.parse(data)));
     } catch (error) {
        console.error('PeerTreeNet.loadLoginsFromFile():: No previous logins found or error reading file: new Map created.');
        return new Map();
     }
   }
   updatePortalsFile(borg){
     var portals = null;
     borg.activeNodes = this.PTnodes;

     const portalFile = 'keys/borgPortalsList.dat';
     try {
       const data = fs.readFileSync(portalFile, 'utf8');
       portals = JSON.parse(data);
     }
     catch (error) {
       console.error("PeerTreeNet.updatePortalsFile():: Update.. file or file doesn't exist. Initializing empty portals list.");
       portals = [];
     }
     const index = portals.findIndex(portal => portal.netName === borg.netName);

     if (index === -1) {
       portals.push(borg);
       console.error(`PeerTreeNet.updatePortalsFile():: Borg added to portals:`, borg);
     } 
     else {
       portals[index] = borg;
       //console.error(`PeerTreeNet.updatePortalsFile():: Borg replaced in portals:`, borg);
     }
     try {
      fs.writeFileSync(portalFile, JSON.stringify(portals, null, 2), 'utf8');
      console.error("PeerTreeNet.updatePortalsFile():: Portals list successfully updated in file.");
     } 
     catch (error) {console.error("PeerTreeNet.updatePortalsFile():: Error writing to file:", error);}
   }
   readNodeFile(doWait=false){
     console.error('PeerTreeNet.readNodeFile():: Random doWait = ',doWait);
     return new Promise( async (resolve,reject)=>{
       if (doWait){
         /* Create random restart detection times to prevent large groups of nodes attempting to re
            restart all at the same time;
         */ 
         const rstart = Math.floor(Math.random() * (3500)) + 500;
         const rsleep = Math.floor(Math.random() * (1000))  + 500;
         var nstats = null;
         try {
           nstats = fs.statSync(this.nodesFile);
           let dNow  = Date.now();
           let dDiff = Date.now() - nstats.atimeMs;
           if (dDiff < rstart){
             console.error('PeerTreeNet.readNodeFile():: restart detected::waiting',rsleep);
             console.error('PeerTreeNet.readNodeFile():: TRYCC:::init::LastActiveTime: '+dNow+' Diff - '+ dDiff,nstats.atimeMs);
             await sleep(rsleep);
             console.error('PeerTreeNet.readNodeFile():: startup resumed::');
           } 
         }
         catch(e) {console.error('PeerTreeNet.readNodeFile():: First Access::',this.nodesFile);}
       }
       var nodes = null;
       //console.error("looking for::",this.nodesFile);
       try {
         nodes =  fs.readFileSync(this.nodesFile);
       }
       catch {
         console.error('no nodes file found');resolve([]);
       }
       try {
         nodes = JSON.parse(nodes);
         //for (node of nodes)
         //  this.sendMsgCX(node.ip,'{"req":"nodeStatus"}');
         resolve(nodes);
       }
       catch {console.error('PeerTreeNet.readNodeFile():: Could Not JSON Parse:: ',this.nodesFile);resolve([]);}
     });

   }
   tryNodeIp(){
     const max = this.PTnodes.length;
     if(!max)
       return null;
     const n = Math.floor(Math.random() * Math.floor(max));
     return this.PTnodes[n].ip;
   }
   setUpNetwork(){
     console.error('PeerTreeNet.setUpNetwork():: begin');
     return new Promise( async (resolve,reject)=>{
       this.initHandlers();
       this.nodesFile = 'keys/myNodeList-'+this.port+'-'+this.nodeType+'.net';
       this.PTnodes = await this.readNodeFile();
    
       this.nIp = null;
       this.nIp = await(this.netIp());

       if (this.PTnodes.length == 0){
         console.error('PeerTreeNet.setUpNetwork():: this.nodesFile is empty starting as root');
         this.isRoot = true;
         this.rootIp = this.nIp;
       }   
       this.genNetKeyPair();
       //this.nIp = '172.105.99.203=>192.168.129.43'; //await(this.netIp());
       //this.checkInternetAccess(this.nIp,this.port);
       this.startServer();
       this.rnet = new MkyRouting(this.nIp,this);
       this.gpow = new gPowKey(this.nIp,this);
       await this.rnet.routingReady();
       setTimeout ( ()=>{
	 this.heartBeat();
       },this.pulseRate);
       resolve(true);
     });
   }
   async netIp(){
      if (this.nIp !== null){
        return this.nIp;
      }
      this.nIp = await tryGetExternalIp();
      if (this.nIp === null){
        console.error('PeerTreeNet.netIp():: could not find exernal IP for peerTree node');
        process.exit(0);
      }
      return this.nIp;
   }
   genNetKeyPair(){
      var keypair = null;
      try {keypair =  fs.readFileSync('keys/peerTreeNet.key');}
      catch {console.error('PeerTreeNet.genNetKeyPair():: no keypair file found');}
      this.publicKey = null;
   
      if (keypair){
        try {
          const pair = keypair.toString();
          const j = JSON.parse(pair);
          this.publicKey  = j.publicKey;
          this.privateKey = j.privateKey;
          this.peerMUID   = j.peerMUID;
          this.signingKey = ec.keyFromPrivate(this.privateKey);
        }
        catch {console.error('PeerTreeNet.genNetKeyPair():: keypair pair not valid');process.exit();}
      } 
      else {
        const key = ec.genKeyPair();
        this.publicKey  = key.getPublic('hex');
        this.privateKey = key.getPrivate('hex');
        var mkybc = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+this.publicKey, 'hex') });
        this.peerMUID = mkybc.address;

	const keypair = '{"publicKey":"' + this.publicKey + '","privateKey":"' + this.privateKey + '","peerMUID":"'+this.peerMUID+'"}';

        fs.writeFile('keys/peerTreeNet.key', keypair, function (err) {
          if (err) throw err;
        });
        this.signingKey = ec.keyFromPrivate(this.privateKey);
      }
   }
   endResCX(resIp,msg){
      this.endRes(resIp,msg,true);
   }
   endRes(resIp,msg,corx=false){
      if(msg == ''){
        console.error('PeerTreeNet.endRes():: reply msg body empty msg NOT sent');
        return;
      }
      var jmsg = null;
      try {
        jmsg = JSON.parse(msg);
      }
      catch {
        console.error('PeerTreeNet.endRes():: Response Error JSON.parse',resIp,msg,corx);
        return;
      }
      if(corx){
        jmsg.PNETCOREX = true;
      }
      this.sendReply(resIp,jmsg);
   }
   startServer(){
     this.server = https.createServer(this.options, (req, res) => {
       req.on('error', (err) => {
         if (err.code === 'ECONNRESET') {
           console.error('PeerTreeNet.startServer():: Connection reset by peer');
         } else {
           console.error('PeerTreeNet.startServer():: BORG:Request error:', err);
         }
       });

       res.on('error', (err) => {
         if (err.code === 'ECONNRESET') {
           console.error('PeerTreeNet.startServer():: Connection reset error on response');
         } else {
           console.error('PeerTreeNet.startServer():: BORG:Response error:', err);
         }
       });
       var sRemIp = req.connection.remoteAddress ||
       req.socket.remoteAddress ||
       req.connection.socket.remoteAddress;
       sRemIp = sRemIp.replace('::ffff:','');
       //console.error('PeerTreeNet.startServer():: REQ::',req.url);
       res.setHeader('Connection', 'close');
       let svtime = setTimeout( ()=>{
         console.error('PeerTreeNet.startServer():: Server Response Timeout:'+sRemIp+req.url);
         res.statusCode = 501;
         res.end('{"netPOST":"FAIL","type":"NotSet","Error":"server timeout"}');
       },2500); 
       if (this.rnet.simulation){
         console.error('PeerTreeNet.startServer():: outage simulation rejecting all traffic');
         res.setHeader('Content-Type', 'application/json');
         res.statusCode = 501;
         res.end('{"netPOST":"FAIL","type":"NotSet","Error":"simulation timeout"}');
       }
       else if (req.url.indexOf('/netREQ') == 0){
           if (req.method == 'POST') {
             var body = '';
             req.on('data', (data)=>{
               body += data;
               // Too much POST data, kill the connection!
               //console.error('PeerTreeNet.startServer():: body.length',body.length);
               if (body.length > maxPacket){
                 console.error('PeerTreeNet.startServer():: netREQ:: max datazize exceeded');
                 clearTimeout(svtime);
                 //console.error('PeerTreeNet.startServer():: SETHEADER::netREQbody:','Content-Type', 'application/json');
                 res.setHeader('Content-Type', 'application/json');
                 res.statusCode = 413;
                 res.end('{"netPOST":"FAIL","type":"netREQ","Error":"data maximum exceeded"}');
                 req.connection.destroy();
               }
             });
             req.on('end', ()=>{
               this.uStats.requests++;
               this.uStats.data += body.length;
               res.setHeader('Content-Type', 'application/json');
               const time = new Date();

               fs.utimes(this.nodesFile, time, time, (err) => {
                 if (err) {console.error('PeerTreeNet.startServer():: \n',err);
                   let myNodes = [];
                   fs.writeFile(this.nodesFile, JSON.stringify(myNodes), function (err) {
                     if (err) throw err;
                     console.error('startServer()::node list saved to disk!');
                   });
                 }
                 else {}
               });

               var j = null;
               try {
                 //console.time('Time Taken');
                 try {j = JSON.parse(body);}
                 catch(err) {
                   console.error('startServer()::\n',err);
                   throw makeErr(520,'Invalid JSON Req');
                 } 
                 if (j.hasOwnProperty('msg') === false) 
                   throw makeErr(521,'invalid netREQ no msg body found');

                 if(this.rnet.status != 'online' && this.rnet.status != 'root'){
                   //console.error(`PeerTreeNet.startServer():: request error 522 this.rnet.status ${this.rnet.status}`);
                   throw makeErr(522,'req mode is offline only :: joins can be accepted');
                 }
  	         if (!j.msg.remIp) j.msg.remIp = sRemIp;
                 clearTimeout(svtime);
                 
                 if (j.msg.hasOwnProperty('PNETCOREX') === true){
                   let mAllow = ['whoIsRoot?','joinReq','joinWaitOK?'];
                   if (j.msg.ptreeId != this.rnet.r.ptreeId && !mAllow.includes(j.msg.req)) {
                     throw makeErr(523,'req mode ptreeId check failed :: msg rejected');
                   }
                   this.emit('peerTReq',sRemIp,j.msg);
		 } 
	  	 else {
                   if (j.msg.ptreeId != this.rnet.r.ptreeId) {
                     throw makeErr(523,'req mode ptreeId check failed :: apps can only talk on same tree chains');
                   }
                   this.emit('mkyReq',sRemIp,j.msg);
	  	 }
                 res.statusCode = 200;
                 res.end('{"netPOST":"OK"}');
                 //console.timeEnd('Time Taken');
               }
               catch (err) {
                 clearTimeout(svtime);
                 // Determine status code
                 res.statusCode = err?.error ?? err?.code ?? 500;

                 const errMsg = err?.msg || err?.message || String(err);
                 res.end(JSON.stringify({
                     netPOST: "FAIL",
                     type: "netREQ",
                     error: errMsg,
                     data: body
                 }));

                if (err?.code != 552){
                   console.error('PeerTreeNet.startServer():: POST netREPLY Error:\n',err);
                   console.error('PeerTreeNet.startServer():: POST msg was ->\n',j);
                 }
                 const isUnhandledNativeError =  err instanceof Error &&  Object.keys(err).length === 0;
                 if (isUnhandledNativeError) {
                   console.log('wtf',err.stack);
                   console.error("UNHANDLED ERROR:", err.stack);
                   // Close errorLog file and exit
                   errorLog.end(() => { process.exit(1); });
                 }
               }
             });
           }
         }
         else {
           if (req.url.indexOf('/netREPLY') == 0){
             if (req.method == 'POST') {
               var body = '';
               req.on('data', (data)=>{
                 body += data;
                 // Too much POST data, kill the connection!
                 //console.error('PeerTreeNet.startServer():: body.length',body.length);
                 if (body.length > maxPacket){
                   console.error('PeerTreeNet.startServer():: max datazize exceeded');
                   clearTimeout(svtime);
                   //console.error('PeerTreeNet.startServer():: SETHEADER::netREPLYbody:','Content-Type', 'application/json');
                   res.setHeader('Content-Type', 'application/json');
                   res.statusCode = 413;
                   res.end('{"netPOST":"FAIL","type":"netREPLY","Error":"data maximum exceeded"}');
                   req.connection.destroy();
                 }
               });
               req.on('end', ()=>{
	         clearTimeout(svtime);
                 //console.error('PeerTreeNet.startServer():: SETHEADER::netREPLYonEND:','Content-Type', 'application/json');
                 res.setHeader('Content-Type', 'application/json');
                 var j = null;
                 try {
                   try {j = JSON.parse(body);}
                   catch(err) {
                     console.error('PeerTreeNet.startServer():: error:\n',err);
                     throw makeErr(550,"netREPLY JSON error");
                   }
                  
                   if (j.hasOwnProperty('msg') === false) 
                     throw makeErr(551,'invalid netREPLY no msg body found');

                   // if offline mode check for addResults only.
                   if(this.rnet.status != 'online' && this.rnet.status != 'root'){
                     if (!(j.msg.hasOwnProperty('addResult')
                        || j.msg.hasOwnProperty('resultAddMeRight') 
                        || j.msg.hasOwnProperty('whoIsRootReply'))){
                         
                       //console.error('PeerTreeNet.startServer():: NETReply::Offline Reject:',this.rnet.status,j);
                       throw makeErr(552,'mode is offline only addResult,resultAddMeRight, or whoIsRootReply can be accepted');
                     }
                   }
                   if (!j.msg.remIp) j.msg.remIp = sRemIp;

                   if (j.msg.hasOwnProperty('PNETCOREX') === false){
		     this.emit('mkyReply',j.msg);
	 	   }
		   else {
		     this.emit('peerTReply',j.msg);
		   }
                   res.statusCode = 200;
                   res.end('{"netPOST":"OK"}');

                 }
                 catch(err) {
                   clearTimeout(svtime);
                   // Determine status code
                   res.statusCode = err?.error ?? err?.code ?? 500;

                   const errMsg = err?.msg || err?.message || String(err);
                   res.end(JSON.stringify({
                     netPOST: "FAIL",
                     type: "netREPLY",
                     error: errMsg,
                     data: body
                   }));


                   if (err?.code != 552){
                     console.error('PeerTreeNet.startServer():: POST netREPLY Error:\n',err);
                     console.error('PeerTreeNet.startServer():: POST msg was ->\n',j);
                   }
                   const isUnhandledNativeError =  err instanceof Error &&  Object.keys(err).length === 0;
                   if (isUnhandledNativeError) {
                     console.log('wtf',err.stack);
                     console.error("UNHANDLED ERROR:", err.stack);
                     // Close errorLog file and exit
                     errorLog.end(() => { process.exit(1); });
                   }
                 } 
               });
             }
           }
           else {
             clearTimeout(svtime);
             //console.error('PeerTreeNet.startServer():: SETHEADER::netWELOCOME:','Content-Type', 'application/json');
             res.statusCode = 200;
             res.end('{"result":"Welcome To PeerTree Network Sevices\nWaiting...\n' + decodeURI(req.url) + ' You Are: ' + sRemIp+'"}\n');
             //this.endResCX(res,'Welcome To PeerTree Network Sevices\nWaiting...\n' + decodeURI(req.url) + ' You Are: ' + sRemIp+'\n');
           }
       }
     });
     this.server.listen(this.port);
     this.server.timeout = 1000;
     this.server.on('timeout', (socket) => {
       console.error('PeerTreeNet.startServer():: Warning Server Socket timed out');
       this.emit('mkyServerTO');
       //this.setNodeBackToStartup('server socket timeout');
     });
     console.error('PeerTreeNet.startServer():: Server PeerTree7.2 running at ' + this.nIp + ':' + this.port);
   }
   netStarted(){
     console.error('PeerTreeNet.netStarded():: Starting Net Work');
     return new Promise( async (resolve,reject)=>{
       await this.setUpNetwork(); 
       this.notifyNetwork();
       console.error('PeerTreeNet.netStarted():: NETWORK started OK..');
       resolve('ok');
     });
   }
   /********************************
   Broadcast Your Ip To The Network So they can add it to 
   their contacts list
   */
   notifyNetwork(){
     const msg = {
       addMe :true
     }
     this.broadcast(msg);
   }
   /*******************************************************
   Sends A Message to all nodes in the PeerTree network
   */
   broadcast(inMsg){
      this.rnet.bcast(inMsg);
   }
   /********************************************************
   Sends Request to eatch node in the list to have them
   ping the targetIp and reply with the result.
   */
   groupPing(ipList,targetIp){
      //console.error('PeerTreeNet.groupPing():: starting groupPing:',targetIp);
      if(this.rnet && this.status != 'startup'){
        var grpPing = {
          pings        : [],
          target       : targetIp,
          targetStatus : null,
          tstamp       : realNow()
        };
        //create error and reply listeners
	var errListener = null;
        var repListener = null;
        this.on('xhrFail',errListener = (j)=>{
	  const peer = this.gPingIndexOf(grpPing.pings,j.toHost);
	  if(peer !== null){
	    grpPing.pings[peer].pRes = 'nodeDead';
          }		
        });
        this.on('peerTReply',repListener  = (j)=>{ 
          if (j.pingResult && j.remIp == targetIp){
            const pTime = realNow() - grpPing.tstamp;
            const peer = this.gPingIndexOf(grpPing.pings,targetIp);
            if (peer !== null){
              grpPing.pings[peer].pRes = j.pingResult;
              grpPing.pings[peer].pTime = pTime;
            }
          }		  
	  if (j.pingTargResult){
	    if (j.pingTargResult.target == targetIp){	  
              const peer = this.gPingIndexOf(grpPing.pings,j.remIp);
              if (peer !== null){
	        grpPing.pings[peer].pRes = j.pingTargResult.pStatus;
                grpPing.pings[peer].pTime = j.pingTargResult.ptime;
              }
            }		    
          }
	});
	
	// Set A Time limit for ping to wait for reply.      
        const hTimer = setTimeout( ()=>{
          this.removeListener('peerTReply', repListener);
          this.removeListener('xhrFail', errListener);
          grpPing.targetStatus = this.reviewTargetStatus(grpPing);
          //console.error('PeerTreeNet.groupPing():: Done:',grpPing);
        },1000);

        // loop through list and send out group ping request.
	if(ipList.length > 0){
          for (var node of ipList){
            if (node.ip != this.rnet.myIp){
	      grpPing.pings.push({pIP:node.ip,pRes : null});
              if(node.ip != targetIp)
		this.sendMsgCX(node.ip,{gping : "hello",target: targetIp});
              else
		this.sendMsgCX(targetIp,{ping : "hello"});
            }		    
          }
        } 		
      }
      
   }
   reviewTargetStatus(grpPing){
     return 'needs coding';
   }	   
   gPingIndexOf(peers,ip){
     var i = null;
     peers.every((peer,n) =>{
       if (peer.pIP == ip ){
         i = n;
         return false;
       }
       return true;
     });
     return i;
   }
   pingTarget(j){
     //console.error('PeerTreeNet.pingTarget():: Got PingTarget Request:',j); 
     var reply = {
       gpingResult : {
         targetIP : null,
 	 ptime    : Date.now(),
	 pStatus  : null
       }
     };	     
     var hListener = null;
     var rListener = null;
     this.on('xhrFail',hListener = (J)=>{
       this.removeListener('xhrFail', hListener);
       reply.gpingResult.targetIP = j.target;
       reply.gpingResult.pStatus  = 'targDead';
       reply.gpingResult.ptime    = null;
       this.sendReplyCX(j.remIp,reply);
     });
     this.on('peerTReply',rListener  = (J)=>{
       this.removeListener('peerTReply', rListener);
       var pres = {
         pingTargResult : {
  	   ptime   : Date.now() - reply.gpingResult.ptime,
           pStatus : 'OK',
           target  : J.remIp
         }
       };	      
       this.sendReplyCX(j.remIp,pres);
     });
     const hTimer = setTimeout( ()=>{
       this.removeListener('peerTReply', rListener);
       this.removeListener('xhrFail', hListener);
       reply.gpingResult.ptime   = null;
       reply.gpingResult.pStatus = 'Timeout';
       reply.gpingResult.target  = j.target;
       this.sendReplyCX(j.remIp,reply);
     },3000);

     //Ping the target
     this.sendMsgCX(j.target,{ping : "hello"});
   }
   /********************************************************
   Pings your associated peers, nodes,parrent,root to determine
   your nodes health on the network
   */
   async heartBeat(){
     try {
      if (this.heartBeatTimer) clearTimeout(this.heartBeatTimer);

      //console.error('PeerTreeNet.heartBeat():: starting heartBeat:',this.rnet.status,this.rnet.err,this.rnet.r.lnStatus);
      if(this.rnet.err){
        console.error('PeerTreeNet.heartBeat():: lnStatusMoving::ping blocked');
        setTimeout( ()=>{this.heartBeat();},this.pulseRate);
        return;
      }
      if(this.rnet && (this.rnet.status == 'online' || this.rnet.status == 'root') && !this.rnet.err){
        var hrtbeat = {
          pings    : [],
          myStatus : 'OK',
          tstamp   : realNow()
        };
	var hListener = null;
        var rListener = null;
        this.on('xhrFail',hListener = (j)=>{
          if (j.ping){
            //console.error('PeerTreeNet.heartBeat():: pingFail',j);
            const peer = this.heartbIndexOf(hrtbeat.pings,j.remIp);
            if (peer !== null){
              hrtbeat.pings[peer].pRes = 'dead';
              if (j.xhrError == 523){
                console.error(`PeerTreeNet.heartBeat():: peerTreeId conflict... fatal error shutting down`,j);
                this.setNodeBackToStartup('Ping detected peerTreeId conflict');
              }
            }  
          }        
        });
        this.on('peerTReply',rListener  = (j)=>{
          if (j.pingResult){
            if (j.nodeStatus == 'online' || j.nodeStatus == 'root'){
              if (j.remIp == this.rnet.r.myParent){
                if (j.statAction == 'doRejoinNet'){
                  console.error('PeerTreeNet.heartBeat():: PINGRESULT:MyParent:',this.rnet.status,j.pingResult,j.statAction,j);
                  this.setNodeBackToStartup('heartBeat MyParent Result: not my child!');
                }
              }
              console.error('j.pingResults',j);
              this.updateChildRTab(j.remIp,j.rtab);
            }

            const peer = this.heartbIndexOf(hrtbeat.pings,j.remIp);
            if (peer !== null){
              const pTime = realNow() - hrtbeat.pings[peer].sendTime;
              hrtbeat.pings[peer].pRes    = j.pingResult;
              hrtbeat.pings[peer].pTime   = pTime;            // the real time elapsed from send to reply.
              hrtbeat.pings[peer].pStatus = j.nodeStatus;
              hrtbeat.pings[peer].pIp     = j.remIp;
              if (process.title == 'cronoTreeCell'){
                this.rnet.cronoT.updateLinkTimeMgr(j.remIp, pTime);
              }
            }
          }
        });
        const REVIEW_OFFSET = Math.floor(this.pulseRate * 0.85);
 
        const hTimer = setTimeout(async ()=>{
          this.removeListener('peerTReply', rListener);
          this.removeListener('xhrFail', hListener);
          hrtbeat.myStatus = await this.reviewMyStatus(hrtbeat);
	  //console.error('PeerTreeNet.heartBeat():: Done:',hrtbeat);
        },REVIEW_OFFSET); // set the timer for reviewMyStatus() to slightly less then the pulse rate.

	// Ping Parent Node
        if (this.rnet.r.myParent){
          hrtbeat.pings.push({pIP:this.rnet.r.myParent,pType:'myParent',pRes : null,sendTime : realNow()});
	  this.sendMsgCX(this.rnet.r.myParent,{ping : "hello",action : "checkMyStatus",myStatus: this.rnet.status});
        }
        // Ping My Child Nodes
        if(this.rnet.r.myNodes)
          for (var node of this.rnet.r.myNodes){
            hrtbeat.pings.push({pIP:node.ip,pType:'myNodes',pRes : null,sendTime : realNow()});
            this.sendMsgCX(node.ip,{ping : "hello",myStatus: this.rnet.status});
          }
            
        // Last Node Ping Root Node.
        if (this.rnet.r.nodeNbr == this.rnet.r.lnode && this.rnet.r.nodeNbr != 1 && !this.hbeatIncludes(hrtbeat.pings,this.rnet.r.rootNodeIp)){
          console.error('PeerTreeNet.heartBeat():: last node ping root:',this.rnet.status,`rnet.r.lnode is: ${this.rnet.r.lnode}`);
          hrtbeat.pings.push({pIP:this.rnet.r.rootNodeIp,pType: 'lastToRoot',pRes : null,sendTime : realNow()});
          this.sendMsgCX(this.rnet.r.rootNodeIp,{ping : "hello",myStatus: this.rnet.status});
        }
      
        // Ping Left Node.
        if (this.rnet.r.leftNode && !this.hbeatIncludes(hrtbeat.pings,this.rnet.r.leftNode)){
          hrtbeat.pings.push({pIP:this.rnet.r.leftNode,pType: 'pingLeft',pRes : null,sendTime : realNow()});
          this.sendMsgCX(this.rnet.r.leftNode,{ping : "hello",myStatus: this.rnet.status});
        }
        // Ping Right Node.
        if (this.rnet.r.rightNode && !this.hbeatIncludes(hrtbeat.pings,this.rnet.r.rightNode)){
          hrtbeat.pings.push({pIP:this.rnet.r.rightNode,pType: 'pingRight',pRes : null,sendTime : realNow()});
          this.sendMsgCX(this.rnet.r.rightNode,{ping : "hello",myStatus: this.rnet.status});
        }

        if (this.rnet.r.nodeNbr == 1 && hrtbeat.pings.length == 0){
          let nstat = await this.checkInternet();
          //console.error("PeerTreeNet.heartBeat():: Bitcoin Network Found:",nstat);
          if (!nstat){
            console.error('Alone And Offline');
            hrtbeat.myStatus = 'AloneOffline';
            this.setNodeBackToStartup('AloneOffline');
          }
          else {
	    hrtbeat.myStatus = 'Alone';
            this.rnet.r.status = 'root'
            console.error('PeerTreeNet.heartBeat():: lowering pulse rate to 15000!');
            this.pulseRate = 500;
          }
        }
      }
      else {
        //console.error('PeerTreeNet.heartBeat():: Skipping',this.rnet.err,this.rnet.status);
      }
    }
    catch(err){ 
      console.error('PeerTreeNet.heartBeat():: outer try catch',err);
    }
    
    this.heartBeatTimer = setTimeout( ()=>{this.heartBeat();},this.pulseRate);
  }
  hbeatIncludes(hbeat,ip){
    var result = false;
    hbeat.forEach((node)=>{
      if (node.pIP == ip){
        result = true;
      }
    });
    return result;
  }
  updateChildRTab(childIp,childRTab){

    this.rnet.r.myNodes.forEach((child)=>{
      if (child.ip == childIp){
        if (childRTab){
          child.rtab = clone(this.dropChildRTabs(childRTab));
        }
        else {
          child.rtab = 'na';
        }
      }
    }); 
    
    if (this.rnet.r.nodeNbr != 1 && this.rnet.r.nodeNbr == this.rnet.r.lnode){
      if (childRTab.nodeNbr == 1){
        //console.error('PeerTreeNet.updateChildRTab():: CREATING copy of rootNode rootRTab',childRTab);
        this.rnet.r.rootRTab = clone(this.dropChildRTabs(childRTab));
      }
    }
  }
  dropChildRTabs(r){
    if (!r){
      console.error("PeerTreeNet.dropChildRTabs():: error .: r is not defined.");
      r.rootRTab = 'na';
      return r;
    }
    if (!Array.isArray(r.myNodes)) {
      console.error("PeerTreeNet.dropChildRTabs():: error .: r.myNodes is not defined or is not an array");
      r.rootRTab = 'na';
      return r;
    }
    r.myNodes.forEach((node)=>{
      node.rtab = 'na';
    })
    if (this.rnet.r.lastNode !== this.rnet.myIp) {
      r.rootRTab = 'na';
    }
    return r;
  }
  /************************************************
  Called by heartBeat To evaluate your current status
  */
  reviewMyStatus(hbeat){
    return new Promise(async(resolve,reject)=>{
      //console.error('PeerTreeNet.reviewMyStatus():: My Health Check::',hbeat);
      var nFails = 0;
      hbeat.pings.forEach((ping)=>{
        if (ping.pRes != 'hello back'){
          //if (ping.pType != 'lastToRoot'){
            nFails++;
            //console.error('PeerTreeNet.reviewMyStatus():: PingFails::counter:',nFails,hbeat.pings.length,hbeat);
          //}
        }
      });
      //console.error('PeerTreeNet.reviewMyStatus():: PingFails::',nFails);
      if (nFails == hbeat.pings.length){
        //console.error('PeerTreeNet.reviewMyStatus():: heartBeat::reviewMyStatus: '+nFails,hbeat.pings.length);
        hbeat.myStatus = 'imOffline';
        if (!(this.rnet.r.nodeNbr == 1 || this.rnet.r.nodeNbr == 2)) {
          //this.setNodeBackToStartup('I Appear To be Offline');
        }
      }
      if (hbeat.myStatus != 'OK' && (this.rnet.r.nodeNbr == 1 || this.rnet.r.nodeNbr == 2)){
        let finalCheck = await this.checkInternet();
        if (!finalCheck){
          console.error('PeerTreeNet.reviewMyStatus():: finalCheck::setNodeBackToStartup');
          this.setNodeBackToStartup('finalCheck::setNodeBackToStartup');
        }
        else {hbeat.myStatus = 'OK';}
      }
      resolve(hbeat.myStatus);
      return;
    });
  }
  async setNodeBackToStartup(msg='noMsg',bestNewRootIp=null){
    
    // If migrating to the same root that just died, wait a random time
    if (bestNewRootIp !== null && bestNewRootIp === this.rnet.r.rootNodeIp) {

      // Random delay between 250ms and 1250ms
      const delay = 250 + Math.floor(Math.random() * 1000);

      await sleep(delay);
    }

    console.error('PeerTreeNet.setNodeBackToStartup():: Node Appears offline msg is: ' + msg,this.rnet.r);
    this.rnet.status = 'offline';
    this.resetErrorsCntAll();

    this.coldStart = false;
    console.error('PeerTreeNet.setNodeBackToStartup():: Setting Status', this.rnet.status);

    this.rnet.initialize();
    this.doHotStartInitialize();

    if (this.waitForNetTimer){
      clearTimeout(this.waitForNetTime);
    }
    await this.waitForInternet();
    await this.rnet.init(bestNewRootIp);
  }
  async waitForInternet(){
    var isAvail = await this.checkInternet();
    console.error('PeerTreeNet.waitForInternet():: isAvail:',isAvail);
    if (isAvail){
      return;
    }
    while(!isAvail){
      console.error('PeerTreeNet.waitForInternet():: trying to join');
      isAvail = await this.checkInternet();
      await sleep(500);
    }
  }
  async checkInternet() {
    const os = require('os');
    const { exec } = require('child_process');

    if (this.rnet.simulation) {
      console.error('PeerTreeNet.checkInternet():: outage simulation no internet access available!');
      return false;
    }

    // Check for any non-internal IPv4 interface
    const interfaces = os.networkInterfaces();
    const hasInterface = Object.values(interfaces).some(ifaces =>
      ifaces.some(d => d.family === 'IPv4' && !d.internal)
    );

    if (!hasInterface) {
      console.error('PeerTreeNet.checkInternet():: hasInternet fail on interfaces');
      return false;
    }

    // Cross-platform ping command
    const pingCmd = process.platform === 'win32'
      ? 'ping -n 1 8.8.8.8'
      : 'ping -c 1 8.8.8.8';

    return new Promise(resolve => {
      exec(pingCmd, (error) => {
        if (error) {
          console.error('PeerTreeNet.checkInternet():: hasInternet fail on ping', error);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }
/* 
** OLD
  async checkInternet() {
    const os = require('os');
    const { exec } = require('child_process');
    return new Promise((resolve, reject) => {
      if (this.rnet.simulation){
        console.error('PeerTreeNet.checkInternet():: outage simulation no internet access available!');
        resolve(false);
        return;
      }
      const interfaces = os.networkInterfaces();
      let hasInternet = false;

      for (const iface in interfaces) {
        for (const details of interfaces[iface]) {
          if (details.family === 'IPv4' && !details.internal) {
            hasInternet = true;
            break;
          }
        }
        if (hasInternet) break;
      }

      if (!hasInternet) {
        console.error('PeerTreeNet.checkInternet():: hasInternet fail on interfaces');
        resolve(false);
        return;
      }

      // Perform a simple ping test to a public IP address
      exec('ping -c 1 8.8.8.8', (error, stdout, stderr) => {
        if (error) {
          console.error('PeerTreeNet.checkInternet():: hasInternet fail on ping',error);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }
*/  
  /******************************************************
  Finds the index of a peers heartBeat reply using its remIp
  */
  heartbIndexOf(peers,ip){
     var i = null;
     peers.every((peer,n) =>{
       if (peer.pIP == ip && peer.pRes === null){
         i = n;
         return false;
       } 
       return true;
     });
     return i;
  }   
  calculateHash(txt) {
     const crypto = require('crypto');
     return crypto.createHash('sha256').update(txt).digest('hex');
  }
  signMsg(msgTime) {
     const sig = this.signingKey.sign(this.calculateHash(this.rnet.myIp + msgTime), 'base64');
     const hexSig = sig.toDER('hex');
     return hexSig;
   }
  isValidSig(j) {
     if (!j){console.error('remPublicKey is null',j);return false;}
     if (j.hasOwnProperty('remPublicKey') === false) {console.error('remPublicKey is undefined',j);return false;}
     if (!j.remPublicKey) {console.error('remPublickey is missing',j);return false;}

     if (j.hasOwnProperty('borgIOSkey') === false) {console.error('borgIOSkey is undefined',j);return false;}
     if (j.borgIOSkey != this.borgIOSkey) {console.error('invalid BorgIOSkey',j);return false;}

     if (!j.signature || j.signature.length === 0) {
        return false;
     }

     const checkRemAddress = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+j.remPublicKey, 'hex') }).address;
     if (checkRemAddress != j.remMUID) {
       console.error('PeerTreeNet.isValidSig():: remAddress not matching');
       return false;
     }
     var rip = j.remIp;
     if (j.INTERNIP){
       rip = rip+'=>'+j.INTERNIP;
     }
     const publicKey = ec.keyFromPublic(j.remPublicKey, 'hex');
     const msgHash   = this.calculateHash(rip + j.msgTime);
     return publicKey.verify(msgHash, j.signature);
  }
  formatMsg(msg){
     if (msg.req == 'undefined' || !msg.req){
       //console.error('PeerTreeNet.formatMsg():: req not defined full message is',msg);
     }
     return 'MSG: req:'+msg.req+',time:'+msg.msgTime+",toHost:"+msg.toHost+",xhrError:"+msg.xhrError;
  }
  processMsgQue() {
    try {
      if (this.msgQue.length) {
        const retryTime = 500; // 5 attempts over ~2.5 seconds
        const msg = this.msgQue.shift();

        const waitTime = Date.now() - msg.retryStartTime;

        if (waitTime > retryTime) {
          this.msgMgr.remove(msg.toHost);
          console.error('PeerTreeNet.processMsgQue():: Sending Message from que -> ',this.formatMsg(msg));
          this.sendMsgCX(msg.toHost, msg);
        } else {
          this.msgQue.push(msg);
        }
      }
    } catch(err) {
      console.err(`processMsgQue()::  try/catch : `,err);
    }

    setTimeout(() => {
      this.processMsgQue();
    }, 500);
  }

  queMsg(msg) {
    console.error(
      'PeerTreeNet.queMsg():: Msg Log Counter: ',
      this.msgMgr.count(msg.toHost),
      msg.toHost
    );

    if (this.msgMgr.count(msg.toHost) < 20) {
      if (typeof msg.retryStartTime === 'undefined') {
        msg.retryStartTime = Date.now();
      }

      this.msgQue.push(msg);
      this.msgMgr.add(msg.toHost);
      return true;
    }

    return false;
  }
  getNetRootIp(){
     const r = this.rnet.r.rootNodeIp; 
     if (!r) 
       return this.rootIp;
     return r;
  }
  sendMsgCX(toHost,msg){
    this.sendMsg(toHost,msg,true);
  }	  
  getExternlIpOnly(host) {
    var regex = /=>.*$/;  
    var result = host.replace(regex, '');  
    return result;
  }
  getInternalIpOnly(host) {
    if (!host || host.indexOf('=>') === -1) {
      return null;
    }
    var regex = /=>(.*)$/;
    var matchResult = host.match(regex);
    return matchResult ? matchResult[1].trim() : null;
  }
  sendMsg(toHost,msg,corx=false){
      if (!toHost) {console.error('Send Message Host '+toHost+' Missing',msg);return;}
      if (!msg)    {console.error('Send Message Msg  Missing'+toHost,msg);return;} 
      msg.INTERNIP = this.getInternalIpOnly(this.rnet.myIp);
      toHost = this.getExternlIpOnly(toHost);

      if (toHost == this.rnet.myIp)
        return;

      if (msg.reroute) {} //console.error('Forwarding re-routed msg');
      msg.borgIOSkey = this.borgIOSkey;
      if(corx){
        msg.PNETCOREX = true;
      }
      if (toHost == 'root'){
        toHost = this.getNetRootIp();
        //console.error('PeerTreeNet.sendMsg():: toHost::Changes to:',toHost);
      }
      //console.error('PeerTreeNet.sendMsg():: toHost Changes to:',toHost);
      const msgTime =  Date.now();

      if(!msg.signature){
        const msgTime    = Date.now();
        msg.signature    = this.signMsg(msgTime);
        msg.borgOISkey   = this.borgIOSkey;
        msg.msgTime      = msgTime;
        msg.remPublicKey = this.publicKey;
        msg.remMUID      = this.peerMUID;
        msg.ptreeId      = this.rnet.r.ptreeId;
      }
      this.sendingReq = true;
      this.sendPostRequest(toHost,msg,'/netREQ');
      return;
  }
  replyQueSend(){
     if (this.rQue.length){
       const msg = this.rQue[0];
       this.rQue.shift();
       //console.error('PeerTreeNet.replyQueSend():: Sending Message from que to '+msg.toHost,msg);
       this.sendReply(msg.toHost,msg.msg);
     }
     const rqtime = setTimeout( ()=>{
       this.replyQueSend();
     },300);
  }
  sendReplyCX(toHost,msg){
     this.sendReply(toHost,msg,true);
  }
  sendReply(toHost,msg,corx=false){
      if (!toHost) {console.error('Send Reply host '+toHost+' Missing',msg);return;}
      if (!msg)    {console.error('Send Reply Msg  Missing');return;}

      if (toHost == this.rnet.myIp)
        return;

      if (msg.reroute) {} //console.error('Forwarding re-routed msg');

      if(corx){
        msg.PNETCOREX = true;
      }
      const qreply = {
        toHost : toHost,
        msg    : msg,
      }
      if (toHost == 'root'){
        toHost = this.getNetRootIp();
      }
      const msgTime =  Date.now();

      if(!msg.signature){
        const msgTime    = Date.now();
        msg.signature    = this.signMsg(msgTime);
        msg.borgIOSkey   = this.borgIOSkey;
        msg.msgTime      = msgTime;
        msg.remPublicKey = this.publicKey;
        msg.remMUID      = this.peerMUID;
        msg.ptreeId      = this.rnet.r.ptreeId;
      }
      this.sendPostRequest(toHost,msg,'/netREPLY');
      return;
  }
  sendPostRequest(toHost,msg,endPoint='/netREPLY'){

     console.log(`sendPostRequest(toHost:${toHost}`,msg,`endPoint='/netREPLY'`);
     if (this.rnet.simulation){
       console.error('PeerTreeNet.sendPostRequest():: outage simulation send failure',toHost);
       msg.xhrError = 500;
       this.emit('xhrFailedTry',msg);
       return;
     }
 
     const https = require('https');

     msg.errCount = 0;
     msg.sentTime = Date.now();

     const pmsg = {msg : msg}
     const data = JSON.stringify(pmsg);
     
     var emitError = null;
     const options = {
       hostname : toHost,
       port     : this.port,
       path     : endPoint,
       method: 'POST',
       headers: {
         'Connection': 'close',
         'Content-Type': 'application/json',
         'Content-Length': Buffer.byteLength(data, 'utf8')
       },
       timeout: 3000
     }
     
     const req = https.request(options, res => {
       msg.toHost = toHost;
       if (res.statusCode !== 200) {
         msg.toHost   = toHost;
         msg.endpoint = options.path;
         msg.xhrError = res.statusCode;
         msg.errCount++;
         console.log(`sendPostRequest():: xhrFailedTry`);
         this.emit('xhrFailedTry',msg);
       } else {
         this.emit('xhrPostOK',msg);
         console.log(`sendPostRequest():: success`);
         this.rnet.nodeHealthMgr.recordPostResult(msg.toHost, "success");
       }

     });

     req.on("timeout", () => {
       if (emitError === null){
          emitError    = true;
          msg.toHost   = toHost;
          msg.endpoint = options.path;
          msg.xhrError = 'xTime';
          msg.errCount++;
          this.emit('xhrFailedTry',msg);
       }
       req.destroy();
     });

     req.on('error', error => {
        if (emitError !== null) return;

        emitError     = true;
        msg.toHost    = toHost;
        msg.endpoint  = options.path;
        msg.xhrError  = 'xError';
        msg.xhrErCode = error.code;
        msg.errCount++;
        if (error.code === 'ETIMEDOUT') {
          msg.xhrError = 'xTime';
        }
        this.emit('xhrFailedTry',msg);
     })

     req.write(data);
     req.end();
  }

  removeNode(ip){
     this.PTnodes.forEach( (n, index, object)=>{
       if (n.ip == ip){
         object.splice(index,1)
       }
     });
     const remip = {ip : ip}
     //console.error('PeerTreeNet.removeNode():: Removed non responsive network node : ',remip);
     const myNodes = this.PTnodes;
     return;
     fs.writeFile(this.nodesFile, JSON.stringify(myNodes), function (err) {
       if (err) throw err;
       console.error('PeerTreeNet.removeNode():: node list saved to disk!');
     });
  }
  getNodesErrorCnt(ip){
     for (var node of this.PTnodes)
       if (ip == node.ip)
         return node.errors;
     return null;
  }
  resetErrorsCnt(ip){
     this.PTnodes.forEach( node=>{
       if (node.ip == ip)
         node.errors = 0;
     });
  }
  resetErrorsCntAll(){
     this.PTnodes.forEach( node=>{
       node.errors = 0;
     });
  }
  incErrorsCnt(ip){
     this.PTnodes.forEach( (node)=>{
       if (node.ip == ip)
         if (this.checkExpire(node.date)){
           console.error('PeerTreeNet.incErrorsCnt():: maxErTime expired reseting ',node);
           node.date = Date.now();
           node.errors = 0;
         }
         node.errors++;
     });
  }
  checkExpire(date, expTime = defPulse*maxNetErrors*1000) {
    const now = Date.now();
    console.error('PeerTreeNet.checkEpire():: maxT is: '+expTime+' diff is: '+(now - date));
    return now - date >= expTime;
  } 
  /********************************************************
  Maintains contact list used for finding the network when
  attempting to rejoin.
  */
  markWhoIsRoot(j){
    for (var node of this.PTnodes){
      if (this.ip == this.rnet.r.rootNodeIp){
        node.isRoot = true;
      }
      else {
        node.isRoot = false;
      }
    }
    if (j.remIp == this.rnet.r.rootNodeIp){
      return true;
    }
    return false;
  }
  async pushToContacts(j){
    const isRoot = this.markWhoIsRoot(j);

    // update last heard from date of the contact.
    for (var node of this.PTnodes){
       if (node.ip == j.remIp){
         node.date = Date.now();
         node.lastState = 'online';
         this.pruneContacts();
         return;
       }
     }

     const newip = {ip : j.remIp,errors : 0,date : Date.now(),pKey : j.remPublicKey, isRoot : isRoot,lastState : 'online' }
     console.error('PeerTreeNet.pushToContacts():: New Network Node Joined: ',newip.ip);
     this.PTnodes.push(newip);
     const myNodes = this.PTnodes;
     fs.writeFile(this.nodesFile, JSON.stringify(myNodes), function (err) {
       if (err) throw err;
       console.error('PeerTreeNet.pushToContacts():: node list saved to disk!');
     });

  }
  setContactsStatusTo(ip, status) {
    let changed = false;

    for (let node of this.PTnodes) {
      if (node.ip === ip) {
        if (node.lastState !== status) {
          node.lastState = status;
          node.date = Date.now();
          changed = true;
        }
        break;
      }
    }

    if (changed) {
      fs.writeFile(this.nodesFile, JSON.stringify(this.PTnodes), err => {
        if (err) throw err;
        //console.error(`PeerTreeNet.setContactsStatusTo():: Updated status of ${ip} to '${status}' and saved to disk.`,this.PTnodes);
      });
    }

    return changed;
  }
  pruneContacts() {
    // Sort newest → oldest
    const sorted = [...this.PTnodes].sort((a, b) => b.date - a.date);

    // Keep only the first 10
    const pruned = sorted.slice(0, 10);

    // Detect if anything changed
    const changed = pruned.length !== this.PTnodes.length ||
                  pruned.some((node, i) => node.ip !== this.PTnodes[i].ip);

    if (changed) {
      this.PTnodes = pruned;

      // Persist to disk
      fs.writeFile(this.nodesFile, JSON.stringify(this.PTnodes), err => {
        if (err) throw err;
        //console.error("PeerTreeNet.pruneContacts():: pruned node list saved to disk!");
      });
    }

    return changed;
  }
  handleBcast(j){
     
     if (j.msg.addMe){
       this.pushToContacts(j); 
       return;
     }
     if (this.rnet.handleBcast(j))
       return;
  }
  setErrorHandlers(){
     // ********************
     // handles messages that can not be delivered do to network problem.
     
     this.on('xhrFailedTry',async (j)=>{
       //console.error('xhrFail handler:',j);
       const retry = await this.rnet.handleSendMsgErrors(j);
       console.error('PeerTreeNet.setErrorHandlers():: ',retry,j);
       if (retry === 'FailedSend'){
         console.error('PeerTreeNet.setErrorHandlers():: FailedSend emit(xhrFail):',retry,j);
         this.emit('xhrFail',j);
         return;
       }
     });
  } 
  analyseTrafficRate(){
    // track network traffic flow rate so that heartBeats pulse rate can be increased 
    // when traffic is low and decreased as load increases.
    // heartBeat rate is controled by this.pulseRate  which is initialy = global defPulse; 
    const now = Date.now();

    // --- 1. Track message timestamps ---
    if (!this._trafficHistory) {
        this._trafficHistory = [];
        this._lastPulseAdjust = now;
        this._currentRate = defPulse;   // starting pulse
    }

    // push timestamp
    this._trafficHistory.push(now);

    // keep only last N seconds of history
    const WINDOW = 5000; // 5 seconds
    this._trafficHistory = this._trafficHistory.filter(t => now - t <= WINDOW);

    // --- 2. Compute traffic rate (messages/sec) ---
    const rate = this._trafficHistory.length / (WINDOW / 1000);

    // --- 3. Adaptive thresholds ---
    const IDLE_THRESHOLD  = 1.0;  // <1 msg/sec → idle
    const BUSY_THRESHOLD  = 10.0; // >10 msg/sec → busy

    // --- 4. Hysteresis: adjust at most every 2 seconds ---
    if (now - this._lastPulseAdjust < 2000) return;

    let newPulse = this.pulseRate;

    if (rate < IDLE_THRESHOLD) {
        // Idle → speed up heartbeat
        newPulse = Math.max(this.minPulse, this.pulseRate - 50);
    } 
    else if (rate > BUSY_THRESHOLD) {
        // Busy → slow down heartbeat
        newPulse = Math.min(this.maxPulse, this.pulseRate + 100);
    } 
    else {
        // Normal → drift toward default
        if (this.pulseRate < defPulse)
            newPulse += 20;
        else if (this.pulseRate > defPulse)
            newPulse -= 20;
    }

    // clamp
    newPulse = Math.max(this.minPulse, Math.min(this.maxPulse, newPulse));

    // apply if changed
    if (newPulse !== this.pulseRate) {
        this.pulseRate = newPulse;
        this._lastPulseAdjust = now;
        // console.error(`Adaptive Pulse: ${rate.toFixed(2)} msg/s → pulseRate=${newPulse}`);
    }
    
  }
  initHandlers(){ 
     this.setErrorHandlers();

     // *****************************
     // Handles message responses from peers
     
     this.on('peerTReply',(j)=>{
       if (!this.isValidSig(j)){
         console.error('PeerTreeNet.initHandlers():: netREPLY... invalid signature message refused',j);
         return;
       }
       this.analyseTrafficRate();
       if (this.rnet.handleReply(j))
         return;
       if (j.nodeReply){
        //console.error('PeerTreeNet.initHandlers():: I heard net root is:',j.netRootIp);
         this.rootIp = j.netRootIp;
       }
     });
     this.on('peerTReq',async (remIp,j)=>{
       //console.error('PeerTreeNet.initHandlers():: peerTReq::::',j);
       var error = null;       
       if (!this.isValidSig(j)){
         error = '400';
         console.error('PeerTreeNet.initHandlers():: invalid signature message refused',j);
         this.endResCX(remIp,'{"response":"' + error +'"}');
         return;
       }
       this.analyseTrafficRate();
       // Add node the contacts List 
       this.pushToContacts(j);

       if (await this.rnet.handleReq(remIp,j)){
         //console.error('PeerTreeNet.initHandlers():: Request Handled By Handler',j);
         return;
       }
       
       if (j.gping == 'hello'){
         this.pingTarget(j);
         return;	 
       }
       if (j.ping == 'hello'){
         //console.error('PINGTEST::',this.rnet.status);
         if (!(this.rnet.status == 'online' || this.rnet.status == 'root')){
           console.error('PeerTreeNet.initHandlers():: rnet.status::',this.rnet.status,'rejecting ping from: ',j.remIp);
           return;
         }
         var result = 'OK';
         if (j.action == 'checkMyStatus'){
           var tres = this.rnet.isMyChild(j.remIp);
           if (tres === null){
             console.error('PeerTreeNet.initHandlers():: pingResult::doRejoinNet',j.remIp,result,j);
             result = 'doRejoinNet';
           }
         }
         const pr = '{"pingResult":"hello back","statAction":"'+result+'","nodeStatus":"'+this.rnet.status+'","rtab":'+JSON.stringify(this.rnet.r)+'}'
         this.endResCX(remIp,pr);
         return;
       }      
       if (j.req == 'bcast'){
         if (this.rnet.myIp == j.req.remIp){
           //console.error('PeerTreeNet.initHandlers():: Bcast To Self Ignored::',j);
           return;
         }
         this.emit('bcastMsg',j);
         this.rnet.forwardMsg(j);
         this.handleBcast(j);
         return;
       }
     });
  }
};
async function tryGetExternalIp() {
    const { networkInterfaces } = require('os');
    const interfaces = networkInterfaces();
    let externalIp = null;
    let internalIp = '';

    for (const interfaceName of Object.keys(interfaces)) {
        for (const network of interfaces[interfaceName]) {
            // Check for IPv4, not internal, and not a loopback address
            if (network.family === 'IPv4' && !network.internal && isPrivate(network.address)) {
              internalIp = network.address;
            }
            if (network.family === 'IPv4' && !network.internal && !isPrivate(network.address)) {
                externalIp = network.address;
                break;
            }
        }
        if (externalIp) break;
    }
    if (externalIp === null){
      const xIp = await getExternalIp();
      externalIp = xIp+'=>'+ internalIp;
    }
    return externalIp;
}

function getExternalIp() {
  return new Promise( async (resolve,reject)=>{
    const axios = require('axios');
    try {
        const response = await axios.get('https://api.ipify.org?format=json');
        const { ip } = response.data;
        resolve(ip);
    } catch (error) {
        console.error('PeerTreeNet.getExternalIp():: Error retrieving external IP:', error.message);
        resolve(null);
    }
  });
}
function getExternlIpOnly(host) {
  var regex = /=>.*$/;
  var result = host.replace(regex, '');
  return result;
}
function checkInternetAccess(ip,port=1350){
  const portscanner = require('portscanner');

  const ipAddress = getExternlIpOnly(ip);
  console.error('PeerTreeNet.checkInternetAccess():: Portscan::',ipAddress);
  const portToCheck = port; // Change this to the port you want to check

  portscanner.checkPortStatus(portToCheck, ipAddress, (error, status) => {
    if (error) {
      console.error('PeerTreeNet.checkInternetAccess():: \n',error);
      process.exit(0);
    } else {
      console.error(`Port ${portToCheck} on ${ipAddress} is ${status}`);
      if (status !== 'open'){
        console.error('PeerTreeNet.checkInternetAccess():: No Internet Access:',status);
        process.exit(0);
      }  
    }
  });
}
function isPrivate(ip) {
    // Check if the IP address is in a private range
    const privateRanges = [
        /^10\./,
        /^192\.168\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./
    ];

    return privateRanges.some(range => range.test(ip));
}
module.exports.PeerTreeNet  = PeerTreeNet;
