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

console.log('running::',process.title);
// Create a writable stream to your desired file
const errorLog = fs.createWriteStream(process.title+'NodeErrors.log', { flags: 'a' });

// Override console.error
console.error = function (...args) {
  const message = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const err = new Error(message);
  errorLog.write('\n'+process.title+' '+logTimestamp()+' - '+erFormat(err.stack)+'\n');
};

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
      console.log(`Port is already in use. Exiting...`);
    }
    errorLog.write("\nUNCAUGHT_exception: " + err.stack + "\n", () => {
      errorLog.end(() => {
        process.exit(1);
      });
    });
});

process.on('unhandledRejection', (reason, promise) => { // Updated
    console.error('process.on():: Unhandled Promise Rejection:');

    // Print the full stack if available
    if (reason && reason.stack) {
        console.error(reason.stack);
    } else {
        console.error(reason);
    }
});

var   defPulse        = 5*1000;
const maxPacket       = 300000000;
const maxNetErrors    = 5;
const verifyRootTimer = 30*1000;

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
const srvFatal = [413,520,521,523,550,551];
const srvBusy  = [501,522,552,'xTime','xError'];

function clone(obj){
  return JSON.parse(JSON.stringify(obj));
}
function sleep(ms){
  return new Promise(resolve=>{
    setTimeout(resolve,ms)
  });
}
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
     this.newNode    = null;
     this.err        = null;
     this.eTime      = null;
     this.status     = 'startup'
     this.startJoin  = null;
     this.joinQue    = [];
     this.dropIps    = [];
     this.rootMap    = new Map();
     this.waitForNetTimer = null;
     this.joinReqFails  = 0;
     this.coldStart      = true;

     this.r = {
       ptreeId    : crypto.randomUUID(), // unique identifier of best branch of the network (new nodes need to join the largest healthy branch).
       rootNodeIp : myIp,                // Top of the network routing table plus each nodes peer group.
       rootRTab   : 'na',
       myNodes    : [],                  // forwarding ips for each nodes peer group.
       lastNode   : myIp,
       leftNode   : null,
       rightNode  : null,
       myParent   : null,
       nextParent : null,
       mylayer    : 1,
       nodeNbr    : 0,                   // node sequence number 1,2,3 ... n
       nlayer     : 1,    // nlayers in the network 1,2,3 ... n
       lnode      : 1,    // number of the last node in.
       lnStatus   : 'OK', // used for routing updates. 'OK' or 'moving'
       nextPNbr   : 1
     }
     setTimeout(() => {this.verifyRoot();},60*1000);
     setTimeout(() => {this.scanNodesRight();},65*1000);
   }
   simulateOutage(mode){
     if (mode == 'startSim'){
       this.simulation = true;
       console.error('MkyRouting. simulateOutage():: simulated outage started!');
     }
     else {
       this.simulation = false;
       console.error('MkyRouting. simulateOutage():: simulated outage stopping!');
     }
   }
   async scanNodesRight(){
     //console.error('MkyRouting.scanNodesRight()::START node scan',this.myIp,this.r.rootNodeIp);
     if (this.myIp == this.r.rootNodeIp){
       const nodes = [];
       var  node = {ip : this.myIp,rtab:this.r};
       var j = null;
       while (node && node !== 'offline') {
         nodes.push(node);
         j = await this.getNodeRight(node.rtab.rightNode);
         if (j) node = j.sendNodeDataResult; 
         else   node = null;
       }
       //console.error('MkyRouting.scanNodesRight():: nodeScanResult::',nodes);
       //console.error('MkyRouting.scanNodesRight():: finalNode::',j);
     }
     setTimeout(() => { this.scanNodesRight();},60*1000);
   }
   getNodeRight(ip){
     return new Promise( (resolve,reject)=>{
       if (!ip) {resolve(null); return;}
       var rtListen = null;
       var rtLFail  = null;
       const gtime = setTimeout( ()=>{
         console.error('MkyRouting.getNodeRight():: who is root timeout', ip);
         this.net.removeListener('peerTReply', rtListen);
         this.net.removeListener('xhrFail', rtLFail);
         resolve(null);
       },800);
       
       this.net.on('peerTReply', rtListen = (j)=>{
         if (j.sendNodeDataResult && j.remIp == ip){
           clearTimeout(gtime);
           resolve(j);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
       this.net.on('xhrFail', rtLFail = (j)=>{
         if (j.sendNodeDataResult && j.remIp == ip){
           clearTimeout(gtime);
           resolve (null);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
       const req = {
         req : 'sendNodeData'
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
     //console.error('BorgUsage::',this.net.uStats);
     if ((this.status == 'root') && !this.err) {
       const rmap = await this.findWhoIsRoot();
       if (rmap.size){
         const rInfo = this.getMaxRoot();
         console.error('MkyRouting.verifyRoot():: VERIFIED best root to follow is:',rInfo);  
         if (this.r.rootNodeIp === rInfo.jroot.rip){
           //console.error('MkyRouting.verifyRoot():: OK I am still Root:',this.myIp);
         }
         else {
           this.net.setNodeBackToStartup('Best Network Tree Root has changed! Shutting down to join new tree.');
           return;
         }   
       }
     }
     setTimeout(() => {
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
         const tryIp  = this.net.PTnodes[i].ip;
         const status = this.net.PTnodes[i].lastState;
         i = i +1;
         if (this.status == 'startup' || this.status == 'tryJoining' || ((this.status == 'online' || this.status == 'root') && status == 'online')){
           if (tryIp != this.myIp){
             jroot = await this.whoIsRoot(tryIp);
             if (jroot){
               var map = this.rootMap.get(jroot.rip);
               if (map)
                 map.count++;
               else {
                 if (jroot.rip)
                   this.rootMap.set(jroot.rip,{count:1,jroot:jroot});
               }
             }
           }
         }
       } 
       if (this.rootMap.size === 0) {
         console.error('MkyRouting.findWhoIsRoot():: RootMap::',this.rootMap);
       }
       console.log('MkyRouting.findWhoIsRoot():: RootMap::',this.rootMap);
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
         console.error('MkyRouting.whoIsRoot():: timeout', ip);
         this.net.removeListener('peerTReply', rtListen);
         this.net.removeListener('xhrFail', rtLFail);
         resolve(null);
       },1000);

       this.net.on('peerTReply', rtListen = (j)=>{
         if (j.whoIsRootReply && j.remIp == ip){
           clearTimeout(gtime);
           if (j.whoIsRootReply == 'notready'){
             console.error('MkyRouting.whoIsRoot():: Repy::status not ready: ',j.remIp);
             resolve(null);
           }
           else if (j.whoIsRootReply == 'deadnode'){
             console.error('MkyRouting.whoIsRoot():: Repy::status deadnode: ',j.remIp);
             resolve(null);
           }
           else {
             //console.error('MkyRouting.whoIsRoot():: this.rootFound',j.whoIsRootReply);
             resolve(j.whoIsRootReply);
           }
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
       this.net.on('xhrFail', rtLFail = (j)=>{
         if (j.req == 'whoIsRoot?'){
           clearTimeout(gtime);
           console.error('MkyRouting.whoIsRoot():: xhrFail::this.rootFound');
           resolve (null);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
  
       const req = {
         req  : 'whoIsRoot?'
       }
       //console.error('MkyRouting.whoIsRoot():: sending message to'+ip,req);
       this.net.sendMsgCX(ip,req);
     });
   }
   // ***********************************************
   // Notify Root That A Node Is Dropping
   // ===============================================
   notifyRootDropingNode(node){
     const reqId = crypto.randomUUID();   // Unique ID for THIS attempt
     return new Promise((resolve,reject)=>{
       console.error('MkyRouting.notifyRootDropingNode():: Start',node);
       if (node == this.r.rootNodeIp){
         resolve('IsRoot');
         return;
       }
       //*check to see if myIp is the root node.
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
       const oldNextPNbr = this.r.nextPNbr;
       const newNextPNbr = this.getMyParentNbr(this.r.lnode+1);
       console.error('MkyRouting.addNewNodeReq():: NextPNbr::',oldNextPNbr,newNextPNbr);

       if ( this.r.myNodes.length < this.net.maxPeers){
         var node = {ip : ip,nbr : this.r.lnode+1, pgroup : [],rtab : 'na'}
         this.r.myNodes.push(node);
         this.incCounters();
         this.r.lastNode = ip;
         this.newNode = clone(this.r);
         this.newNode.leftNode = oldLastNodeIp;
         this.newNode.rightNode = null;
         this.newNode.myParent = this.myIp;
         this.newNode.mylayer = this.getNthLayer(this.net.maxPeers,this.r.lnode);
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
       this.newNode = clone(this.r);
       this.newNode.myParent = nextParent;
       this.newNode.leftNode = oldLastNodeIp;
       this.newNode.rightNode = null;
       this.newNode.mylayer = this.getNthLayer(this.net.maxPeers,this.r.lnode);
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
   getMyParentNbr(n){
     let p=0;
     for ( let i=1; i < n;i++){
       if ((i-1) % this.net.maxPeers === 0)
          p++;
     }
     if (p==0){return 1;}
     return p;
   }
   findWhoHasChild(ip){
     return new Promise((resolve,reject)=>{
       var errListener = null;
       var repListener = null;

       //catch errors.
       this.net.on('xhrFail',errListener = (j)=>{
         if (j.remIp == ip && j.req == 'findWhoHasChild'){
           this.net.removeListener('xhrFail', errListener);
           this.net.removeListener('peerTReply', repListener);
           resolve(null);
         }
       });

       // Listen for responses.
       this.net.on('peerTReply',repListener  = (j)=>{
         if (j.resultWhoHasChild){ 
           console.error('MkyRouting.findWhoHasChild():: gotBack:', j.resultWhoChild);
           resolve (j.resultWhoHasChild);
           this.net.removeListener('xhrFail', errListener);
           this.net.removeListener('peerTReply', repListener);
         }
       });

       // Set Time out for responses.
       const hTimer = setTimeout( ()=>{
         this.net.removeListener('peerTReply', repListener);
         this.net.removeListener('xhrFail', errListener);
         resolve('noBody');
       },2500);

       this.bcast({findWhoHasChild : {ip:ip}});
     });
   }
   nextParentAddChild(ip,nbr,nextParent){
     return new Promise((resolve,reject)=>{
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
     if (n <= 1){
       return 1;
     }
     var pmax   = 1;
     var max    = 1;
     var layer  = 1;

     while (max <= n){
       max = pmax + Math.pow(maxPeers,layer -1);
       pmax = max;
       layer++;
     }
     return layer -1;
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
   init(mode=null){
     console.error('MkyRouting.init():: mode:',mode);
     return new Promise(async (resolve,reject)=>{
       const doWait = true;
       const rtab = await this.net.readNodeFile(doWait);
       var   jroot = null;
       var   rInfo = null;
       if (!rtab) 
         console.error('MkyRouting.init():: NETWORK starting... I am new!', this.net.PTnodes);
       else 
         if (Array.isArray(rtab))
           if (rtab.length > 0)
             this.net.PTnodes = rtab;

       console.error('MkyRouting.init():: nodesFile\n', this.net.nodesFile,this.net.PTnodes);
       
       let tryfind = 0;
       if (this.net.PTnodes.length > 0){
         while (tryfind < 10 ){
	   const rmap = await this.findWhoIsRoot();
           rInfo = this.getMaxRoot();
           console.error('MkyRouting.init():: findingRoot:',rInfo);
           tryfind = tryfind + 1;
           if(rInfo){
             tryfind = 10;
           }
         }
         console.error('MkyRouting.init():: Done Trying',rInfo);
         if (!rInfo){ 
           console.error('MkyRouting.init():: No Root Ip Provided:');
           jroot = this.myIp;
         }
         else {
           jroot = rInfo.jroot.rip;
           this.net.rootIp = jroot;
           this.net.maxPeers = rInfo.jroot.maxPeers;
           console.error('MkyRouting.init():: BUGFIX::',rInfo,rInfo.jroot.maxPeers);
         }
       } 
       if (this.myIp != jroot && jroot !== null){
         const reqId = crypto.randomUUID();
         const msg = {
           req : 'joinReq',
           reqId : reqId     // ??? folowup  addResult reply must be changed to accomodate a reqId
         }
         console.error("MkyRouting.init():: New Node Sending Join.. req to:",jroot,this.myIp,msg);
         this.net.sendMsgCX(jroot,msg); 
         const joinRes = await this.resultFromJoinReq(jroot,reqId);
         console.error('MkyRouting.init():: joinRes::',joinRes);
         if (joinRes){
           this.status = 'online';
         }
         else {
           resolve(false);
           return;
         }
       }    
       else{ 
         this.r.rootNodeIp = this.myIp;
         this.r.nextParent = this.myIp;
         this.status = 'root';
         this.r.nodeNbr = 1;
         console.error("MkyRouting.init():: I am alone :(");
         
         this.procJoinQue();
       }
       resolve(true);
     });	     
   }
   resultFromJoinReq(ip,reqId){
     return new Promise((resolve,reject)=>{
       var rtListen = null;
       var rtLFail  = null;
       const gtime = setTimeout( ()=>{
         console.error('MkyRouting.resultFromJoinReq():: timeout',ip);
         this.net.removeListener('peerTReply', rtListen);
         this.net.removeListener('xhrFail', rtLFail);
         this.net.setNodeBackToStartup('my join request Timeout');
         resolve(null);
       },15800);

       this.net.on('peerTReply', rtListen = async (j)=>{
         if (j.addResult && j.remIp == ip && j.reqId == reqId){
           console.error('MkyRouting.resultFromJoinReq():: \n',j,'\n');
           let jres = await this.processMyJoinResponse(j);
           if (jres !== 'wait') {
             console.error('MkyRouting.resultFromJoinReq():: NoWait\n',jres,'\n');
             clearTimeout(gtime);
             this.net.removeListener('peerTReply', rtListen);
             this.net.removeListener('xhrFail', rtLFail);
             resolve(jres);
           }
           else {
             console.error('MkyRouting.resultFromJoinReq():: inWaitMode\n',jres,'\n');
             this.net.removeListener('peerTReply', rtListen);
             this.net.removeListener('xhrFail', rtLFail);
           }
         }
       });
       this.net.on('xhrFail', rtLFail = (j)=>{
         if (j.req == 'joinReq' && j.remIp == ip && j.reqId == reqId ){
           console.error('MkyRouting.resultFromJoinReq():: addFailxhr:\n',j);
           clearTimeout(gtime);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
           resolve(false);
         }
       });
     });
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
     console.error(`MkyRouting.bcast():: this.r`,msg);
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
     console.error('MkyRouting.routePastNode():: msg: ',msg);
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
     this.r = {
       ptreeId    : crypto.randomUUID(), // create a new unique Id for this network tree
       rootNodeIp : this.myIp,
       myNodes    : [],
       lastNode   : this.myIp,
       myParent   : null,
       nextParent : this.myIp,
       rightNode  : null,
       leftNode   : null,
       mylayer    : 1,
       nodeNbr    : 1,
       nlayer     : 1,
       lnode      : 1,
       lnStatus   : 'OK',
       nextPNbr   : 1
     }
     this.joinReqFails = 0;
     this.coldStart    = false;
     this.net.msgQue   = [];
     this.net.msgMgr.remove(this.net.rootIp);
     this.net.rootIp   = this.myIp;
     this.status       = 'root';
     this.startJoin    = null;
     this.err          = null;
     this.procJoinQue();
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
           this.r.rootRTab.pop();
         }
       }

       console.error('MkyRouting.lnodeReplaceRoot():: Cloning RootRTab',this.r.rootRTab);
       if (this.r.rootRTab == 'na' || !this.r.rootRTab){
         //this.r = 'na'
         resolve(false);
         return;
       }
       this.r = clone(this.r.rootRTab);

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
       this.procJoinQue();
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
         if (this.r.lastNode == ip){
           this.r.lastNode = holdLastNodeIp;
         }   
         if (this.r.myNodes[this.r.myNodes.length -1].ip == holdLastNodeIp){
           console.error('MkyRouting.sendMoveRequestToLastNode():: Case 4. Pop',holdLastNodeIp,this.r.myNodes[this.r.myNodes.length -1].ip);
           this.r.myNodes.pop();
         }
         this.myChildSetNewIp(lnodeIp,ip);
         this.bcastRootTableUpdate();
         resolve(null);
         return;
       }

       //case 5 parent node is not root or last node 
       console.error('MkyRouting.sendMoveRequestToLastNode():: Case: 5',ip,nbr);

       var lnStatus = null;
       var trys     = 0;
       let maxTrys  = 5;
       
       while (lnStatus != 'moveOK' && trys < maxTrys){
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
         
         // Build and send move request to the last node.
         const req = {
           req       : 'lastNodeMoveTo',
           dropIp    : ip,
           newRTab   : dropRTab
         }
         console.error('MkyRouting.sendMoveRequestToLastNode():: lastNodeMoveTo::request looks like this',req);

         // update my child nodes before sending move request
         this.updateMyChildNodes(ip,nbr,lnodeIp,5);

         // Start Check Status of Lastnode
         var mres = await this.getLastNodeStatus(lnodeIp,req);
         console.error('MkyRouting.sendMoveRequestToLastNode():: lastNodeBecome::',mres);
         lnStatus = mres.status;
         this.r.lastNode = mres.newLastIp;
         trys++;

         if (!lnStatus){
           await sleep(1000);
           holdLastNodeNbr = this.r.lnode;
           lnodeIp = mres.newLastIp;
         }
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
   lastNodeBecome(lastNodeIp,dropRTab,dropIp){
     return new Promise(async(resolve,reject)=>{
       var lnStatus = null;
       var trys     = 0;
       let maxTrys  = 5;

       while (lnStatus != 'moveOK' && trys < maxTrys){
         // Build and send move request to the last node.
         const req = {
           req       : 'lastNodeMoveTo',
           dropIp    : dropIp,
           newRTab   : dropRTab
         }
         // Start Check Status of Lastnode
         var mres = await this.getLastNodeStatus(lastNodeIp,req);
         console.error('MkyRouting.lastNodeBecome()::',mres);
         lnStatus = mres.status;
         trys++;
         if (!lnStatus){
           await sleep(1000);
           resolve(null);
           return;
         }
       }
       resolve(mres.newLastIp);
     });
   }
   getLastNodeStatus(ip,req){
     return new Promise((resolve,reject)=>{
       //create error and reply listeners
       var errListener = null;
       var repListener = null;
       this.net.on('xhrFail',errListener = (j)=>{
         if (j.remIp == ip && j.req == 'lastNodeMoveTo'){
           this.net.removeListener('xhrFail', errListener);
           this.net.removeListener('peerTReply', repListener);
           resolve(null);
         }
       });
       this.net.on('peerTReply',repListener  = (j)=>{
         if (j.moveResult && j.remIp == ip){
           resolve (j.moveResult);
           this.net.removeListener('xhrFail', errListener);
           this.net.removeListener('peerTReply', repListener);
           resolve(null);
         }
       });
       this.net.sendMsgCX(ip,req);
       console.error('MkyRouting.getLastNodeStatus():: Request Sent To:',ip);
     });
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
     if (this.status == 'moving'){
       var reply = {
         moveResult : {
           targetIP : j.dropIp,
           time     : Date.now(),
           status   : 'moving'
         }
       };
       this.net.sendReplyCX(j.remIp,reply);
       return;
     }
     if (this.r == 'na'){
       console.error('MkyRouting.lastNodeMoveTo():: CRITICALL:: this.r is na!',);
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
     }
 
     console.error('I am Now:',this.r);
     if (this.r !== 'na'){
       this.r.lnStatus = 'OK';
     }
     var reply = {
       moveResult : {
         targetIP : j.dropIp,
         time     : Date.now(),
         status   : 'moveOK',
         newLastIp: newLastNodeIp 
       }
     };
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
   procJoinQue(){
     //console.error('procJoinQue::');
     if (this.joinQue.length){
       var req = this.joinQue[0];
       this.joinQue.shift();
       this.handleJoins(req.jIp,req.j);
     }
     const jqTime = setTimeout( ()=>{
        this.procJoinQue();
     },1000);
   }
   async handleJoins(remIp,j){
     console.error('handleJoins()::start:',remIp,this.joinQue,j);
 
     var joinFailed   = null;
     const saveState = this.saveState();
     const reqId     = j.reqId;
     var rollbck     = null;

     // Check If The Node Is Busy. If yes que the join request.
 
     if (this.startJoin || this.err){    
       if (this.startJoin != remIp){
         this.joinQue.push({jIp:remIp,j:j,status:"waiting"});
         this.net.endResCX(remIp,`{"addResult":"reJoinQued","reqId":"${reqId}"}`);
         return;
       }
     }

     // Set A timeout for the join operation.

     const joinTime = setTimeout( async ()=>{
       console.error('MkyRouting.handleJoins():: join timeout',remIp);
       this.net.endResCX(remIp,`{"addResult":"timedOut","reqId:"${reqId}"}`);
       rollbck = await this.restoreState(saveState,reqId);
       this.startJoin = false;
       joinFailed     = true;
       if (!rollbck) {this.net.setNodeBackToStartup('Join Rollbck Failed:timeout');}
     },8000);

     this.startJoin = remIp;
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
       clearTimeout(joinTime);
     }
     else {
       console.error('MkyRouting.handleJoins():: Node Not Added');
       // Rollback any changes here.
       rollbck = await this.restoreState(saveState,reqId);
       
       this.net.endResCX(remIp,JSON.stringify({addResult : 'Node Not Added', why : addRes,reqId:reqId}));
       this.startJoin = false;
       if (!rollbck) {this.net.setNodeBackToStartup(`Join Rollbck Failed on: addRes: ${addRes}`);}
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
         if (j.bcast.msg.newNode && j.bcast.msg.reqId == reqId){
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
           resolve(true);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
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
     return new Promise((resolve,reject)=>{
       var rtListen = null;
       var rtLFail  = null;
       const reqId = crypto.randomUUID();

       const gtime = setTimeout( ()=>{
         console.error('MkyRouting.myHealthCheck():: timeout');
         this.net.removeListener('peerTReply', rtListen);
         this.net.removeListener('xhrFail', rtLFail);
         resolve(null);
       },2800);

       this.net.on('peerTReply', rtListen = (j)=>{
         if (j.myHealthCheckReply && j.reqId == reqId){
           console.error('MkyRouting. myHealthCheck():: Reply:',j);
           clearTimeout(gtime);
           resolve(true);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });

       this.net.on('xhrFail', rtLFail = (j)=>{
         if (j.myHealthCheck && j.reqId == reqId){
         console.error('MkyRouting.myHealthCheck():: FailOnxhr:',j);
         clearTimeout(gtime);
           resolve(false);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
       this.net.sendMsgCX(this.r.rootNodeIp,{req : "myHealthCheck", reqId : reqId});
     }); 
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
     });}
   // ********************************
   // Handler for incoming http request
   // ================================   
   async handleReq(remIp,j){
     //console.error(`MkyRouting.handleReq():: got req `,j);
     var dropTimer = null;
     this.net.resetErrorsCnt(j.remIp);
     if (j.req == 'joinReq'){
       console.error ('MkyRouting.handleReq():: Starting:qued',remIp,j);
       this.joinQue.push({jIp:remIp,j:j,status:'waiting'});
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
     if (j.req == 'sendNodeData'){
       if (this.status == 'online' || this.status == 'root'){
         const qres = {
           sendNodeDataResult : {
             ip   : this.myIp,
             rtab : this.r
           }
         }
         this.net.endResCX(remIp,JSON.stringify(qres));
       }
       else {
         this.net.endResCX(remIp,`{"sendNodeDataResult":"offline","status":${this.status},"error":${this.err}}`);
       }
       return true;
     }
     if (j.req == 'whoIsRoot?'){
       if ((this.status == 'online' || this.status == 'root')) {
         let healthy = true;
         if (this.myIp != this.r.rootNodeIp){
           healthy = await this.myHealthCheck();
         } 
         if (healthy){
           const qres = {
             whoIsRootReply : {
               rip      : this.r.rootNodeIp,
               maxPeers : this.net.maxPeers,
               reportBy : this.myIp,
               rtab     : this.r
             }
           } 
           this.net.endResCX(remIp,JSON.stringify(qres)); 
           return true;
         }
         
         console.error('MkyRouting.handleReq():: myHealthCheck failed... shutting down\n',j);
         this.net.endResCX(remIp,JSON.stringify({whoIsRootReply:'deadnode'}));
         this.net.setNodeBackToStartup('whoIsRootFailed HealthCheck');
         return true;
       }
       this.net.endResCX(remIp,'{"whoIsRootReply":"notready"}');
       return true;
     }
     if (j.req == 'myHealthCheck'){
       console.error(`MkyRouting.handleReq():: myHealthCheck reply is: {"myHealthCheckReply":"OK","reqId":"${j.reqId}"} to is: ${remIp}`);
       this.net.endResCX(remIp,`{"myHealthCheckReply":"OK","reqId":"${j.reqId}"}`);
       return true;
     }
     if (j.req == 'pRouteUpdate'){
       this.updatePeerRouting(j);
       this.net.endResCX(remIp,'{"result":"OK"}');
       return true;
     }
     if (j.req == 'addMeToYourRight'){
       console.error(`MkyRouting.handleReq():: Got addMeToYourRight `,j);
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
     if (j.req == 'nextParentAddChildIp'){
       console.error('MkyRouting.handleReq():: Got Request:ReplyTO '+remIp,j);
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
       }
       if (this.r.myNodes.length == this.net.maxPeers){
         console.error('MkyRouting.handleReq():: ',remIp,'{"resultNextParentAddChildIp":"'+this.r.rightNode+'"}');
         this.net.endResCX(remIp,'{"resultNextParentAddChildIp":"'+this.r.rightNode+'"}');
       }
       else {
         console.error(remIp,'{"resultNextParentAddChildIp":"'+this.myIp+'"}');
         this.net.endResCX(remIp,'{"resultNextParentAddChildIp":"'+this.myIp+'"}');
       }
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
       console.error('MkyRouting.processMyJoinResponse():: Processing\n', j,'\n');
       const reqId = j.reqId;

       if ( j.addResult == 'Node Not Added'
         || j.addResult == 'timedOut'){
         this.joinReqFails ++;
         console.error('MkyRouting.processMyJoinResponse():: JOINREQFAILS is now::\n',this.joinReqFails,'\n');
         if (this.joinReqFails > 1 && 1 == 2)
           this.becomeRoot();
         else
           this.net.setNodeBackToStartup('my join request failed');
         resolve(false);
         return;
       }
       if (j.addResult == 'reJoinQued'){
         console.error('MkyRouting.processMyJoinResponse():: Join Request Qued And Waiting');
         resolve('wait');     
         return;
       }

       console.error(`MkyRouting.processMyJoinResponse():: addResult for reqId: ${j.reqId}\n`,j.newNode,{req : "addMeToYourRight", ip : this.myIp,nbr : j.newNode.lnode},'\n');
       this.r.ptreeId = j.ptreeId;
       var myLeft = j.newNode.leftNode;
       if (myLeft == this.myIp){
           console.error('MkyRouting.processMyJoinResponse():: MyLeft Is ME!!!! major errror ::: ',myLeft);
           resolve(false);
           return;
       }
       console.error(`MkyRouting.processMyJoinResponse():: to IP = ${myLeft} : myIp ${this.myIp} : myNbr ${j.newNode.lnode}`); 
       this.net.sendMsgCX(myLeft,{req : "addMeToYourRight", ip : this.myIp,nbr : j.newNode.lnode, reqId : reqId});
       const addMeRight = await this.resultAddMeRight(reqId);
       if (!addMeRight){
         this.net.setNodeBackToStartup('my join request failed on resultAddMeRight.');
         resolve(true);
         return;
       }

       this.r.leftNode = myLeft;
       this.r.rightNode = null;
       this.r = j.newNode;
       this.r.myNodes = [];
       this.r.nodeNbr = this.r.lnode;
       this.newNode = null;
       this.status = 'online';

       const reply = {resultFromJoin : 'Thanks',reqId : reqId};
       this.net.endResCX(this.r.rootNodeIp,JSON.stringify(reply));
       resolve(true);
     });
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
           console.error('MkyRouting.resultAddMeRight():: Reply:\n',j,'\n');
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
     if (j.msg.whoHasNodeIp){
       this.responseWhoHasNodeIp(j.remIp,j.msg.whoHasNodeIp);	     
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
       var fres = false;
       this.r.myNodes.forEach((child)=>{
         if (child.ip == j.msg.findWhoHasChild.ip){
           fres = true;
         }
       });
       if (fres){
         this.net.sendMsgCX(j.remIp,{resultWhoHasChild:this.myIp});
       }
       return true;
     }
     return false;
   }
   // ********************************************************************
   // Handle undelivered http request from offline or slow to respond peers
   // ====================================================================
   async handleError(j){
     if (!(this.status == 'root' || this.status == 'online')){
       console.error(`MkyRouting.handleError():: Ignore Error Handling: staus is: ${this.status}`);
       return;
     } 
     console.error(`MkyRouting.handleError():: START: this.err is ${this.err} node status: `+this.status+'\n',this.net.formatMsg(j));

     if (!j.hasOwnProperty('xhrError')) {
       console.error('MkyRouting.handleError():: FATAL_MSG_ERROR::XhrCodeNotSet',j);
       this.net.setContactsStatusTo(j.toHost,'notSet');
       return;
     }
     if (srvFatal.includes(j.xhrError)) {
       console.error('MkyRouting.handleError():: FATAL_MSG_ERROR::',j);
     } 
     if (!srvBusy.includes(j.xhrError)) {
       console.error('MkyRouting.handleError():: FATAL_MSG_ERROR_srvBusy::InvalidXhrCode',j);
     }

     this.net.setContactsStatusTo(j.toHost,j.xhrError);

     if (this.status == 'startup' || this.status == 'offline'){
       console.error('MkyRouting.handleError():: handleError::is in Startup mode:',j.req);
       return true;
     }
     if (j.xhrError == 523){
       //console.error('MkyRouting.handleError():: xhrError 523: multiple branches detected... Going to restart mode');
       //this.net.setNodeBackToStartup('Its Me Error:xhrError 523');
       //return;
     }
     if (j.req == 'bcast'){
       console.error('MkyRouting.handleError():: handleError::got bcast, re-routing:',j.msg);
       this.routePastNode(j);
       return true;
     }

     if (!this.err){ //this.node.isError(j.toHost)){
       this.net.incErrorsCnt(j.toHost);
       if (this.net.getNodesErrorCnt(j.toHost) > maxNetErrors && !this.startJoin && !this.err){
         console.error(`MkyRouting.handleError():: Err Count Exceeded max ${maxNetErrors} errros`,j.toHost);
      
         const myStat = await this.net.checkInternet();
         console.error('MkyRouting.handleError():: MyStat',myStat);
         if (!myStat){
           console.error('MkyRouting.handleError():: Its Me... Going to restart mode');
           this.net.setNodeBackToStartup('Its Me Errror');
           return;
         }
         // Only Parent Nodes Can Drop A Node.
         if (this.notMyNode(j.toHost)){
           console.error('MkyRouting.handleError():: Not My Node To Drop::',j.toHost);
	   return;
         }
         if (this.dropIps.includes(j.toHost)){
           console.error('MkyRouting.handleError():: Node Aready Dropped:',j.toHost);
           return;
         }

         this.err = true; 
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
         // Set Timeout for drop operation.
         this.eTime = setTimeout( ()=>{
           console.error('MkyRouting.handleError():: Drop Time Out',this.net.formatMsg(j));
           this.notifyRootDropComplete();
           this.err = false; //this.node.clearError(j.toHost);
         },6500);

         // Get nodeNbr of the node to drop.
         const nbr = this.inMyNodesList(j.toHost); 
         console.error('MkyRouting.handleError():: inMyNodesList::retured',nbr);
         if(nbr){
           console.error('MkyRouting.handleError():: await this.sendMoveRequestToLastNode(',j.toHost,nbr,')');
           var nIp = await this.sendMoveRequestToLastNode(j.toHost,nbr);
           console.error('MkyRouting.handleError():: nIp is now',nIp);

           // If nIp is null move opperation is completed.
           if(!nIp){
             this.err = false; //this.node.clearError(j.toHost);
             this.notifyRootDropComplete();
             console.error(`MkyRouting.handleError():: node removed ${nIp} setting this.err to: ${this.err}`);
             clearTimeout(this.eTime);
           }
         }
       }
       else { 
         if (this.net.checkExpire(j.msgTime,60*1000)){
           console.error('MkyRouting.handleError():: message expired dropping:: ',this.net.formatMsg(j));
         }
         else {
           if (!j.hasOwnProperty('ping')) {
             if (j.req != 'whoIsRoot?' && j.req != 'addMeToYourRight'){
               console.error('MkyRouting.handleError():: re-queing errored message',this.net.formatMsg(j));
               this.net.queMsg(j);
             }
           }
         }
       } 
       return true;
     }
     console.error('MkyRouting.handleError():: InDrop Mode:',j.toHost);
     return false;
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
// *********************************************************
// CLASS: gPowQue
// A Proof of work class Que Managerk.
//
class gPowQue {
   constructor(){
     this.POWnodes = [];
   }
   push(ip,work,diff){
     var node = {
       ip   : ip,
       work : work,
       diff : diff
     }
     if (this.inList(ip) === null) {
       this.POWnodes.push(node);
     }
     return this.pop();
   }
   remove(ip){
     var breakFor = {};
     try {
       this.POWnodes.forEach( (n, index, object)=>{
         if (n.ip == ip){
           object.splice(index,1)
           console.error("gPowQue.remove():: Job IP Removed:",ip);
         }
       });
     }
     catch(e){}
   }
   inList(ip){
     var isIn = null;
     var breakFor = {};
     try {
       this.POWnodes.forEach( (n)=>{
         if (n.ip == ip){
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
  async doPow(difficulty,work,remIP) {
    console.error('gPowKey.doPow():: Doing POW for:',remIP);
    var work = this.que.push(remIP,work,difficulty);
    while(work){
      console.error('While Working');
      this.work = work.work;
      this.remIP = work.ip;
      this.isMining = true;
      this.stopMining = false;
      this.repeatHash(work.diff);
      work = this.que.pop();
    }
  }
  doStop(remIP){
    console.error('gPowKey.doStop():: Do Stop Initiated:'+this.remIP+'|',remIP);
    if (this.remIP == remIP){
      console.error('gPowKey.doStop():: OPTION STOPPING:'+this.remIP+'|',remIP);
      this.stopMining = true;
    }
    else {
      console.error('gPowKey.doStop():: OPTION REMOVE FROM QUE:'+this.remIP+'|',remIP);
      this.que.remove(remIP);
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
          req : 'pNodeListGenIP',
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
/*
class gPowKey {
  constructor(myIP,net) {
    this.net     = net;
    this.nonce   = 0;
    this.hash    = "";
    this.ip      = myIP;
    this.remIP   = null;
    console.error('GPow Started:',this.ip);
    console.error('GPow Net: XXXXX');
    this.isMining = false;
    this.stopMining = null;
  }
  async doPow(difficulty,work,remIP) {
    console.error('Doing POW for:',remIP);
    this.work = work;
    this.remIP = remIP;
    this.isMining = true;
    this.stopMining = false;
    this.repeatHash(difficulty);
  }
  doStop(){
    this.stopMining = true;
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
        console.error('stop intiated:');
      }
      else {
        var timeout = setTimeout( ()=>{this.repeatHash(difficulty);},1);
      }
    }
    else {
      this.stopMining = false;
      this.isMining = false;
      var qres = {
        req : 'pNodeListGenIP',
        work  : this.work,
        nonce : this.nonce,
        hash  : this.hash
      }
      console.error('Nonce: ',this.nonce);
      console.error('Work: ',this.work);
      console.error(this.ip,this.hash);
      this.net.sendReply(this.remIP,qres);
    }
  }
}
*/
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
      this.borgIOSkey='default';
      this.nodeType  = 'router';
      this.pulseRate = defPulse;	   
      this.maxPeers = maxPeers;
      this.rootIp   = null;
      this.isRoot   = false;
      this.peerMUID = null;
      this.server   = null;
      this.port     = port;
      this.wmon     = wmon;
      this.options  = options;
      this.PTnodes  = [];
      this.msgQue   = [];
      this.rQue     = [];
      this.msgMgr   = new MkyMsgQMgr();
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
         const rstart = Math.floor(Math.random() * (35000 - 20000 + 1)) + 20000;
         const rsleep = Math.floor(Math.random() * (10000 - 500 + 1)) + 500;
         var nstats = null;
         try {
           nstats = fs.statSync(this.nodesFile);
           let dNow  = Date.now();
           let dDiff = Date.now() - nstats.atimeMs;
           if (dDiff < rstart){
             console.error('PeerTreeNet.readNodeFile():: restart detected::waiting',rsleep);
             console.error("PeerTreeNet.readNodeFile():: type of:",typeof nstats.atimeMs);
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
       var jSaver = null;
       res.setHeader('Connection', 'close');
       let svtime = setTimeout( ()=>{
         console.error('PeerTreeNet.startServer():: Server Response Timeout:'+sRemIp+req.url,jSaver);
         res.setHeader('Content-Type', 'application/json');
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
                     console.error('startServer()::node list saved to disk!\n',myNodes);
                   });
                 }
                 else {}
               });

               var j = null;
               try {
                 //console.time('Time Taken');
                 try {j = JSON.parse(body);jSaver = j;}
                 catch(err) {
                   throw {error:520,msg:'Invalid JSON Req'};
                   console.error('startServer()::\n',err);
                   jSaver = body;
                 } 
                 if (j.hasOwnProperty('msg') === false) 
                   throw {error:521,msg:'invalid netREQ no msg body found'};

                 if(this.rnet.status != 'online' && this.rnet.status != 'root'){
                   //console.error(`PeerTreeNet.startServer():: request error 522 this.rnet.status ${this.rnet.status}`);
                   throw {error:522,msg:'req mode is offline only :: joins can be accepted'};
                 }
  	         if (!j.msg.remIp) j.msg.remIp = sRemIp;
                 clearTimeout(svtime);
                 
                 if (j.msg.hasOwnProperty('PNETCOREX') === false){
                   if (j.msg.ptreeId != this.rnet.r.ptreeId) {
                     throw {error:523,msg:'req mode ptreeId check failed :: msg rejected'};
                   }
                   this.emit('mkyReq',sRemIp,j.msg);
		 } 
	  	 else {
                   if (j.msg.ptreeId != this.rnet.r.ptreeId && j.msg.req != 'joinReq' && j.msg.req != 'whoIsRoot?') {
                     throw {error:523,msg:'req mode ptreeId check failed :: only joins req can be accepted'};
                   }
                   this.emit('peerTReq',sRemIp,j.msg);
	  	 }
                 res.statusCode = 200;
                 res.end('{"netPOST":"OK"}');
                 //console.timeEnd('Time Taken');
               }
               catch (err) {
                 if (err.error != 522){
	           //console.error(`PeerTreeNet.startServer():: POST netREQ from: ${sRemIp} Error: `,err);
                   //console.error('PeerTreeNet.startServer():: POST msg was ->\n',body);
                 }
                 clearTimeout(svtime);
                 res.statusCode = err.error;
                 res.end('{"netPOST":"FAIL","type":"netREQ","Error":"'+err+'","data":"'+body+'"}');
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
                     throw {error:550,msg:"netREPLY JSON error"};
                     console.error('PeerTreeNet.startServer():: error:\n',err);
                   }
                  
                   if (j.hasOwnProperty('msg') === false) 
                     throw {error:551,msg:'invalid netREPLY no msg body found'};

                   // if offline mode check for addResults only.
                   if(this.rnet.status != 'online' && this.rnet.status != 'root'){
                     if (!(j.msg.hasOwnProperty('addResult')
                        || j.msg.hasOwnProperty('resultAddMeRight') 
                        || j.msg.hasOwnProperty('whoIsRootReply'))){
                       //console.error('PeerTreeNet.startServer():: NETReply::Offline Reject:',this.rnet.status,j);
                       throw {error:552,msg:'mode is offline only addResult,resultAddMeRight, or whoIsRootReply can be accepted'};
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
                   res.statusCode = err.error;
                   res.end('{"netPOST":"FAIL","type":"netREPLY","Error":"'+err+'","data":"'+body+'"}');
                   if (err.error != 552){
                     //console.error('PeerTreeNet.startServer():: POST netREPLY Error:\n',err);
                     //console.error('PeerTreeNet.startServer():: POST msg was ->\n',j);
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
          tstamp       : Date.now()
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
            const pTime = Date.now() - grpPing.tstamp;
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
      //console.error('PeerTreeNet.heartBeat():: starting heartBeat:',this.rnet.status,this.rnet.err,this.rnet.r.lnStatus);
      if(this.rnet.err){
        console.error('PeerTreeNet.heartBeat():: lnStatusMoving::ping blocked');
        let to = setTimeout( ()=>{this.heartBeat();},this.pulseRate);
        return;
      }
      if(this.rnet && (this.rnet.status == 'online' || this.rnet.status == 'root') && !this.rnet.err){
        var hrtbeat = {
          pings    : [],
          myStatus : 'OK',
          tstamp   : Date.now()
        };
	var hListener = null;
        var rListener = null;
        this.on('xhrFail',hListener = (j)=>{
          if (j.ping){
            console.error('PeerTreeNet.heartBeat():: pingFail',j);
            const peer = this.heartbIndexOf(hrtbeat.pings,j.remIp);
            if (peer !== null){
              hrtbeat.pings[peer].pRes = 'dead';
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
              this.updateChildRTab(j.remIp,j.rtab);
            }

            const pTime = Date.now() - hrtbeat.tstamp;
            const peer = this.heartbIndexOf(hrtbeat.pings,j.remIp);
            if (peer !== null){
              hrtbeat.pings[peer].pRes = j.pingResult;
              hrtbeat.pings[peer].pTime = pTime;
              hrtbeat.pings[peer].pStatus = j.nodeStatus;
              hrtbeat.pings[peer].pIp = j.remIp;
            }
          }
        });
         
        const hTimer = setTimeout(async ()=>{
          this.removeListener('peerTReply', rListener);
          this.removeListener('xhrFail', hListener);
          hrtbeat.myStatus = await this.reviewMyStatus(hrtbeat);
	  //console.error('PeerTreeNet.heartBeat():: Done:',hrtbeat);
        },this.pulseRate - 900);

	// Ping Parent Node
        if (this.rnet.r.myParent){
          hrtbeat.pings.push({pIP:this.rnet.r.myParent,pType:'myParent',pRes : null});
	  this.sendMsgCX(this.rnet.r.myParent,{ping : "hello",action : "checkMyStatus",myStatus: this.rnet.status});
        }
        // Ping My Child Nodes
        if(this.rnet.r.myNodes)
          for (var node of this.rnet.r.myNodes){
            hrtbeat.pings.push({pIP:node.ip,pType:'myNodes',pRes : null});
            this.sendMsgCX(node.ip,{ping : "hello",myStatus: this.rnet.status});
          }
            
        // Last Node Ping Root Node.
        if (this.rnet.r.nodeNbr == this.rnet.r.lnode && this.rnet.r.nodeNbr != 1 && !this.hbeatIncludes(hrtbeat.pings,this.rnet.r.rootNodeIp)){
          console.error('PeerTreeNet.heartBeat():: last node ping root:',this.rnet.status,`rnet.r.lnode is: ${this.rnet.r.lnode}`);
          hrtbeat.pings.push({pIP:this.rnet.r.rootNodeIp,pType: 'lastToRoot',pRes : null});
          this.sendMsgCX(this.rnet.r.rootNodeIp,{ping : "hello",myStatus: this.rnet.status});
        }
      
        // Ping Left Node.
        if (this.rnet.r.leftNode && !this.hbeatIncludes(hrtbeat.pings,this.rnet.r.leftNode)){
          hrtbeat.pings.push({pIP:this.rnet.r.leftNode,pType: 'pingLeft',pRes : null});
          this.sendMsgCX(this.rnet.r.leftNode,{ping : "hello",myStatus: this.rnet.status});
        }
        // Ping Right Node.
        if (this.rnet.r.rightNode && !this.hbeatIncludes(hrtbeat.pings,this.rnet.r.rightNode)){
          hrtbeat.pings.push({pIP:this.rnet.r.rightNode,pType: 'pingRight',pRes : null});
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
            console.error('PeerTreeNet.heartBeat():: lowering pulse rate to 15000!');
            this.pulseRate = 15000;
          }
        }
      }
      else {
        //console.error('PeerTreeNet.heartBeat():: Skipping',this.rnet.err,this.rnet.status);
      }
      var timeout = setTimeout( ()=>{this.heartBeat();},this.pulseRate);
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
    r.rootRTab = 'na';
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
        console.error('PeerTreeNet.reviewMyStatus():: heartBeat::reviewMyStatus: '+nFails,hbeat.pings.length);
        hbeat.myStatus = 'imOffline';
        if (!(this.rnet.r.nodeNbr == 1 || this.rnet.r.nodeNbr == 2)) {
          this.setNodeBackToStartup('I Appear To be Offline');
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
  async setNodeBackToStartup(msg='noMsg'){
    console.error('PeerTreeNet.setNodeBackToStartup():: Node Appears offline msg is: ' + msg,this.rnet.r);
    this.rnet.status = 'offline';
    this.resetErrorsCntAll();

    this.coldStart = false;
    console.error('PeerTreeNet.setNodeBackToStartup():: Setting Status', this.rnet.status);
    this.rnet.newNode    = null;
    this.rnet.err        = null;
    this.rnet.eTime      = null;
    this.rnet.startJoin  = null;
    this.rnet.joinQue    = [];
    this.dropIps         = [];
    this.rootMap         = new Map();

    this.rnet.r = {
      rootNodeIp : this.rnet.myIp,   // Top of the network.
      rootRTab   : 'na',
      myNodes    : [],   // forwarding ips for each nodes peers group.
      lastNode   : this.rnet.myIp,
      leftNode   : null,
      rightNode  : null,
      nextParent : null,
      myParent   : null,
      mylayer    : 1,
      nodeNbr    : 0,    // node sequence number 1,2,3 ... n
      nlayer     : 1,    // nlayers in the network 1,2,3 ... n
      lnode      : 1,    // number of the last node in.
      lnStatus   : 'OK' 
    }
    if (msg == 'my join request Timeout'){
      this.rnet.becomeRoot();
      return;
    }
    if (this.waitForNetTimer){
      clearTimeout(this.waitForNetTime);
    }
    setTimeout(()=>{this.waitForInternet();},20*1000);
  }
  async waitForInternet(){
    var isAvail = await this.checkInternet();
    console.error('PeerTreeNet.waitForInternet():: isAvail:',isAvail);
    if (isAvail){
      if (this.rnet.status == 'tryJoining'){
        return;
      }
      this.rnet.status = 'tryJoining';
      console.error('PeerTreeNet.waitForInternet():: trying to join: ',this.rnet.status);

      while(isAvail && this.rnet.status == 'tryJoining'){
        console.error('PeerTreeNet.waitForInternet():: trying to join');
        let joinRes = await this.rnet.init();
        if (joinRes) return;
        if (this.rnet.status == 'tryJoining'){
          this.rnet.status = 'offline';
          await sleep(10*1000);
          if (this.rnet.status == 'offline'){
            this.rnet.status = 'tryJoining';
          }
          isAvail = await this.checkInternet();
        }
        else {return;}
      }
    }
    if (!(this.rnet.status == 'online' || this.rnet.status == 'root')){
      this.waitForNetTimer = setTimeout(()=>{this.waitForInternet();},20*1000);
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
       console.error('PeerTreeNet.formatMsg():: req not defined full message is \n',msg);
     }
     return 'MSG: req:'+msg.req+',time:'+msg.msgTime+",toHost:"+msg.toHost+",xhrError:"+msg.xhrError;
  }
  processMsgQue(){
     if (this.msgQue.length){
       const msg = this.msgQue[0];
       this.msgQue.shift();
       this.msgMgr.remove(msg.toHost);
       console.error('PeerTreeNet.processMsgQue():: Sending Message from que -> ',this.formatMsg(msg));
       this.sendMsgCX(msg.toHost,msg);
     }
     var qtime = setTimeout( ()=>{
       this.processMsgQue();
      },500);
  }
  queMsg(msg){
     console.error('PeerTreeNet.queMsg():: Msg Log Counter: ',this.msgMgr.count(msg));
     if (this.msgMgr.count(msg.toHost) < 20){
       //console.error('PeerTreeNet.queMsg():: pushing msg:',msg);
       this.msgQue.push(msg);
       this.msgMgr.add(msg.toHost);
       return true;
     }
     else 
       return false; //this.abandonNode(msg.toHost)
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

     if (this.rnet.simulation){
       console.error('PeerTreeNet.sendPostRequest():: outage simulation send failure',toHost);
       this.emit('xhrFail',msg);
       return;
     }
 
     const https = require('https');

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
         this.emit('xhrFail',msg);
       }
     });

     req.on("timeout", () => {
       if (emitError === null){
          emitError    = true;
          msg.toHost   = toHost;
          msg.endpoint = options.path;
          msg.xhrError = 'xTime';
          this.emit('xhrFail',msg);
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
        if (error.code === 'ETIMEDOUT') {
          msg.xhrError = 'xTime';
        }
        this.emit('xhrFail',msg);
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
       console.error('PeerTreeNet.removeNode():: node list saved to disk!',myNodes);
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
     console.error('PeerTreeNet.pushToContacts():: New Network Node Joined: ',newip);
     this.PTnodes.push(newip);
     const myNodes = this.PTnodes;
     fs.writeFile(this.nodesFile, JSON.stringify(myNodes), function (err) {
       if (err) throw err;
       console.error('PeerTreeNet.pushToContacts():: node list saved to disk!',myNodes);
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
        //console.error("PeerTreeNet.pruneContacts():: pruned node list saved to disk!", this.PTnodes);
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
     
     this.on('xhrFail',(j)=>{
       //console.error('xhrFail handler:',j);
       if (this.rnet.handleError(j))
         return;
     });
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
