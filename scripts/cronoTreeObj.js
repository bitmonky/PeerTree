const PtreeReceptor = require('./ptreeReceptorObj');
const {MkyWebConsole}  = require('./networkWebConsole.js');

class CronoTreeReceptor extends PtreeReceptor {
  constructor(peerTree, port) {
    super(peerTree, port);
  }

  handleReq(msg, res) {
    switch (msg.req) {
      case 'sendCronoTime':
        return this.handleTimeReq(msg, res);

      case 'echo':
        return this.handleEcho(msg, res);

      default:
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Unknown request: ${msg.req}` }));
    }
  }

  handleTimeReq(msg, res) {
    const reply = this.net.getCronoTreeTime();
    res.writeHead(200);
    res.end(JSON.stringify(reply));
  }

}

class CronoTreeObj {
  constructor(peerTree,reset){
    this.reset        = reset;
    this.isRoot       = null;
    this.status       = 'starting';
    this.net          = peerTree;
    this.receptor     = null;
    this.wcon         = new MkyWebConsole(this.net,null,this,'borgAgentCell');
    this.init();
    this.setNetErrHandle();
    this.sayHelloPeerGroup();
  }
  attachReceptor(inReceptor){
    this.receptor = inReceptor;
  }	  
  setNetErrHandle(){
    this.net.on('mkyRejoin',(j)=>{
      console.log('Network Drop Detected',j);
      this.status = 'starting';
      this.init();
    });
  }
  async init(){
  }
  getGoldRate(){
    return new Promise( (resolve,reject)=>{
      const https = require('https');

      const pmsg = {msg : 'sendGoldRate'}
      const data = JSON.stringify(pmsg);

      const options = {
        hostname : 'www.bitmonky.com',
        port     : 443,
        path     : '/whzon/bitMiner/getGoldRate.php',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        }
      }
      const req = https.request(options, res => {
        var rdata = '';
        res.on('data', d => {
          console.log(d);
          rdata += d;
        });
        res.on('end',()=>{
          var reply = null;
          console.log('getGold Rate returned',rdata);
          try {reply = JSON.parse(rdata);}
          catch(err) {reply = {mkyRate:0.0};}
          resolve(reply.mkyRate);
        });
      });

      req.on('error', error => {
        console.error(error)
        resolve(0.0);
      });

      req.write(data);
      req.end();
    });
  }
  handleXhrError(j){
    if (!j.msg)
      return;    
    const msg = j.msg;
  }
  handleReq(res,j){
    if (!this.isRoot && this.status != 'Online'){
      return true;
    }
    return false;
  }
  handleReply(r){
    if (r.req == 'doSomthingExample'){
      //do somestuff an pass result back to receptor
      this.receptor.brain.processRemGroup.Chat(r);
      return;
    } 
  }
  handleBCast(j){
    if (j.remIp == this.net.nIp) {
      //console.log('ignoring bcast to self',this.net.nIp);return;
      return;
    } 
    if (!j.msg.to) {return;}
    if (j.msg.to == 'cronoAgents'){
      if (j.msg.req == 'someBCastRequest'){
        var qres = {req : 'someBCastRequestReply', someData : 'bla...'};
        this.receptor.someBCastREsult(j.remIp,qres);        
      }
      if (j.msg.req){
        if (j.msg.req == 'shareDocHistory'){
          this.receptor.brain.processSharedDocHistory(j.msg);
        }
        // Sample goPOW (proof work random node selection.
        if (j.msg.req == 'sendNodeList'){
          console.log('DOPOW xxxx',j.remIp);
          this.doPow(j.msg,j.remIp);
        }
        if (j.msg.req == 'stopNodeGenIP'){
          console.log('DOPOW stopNodeGenIP-XX Received:',j.remIp);
          this.doPowStop(j.remIp);
        }
      }
    } 
    return;
  }
  sayHelloPeerGroup(){
    var breq = {
      to : 'cronoAgents',
      token : 'hello'
    }
    //console.log('bcast greeting to agentCell group: ',breq);
    if (this.receptor){
      if (this.receptor.brain){
        this.receptor.brain.BORGO = [];
      } else {console.log('receptor.brain Not Ready!',this.receptor);} 
   
    } else {console.log('Receptor Not Ready!',this.receptor);}
    this.net.broadcast(breq);
    const gtime = setTimeout( ()=>{
      this.sayHelloPeerGroup();
    },15*1000);
  }
  doPowStop(remIp){
    this.net.gpow.doStop(remIp);
  }
  doPow(j,remIp){
    this.net.gpow.doPow(2,j.work,remIp);
  }
  receptorReqStopIPGen(work){
    var req = {
      to : 'cronoAgents',
      req : 'stopNodeGenIP',
      work  : work
    }
    this.net.broadcast(req);
  }
  receptorReqNodeList(j){
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const maxIP = j.agent.nCopys;
      var   IPs = [];
      const gtime = setTimeout( ()=>{
        console.log('Send Node List Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(IPs);
      },7*1000);

      var req = {
        to : 'cronoAgents',
        req : 'sendNodeList',
        nodes : maxIP,
        work  : crypto.randomBytes(20).toString('hex') 
      }

      this.net.broadcast(req);
      this.net.on('mkyReply', mkyReply = (r)=>{
        if (r.req == 'pNodeListGenIP'){
          //console.log('mkyReply NodeGen is:',r);
          if (IPs.length < maxIP){
            IPs.push(r.remIp);
          }
          else {
            this.receptorReqStopIPGen(req.work);
            clearTimeout(gtime);
            this.net.removeListener('mkyReply', mkyReply);
            resolve(IPs);
          }
        }
      });
    });
  }
};	  

function sleep(ms){
  return new Promise(resolve=>{
    setTimeout(resolve,ms)
  })
}

module.exports.CronoTreeObj = CronoTreeObj;
module.exports.CronoTreeReceptor = CronoTreeReceptor;

