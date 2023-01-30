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

     this.r = {
       rootNodes  : [],   // Top of the network routing table plus each nodes peer group.
       myNodes    : [],   // forwarding ips for each nodes peers group.
       lastNode   : myIp,
       myParent   : null,
       mylayer    : 1,
       nodeNbr    : 1,    // node sequence number 1,2,3 ... n
       nlayer     : 1,    // nlayers in the network 1,2,3 ... n
       lnode      : 1     // number of the last node in.
     }
   }
   routingReady(){
     return new Promise( async (resolve,reject)=>{
       await this.init();
       resolve(true);
     });
   }
   // ********************************************************************
   // Search any previously known nodes and request th whoIsRoot response.
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
     //*check to see if myIp is the root node.
     if (this.myIp != this.r.rootNodes[0].ip){
       const req = {
         req  : 'rootStatusDropNode',
         node : node
       }
       this.net.sendMsgCX(this.net.getNetRootIp(),req);
     }
     else {
       this.startJoin = 'waitForDrop';
     }
   }
   clearWaitForDrop(){
     if (this.startJoin == 'waitForDrop')
       this.startJoin = null;
   }
   // ****************************************************
   // handles directly the first 2*maxPeer peers to joing
   // ====================================================
   addNewNodeReq(ip){
     console.log('Add by REQUESST');
       if (this.inMyNodesList(ip)){
         return false;
       }
 
       if (this.r.rootNodes.length < this.net.maxPeers){
         console.log('Adding to top layer',ip);
         var node = {ip : ip, nbr : this.r.lnode +1,pgroup : []}
         this.r.lnode++;
         this.r.rootNodes.push(node);
         this.r.lastNode = ip;
         console.log('NEW NET Root node Added',this.r);
         this.newNode = clone(this.r);
         return true;
       }
       else {
         if ( this.r.myNodes.length < this.net.maxPeers){
           console.log('adding to my peer group',ip);
           var node = {ip : ip,nbr : this.r.lnode+1, pgroup : []}
           this.r.myNodes.push(node);
           this.incCounters();
           this.updateRootRoutingTable();
           this.r.lastNode = ip;
           console.log('NEW NET Root node Added',this.r);
           this.newNode = clone(this.r);
           console.log('my parent before',this.r.myParent);
           this.newNode.myParent = this.myIp
           console.log('my parent after',this.r.myParent);
           return true;
         }
       }   
       // Send request to lastNodes parent 
       // ********************************
       var req = {req : 'lnParentAddNode',ip  : ip};
       this.net.sendMsgCX(this.r.lastNode,req);

       //this.incCounters()
       //this.r.lastNode = ip;
       return false;
   }
   // ***********************************************
   // update rootRouting table broadcast the update.
   // ===============================================
   updateRootRoutingTable(){
     this.r.rootNodes.forEach( n =>{
       if (n.ip == this.myIp)
         n.pgroup = this.r.myNodes;
     });
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
       var node = {ip : ip,nbr : this.r.lnode+1,pgroup : []}
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
         this.bcast({newNode : ip,rootUpdate : this.r.rootNodes});
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
     if (this.startJoin){
       this.startJoin = false;
       clearTimeout(this.joinTime);
     }
     if (this.inMyNodesList(ip)){
       console.log('inMyNodesList true');
       return false;
     }

     if (ip == this.myIp){
       console.log('hey this is me');
       return false;
     }

     if (rUpdate)
       this.r.rootNodes = rUpdate;

     this.r.lastNode = ip;
     this.incCounters();
     return false;
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
     if (this.iamRootNode())
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
             object.splice(index,1);
             rUpdate = true;
           }
         }); 
         if (n.ip == ip){
           object.splice(index,1)
           rUpdate = true;
         }
       });
       if (rUpdate)
         this.bcastRootTableUpdate();
     }
     this.r.myNodes.forEach( (n, index, object)=>{
       if (n.ip == ip){
         console.log('dropping child node',ip);
         object.splice(index,1)
       }
     });
   }
   // **********************************************************
   // Calculate what layer a node is in
   // ==========================================================
   getNthLayer(maxPeers,n){
     var l = 0;
     for (var i=1; l < n;i++)
       l = l + Math.pow(maxPeers,i);
     return i-1;
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

       rInfo = await this.findWhoIsRoot();
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
         this.r.rootNodes[0] = {ip : this.myIp,nbr : 1,pgroup : []};
         this.status = 'root';
         console.log("I am alone :(");
       }
       this.procJoinQue();
       resolve(true);
     });	     
   }
   // *************************************************
   // check to see if i am a root node in the network
   // =================================================
   iamRootNode(){
     for (var node of this.r.rootNodes)
       if (node.ip == this.myIp)
         return true;
     return false;
   }
   // ******************************************************
   // Must Call this any time the main root table is chainged
   // =======================================================
   bcastRootTableUpdate(){
     console.log('Sending bcast rootTabUpdate...');
     this.bcast({rootTabUpdate : this.r.rootNodes});
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
     // console.log('List TO send bcast to',this.r.rootNodes);
     for (var node of this.r.rootNodes){
       if (node.ip != this.myIp){
         this.net.sendMsgCX(node.ip,bc);
         //console.log("Send bcast to ",node.ip);
       }
     }
     this.forwardMsg(bc);
   }       
   // *************************************************
   // forwards 'bcast' messages down the tree
   // =================================================
   forwardMsg(msg){
     if (this.r.myNodes)
       for (var node of this.r.myNodes){
         if (node.ip != this.myIp){
           this.net.sendMsgCX(node.ip,msg);
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
     if (this.iamRootNode())
       for (var node of this.r.rootNodes){
         if (node.ip == ip)
           return true;
       }
     return false;
   }
   // *******************************************************
   // Check If Ip is in either the root table or my peer group
   // ======================================================
   inMyNodesList(ip){
     // Last node has root ash child.
     if (this.r.rootNodes[0])
       if (this.myIp == this.r.lastNode && ip == this.r.rootNodes[0].ip )
         return 1;

     // Root node has all top level nodes as children as well.
     if (this.iamRootNode())
       for (var node of this.r.rootNodes){
         if (node.ip == ip)
           return node.nbr;
       }

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
     if (this.r.nodeNbr == 1)
       this.r.rootNodes.forEach( node=>{
         if (node.ip == dip)
           node.ip = rip;
       });

     this.r.myNodes.forEach( node=>{
       if (node.ip == dip)
         node.ip = rip;
     });
   }
   // ******************************************************************
   // checks to see if the node is the parent of the node to be dropped
   // ==================================================================
   notMyNode(ip){
    if (ip == this.r.rootNodes[0].ip && this.r.nodeNbr == 2 && this.lnodes == 2)
      return false;
    
    if (this.myIp == this.r.lastNode && this.r.rootNodes[0].ip == ip)
      return false;
 
    if (this.r.nodeNbr <= this.net.maxPeers && this.r.nodeNbr > 1)
       return true;

     for (var node of this.r.myNodes)
       if (node.ip == ip)
         return false;
  
     return false;
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
     console.log('becoming root node');
     this.r = {
       rootNodes  : [],
       myNodes    : [],
       lastNode   : this.myIp,
       myParent   : null,
       mylayer    : 1,
       nodeNbr    : 1,
       nlayer     : 1,
       lnode      : 1
     }
     this.r.rootNodes.push({ip:this.myIp,nbr:1,pgroup : []});
     this.net.rootIp = this.myIp;
     this.status = 'root';
   }
   // ***********************************************
   // last node replaces root node if root node is inactive
   // ===============================================
   lnodeReplaceRoot(ip,nbr){
     console.log('lnodeReplaceRoot: '+ip,nbr);
     return new Promise( async (resolve,reject)=>{
     const rip = this.myIp;
     this.r.myNodes  = this.getRootNodePeerGroup(ip);
     this.r.myParent = null;
     this.r.mylayer  = 1;
     this.r.nodeNbr  = 1;
     this.r.lnode--;
     console.log('this.r.lnode ',this.r.lnode);
     this.r.lastNode = await this.getNodeIpByNbr(this.r.lnode);
     console.log('new this.r.lastNode ',this.r.lastNode);
     console.log('this.r.lnode ',this.r.lnode);

     //this.dropLastNode(this.r.myNodes,this.r.lnode +1);
     //this.dropLastNode(this.r.rootNodes,this.r.lnode +1);

     this.r.myNodes.forEach( (n)=>{
       if (n.nbr == nbr)
         n.ip = rip;
     })
     this.r.rootNodes.forEach( (n)=>{
       if (n.nbr == nbr)
         n.ip = rip;
     });

     this.dropLastNode(this.r.myNodes,this.r.lnode +1);
     this.dropLastNode(this.r.rootNodes,this.r.lnode +1);

     this.status = 'root';
     this.net.rootIp = this.myIp;
     this.bcast({simReplaceNode : {ip : ip,nbr : nbr,lnode : this.r.lastNode }});
     resolve(true);
     });
   }
   // ***************************************************
   // send message to last node to replace a failin node
   // ===================================================
   sendMoveRequestToLastNode(ip,nbr){
     console.log('Sending lastNodeMoveTo request to'+ip,nbr);
     return new Promise( async (resolve,reject)=>{

       if (this.r.nodeNbr == 1 && this.r.lnode == 2 && nbr == 2){
         this.becomeRoot();
         resolve(null);
         return;
       }
       if (this.r.nodeNbr == 2 && this.r.lnode == 2 && nbr == 1){
         this.becomeRoot();
         resolve(null);
         return;
       }
       if (this.notMyNode(ip)){
         console.log('not my node to drop',ip);
         //clearTimeout(gtime);
         resolve(null);
         return;
       }
       if (this.myIp == this.r.lastNode && nbr == 1){
         console.log('removing last node to replace root');
         await this.lnodeReplaceRoot(ip,nbr);
         resolve(null);
         return;
       }
       if (ip == this.r.lastNode){
         console.log('removing last node');
         console.log('asking nework for lastNode ip',this.r.lnode);
         await this.getNodeIpByNbr(this.r.lnode -1); 
         const lnode = this.responseSendIp;
         console.log('lnode reported is',lnode);
         this.simReplaceNode({ip : ip,nbr:nbr,lnode : lnode });
         this.bcast({simReplaceNode : {ip : ip,nbr : nbr,lnode : lnode}});
         resolve(null);
         return;
       }
       const req = {
         req       : 'lastNodeMoveTo',
         myNodes   : this.getDropNodePeerGroup(ip),
         myParent  : this.myIp,
         mylayer   : this.getNthLayer(this.net.maxPeers,nbr),
         nodeNbr   : nbr,
         dropIp    : ip
       }
       console.log('request looks like this',req);
       this.net.sendMsgCX(this.r.lastNode,req);
       resolve(this.r.lastNode);
     });
   }
   // ******************************************************
   // last node moves position to replace the droppe  node
   // ******************************************************
   async lastNodeMoveTo(j){
     const rip = this.myIp;
     const dropNbr = this.r.nodeNbr;

     this.r.myNodes   = j.myNodes;
     this.r.myParent  = j.myParent;
     this.r.mylayer   = j.mylayer;
     this.r.nodeNbr   = j.nodeNbr;

     console.log('lastNode droping',dropNbr);
     this.dropLastNode(this.r.rootNodes,dropNbr);
     this.r.myNodes.forEach( (n)=>{
       if (n.nbr == j.nodeNbr)
         n.ip = rip;
     })
     this.r.rootNodes.forEach( (n)=>{
       if (n.nbr == j.nodeNbr)
         n.ip = rip;
     });
     this.decCounters();
     if (j.nodeNbr == 1){
       this.status = 'root';
       this.r.myParent = null;
     }
     this.r.lastNode = await this.getNodeIpByNbr(this.r.lnode);
     this.bcast({simReplaceNode : {ip : j.dropIp,nbr : j.nodeNbr,lnode : this.r.lastNode}});
   }
   // ************************************************
   // All nodes accept the last node find and replace 
   // the ip of the dropped node nbr
   // ================================================
   simReplaceNode(node){ 
     console.log('simReplace',node);
     if (this.r.nodeNbr == node.nbr){
       console.log('can not drop self');
       return;
     }
     const rip = this.r.lastNode; 

     this.dropLastNode(this.r.myNodes,this.r.lnode);
     this.dropLastNode(this.r.rootNodes,this.r.lnode);

     if (rip == this.myIp){
       console.log('this is me!!!!',rip);
       return;
     }
     this.decCounters();

     this.r.myNodes.forEach( (n)=>{
       if (n.nbr == node.nbr)
         n.ip = rip;
     })
     this.r.rootNodes.forEach( (n)=>{
       if (n.nbr == node.nbr)
         n.ip = rip;
     });
     
     this.r.lastNode = node.lnode;
      if (node.nbr == 1)
        if (this.r.myParent == node.ip)
          this.r.myParent = rip;
     this.net.rootIp = this.r.rootNodes[0].ip;
     console.log('new last node is;',this.r.lastNode);
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
     else 
       if (this.inRootTab(ip))
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
       mylayer    : 1,
       nodeNbr    : 1,
       nlayer     : 1,
       lnode      : 1
     }
     this.r.rootNodes.push({ip:this.myIp,nbr:1,pgroup : []});
     const cRoot = await this.findWhoIsRoot();
     console.log(cRoot);
     this.net.rootIp = cRoot.rip;
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
       const req = this.joinQue[0];
       this.joinQue.shift();
       console.log('Sending Join Req from que ',req);
       this.handleJoins(req.jIp,req.j);
     }
     const jqTime = setTimeout( ()=>{
        this.procJoinQue();
     },1000);
   }
   handleJoins(res,j){
     if (this.r.lastNode == j.remIp){
       this.net.endResCX(res,'{"result":"alreadyJoined"}');
       return;
     }
     if (this.startJoin || this.err){  //this.node.isError(res)){
       if (this.startJoin != res)
         this.joinQue.push({jIp:res,j:j});
       this.net.endResCX(res,'{"result":"reJoinQued"}');
       return;
     }
     this.joinTime = setTimeout( ()=>{
       console.log('join timeount',res);
       this.startJoin = false;
     },8000);

     this.startJoin = res;
     const addRes = this.addNewNodeReq(j.remIp);

     if (addRes){
       const reply = {addResult : this.newNode}
       this.net.endResCX(res,JSON.stringify(reply));
       this.newNode = null;
       this.bcast({newNode : j.remIp,rootUpdate : this.r.rootNodes});
       this.startJoin = false;
       clearTimeout(this.joinTime);
     }
     else {
       this.net.endResCX(res,JSON.stringify({addResult : 'Forwarded Request To Join'}));
     }
   }
   // ********************************
   // Handler for incoming http request
   // ================================   
   handleReq(res,j){
     this.net.resetErrorsCnt(j.remIp);
     if (j.req == 'joinReq'){
       this.handleJoins(res,j);
       return true;
     }
     if (j.req == 'rootStatusDropNode'){
       this.startJoin = 'waitForDrop';
       return;
     }
     if (j.req == 'lastNodeMoveTo'){
       this.lastNodeMoveTo(j);
       this.net.endResCX(res,'{"lasNodeMoveToResult":"OK"}');
       return true;
     }
     if (j.req == 'lnParentAddNode'){
       console.log('received reqeust lnParentAddNode');
       this.net.sendMsgCX(this.r.myParent,{req : "lnForwardedAddNode", ip : j.ip});
       this.net.endResCX(res,'{"lnParentNodeAdded":true,"result":"forwarded",parent : '+this.r.myParent+'}');
       return true;
     }
     if (j.req == 'lnForwardedAddNode'){
       console.log('received forward reqeust lnForwardNode');
       this.lnParentAddNode(res,j.ip);
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
       this.net.endResCX(res,'{"result":"OK"}');       
       return true;
     }
     if (j.req == 'whoIsRoot?'){
       if (this.status == 'online' || this.status == 'root'){
         const qres = {
           whoIsRootReply : {
             rip      : this.r.rootNodes[0].ip,
             maxPeers : this.net.maxPeers
           }
         } 
         console.log('here is root',qres);
         this.net.endResCX(res,JSON.stringify(qres));
       }
       else {
         this.net.endResCX(res,'{"whoIsRootReply":"notready"}');
       }
       return true;
     }
     if (j.req == 'pRouteUpdate'){
       this.updatePeerRouting(j);
       this.net.endResCX(res,'{"result":"OK"}');
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
       this.r.myParent = this.r.rootNodes[0].ip;
       this.newNode = null;
       this.r.mylayer = this.r.nlayer;
       //console.log('NEW NET add Result',j.addResult);
       this.status = 'online';
       return true;
     }
     if (j.pingResult){
       //console.log('Ping Result '+j.status,this.status);
     
       if (!j.status && this.r.myParent == j.remIp && this.r.nodeNbr > 1){
         if(this.status != 'detached')
           this.rejoinNetwork();
       }
       return true;

     }    
     return false;
   }
   // ***************************************************
   // Handle Broadcasts From the network
   // ==================================================
   handleBcast(j){
     //console.log('Broadcast Recieved: ',j.msg);
     if (j.msg.newNode){
       this.addNewNodeBCast(j.msg.newNode,j.msg.rootUpdate);
       return true;
     }
     if (j.msg.simReplaceNode){
       console.log('got simReplaceNode',j.msg.simReplaceNode);
       this.simReplaceNode(j.msg.simReplaceNode);
       this.err = false; //this.node.clearError(j.msg.simReplaceNode.ip);
       this.clearWaitForDrop();
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
       console.log('Updating Root Tables',j.msg.rootTabUpdate);
       if (this.inRootTab(j.remIp)){
         console.log('Updating Root Tables',j.msg.rootTabUpdate);
         this.r.rootNodes = j.msg.rootTabUpdate;       
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
       console.log('got whoIsRoot',j.req);
       return true;
     } 
     if (this.status == 'startup')
       return true;

     if(j.req == 'bcast'){
       this.routePastNode(j);
       return true;
     }
     // Que errors to nodes that are not in my control.
     if (this.isMyChild(j.toHost) === null){
       this.net.queMsg(j);
       return;
     }
     if (!this.err){ //this.node.isError(j.toHost)){
       this.net.incErrorsCnt(j.toHost);
       if (this.net.getNodesErrorCnt(j.toHost) > 2){
         
         //console.log('XHR Fail',j);
         this.err = true; //this.node.pushError(j.toHost);
         this.notifyRootDropingNode(j.toHost);
         this.eTime = setTimeout( ()=>{
           console.log('Drop Time Out',j);
           this.err = false; //this.node.clearError(j.toHost);
         },8000);
         const nbr = this.inMyNodesList(j.toHost); 
         if(nbr){
           var nIp = await this.sendMoveRequestToLastNode(j.toHost,nbr);
           console.log('nIp is now',nIp);

           if(!nIp){
             this.err = false; //this.node.clearError(j.toHost);
             this.clearWaitForDrop();
             clearTimeout(this.eTime);
           }
         }
         else {
           this.err = false; //this.node.clearError(j.toHost);
           this.clearWaitForDrop();
           clearTimeout(this.eTime);
         }
       }
       else { 
         console.log('queing errored message',j);
         this.net.queMsg(j);
       } 
       return true;
     }
     return false;
   }
   // ****************************************
   // Check if ip is in my child nodes list
   // ========================================
   isMyChild(ip){
     if (this.r.rootNodes[0])
       if (this.myIp == this.r.lastNode && ip == this.r.rootNodes[0].ip )
         return 1;

     // Root node has all top level nodes as children as well.
     if (this.iamRootNode())
       for (var node of this.r.rootNodes){
         if (node.ip == ip)
           return node.nbr;
       }

     if (!this.r.myNodes)
       return null;

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
       try {rtab =  fs.readFileSync('keys/myNodeList.net');}
       catch {console.log('no node list  file found');resolve(null);}
       try {
         rtab = JSON.parse(rtab);
         resolve(rtab);
       }
       catch {resolve(null);}
     });
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
     this.nodes.forEach( (n, index, object)=>{
       if (n.ip == ip){
         if (n.nMsg <= 1)
           object.splice(index,1)
         else 
           n.nMsg--;
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
   constructor (options,network=null,port=1336,wmon=1339,maxPeers=3){
      super(); 
      this.nodeType  = 'router';
      this.pulseRate = 10*1000;	   
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
   }  
   readNodeFile(){
     return new Promise( (resolve,reject)=>{
       var nodes = null;
       try {nodes =  fs.readFileSync('keys/myNodeList.net');}
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
       this.nodes = await this.readNodeFile();
       this.genNetKeyPair();
       this.startServer();
       this.rnet = new MkyRouting(this.netIp(),this);
       await this.rnet.routingReady();
       setTimeout ( ()=>{
	 this.heartBeat();
       },this.pulseRate);
       setTimeout ( ()=>{
	 this.groupPing(this.nodes,'170.187.179.251');
       },5*1000);
       resolve(true);
     });
   }
   netIp(){
      const { networkInterfaces } = require('os');
      const nets = networkInterfaces();
      const results = Object.create(null); // Or just '{}', an empty object

      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
          if (net.family === 'IPv4' && !net.internal && net.netmask != '255.255.128.0') {
            if (!results[name]) {
              results[name] = [];
            }
            results[name].push(net.address);
          }
        }
      }
      return results['eth0'][0];
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
          console.log('Peer Wallet:',j);
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
        console.log('Response Error JSON.parse',msg);
        return;
      }
      if(corx){
        jmsg.PNETCOREX = true;
      }
      this.sendReply(resIp,jmsg);
   }
   startServer(){
      this.server = https.createServer(this.options, (req, res) => {
        this.resHandled = false;
        this.svtime = setTimeout( ()=>{
          if (!this.resHandled){
            console.log('server response timeout',req.url);
            //res.end('{"server":"timeout"}');
            this.resHandled = true;
          }
        },5000); 
   
	//this.remIp = req.headers['x-forwarded-for'] ||
        this.remIp = req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress;
        this.remIp = this.remIp.replace('::ffff:','');

        if (req.url.indexOf('/netREQ') == 0){
          if (req.method == 'POST') {
            var body = '';
            req.on('data', (data)=>{
              body += data;
              // Too much POST data, kill the connection!
              //console.log('body.length',body.length);
              if (body.length > 300000000){
                console.log('max datazize exceeded');
                req.connection.destroy();
              }
            });
            req.on('end', ()=>{
              var j = null;
              try {
                j = JSON.parse(body);
                if (j.hasOwnProperty('msg') === false) throw 'invalid netREQ no msg body found';
		if (!j.msg.remIp) j.msg.remIp = this.remIp;
                this.resHandled = true;
                clearTimeout(this.svtime);
                if (j.msg.hasOwnProperty('PNETCOREX') === false){
                  this.emit('mkyReq',this.remIp,j.msg);
		} 
		else {
                  this.emit('peerTReq',this.remIp,j.msg);
		}
		res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end('{"netReq":"OK"}');
              }
              catch (err) {
		console.log('POST netREQ Error: ',err);
                console.log('POST msg was ->',j);
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(500);
                res.end('{"netReq":"Fail","error":"'+err+'"}');
                this.resHandled = true;
                clearTimeout(this.svtime);
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
                req.connection.destroy();
              }
            });
            req.on('end', ()=>{
              var j = null;
              try {
                j = JSON.parse(body);
                if (j.hasOwnProperty('msg') === false) throw 'invalid netREPLY no msg body found';
                if (!j.msg.remIp) j.msg.remIp = this.remIp;
                clearTimeout(this.svtime);
                if (j.msg.hasOwnProperty('PNETCOREX') === false){
		  this.emit('mkyReply',j.msg);
		}
		else {
		  this.emit('peerTReply',j.msg);
		}
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                res.end('{"netREPLY":"OK"}');
              }
              catch(err) {
                console.log('POST netREPLY Error: ',err);
                console.log('POST msg was ->',j);
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(500);
                res.end('{"netREPLY":"fail","error":"'+err+'"}');
                clearTimeout(this.svtime);
              } 
            });
          }
        }
        else {
          this.endResCX(res,'Welcome To PeerTree Network Sevices\nWaiting...\n' + decodeURI(req.url) + ' You Are: ' + this.remIp );
          clearTimeout(this.svtime);
          this.resHandled = true;
        }}
      });
      this.server.listen(this.port);
      console.log('Server PeerTree7.2 running at ' + this.netIp() + ':' + this.port);
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
      console.log('starting groupPing:',targetIp);
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
          console.log('grpPing Done:',grpPing);
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
      
      /*
      if (this.isRoot){ 
        setTimeout( ()=>{
          this.groupPing(ipList,targetIp);
        },10000);
      }
      */
      
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
     console.log('Got PingTarget Request:',j); 
     var reply = {
       gpingResult : {
         targetIP : null,
 	 ptime    : Date.now(),
	 pStatus  : null
       }
     };	     
     var hListener = null;
     var rListener = null;
     this.rnet.net.once('xhrFail',hListener = (J)=>{
       reply.gpingResult.targetIP = j.target;
       reply.gpingResult.pStatus  = 'targDead';
       reply.gpingResult.ptime    = null;
       this.sendReplyCX(j.remIp,reply);
     });
     this.rnet.net.once('peerTReply',rListener  = (J)=>{
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
     },1000);

     //Ping the target
     this.sendMsgCX(j.target,{ping : "hello"});
   }
   /********************************************************
   PingsYour accociated peers, nodes,parrent,root to determine
   your nodes health on the network
   */
   heartBeat(){
      //console.log('starting heartBeat:');
      if(this.rnet && this.status != 'startup'){
        var hrtbeat = {
          pings    : [],
          myStatus : 'OK',
          tstamp   : Date.now()
        };
	var hListener = null;
        var rListener = null;
        this.rnet.net.on('xhrFail',hListener = (j)=>{
          const peer = this.heartbIndexOf(hrtbeat.pings,j.remIp);
          if (peer !== null){
            hrtbeat.pings[peer].pRes = 'dead';
          }          
        });
        this.rnet.net.on('peerTReply',rListener  = (j)=>{
          const pTime = Date.now() - hrtbeat.tstamp; 
	  const peer = this.heartbIndexOf(hrtbeat.pings,j.remIp);
	  if (peer !== null){
            hrtbeat.pings[peer].pRes = j.pingResult;
	    hrtbeat.pings[peer].pTime = pTime;
	  }	  
        });
        const hTimer = setTimeout( ()=>{
          this.rnet.net.removeListener('peerTReply', rListener);
          this.rnet.net.removeListener('xhrFail', hListener);
          hrtbeat.myStatus = this.reviewMyStatus(hrtbeat);
	  //console.log('hearBeat Done:',hrtbeat);
        },1000);

	if (this.rnet.r.myParent){
          hrtbeat.pings.push({pIP:this.rnet.r.myParent,pType:'myParent',pRes : null});
	  this.sendMsgCX(this.rnet.r.myParent,{ping : "hello"});
        }
        if(this.rnet.r.myNodes)
          for (var node of this.rnet.r.myNodes){
            hrtbeat.pings.push({pIP:node.ip,pType:'myNodes',pRes : null});
            this.sendMsgCX(node.ip,{ping : "hello"});
          }
            
        if (this.rnet.r.nodeNbr == 1){
          for (var node of this.rnet.r.rootNodes){
            if (node.ip != this.rnet.myIp){
              hrtbeat.pings.push({pIP:node.ip,pType: 'rootNodes',pRes : null});
              this.sendMsgCX(node.ip,{ping : "hello"});
            } 
          }
        }
        if (this.rootIp != this.rnet.myIp){
          hrtbeat.pings.push({pIP:this.rootIp,pType : 'root',pRes : null});
          this.sendMsgCX(this.rootIp,{ping : "hello"});
        }
      }
      if (hrtbeat.pings.length == 0){
	hrtbeat.myStatus = 'Alone';
      }
      var timeout = setTimeout( ()=>{this.heartBeat();},this.pulseRate);
  }
  /************************************************
  Called by heartBeat To evelute your current status
  */
  reviewMyStatus(peers){
    return 'healthy';
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
     if (!checkRemAddress != j.remMUID) {
       console.log('remAddress not matching');
       return false;
     }

     const publicKey = ec.keyFromPublic(j.remPublicKey, 'hex');
     const msgHash   = this.calculateHash(j.remIp + j.msgTime);
     return publicKey.verify(msgHash, j.signature);
  }
  processMsgQue(){
     if (this.msgQue.length){
       const msg = this.msgQue[0];
       this.msgQue.shift();
       this.msgMgr.remove(msg.toHost);
       console.log('Sending Message from que to '+msg.toHost,msg);
       this.sendMsgCX(msg.toHost,msg.msg);
     }
     var qtime = setTimeout( ()=>{
       this.processMsgQue();
      },1500);
  }
  queMsg(msg){
     //console.log('Msg Log Counter: ',this.msgMgr.count(msg.toHost));
     if (this.msgMgr.count(msg.toHost) < 20){
       console.log('pushing msg:',msg);
       this.msgQue.push(msg);
       this.msgMgr.add(msg.toHost);
       return true;
     }
     else 
       return false; //this.abandonNode(msg.toHost)
  }
  getNetRootIp(){
     const r = this.rnet.r.rootNodes[0]; 
     if (!r) 
       return this.rootIp;
     return r.ip;
  }
  sendMsgCX(toHost,msg){
    this.sendMsg(toHost,msg,true);
  }	  
  sendMsg(toHost,msg,corx=false){
      if (!toHost) {console.log('Send Message Host '+toHost+' Missing',msg);return;}
      if (!msg)    {console.log('Send Message Msg  Missing');return;} 

      if (toHost == this.rnet.myIp)
        return;

      if (msg.reroute) {} //console.log('Forwarding re-routed msg');
      if(corx){
        msg.PNETCOREX = true;
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

     const options = {
       hostname : toHost,
       port     : this.port,
       path     : endPoint,
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'Content-Length': data.length
       }
     }

     const req = https.request(options, res => {
       res.on('end',()=>{
         this.sendingReply = false;
       });
     })

     req.on('error', error => {
	msg.toHost = toHost
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
     fs.writeFile('keys/myNodeList.net', JSON.stringify(myNodes), function (err) {
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
     fs.writeFile('keys/myNodeList.net', JSON.stringify(myNodes), function (err) {
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
       console.log('xhrFail handler:',j);
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
       console.log(j);
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
       // Add node yhe contacts List 
       this.pushToContacts(j);

       if (this.rnet.handleReq(remIp,j))
         return;

       if (j.gping == 'hello'){
         this.pingTarget(j);
         return;	 
       }
       if (j.ping == 'hello'){
         var result = this.rnet.checkPeerStatus(j.remIp);
         this.endResCX(remIp,'{"pingResult":"hello back","status":'+result+'}');
         return;
       }      
       if (j.req == 'bcast'){
         this.emit('bcastMsg',j);
         this.rnet.forwardMsg(j);
         this.endResCX(remIp,'');
         this.handleBcast(j);
         return;
       }
     });
  }
};
module.exports.PeerTreeNet  = PeerTreeNet;
