/*
Dust Removed: Date: Dec 28, 2022
*/

class MkyPeers {
  constructor (p){
    this.ip       = p.ip;
    this.status   = p.status;
    this.lastMsg  = p.lastMsg;
  }
}
class MkyBankGroupMgr{
  constructor (bank){
    this.pollTime = 15*1000;
    this.bank     = bank;
    this.myType   = 'banker';
    this.myBranch = bank.branchId;
    this.myPeers = [];
    this.me = {
      ip : bank.net.rnet.myIp,
      status : bank.status,
      lastMsg : null
    }
    this.joinGroup(this.me);
    this.listGroup();
    this.pingGroup();
  }
  
  joinGroup(me){
    var breq = {
      to : 'bankers',
      branch : 2,
      joinGroup : me
    }
    this.bank.net.broadcast(breq);
  }
  replyGotUAddMe(to){
    var req = {
      req : 'gotUAddMe',
      me  : this.me
    }
    this.bank.net.sendMsg(to,req);
  }
  pingGroup(){
    var req = {
      req : 'sendStatus'
    }
    this.msgGroup(req);
    const group =  this;
    var t = setTimeout(function (){
      group.pingGroup();
    },group.pollTime);
  }
  msgGroup(msg){
   //console.log('start msg to group',msg);
    for (var p of this.myPeers){
     //console.log('sending to:',p.ip);
      this.bank.net.sendMsg(p.ip,msg);
    }
  }
  changeMyStatus(status){
    this.me.status = status;
    var req = {
      req : 'changeBankStatus',
      me : this.me
    }
    this.msgGroup(req);
  }
  updateGroup(peer){
    const group = this;
    this.myPeers.forEach(p => {
      if (p.ip == peer.ip){
        p.status = peer.status;
        p.lastMsg = Date.now();
        group.listGroup();
        return;
      }
    });
  }
  addPeer(p){
    for (var i of this.myPeers){
     //console.log(i,p);
      if (i.ip == p.ip){
        return;
      }
    }
    this.myPeers.push(p);
    this.listGroup();
  }
  listGroup(){
   //console.log('group Type',this.myType);
   //console.log('branch',this.myBranch);
   //console.log('peers',this.myPeers);
  } 
}
module.exports.MkyBankGroupMgr = MkyBankGroupMgr;
module.exports.MkyPeers        = MkyPeers;
