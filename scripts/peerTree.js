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
var rootIp = process.argv[2];
var isRoot = process.argv[3];

var defPulse = 2500;

console.log('IsRoot:->',isRoot);
if (!isRoot){
  isRoot = null;
}

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

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
     this.ipListener = null;
     this.lnListener = null;
     //this.node       = new MkyErrorMgr();
     this.err        = null;
     this.eTime      = null;
     this.status     = 'startup'
     this.startJoin  = null;
     this.joinTime   = null;
     this.joinQue    = [];
     this.dropIps    = [];
     this.r = {
       rootNodeIp : myIp,   // Top of the network routing table plus each nodes peer group.
       rootRTab   : 'na',
       myNodes    : [],   // forwarding ips for each nodes peers group.
       lastNode   : myIp,
       leftNode   : null,
       rightNode  : null,
       myParent   : null,
       nextParent : null,
       mylayer    : 1,
       nodeNbr    : 0,    // node sequence number 1,2,3 ... n
       nlayer     : 1,    // nlayers in the network 1,2,3 ... n
       lnode      : 1,    // number of the last node in.
       lnStatus   : 'OK'  // used for routing updates. 'OK' or 'moving'
     }
   }
   routingReady(){
     return new Promise( async (resolve,reject)=>{
       await this.init();
       resolve(true);
     });
   }
   // ********************************************************************
   // Search any previously known nodes and request the whoIsRoot response.
   // =====================================================================
   findWhoIsRoot(i=0){
     this.rootFound = null;
     return new Promise( async (resolve,reject)=>{
       var jroot = null;
       while (!this.rootFound && i < this.net.nodes.length){
         jroot = await this.whoIsRoot(this.net.nodes[i++].ip);
         console.log('jroot is ',jroot);         
       }
       resolve(this.rootFound); 
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
         console.log('who is root timeout', ip);
         this.net.removeListener('peerTReply', rtListen);
         this.net.removeListener('xhrFail', rtLFail);
         resolve(null);
       },500);

       this.net.on('peerTReply', rtListen = (j)=>{
         if (j.whoIsRootReply){
           clearTimeout(gtime);
           if (j.whoIsRootReply == 'notready')
             resolve(null);
           else {
             this.rootFound = j.whoIsRootReply;
             console.log('this.rootFound',this.rootFound);
             resolve(j.whoIsRootReply);
           }
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
       this.net.on('xhrFail', rtLFail = (j)=>{
         if (j.req == 'whoIsRoot?'){
           clearTimeout(gtime);
           if (this.rootFound)
             resolve(this.rootFound);
           else
             resolve (null);
           this.net.removeListener('peerTReply', rtListen);
           this.net.removeListener('xhrFail', rtLFail);
         }
       });
  
       const req = {
         req  : 'whoIsRoot?'
       }
       console.log('sending mesage to'+ip,req);
       this.net.sendMsgCX(ip,req);
     });
   }
   // ***********************************************
   // Notify Root That A Node Is Dropping
   // ===============================================
   notifyRootDropingNode(node){
     if (node == this.r.rootNodeIp){
       return;
     }
     //*check to see if myIp is the root node.
     if (this.myIp != this.r.rootNodeIp && node != this.net.getNetRootIp()){
       const req = {
         req  : 'rootStatusDropNode',
         node : node
       }
       this.net.sendMsgCX(this.net.getNetRootIp(),req);
     }
     else {
       console.log('notifyRootDropingNode::Root is Is Root set join que block');
       this.startJoin = 'waitForDrop';
     }
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
       console.log('notifyRootDropingNode::Root is Is Root: Clearing Wait For Drop');
       this.clearWaitForDrop();
     }
   }
   clearWaitForDrop(){
     if (this.startJoin == 'waitForDrop')
       console.log('WaitForDrop::cleared');
       this.startJoin = null;
   }
   // ****************************************************
   // handles directly the first 2*maxPees peers to joing
   // ====================================================
   async addNewNodeReq(ip){
     return new Promise(async(resolve,reject)=>{
       console.log('Add by REQUESST');
       if (this.inMyNodesList(ip)){
         resolve(false);
         return;
       }

       const oldLastNodeIp = this.r.lastNode;
       this.r.nextPNbr = this.getMyParentNbr(this.r.lnode+1);
       console.log('NextPNbr::',this.r.nextPNbr);

       if ( this.r.myNodes.length < this.net.maxPeers){
         var node = {ip : ip,nbr : this.r.lnode+1, pgroup : [],rtab : 'na'}
         this.r.myNodes.push(node);
         this.incCounters();
         this.updateRootRoutingTable();
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
         console.log('Updating NextParent To: ',this.r.rightNode);
         this.r.nextParent = this.r.rightNode;
       }

       this.incCounters();
       var prevNextParent = this.r.nextParent;
       var nextParent = await this.getNodeIpByNbr(this.r.nextPNbr);
       this.r.nextParent = nextParent;
       await this.nextParentAddChild(ip,this.r.lnode);

       this.r.lastNode = ip;
       if (this.r.lnode == 2){
         this.r.rightNode = ip;
       }
       this.newNode = clone(this.r);
       this.newNode.myParent = prevNextParent;
       this.newNode.leftNode = oldLastNodeIp;
       this.newNode.rightNode = null;
       this.newNode.mylayer = this.getNthLayer(this.net.maxPeers,this.r.lnode);
       resolve(true);
       return;
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

   nextParentAddChild(ip,nbr){
     return new Promise((resolve,reject)=>{
       //create error and reply listeners
       var errListener = null;
       var repListener = null;
       this.net.on('xhrFail',errListener = (j)=>{
         if (j.remIp == ip && j.req == 'nextParentAddChildIp'){
           this.net.removeListener('xhrFail', errListener);
           this.net.removeListener('peerTReply', repListener);
           resolve(null);
         }
       });
       this.net.on('peerTReply',repListener  = (j)=>{
         if (j.resultNextParentAddChildIp){ // && j.remIp == ip){
           console.log('nextParentAddChild::gotBack:', j.resultNextParentAddChildIp);
           resolve (j.resultNextParentAddChildIp);
           this.net.removeListener('xhrFail', errListener);
           this.net.removeListener('peerTReply', repListener);
         }
       });
       var req = {req : 'nextParentAddChildIp',ip:ip,nbr:nbr};
       this.net.sendMsgCX(this.r.nextParent,req);
     });
   }
   // ***********************************************
   // update rootRouting table broadcast the update.
   // ===============================================
   updateRootRoutingTable(){
     return;
     this.bcastRootTableUpdate();
   }
   // ******************************************************
   // Handles request to add new last node
   //   - only the node with and open slot will return true.
   // ======================================================
   async lnParentAddNode(res,ip){
     console.log('Add by Parent ',ip);
     if (this.inMyNodesList(ip)){
       console.log('inMyNodesList true');
       const result = {
         lnParentNodeAdded : true,
         result            : 'already add',
         parent            : this.myIp,
       }       
       this.net.endResCX(res,JSON.stringify(result));
       return true;
     }

     if (ip == this.myIp){
       this.net.endResCX(res,'{"lnParentNodeAdded":true,"result":"Attempt To Add Self"}');
       return false;
     }

     if (this.r.myNodes.length < this.net.maxPeers){
       console.log('open slot found... adding node',ip);
       var node = {ip : ip,nbr : this.r.lnode+1,pgroup : [],rtab : 'na'}
       this.r.myNodes.push(node);
       if (this.r.mylayer == 1)
          this.updateRootRoutingTable();
       else 
         this.sendParentNewRoutes();
       this.r.lastNode = ip;

       this.incCounters();
       this.net.sendMsgCX(ip, {req : 'addedYou',info : this.r});

       console.log('adding peer mylayer is',this.r.mylayer);
       if (this.r.mylayer == 1){
         this.bcast({newNode : ip,rootUpdate : this.r.rootNodeIp});
       }
       else
         this.bcast({newNode : ip,rootUpdate : null});
       const aresult = {lnParentNodeAdded : true,result : true,parent : this.myIp};
       this.net.endResCX(res,JSON.stringify(aresult));
       return true;
     }
     const parent = await this.getNodeIpByNbr(this.r.nodeNbr +1);         
     this.net.sendMsgCX(parent,{req : "lnForwardedAddNode", ip : ip});
     console.log('FOrwarded Add By Reques addRes to',parent);

     const result = {lnParentNodeAdded : true, result : 'Forwarded', parent : parent };
     this.net.endResCX(res,JSON.stringify(result));
     return false;
   }
   // ******************************************************
   // Handles broadcasted requests to join.  
   //   - only the node with and open slot will return true.
   // ====================================================== 
   addNewNodeBCast(ip,rUpdate){
     console.log('Add by BROADCAST '+ip,rUpdate);
     this.r.mylayer = this.getMyLayer(this.net.maxPeers,this.r.nodeNbr);
     this.r.nlayer  = this.getMyLayer(this.net.maxPeers,this.r.lnode+1);

     if (this.myIp != this.r.lastNode){
       this.r.rootRTab = 'na';
     }
     if (this.startJoin){
       this.startJoin = false;
       clearTimeout(this.joinTime);
     }
     if (this.inMyNodesList(ip)){
       console.log('inMyNodesList true');
       return false;
     }

     if (ip == this.myIp){
       console.log('hey this is me:',this.status);
       return false;
     }

     if (rUpdate)
       this.r.rootNodeIp = rUpdate;

     this.r.lastNode = ip;
     this.incCounters();

     // Remove New Node Ip from dropped nodes list;
     let newNodex = this.dropIps.indexOf(ip);
     if (newNodex !== -1) {
       this.dropIps.splice(newNodex, 1);
     }  
     return false;
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
   // Send Message to parent to update their routing
   // ===============================================
   sendParentNewRoutes(){
     if (this.r.myParent){
       const req = {
         req  : 'pRouteUpdate',
         newRoute : this.r.myRoutes
       }
       this.net.sendMsgCX(this.r.myParent,req);
     } 
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
     console.log('starting dropNode',ip);
     if (this.r.lnode <= this.net.maxPeers){
       var rUpdate = false;
       this.r.rootNodes.forEach( (n, index, object)=>{
         n.pgroup.forEach( (n, index, object)=>{
           if (n.ip == ip){
             console.log('dropNode::splice pgroup: '+n.nbr,ip);
             object.splice(index,1);
             rUpdate = true;
           }
         }); 
         if (n.ip == ip){
           console.log('dropNode::splice child: '+n.nbr,ip);
           object.splice(index,1)
           rUpdate = true;
         }
       });
       if (rUpdate)
         console.log('dropNode::bcastRootUpdate ',this.r.rootNodes);
         this.bcastRootTableUpdate();
     }
     this.r.myNodes.forEach( (n, index, object)=>{
       if (n.ip == ip){
         console.log('dropping child node',ip);
         object.splice(index,1);
         if(this.r.mylayer == 1){
           console.log('dropNode::bcastRootUpdate:childNodes ',this.r.myNodes);
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
   init(){
     return new Promise(async (resolve,reject)=>{
       const rtab = await this.readNodeFile();
       var   jroot = null;
       var   rInfo = null;
       if (!rtab)
         console.log('NETWORK starting... I am new!');
       else 
         this.net.nodes = rtab;

       let tryfind = 0;
       while (tryfind < 10){
	 rInfo = await this.findWhoIsRoot();
         console.log('findingRoot:',rInfo);
	 if (rInfo == this.myIp){
           tryfind = tryfind + 1;
         }
	 else {
           tryfind = 10;
         }
       }
       if (!rInfo) 
         jroot = rootIp;
       else {
         jroot = rInfo.rip;
         this.net.rootIp = jroot;
         this.net.maxPeers = rInfo.maxPeers;
       }
       if (this.myIp != this.net.rootIp){
         const msg = {
           req : 'joinReq'
         }
         console.log("New Node Sending Join.. req");
         this.net.sendMsgCX(jroot,msg);
       }    
       else{ 
         this.r.rootNodeIp = this.myIp;
         this.r.nextParent = this.myIp;
         this.status = 'root';
         this.r.nodeNbr = 1;
         console.log("I am alone :(");
       }
       this.procJoinQue();
       resolve(true);
     });	     
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
     console.log('Sending bcast rootTabUpdate...');
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
     const bc = {
       req     : 'bcast',
       msg     : msg,
       reroute : false
     }
     console.log('bcast::Constructed ',bc);
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
     if (!msg.req == 'bcast')
       return false;

     if (this.r.myNodes)
       for (var node of this.r.myNodes){
         if (node.ip == msg.toHost){
           for (var p of node.pgroup){
             console.log('Send BCAST past node ',ip);
             this.net.sendMsgCX(p.ip,msg);
           }
         }
       }
     return true;
   }
   // *************************************************
   // Check If Ip is one of the root nodes on the network
   // =================================================
   inRootTab(ip){
     if (ip == this.r.rootNodeIp){
       return true;
     }
     return false;
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

     for (var node of this.r.myNodes){
       if (node.ip == ip)
         return node.nbr;
     }
     return false;
   }
   // *******************************************************
   // Swap routing info to replace node
   // ======================================================
   swapNodeIps(dip,rip){
     this.r.myNodes.forEach( node=>{
       if (node.ip == dip)
         node.ip = rip;
     });
   }
   // ******************************************************************
   // checks to see if the node is the parent of the node to be dropped
   // ==================================================================
   notMyNode(ip){
     // last node check
     if (this.myIp == this.r.lastNode && this.r.rootNodeIp == ip){
       console.log('Last Node Check Root Node Drop::OK',ip);
       return false;
     }
     // all other nodes check
     for (var node of this.r.myNodes)
       if (node.ip == ip)
         return false;
  
     console.log('notMyNode::true for ',ip);
     return true;
   }
   // ********************************
   // Replace Node 
   // ================================
   dropLastNode(nodes,nbr){
     console.log('start drop last node',nodes); 
     if (!nodes)
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
         console.log('spliced',nbr);
       }
     });
   }
   // ***********************************************
   // gets the peer group list from root nodes list for 
   // for the requested ip 
   // ===============================================
   getRootNodePeerGroup(ip){
     if (this.r.rootNodes)
       for (var node of this.r.rootNodes){
         if (node.ip == ip){
           return node.pgroup;
         }
       }
     return [];
   }
   // ***********************************************
   // get peer group list for node in the pgroup list
   // ===============================================
   getDropNodePeerGroup(ip){
     if (this.r.myNodes)
       for (var node of this.r.myNodes){
         if (node.ip == ip){
           return node.pgroup;
         }
       }
     return [];
   }
   // ***********************************************
   // set last node active to root settings
   // ===============================================
   becomeRoot(){
     console.log('becoming root node:replacing:'+this.myIp+'-',this.net.rootIp);
     this.r = {
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
       lnode      : 1
     }
     this.net.msgQue = [];
     this.net.msgMgr.remove(this.net.rootIp);
     this.net.rootIp = this.myIp;
     this.status = 'root';
     this.startJoin = null;
     this.err = null;
   }
   // ***********************************************
   // last node replaces root node if root node is inactive
   // ===============================================
   lnodeReplaceRoot(ip,nbr){
     console.log('lnodeReplaceRoot: '+ip,nbr);
     return new Promise( async (resolve,reject)=>{
       this.dropIps.push(ip);

       const rip = this.myIp;
       const dropNbr = this.r.lnode;
       const newLastNodeIp = this.r.leftNode;

       // Notify Parent This Node Is Moving and needs to be dropped.
       if (ip != this.r.myParent){
         if (this.r.myParent != ip){
           const req = {
             req : 'dropMeAsChildLastNode',
             ip  : this.myIp
           }
           console.log('lastNodeMoveTo::sending:'+this.r.myParent,req);
           this.net.sendMsgCX(this.r.myParent,req);
         }
         else {
           console.log('Popping newRTab',this.r.rootRTab.myNodes);
           this.r.rootRTab.pop();
         }
       }

       console.log('Cloning RootRTab',this.r.rootRTab);
       this.r = clone(this.r.rootRTab);

       this.dropLastNode(this.r.myNodes,this.r.lnode);

       this.r.lnode--;
       this.r.lastNode = newLastNodeIp;
       this.r.rootRTab = 'na';
       this.r.rootNodeIp = this.myIp;

       console.log('ROOTDROPED::rtab is now:',this.r);
       this.status = 'root';
       this.r.rootNodeIp = this.myIp;
       this.net.msgQue = [];
       this.net.msgMgr.remove(this.net.rootIp);

       this.startJoin = null;
       this.err = null;
       resolve(true);
     });
   }
   // ***************************************************
   // send message to last node to replace a failing node
   // ===================================================
   // ip  : ip of the dead node.
   // nbr : node number of the dead node.
   
   sendMoveRequestToLastNode(ip,nbr){
     console.log('Sending lastNodeMoveTo request to'+ip,nbr);
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
         console.log('node2 becoming root');
         this.becomeRoot();
         resolve(null);
         return;
       }

       // Case 2. I am last node and Root is dropping last node will become root.
       if (this.myIp == this.r.lastNode && nbr == 1){
         console.log('dropping Root moving last node to replace root');
         await this.lnodeReplaceRoot(ip,nbr);
         this.bcastRootTableUpdate();
         resolve(null);
         return;
       }

       var lnodeIp  = this.r.lastNode;
       let dropRTab = this.getMyChildRTab(ip); 
       console.log('Droping Node RTab looks like :'+ip,dropRTab);

       //Case 3. Last Node is dropping.
       if (ip == holdLastNodeIp){
         // Change my child node list to point to the last nodes Ip
         lnodeIp = dropRTab.leftNode;
         this.updateMyChildNodes(ip,nbr,lnodeIp);

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
         console.log('Executing Case 4.',ip,nbr);
         this.r.lnode --;
         this.r.lastNode = await this.lastNodeBecome(this.r.lastNode,dropRTab);
         if (this.r.lastNode == ip){
           this.r.lastNode = holdLastNodeIp;
         }   
         if (this.r.myNodes[this.r.myNodes.length -1].ip == holdLastNodeIp){
           console.log('Case 4. Pop',holdLastNodeIp,this.r.myNodes[this.r.myNodes.length -1].ip);
           this.r.myNodes.pop();
         }
         this.myChildSetNewIp(lnodeIp,ip);
         this.bcastRootTableUpdate();
         resolve(null);
         return;
       }

       //case 5 parent node is not root or last node 
       console.log('Case: 5',ip,nbr);

       var lnStatus = null;
       var trys     = 0;
       let maxTrys  = 5;
       
       while (lnStatus != 'moveOK' && trys < maxTrys){
         var newLeftIp = dropRTab.leftNode;
         var lnPoint = 1;
         lnodeIp = this.r.lastNode;
         console.log('Last Node Ip Remains: ',lnodeIp);

         dropRTab.lnode = holdLastNodeNbr -1;
         if (nbr == holdLastNodeNbr -1){
           dropRTab.rightNode=null;
         }
         this.r.lnode --;
         this.r.lastNode = lnodeIp;
         
         // Build and send move request to the last node.
         const req = {
           req       : 'lastNodeMoveTo',
           newRTab   : dropRTab
         }
         console.log('lastNodeMoveTo::request looks like this',req);

         // update my child nodes before sending move request
         this.updateMyChildNodes(ip,nbr,lnodeIp);

         // Start Check Status of Lastnode
         var mres = await this.getLastNodeStatus(lnodeIp,req);
         console.log('lastNodeBecome::',mres);
         lnStatus = mres.status;
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
   lastNodeBecome(lastNodeIp,dropRTab){
     return new Promise(async(resolve,reject)=>{
       var lnStatus = null;
       var trys     = 0;
       let maxTrys  = 5;

       while (lnStatus != 'moveOK' && trys < maxTrys){
         // Build and send move request to the last node.
         const req = {
           req       : 'lastNodeMoveTo',
           newRTab   : dropRTab
         }
         // Start Check Status of Lastnode
         var mres = await this.getLastNodeStatus(lastNodeIp,req);
         console.log('lastNodeBecome::',mres);
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
       console.log('Request Sent To:',ip);
     });
   }
   updateMyChildNodes(dropIp,dropNbr,newIp){
     console.log('updateMyChildNodes(dropIp:'+dropIp+',dropNbr:'+dropNbr+',newIp:',newIp);
     //if last node is dropping remove the last child in the list.
     if (dropNbr == this.r.lnode){
       this.r.myNodes.pop();
     }
     //Update the current child to the new last Node ip.
     this.r.myNodes.forEach((node)=>{
       if (node.ip == dropIp){
         node.ip = newIp;
       }
     });

   }
   async updateMyChildNToNewIp(ip,nodeNbr,lnodeIp){
     console.log('updateMyChildNToNewIp::'+nodeNbr+' From:'+ip+ ' To:',lnodeIp);

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
       console.log('updateMyChildNToNewIp::dropingLastNode:',ip);
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
         console.log('updateMyChildNToNewIp::myNodes'+nodeNbr,ip);
       }
     });
   }
   // ******************************************************
   // last node moves position to replace the dropped  node
   // ******************************************************
   async lastNodeMoveTo(j){
     console.log('lastNodeMoveTo::J',j);
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
     this.r.lnStatus = 'moving'

     // Notify Parent This Node Is Moving and needs to be dropped.
     if (j.remIp != this.r.myParent){
       if (this.r.myParent != j.dropIp){
         const req = {
           req : 'dropMeAsChildLastNode',
           ip  : this.myIp
         }
         console.log('lastNodeMoveTo::sending:'+this.r.myParent,req);
         this.net.sendMsgCX(this.r.myParent,req);
       }
     }

     const newLastNodeIp = this.r.leftNode;

     this.r = clone(this.net.dropChildRTabs(j.newRTab));
     this.net.sendMsgCX(this.r.leftNode,{req : "addMeToYourRight", ip : this.myIp});
     console.log('I am Now:',this.r);

     this.r.lnStatus = 'OK';

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
     console.log("updateToNewLastNode::",node);
     this.r.lastNode = node.lnode;
     this.r.lnode = node.nbr;
     if (this.r.nodeNbr == this.r.lnode){
       this.r.rightNode = null;
     }     
     this.r.myNodes.forEach((mnode,index,list)=>{
       if (mnode.ip == node.ip){
         list.splice(index,1);
       }
     });
   }
   simReplaceNode(node){ 
     console.log('simReplace',node);
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
         console.log('get Node by nbre timed out',nbr);
         this.net.removeListener('peerTReq',ipListen);
         resolve(null);
       },4*1000);  
                  
       console.log('installing ipListener');
       this.net.on('peerTReq', ipListen = (res,j)=>{
         if (j.responseSendIp){
           this.net.endResCX(res,'{"result":"Thanks"}');
           console.log('Got Response to BCAST peerSendIp '+nbr,j.responseSendIp);
           this.responseSendIp = j.responseSendIp;
           clearTimeout(gtime);
           resolve(j.responseSendIp);
           this.net.removeListener('peerTReq',ipListen);
           this.ipListener = null;
         }
       });
     });
   }
   // ***********************************************
   // Get nodes peer group list
   // ===============================================
   getChildPGroupList(ip){
     for (var n of this.r.myNodes)
       if (n.ip == ip)
         return n.pgroup;
     return [];
   }
   responseWhoHasNodeIp(rootIp,ip){
     console.log('responseWhoHasNodeIp::'+this.net.rootIp,ip);
     console.log('rootIp:',rootIp);
     if (this.isMyChild(ip)){
       this.net.sendMsgCX(this.net.rootIp,{responseWhoHasIp: this.myIp});
     }	     
   }

   // ***********************************************
   // Send Nodes Ip to The host that requeste it nbr
   // ===============================================

   respondToIpByNbrRequest(j,toIp){
     if (this.r.nodeNbr == j.peerSendIp)
       this.net.sendMsgCX(toIp,{responseSendIp : this.myIp});
   }
   // *****************************************************
   // Check peers ip to see if it is still in the network
   // =====================================================
   checkPeerStatus(ip){
     if (this.inMyNodesList(ip))
       return true;
     return false;
   } 
   // *****************************************************************
   // Send Rejoin request if this node has dettached from the network
   // =================================================================
   async rejoinNetwork(){
     this.net.emit('mkyRejoin','networkDrop');
     this.r = {
       rootNodes  : [],
       myNodes    : [],
       lastNode   : this.myIp,
       myParent   : null,
       nextParent : this.myIp,
       mylayer    : 1,
       nodeNbr    : 1,
       nlayer     : 1,
       lnode      : 1
     }
     this.r.rootNodes.push({ip:this.myIp,nbr:1,pgroup : []});
     const cRoot = await this.findWhoIsRoot();
     console.log(cRoot);
     if (cRoot){
       this.net.rootIp = cRoot.rip;
     }
     this.status = 'rejoining';

     const msg = {
       req : 'joinReq'
     }
     console.log("Detached Node Sending Re-join.. req",this.net.rootIp);
     this.net.sendMsgCX(this.net.rootIp,msg);
   }
   // *****************************************************************
   // Handles all network join requests
   // =================================================================
   procJoinQue(){
     if (this.joinQue.length){
       var req = this.joinQue[0];
       if (req.status == 'waiting'){
         this.joinQue.shift();
         this.handleJoins(req.jIp,req.j);
       }
     }
     const jqTime = setTimeout( ()=>{
        this.procJoinQue();
     },1000);
   }
   async handleJoins(remIp,j){
     if (this.startJoin || this.err){  //this.node.isError(res)){
       if (this.startJoin != remIp){
         this.joinQue.push({jIp:remIp,j:j,status:"waiting"});
         this.net.endResCX(remIp,'{"result":"reJoinQued"}');
         return;
       }
     }
     this.joinTime = setTimeout( ()=>{
       console.log('join timeount',remIp);
       this.startJoin = false;
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

       const reply = {addResult : this.newNode}
       this.net.endResCX(remIp,JSON.stringify(reply));
       this.newNode = null;
       this.bcast({newNode : j.remIp,rootUpdate : this.r.rootNodeIp});
       this.startJoin = false;
       clearTimeout(this.joinTime);
     }
     else {
       this.net.endResCX(remIp,JSON.stringify({addResult : 'Forwarded Request To Join'}));
     }
   }
   // ********************************
   // Handler for incoming http request
   // ================================   
   handleReq(remIp,j){
     this.net.resetErrorsCnt(j.remIp);
     if (j.req == 'joinReq'){
       this.joinQue.push({jIp:remIp,j:j,status:'waiting'});
       return true;
     }
     if (j.req == 'rootStatusDropNode'){
       this.startJoin = 'waitForDrop';
       return;
     }
     if (j.req == 'rootStatusDropComplete'){
       this.clearWaitForDrop();
       return;
     }
     if (j.req == 'dropMeAsChildLastNode'){
       console.log('GOT REQUEST::',this.r,j);
       this.r.myNodes.pop();
     }
     if (j.req == 'lastNodeMoveTo'){
       this.lastNodeMoveTo(j);
       return true;
     }
     if (j.req == 'lnParentAddNode'){
       console.log('received reqeust lnParentAddNode');
       this.net.sendMsgCX(this.r.myParent,{req : "lnForwardedAddNode", ip : j.ip});
       this.net.endResCX(remIp,'{"lnParentNodeAdded":true,"result":"forwarded","parent" : '+this.r.myParent+'}');
       return true;
     }
     if (j.req == 'lnForwardedAddNode'){
       console.log('received forward reqeust lnForwardNode');
       this.lnParentAddNode(remIp,j.ip);
       return true;
     }
     if (j.req == 'addedYou'){
       console.log('added you received',j.info);
       this.r          = j.info;
       this.r.myNodes  = [];
       this.r.nodeNbr  = this.r.lnode;
       this.r.mylayer  = this.getNthLayer(this.net.maxPeers,this.r.lnode);
       this.r.myParent = j.remIp;
       this.newNode    = null;
       this.status     = 'online';
       this.net.endResCX(remIp,'{"result":"OK"}');       
       return true;
     }
     if (j.req == 'whoIsRoot?'){
       if (this.status == 'online' || this.status == 'root'){
         const qres = {
           whoIsRootReply : {
             rip      : this.r.rootNodeIp,
             maxPeers : this.net.maxPeers,
             reportBy : this.myIp
           }
         } 
         console.log('here is root',qres);
         this.net.endResCX(remIp,JSON.stringify(qres));
       }
       else {
         this.net.endResCX(remIp,'{"whoIsRootReply":"notready"}');
       }
       return true;
     }
     if (j.req == 'pRouteUpdate'){
       this.updatePeerRouting(j);
       this.net.endResCX(remIp,'{"result":"OK"}');
       return true;
     }
     if (j.req == 'addMeToYourRight'){
       this.r.rightNode = j.remIp;
       return true;
     }
     if (j.req == 'nextParentAddChildIp'){
       console.log('Got Request:ReplyTO '+remIp,j);
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
         console.log(remIp,'{"resultNextParentAddChildIp":"'+this.r.rightNode+'"}');
         this.net.endResCX(remIp,'{"resultNextParentAddChildIp":"'+this.r.rightNode+'"}');
       }
       else {
         console.log(remIp,'{"resultNextParentAddChildIp":"'+this.myIp+'"}');
         this.net.endResCX(remIp,'{"resultNextParentAddChildIp":"'+this.myIp+'"}');
       }
       return true;
     }
     return false;
   }
   // *****************************************
   // Handle Direct Responses from http request 
   // =========================================
   handleReply(j){

     if (j.addResult){

       if (j.addResult == 'Forwarded Request To Join')
         return true;
      
       this.r = j.addResult;
       this.r.myNodes = [];
       this.r.nodeNbr = this.r.lnode;
       this.newNode = null;
       this.net.sendMsgCX(this.r.leftNode,{req : "addMeToYourRight", ip : this.myIp});
       this.status = 'online';
       return true;
     }
     if (j.pingResult){
       //console.log('Ping Result '+j.status,j);
     
       if (!j.status && this.r.myParent == j.remIp && this.r.nodeNbr > 1){
         if(this.status != 'detached'){
           //console.log("REJOIN::camefrom Ping Result!",j);
           //this.rejoinNetwork();
         }
       }
       return true;

     }    
     return false;
   }
   // ***************************************************
   // Handle Broadcasts From the network
   // ==================================================
   handleBcast(j){
     console.log('Broadcast Recieved: ',j);
     if (j.remIp == this.myIp){
       console.log('Ingore Broad Cast To Self',j);
       return true;
     }
     if (j.msg.whoHasNodeIp){
       this.responseWhoHasNodeIp(j.remIp,j.msg.whoHasNodeIp);	     
       return true;
     }
     if (j.msg.newNode){
       this.addNewNodeBCast(j.msg.newNode,j.msg.rootUpdate);
       return true;
     }
     if (j.msg.simReplaceNode){
       console.log('got simReplaceNode',j.msg.simReplaceNode);
       this.simReplaceNode(j.msg.simReplaceNode);
       this.err = false; //this.node.clearError(j.msg.simReplaceNode.ip);
       this.notifyRootDropComplete();
       clearTimeout(this.eTime);
       return true;
     }
     if (j.msg.removeNode){
      //console.log('Bcast remove Node',j.msg.removeNode);
       this.dropNode(j.msg.removeNode);
       return true;
     }
     // Root Table Update... only update if a current root node 
     // sent the message.  
     if (j.msg.rootTabUpdate){

       console.log('Updating Root Tables',j.msg.rootTabUpdate,j.msg);
       this.r.rootNodeIp = j.msg.rootTabUpdate.rootIp;       
       this.r.lastNode   = j.msg.rootTabUpdate.lastNodeIp;
       this.r.lnode      = j.msg.rootTabUpdate.lastNodeNbr;
       if (this.r.nodeNbr == this.r.lnode){
         this.r.rightNode = null;
       }
       return true;
     }
     if (j.msg.newLastHost){
       console.log('Acting on bcast updating last host to ',j.msg.newLastHost);
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
     return false;
   }
   // ********************************************************************
   // Handle undelivered http request from offline or slow to respond peers
   // ====================================================================
   async handleError(j){
     //console.log('handle error'+this.status,j);
     if (j.req == 'whoIsRoot?'){
       console.log('handleError::got whoIsRoot',j.req);
       return true;
     } 
     if (this.status == 'startup'){
       console.log('handleError::is in Startup mode:',j.req);
       return true;
     }
     if(j.req == 'bcast'){
       console.log('handleError::got bcast, re-routing:',j.req);
       this.routePastNode(j);
       return true;
     }
     if (!this.err){ //this.node.isError(j.toHost)){
       this.net.incErrorsCnt(j.toHost);
       if (this.net.getNodesErrorCnt(j.toHost) > 0){
         console.log('handleError::Err Count Exceeded',j.toHost);
         // Only Parent Nodes Can Drop A Node.
         if (this.notMyNode(j.toHost)){
           console.log('Not My Node To Drop::',j.toHost);
	   return;
         }
         if (this.dropIps.includes(j.toHost)){
           console.log('Aready Dropped:',j.toHost);
           return;
         }

         this.err = true; 
         this.dropIps.push(j.toHost);
         this.notifyRootDropingNode(j.toHost);

         // Set Timeout for drop operation.
         this.eTime = setTimeout( ()=>{
           console.log('Drop Time Out',j);
           this.notifyRootDropComplete();
           this.err = false; //this.node.clearError(j.toHost);
         },8000);

         // Get nodeNbr of the node to drop.
         const nbr = this.inMyNodesList(j.toHost); 
         console.log('inMyNodesList::retured',nbr);
         if(nbr){
           var nIp = await this.sendMoveRequestToLastNode(j.toHost,nbr);
           console.log('nIp is now',nIp);

           // If nIp is null move opperation is completed.
           if(!nIp){
             this.err = false; //this.node.clearError(j.toHost);
             this.notifyRootDropComplete();
             clearTimeout(this.eTime);
           }
         }
       }
       else { 
         console.log('handleError::queing errored message',j);
         this.net.queMsg(j);
       } 
       return true;
     }
     console.log('handleError::InDrop Mode:',j.toHost);
     return false;
   }
   // ****************************************
   // Check if ip is in my child nodes list
   // ========================================
   isMyChild(ip){
     if (this.myIp == this.r.lastNode && this.r.nodeNbr > 1 && ip == this.r.rootNodeIp ){
       return this.r.rootNodeIp;
     }
     if (!this.r.myNodes){
       return null;
     }

     for (var node of this.r.myNodes){
       if (node.ip == ip)
         return node.nbr;
     }
     return null;
   }
   // ****************************************
   // Check for existing routing information
   // ========================================
   readNodeFile(){
     return new Promise( (resolve,reject)=>{
       var rtab = null;
       try {rtab =  fs.readFileSync(this.net.nodesFile);}
       catch {console.log('no node list  file found',this.net.nodesFile);resolve(null);}
       try {
         rtab = JSON.parse(rtab);
         resolve(rtab);
       }
       catch {resolve(null);}
     });
   }
}
// *********************************************************
// CLASS: gPowQue
// A Proof of work class Que Managerk.
//
class gPowQue {
   constructor(){
     this.nodes = [];
   }
   push(ip,work,diff){
     var node = {
       ip   : ip,
       work : work,
       diff : diff
     }
     if (this.inList(ip) === null) {
       this.nodes.push(node);
     }
     return this.pop();
   }
   remove(ip){
     var breakFor = {};
     try {
       this.nodes.forEach( (n, index, object)=>{
         if (n.ip == ip){
           object.splice(index,1)
           console.log("Job IP Removed:",ip);
         }
       });
     }
     catch(e){}
   }
   inList(ip){
     var isIn = null;
     var breakFor = {};
     try {
       this.nodes.forEach( (n)=>{
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
     return this.nodes.pop();
   }
   list(){
    //console.log('Network MsgQue Status: ');
     this.nodes.forEach( (n)=>{
      //console.log(n);
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
    console.log('Doing POW for:',remIP);
    var work = this.que.push(remIP,work,difficulty);
    while(work){
      console.log('While Working');
      this.work = work.work;
      this.remIP = work.ip;
      this.isMining = true;
      this.stopMining = false;
      this.repeatHash(work.diff);
      work = this.que.pop();
    }
  }
  doStop(remIP){
    console.log('Do Stop Initiated:'+this.remIP+'|',remIP);
    if (this.remIP == remIP){
      console.log('OPTION STOPPING:'+this.remIP+'|',remIP);
      this.stopMining = true;
    }
    else {
      console.log('OPTION REMOVE FROM QUE:'+this.remIP+'|',remIP);
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
        console.log('HALT intiated:',this.remIP);
      }
      else {
        var timeout = setTimeout( ()=>{this.repeatHash(difficulty);},1);
      }
    }
    else {
     console.log('this.stopMining:',this.stopMining);
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
    console.log('GPow Started:',this.ip);
    console.log('GPow Net: XXXXX');
    this.isMining = false;
    this.stopMining = null;
  }
  async doPow(difficulty,work,remIP) {
    console.log('Doing POW for:',remIP);
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
        console.log('stop intiated:');
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
      console.log('Nonce: ',this.nonce);
      console.log('Work: ',this.work);
      console.log(this.ip,this.hash);
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
   add(ip){
     var node = {
       ip   : ip,
       nMsg : 1
     }
     var breakFor = {};
     try {
       this.nodes.forEach( (n)=>{
         if (n.ip == ip){
           n.nMsg++;
           throw breakFor;
         }
       });
       this.nodes.push(node);
     }
     catch(e){}
   }  
   kill(ip){
     this.nodes.forEach( (n, index, object)=>{
       if (n.ip == ip){
         object.splice(index,1)
       }
     });
   }
   remove(ip){
     console.log('MkyMsgQue::remove: ip-'+ip,this.nodes);
     this.nodes.forEach( (n, index, object)=>{
       if (n.ip == ip){
         if (n.nMsg <= 1){
           console.log('droping:',n);
           object.splice(index,1);
         }		 
         else { 
           n.nMsg--;
         }		 
       } 
     });
   } 
   count(ip){
     var ncount = 0;
     this.nodes.forEach( (n)=>{
       if (n.ip == ip)
         ncount = n.nMsg;
     });
     return ncount;
   }
   list(){
    //console.log('Network MsgQue Status: ');
     this.nodes.forEach( (n)=>{
      //console.log(n);
     });
   }
}
// *********************************************************
// CLASS: PeerTreeNet
// Provides peer network for applications to send, recieve and broadcast 
// JSON messages using https.
// *********************************************************
class PeerTreeNet extends  EventEmitter {
   constructor (options,network=null,port=1336,wmon=1339,maxPeers=2){
      super(); 
      this.nodeType  = 'router';
      this.pulseRate = defPulse;	   
      this.maxPeers = maxPeers;
      this.rootIp   = rootIp;
      this.isRoot   = isRoot;
      this.peerMUID = null;
      this.server   = null;
      this.remIp    = null;
      this.port     = port;
      this.wmon     = wmon;
      this.options  = options;
      this.nodes    = [];
      this.msgQue   = [];
      this.rQue     = [];
      this.msgMgr   = new MkyMsgQMgr();
      this.processMsgQue();
      this.replyQueSend();
      this.sendingReply = false;
      this.sendingReq   = false;
      this.resHandled   = false;
      this.svtime       = null;
      this.lastActive   = null;
   }  
   readNodeFile(){
     return new Promise( async (resolve,reject)=>{
       var nstats = null;
       try {
         nstats = fs.statSync(this.nodesFile);
         let dNow  = Date.now();
         let dDiff = Date.now() - nstats.atimeMs;
         if (dDiff < 30000){
           console.log('restart detected::waiting',15000);
           console.log("type of:",typeof nstats.atimeMs);
           console.log('TRYCC:::init::LastActiveTime: '+dNow+' Diff - '+ dDiff,nstats.atimeMs);
           await sleep(15000);
           console.log('startup resumed::');
         } 
       }
       catch(e) {console.log('First Access::',this.nodesFile);}

       var nodes = null;
       console.log("looking for::",this.nodesFile);
       try {nodes =  fs.readFileSync(this.nodesFile);}
       catch {console.log('no nodes file found');resolve([]);}
       try {
         nodes = JSON.parse(nodes);
         //for (node of nodes)
         //  this.sendMsgCX(node.ip,'{"req":"nodeStatus"}');
         resolve(nodes);
       }
       catch {resolve([]);}
     });

   }
   tryNodeIp(){
     const max = this.nodes.length;
     if(!max)
       return null;
     const n = Math.floor(Math.random() * Math.floor(max));
     return this.nodes[n].ip;
   }
   setUpNetwork(){
     return new Promise( async (resolve,reject)=>{
       this.initHandlers();
       this.nodesFile = 'keys/myNodeList-'+this.port+'-'+this.nodeType+'.net';
       this.nodes = await this.readNodeFile();
       this.genNetKeyPair();
       this.nIp = null;
       this.nIp = await(this.netIp());
       //this.nIp = '172.105.99.203=>192.168.129.43'; //await(this.netIp());
       //checkInternetAccess(this.nIp,this.port);
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
      if (!this.nIp === null){
        return this.nIp;
      }
      this.nIp = await tryGetExternalIp();
      if (this.nIp === null){
        console.log('could not find exernal IP for peerTree node');
        process.exit(0);
      }
      return this.nIp;
   }
   genNetKeyPair(){
      var keypair = null;
      try {keypair =  fs.readFileSync('keys/peerTreeNet.key');}
      catch {console.log('no keypair file found');}
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
        catch {console.log('keypair pair not valid');process.exit();}
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
      //console.log('\n=======================\nendRes sent:',msg);
      this.resHandled = true;
      if(this.svtime)clearTimeout(this.svtime);
      if(msg == ''){
        //console.log('no response required');
        return;
      }
      var jmsg = null;
      try {
        jmsg = JSON.parse(msg);
      }
      catch {
        console.log('Response Error JSON.parse',resIp,msg,corx);
        return;
      }
      if(corx){
        jmsg.PNETCOREX = true;
      }
      this.sendReply(resIp,jmsg);
   }
   startServer(){
      this.server = https.createServer(this.options, (req, res) => {
        this.remIp = req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress;
        this.remIp = this.remIp.replace('::ffff:','');
        //console.log('REQ::',req.url);
        this.resHandled = false;
        var jSaver = null;
        res.setHeader('Connection', 'close');
        this.svtime = setTimeout( ()=>{
          if (1==2 && !this.resHandled){
            console.log('server response timeout:'+this.remIp+req.url,jSaver);
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 501;
            res.end('{"netPOST":"FAIL","type":"NotSet","Error":"server timeout"}');
            //process.exit();
            this.resHandled = true;
          }
        },2500); 
        
        if (req.url.indexOf('/netREQ') == 0){
	  if (req.method == 'POST') {
            var body = '';
            req.on('data', (data)=>{
              body += data;
              // Too much POST data, kill the connection!
              //console.log('body.length',body.length);
              if (body.length > 300000000){
                console.log('netREQ:: max datazize exceeded');
                clearTimeout(this.svtime);
                //console.log('SETHEADER::netREQbody:','Content-Type', 'application/json');
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 413;
                res.end('{"netPOST":"FAIL","type":"netREQ","Error":"data maximum exceeded"}');
                req.connection.destroy();
              }
            });
            req.on('end', ()=>{
	      res.setHeader('Content-Type', 'application/json');
              const time = new Date();

              fs.utimes(this.nodesFile, time, time, (err) => {
                if (err) {console.log(err);}
                else {}
              });

              var j = null;
              try {
                //console.time('Time Taken');
                j = JSON.parse(body);
                jSaver = j;
                if (j.hasOwnProperty('msg') === false) throw 'invalid netREQ no msg body found';
                if(this.rnet.status != 'online' && this.rnet.status != 'root'){
                  console.log('NETREQ::Status:'+this.rnet.status,j);
                }
		if (!j.msg.remIp) j.msg.remIp = this.remIp;
                this.resHandled = true;
                clearTimeout(this.svtime);
                //if (j.msg.ping){console.log('PING:::',j.msg.remIp);}
                if (j.msg.hasOwnProperty('PNETCOREX') === false){
                  this.emit('mkyReq',this.remIp,j.msg);
		} 
		else {
                  this.emit('peerTReq',this.remIp,j.msg);
		}
                res.statusCode = 200;
                res.end('{"netPOST":"OK"}');
                //console.timeEnd('Time Taken');
              }
              catch (err) {
		console.log('POST netREQ Error: ',err);
                console.log('POST msg was ->',body);
                clearTimeout(this.svtime);
                res.statusCode = 502;
                res.end('{"netPOST":"FAIL","type":"netREQ","Error":"'+err+'","data":"'+body+'"}');
                this.resHandled = true;
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
              //console.log('body.length',body.length);
              if (body.length > 300000000){
                console.log('max datazize exceeded');
                clearTimeout(this.svtime);
                //console.log('SETHEADER::netREPLYbody:','Content-Type', 'application/json');
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 413;
                res.end('{"netPOST":"FAIL","type":"netREPLY","Error":"data maximum exceeded"}');
                req.connection.destroy();
              }
            });
            req.on('end', ()=>{
	      clearTimeout(this.svtime);
              //console.log('SETHEADER::netREPLYonEND:','Content-Type', 'application/json');
              res.setHeader('Content-Type', 'application/json');
              var j = null;
              try {
                j = JSON.parse(body);
                if (j.hasOwnProperty('msg') === false) throw 'invalid netREPLY no msg body found';
                if(this.rnet.status != 'online' && this.rnet.status != 'root'){
                  console.log('NETReply::Status:'+this.rnet.status,j);
                }
                if (!j.msg.remIp) j.msg.remIp = this.remIp;
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
                clearTimeout(this.svtime);
                res.statusCode = 503;
                res.end('{"netPOST":"FAIL","type":"netREPLY","Error":"'+err+'","data":"'+body+'"}');
                console.log('POST netREPLY Error: ',err);
                console.log('POST msg was ->',j);
              } 
            });
          }
        }
        else {
          clearTimeout(this.svtime);
          //console.log('SETHEADER::netWELOCOME:','Content-Type', 'application/json');
          res.statusCode = 200;
          res.end('{"result":"Welcome To PeerTree Network Sevices\nWaiting...\n' + decodeURI(req.url) + ' You Are: ' + this.remIp+'"}\n');
          //this.endResCX(res,'Welcome To PeerTree Network Sevices\nWaiting...\n' + decodeURI(req.url) + ' You Are: ' + this.remIp+'\n');
          this.resHandled = true;
        }}
      });
      this.server.listen(this.port);
      this.server.timeout = 1000;
      this.server.on('timeout', (socket) => {
        console.log('Warning Server Socket timed out');
        this.emit('mkyServerTO');
      });
      console.log('Server PeerTree7.2 running at ' + this.nIp + ':' + this.port);
   }
   netStarted(){
     console.log('Starting Net Work');
     return new Promise( async (resolve,reject)=>{
       await this.setUpNetwork(); 
       this.notifyNetwork();
       console.log('NETWORK started OK..');
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
      //console.log('starting groupPing:',targetIp);
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
        this.rnet.net.on('xhrFail',errListener = (j)=>{
	  const peer = this.gPingIndexOf(grpPing.pings,j.toHost);
	  if(peer !== null){
	    grpPing.pings[peer].pRes = 'nodeDead';
          }		
        });
        this.rnet.net.on('peerTReply',repListener  = (j)=>{ 
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
          this.rnet.net.removeListener('peerTReply', repListener);
          this.rnet.net.removeListener('xhrFail', errListener);
          grpPing.targetStatus = this.reviewTargetStatus(grpPing);
          //console.log('grpPing Done:',grpPing);
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
     //console.log('Got PingTarget Request:',j); 
     var reply = {
       gpingResult : {
         targetIP : null,
 	 ptime    : Date.now(),
	 pStatus  : null
       }
     };	     
     var hListener = null;
     var rListener = null;
     this.rnet.net.on('xhrFail',hListener = (J)=>{
       this.rnet.net.removeListener('xhrFail', hListener);
       reply.gpingResult.targetIP = j.target;
       reply.gpingResult.pStatus  = 'targDead';
       reply.gpingResult.ptime    = null;
       this.sendReplyCX(j.remIp,reply);
     });
     this.rnet.net.on('peerTReply',rListener  = (J)=>{
       this.rnet.net.removeListener('peerTReply', rListener);
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
       this.rnet.net.removeListener('peerTReply', rListener);
       this.rnet.net.removeListener('xhrFail', hListener);
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
      //console.log('starting heartBeat:',this.rnet.status);
      if(this.rnet && this.rnet.status != 'startup' && !this.rnet.err){
        var hrtbeat = {
          pings    : [],
          myStatus : 'OK',
          tstamp   : Date.now()
        };
	var hListener = null;
        var rListener = null;
        this.rnet.net.on('xhrFail',hListener = (j)=>{
          if (j.ping){
            const peer = this.heartbIndexOf(hrtbeat.pings,j.remIp);
            if (peer !== null){
              hrtbeat.pings[peer].pRes = 'dead';
            }  
          }        
        });
        this.rnet.net.on('peerTReply',rListener  = (j)=>{
          if (j.remIp == this.rnet.r.myParent){
            //console.log('heartBeat::PINGRESULT:',j);
            if (j.result == 'doRejoinNet'){
              this.setNodeBackToStartup();
            }
          }
          if (j.pingResult && (j.nodeStatus == 'online' || j.nodeStatus == 'root')){
            if (j.remIp == this.rnet.r.myParent){
              console.log('heartBeat::PINGRESULT:',j);
              if (j.result == 'doRejoinNet'){
                this.setNodeBackToStartup();
              }
            }
            this.updateChildRTab(j.remIp,j.rtab);
            const pTime = Date.now() - hrtbeat.tstamp; 
	    const peer = this.heartbIndexOf(hrtbeat.pings,j.remIp);
	    if (peer !== null){
              hrtbeat.pings[peer].pRes = j.pingResult;
	      hrtbeat.pings[peer].pTime = pTime;
	    }	  
          }
        });
         
        const hTimer = setTimeout( ()=>{
          this.rnet.net.removeListener('peerTReply', rListener);
          this.rnet.net.removeListener('xhrFail', hListener);
          //hrtbeat.myStatus = this.reviewMyStatus(hrtbeat);
	  //console.log('hearBeat Done:',hrtbeat);
        },1500);

	// Ping Parent Node
        if (this.rnet.r.myParent){
          hrtbeat.pings.push({pIP:this.rnet.r.myParent,pType:'myParent',pRes : null});
	  this.sendMsgCX(this.rnet.r.myParent,{ping : "hello",action : "checkMyStatus"});
        }
        // Ping My Child Nodes
        if(this.rnet.r.myNodes)
          for (var node of this.rnet.r.myNodes){
            hrtbeat.pings.push({pIP:node.ip,pType:'myNodes',pRes : null});
            this.sendMsgCX(node.ip,{ping : "hello"});
          }
            
        // Last Node Ping Root Node.
        if (this.rnet.r.nodeNbr == this.rnet.r.lnode){
          hrtbeat.pings.push({pIP:this.rnet.r.rootNodeIp,pType: 'lastToRoot',pRes : null});
          this.sendMsgCX(this.rnet.r.rootNodeIp,{ping : "hello"});
        }
      
        if (this.rnet.r.nodeNbr == 1 && hrtbeat.pings.length == 0){
          let nstat = await this.checkInternet();
          //console.log("Bitcoin Network Found:",nstat);
          if (!nstat){
            console.log('Alone And Offline');
            hrtbeat.myStatus = 'AloneOffline';
            this.setNodeBackToStartup();
          }
          else {
	    hrtbeat.myStatus = 'Alone';
            console.log('lowering pulse rate!');
            this.pulseRate = 15000;
          }
        }
      }
      var timeout = setTimeout( ()=>{this.heartBeat();},this.pulseRate);
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
        //console.log('CREATING copy of rootNode rootRTab',childRTab);
        this.rnet.r.rootRTab = clone(this.dropChildRTabs(childRTab));
      }
    }
  }
  dropChildRTabs(r){
    if (!r){
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
  async reviewMyStatus(hbeat){
    //console.log('My Health Check::',hbeat);
    var nFails = 0;
    hbeat.pings.forEach((ping)=>{
      if (ping.pRes != 'hello back'){
        if (ping.pType != 'lastToRoot'){
          console.log('hbeat:::fail::', ping);
          nFails++;
        }
      }
    });
    //console.log('PingFails::',nFails);
    if (nFails == hbeat.pings.length){
      console.log('heartBeat::reviewMyStatus: '+nFails,hbeat.pings.length);
      hbeat.myStatus = 'imOffline';
    }
    if (hbeat.myStatus != 'OK' && (this.rnet.r.nodeNbr == 1 || this.rnet.r.nodeNbr == 2)){
      let finalCheck = await this.checkInternet();
      if (!finalCheck){
        this.setNodeBackToStartup();
      }
      else {hbeat.myStatus = 'OK';}
    }
    return hbeat.myStatus;
  }
  setNodeBackToStartup(){
    console.log('Node Appears offline returning to startup mode');
    this.rnet.status = 'startup';
    this.rnet.newNode    = null;
    this.rnet.ipListener = null;
    this.rnet.lnListener = null;
    this.rnet.err        = null;
    this.rnet.eTime      = null;
    this.rnet.startJoin  = null;
    this.rnet.joinTime   = null;
    this.rnet.joinQue    = [];

    this.rnet.r = {
      rootNodeIp : this.rnet.myIp,   // Top of the network.
      myNodes    : [],   // forwarding ips for each nodes peers group.
      lastNode   : this.rnet.myIp,
      leftNode   : null,
      rightNode  : null,
      nextParent : null,
      myParent   : null,
      mylayer    : 1,
      nodeNbr    : 0,    // node sequence number 1,2,3 ... n
      nlayer     : 1,    // nlayers in the network 1,2,3 ... n
      lnode      : 1     // number of the last node in.
    }
    setTimeout(()=>{this.waitForInternet();},20*1000);
  }
  async waitForInternet(){
    var isAvail = await checkInternet();
    if (isAvail){
      await this.init();
    }
    else { 
      setTimeout(()=>{this.waitForInternet();},20*1000);
    }
  }
  async checkInternet() {
    const os = require('os');
    const { exec } = require('child_process');
    return new Promise((resolve, reject) => {
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
        resolve(false);
        return;
      }

      // Perform a simple ping test to a public IP address
      exec('ping -c 1 8.8.8.8', (error, stdout, stderr) => {
        if (error) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }
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
     if (!j){console.log('remPublicKey is null',j);return false;}
     if (j.hasOwnProperty('remPublicKey') === false) {console.log('remPublicKey is undefined',j);return false;}
     if (!j.remPublicKey) {console.log('remPublickey is missing',j);return false;}

     if (!j.signature || j.signature.length === 0) {
        return false;
     }

     const checkRemAddress = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+j.remPublicKey, 'hex') }).address;
     if (checkRemAddress != j.remMUID) {
       console.log('remAddress not matching');
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
  processMsgQue(){
     if (this.msgQue.length){
       const msg = this.msgQue[0];
       this.msgQue.shift();
       this.msgMgr.remove(msg.toHost);
       console.log('Sending Message from que to '+msg.toHost,msg);
       this.sendMsgCX(msg.toHost,msg);
     }
     var qtime = setTimeout( ()=>{
       this.processMsgQue();
      },500);
  }
  queMsg(msg){
     //console.log('Msg Log Counter: ',this.msgMgr.count(msg.toHost));
     if (this.msgMgr.count(msg.toHost) < 20){
       //console.log('pushing msg:',msg);
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
      if (!toHost) {console.log('Send Message Host '+toHost+' Missing',msg);return;}
      if (!msg)    {console.log('Send Message Msg  Missing'+toHost,msg);return;} 
      msg.INTERNIP = this.getInternalIpOnly(this.rnet.myIp);
      toHost = this.getExternlIpOnly(toHost);

      if (toHost == this.rnet.myIp)
        return;

      if (msg.reroute) {} //console.log('Forwarding re-routed msg');
      if(corx){
        msg.PNETCOREX = true;
      }
      if (toHost == 'root'){
        toHost = this.getNetRootIp();
        //console.log('toHost::Changes to:',toHost);
      }
      //console.log('toHost Changes to:',toHost);
      const msgTime =  Date.now();

      if(!msg.signature){
        const msgTime    = Date.now();
        msg.signature    = this.signMsg(msgTime);
        msg.msgTime      = msgTime;
        msg.remPublicKey = this.publicKey;
        msg.remMUID      = this.peerMUID;
      }
      this.sendingReq = true;
      this.sendPostRequest(toHost,msg,'/netREQ');
      return;
  }
  replyQueSend(){
     if (this.rQue.length){
       const msg = this.rQue[0];
       this.rQue.shift();
       //console.log('Sending Message from que to '+msg.toHost,msg);
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
      if (!toHost) {console.log('Send Reply host '+toHost+' Missing',msg);return;}
      if (!msg)    {console.log('Send Reply Msg  Missing');return;}

      if (toHost == this.rnet.myIp)
        return;

      if (msg.reroute) {} //console.log('Forwarding re-routed msg');

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
        msg.msgTime      = msgTime;
        msg.remPublicKey = this.publicKey;
        msg.remMUID      = this.peerMUID;
      }
      this.sendingReply = true;
      this.sendPostRequest(toHost,msg,'/netREPLY');
      return;
  }
  sendPostRequest(toHost,msg,endPoint='/netREPLY'){
     const https = require('https');

     const pmsg = {msg : msg}
     const data = JSON.stringify(pmsg);
     
     //if (!msg.PNETCOREX )console.log('POSTDATA::',data);
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
     //if (!msg.PNETCOREX ) console.log('POSTREQ::headers:',options);
     const req = https.request(options, res => {
       //console.time('mkyPOST::');
       msg.toHost = toHost;
       //console.log('responseCODE::'+res.statusCode,msg.toHost);
       if (res.statusCode !== 200) {
         msg.toHost = toHost;
         console.log('xhrAppError:: failed with status code: '+ res.statusCode,msg);
         msg.xhrError = res.statusCode;
         this.emit('xhrAppFail',msg);
         this.sendingReply = false;
       }
       else {
         //res.on('end',()=>{
         //console.timeEnd('mkyPOST::');
         this.sendingReply = false;
         //});
       }
     });

     req.on("timeout", () => {
        msg.toHost = toHost;
        msg.endpoint = options.path;
        if (!(msg.ping || msg.pingResult)){
          console.log('SendByPOST:: Timed Out',msg);
        }
        req.abort();
     });
     req.on('error', error => {
        msg.toHost = toHost;
        //console.log('xhrFAIL:: '+error,msg);
        this.emit('xhrFail',msg);
        this.sendingReply = false;
     })

     req.write(data);
     req.end();
  }

  removeNode(ip){
     this.nodes.forEach( (n, index, object)=>{
       if (n.ip == ip){
         object.splice(index,1)
       }
     });
     const remip = {ip : ip}
     //console.log('Removed non responsive network node : ',remip);
     const myNodes = this.nodes;
     return;
     fs.writeFile(this.nodesFile, JSON.stringify(myNodes), function (err) {
       if (err) throw err;
       console.log('node list saved to disk!',myNodes);
     });
  }
  getNodesErrorCnt(ip){
     for (var node of this.nodes)
       if (ip == node.ip)
         return node.errors;
     return null;
  }
  resetErrorsCnt(ip){
     this.nodes.forEach( node=>{
       if (node.ip == ip)
         node.errors = 0;
     });
  }
  incErrorsCnt(ip){
     this.nodes.forEach( (node)=>{
       if (node.ip == ip)
         node.errors++;
     });
  }
  /********************************************************
  Maintains contact list used for finding the network when
  attempting to rejoin.
  */
  pushToContacts(j){
     for (var node of this.nodes){
       if (node.ip == j.remIp){
         return;
       }
     }
     const newip = {ip : j.remIp,errors : 0,date : Date.now(),pKey : j.remPublicKey}
     console.log('New Network Node Joined: ',newip);
     this.nodes.push(newip);
     const myNodes = this.nodes;
     fs.writeFile(this.nodesFile, JSON.stringify(myNodes), function (err) {
       if (err) throw err;
         console.log('node list saved to disk!',myNodes);
     });

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
       //console.log('xhrFail handler:',j);
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
         console.log('netREPLY... invalid signature message refused',j);
         return;
       }
       if (this.rnet.handleReply(j))
         return;
       if (j.nodeReply){
        //console.log('I heard net root is:',j.netRootIp);
         this.rootIp = j.netRootIp;
       }
     });
     this.on('peerTReq',(remIp,j)=>{

       var error = null;       
       if (!this.isValidSig(j)){
         error = '400';
         console.log('invalid signature message refused',j);
         this.endResCX(remIp,'{"response":"' + error +'"}');
         return;
       }
       // Add node the contacts List 
       this.pushToContacts(j);

       if (this.rnet.handleReq(remIp,j)){
         //console.log('Request Handled By Handler');
         return;
       }

       if (j.gping == 'hello'){
         this.pingTarget(j);
         return;	 
       }
       if (j.ping == 'hello'){
         var result = this.rnet.isMyChild(j.remIp);
         if (result === null){
           //console.log('pingResult::doRejoinNet',j.remIp,result,j);
           result = 'doRejoinNet';
         }
         this.endResCX(remIp,'{"pingResult":"hello back","status":"'+result+'","nodeStatus":"'+this.rnet.status+'","rtab":'+JSON.stringify(this.rnet.r)+'}');
         return;
       }      
       if (j.req == 'bcast'){
         if (this.rnet.myIp == j.req.remIp){
           console.log('Bcast To Self Ignored::',j);
           return;
         }
         this.emit('bcastMsg',j);
         this.rnet.forwardMsg(j);
         this.endResCX(remIp,'');
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
        console.error('Error retrieving external IP:', error.message);
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
  console.log('Portscan::',ipAddress);
  const portToCheck = port; // Change this to the port you want to check

  portscanner.checkPortStatus(portToCheck, ipAddress, (error, status) => {
    if (error) {
      console.error(error);
      process.exit(0);
    } else {
      console.log(`Port ${portToCheck} on ${ipAddress} is ${status}`);
      if (status !== 'open'){
        console.log('No Internet Access:',status);
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
