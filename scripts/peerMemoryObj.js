//const config       = require('./config.js');
var dateFormat     = require('./mkyDatef');
const EventEmitter = require('events');
const https        = require('https');
const fs           = require('fs');
const mkyPubKey    = '04a5dc8478989c0122c3eb6750c08039a91abf175c458ff5d64dbf448df8f1ba6ac4a6839e5cb0c9c711b15e85dae98f04697e4126186c4eab425064a97910dedc';
const EC           = require('elliptic').ec;
const ec           = new EC('secp256k1');
const bitcoin      = require('bitcoinjs-lib');
const crypto       = require('crypto');
const mysql        = require('mysql');
const schedule     = require('node-schedule');
const {MkyWebConsole}                   = require('./networkWebConsole.js');

addslashes  = require ('./addslashes');

/*********************************************
PeerTree Receptor Node: listens on port 1335
==============================================
This port is used for your regular apps to interact
with a memoryCell on the PeerTree Memory network;
*/

class peerMemToken{
   constructor(){
      this.publicKey   = null;
      this.privateKey  = null;
      this.signingKey  = null;
      this.openWallet();
   }

   openWallet(){
      var keypair = null;
      try {keypair =  fs.readFileSync('keys/peerMemToken.key');}
      catch {console.log('no wallet file found');}
      this.publicKey = null;
      if (keypair){
        try {
          const pair = keypair.toString();
          const j = JSON.parse(pair);
          console.log(j);
          this.publicKey    = j.publicKey;
          this.privateKey   = j.privateKey;
          this.memOwnMUID   = j.memOwnMUID;
          this.signingKey   = ec.keyFromPrivate(this.privateKey);
        }
        catch {console.log('wallet file not valid');process.exit();}
      }
      else {
        const key = ec.genKeyPair();
        this.publicKey = key.getPublic('hex');
        this.privateKey = key.getPrivate('hex');

        console.log('Generate a new wallet key pair and convert them to hex-strings');
        const mkybc = bitcoin.payments.p2pkh({ pubkey: new Buffer(''+this.publicKey, 'hex') });
        this.branchMUID = mkybc.address;

        const wallet = '{"memOwnMUID":"'+ this.branchMUID+'","publicKey":"' + this.publicKey + '","privateKey":"' + this.privateKey + '"}';

        fs.writeFile('keys/peerMemToken.key', wallet, function (err) {
          if (err) throw err;
         //console.log('Wallet Created And Saved!');
        });
      } 
    } 
}; 

const recPort = 1335;

class peerMemCellReceptor{
  constructor(peerTree){
    this.peer = peerTree;
    console.log('ATTACHING - cellReceptor on port'+recPort);

    const options = {
      //key: fs.readFileSync('/etc/letsencrypt/live/admin.bitmonky.com/privkey.pem'),
      //cert: fs.readFileSync('/etc/letsencrypt/live/admin.bitmonky.com/fullchain.pem')
      key: fs.readFileSync('keys/privkey.pem'),
      cert: fs.readFileSync('keys/fullchain.pem')
    };
    this.memToken = new peerMemToken();
    console.log(this.memToken);
    var bserver = https.createServer(options, (req, res) => {

      res.writeHead(200);
      if (req.url == '/keyGEN'){
        // Generate a new key pair and convert them to hex-strings
        const key = ec.genKeyPair();
        const publicKey = key.getPublic('hex');
        const privateKey = key.getPrivate('hex');
        console.log('pub key length' + publicKey.length,publicKey);
        console.log('priv key length' + privateKey.length,publicKey);
         res.end('{"publicKey":"' + publicKey + '","privateKey":"' + privateKey + '"}');
      }
      else {
        if (req.url.indexOf('/netREQ/msg=') == 0){
          var msg = req.url.replace('/netREQ/msg=','');
          msg = msg.replace(/\+/g,' ');
          msg = decodeURI(msg);
          msg = msg.replace(/%3A/g,':');
          msg = msg.replace(/%2C/g,',');
          msg = msg.replace(/\\%2F/g,'/');
          var j = null;
          try {j = JSON.parse(msg);}
          catch {
             console.log("json parse error:",msg);
             process.exit();
          }
          console.log('mkyReq',j);

          if (j.req == 'storeMemory'){
	    this.prepMemoryReq(j,res);
            return;
          }   
          res.end('OK');
        }
        else {
          res.end('Wellcome To The PeerTree KeyGEN Server\nUse end point /keyGEN to request key pair');
        }
      }
    });
  
    bserver.listen(recPort);
    console.log('peerTree Memory Receptor running on port:'+recPort);
  }
  procQryResult(j){
    console.log('incoming search result:',j);
  }
  openMemKeyFile(j){
    const bitToken = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+this.memToken.publicKey, 'hex') }); 
    var mToken = {
      publicKey   : this.memToken.publicKey,
      ownMUID     : bitToken.address,
      privateKey  : this.memToken.privateKey  // create from public key using bitcoin wallet algorythm.
    };
    return mToken;
  }
  prepMemoryReq(j,res){
    j.memory.token = this.openMemKeyFile(j);
    var SQL = "SELECT pcelAddress FROM peerBrain.peerMemCells ";
    SQL += "where pcelLastStatus = 'online' and  timestampdiff(second,pcelLastMsg,now()) < 50 order by rand() limit 1";
    console.log(SQL);
    var nStored = 0;
    con.query(SQL, (err, result, fields)=> {
      if (err) {console.log(err);}
      else {
        if (result.length == 0){
          res.end('{"result":"memOK","nRecs":0,"memory":"No Nodes Available"}');
	}	
	result.forEach(async(rec,n) =>{ 
          try {
            var qres = await this.peer.receptorReqStoreMem(j,rec.pcelAddress);
            if (qres){
	      nStored = nStored +1;
	    }    
          }
	  catch(err) {
            console.log('memeory storage failed on:',rec.pcelAddress);
          }
          if (n==result.length -1){
            res.end('{"result":"memOK","nRecs":'+nStored+'","memory":'+JSON.stringify(j)+'}');
	  }	
	});
      } 		  
    });
  }
  signMemRequest(j){
    return;
  }
};
/*----------------------------
End Receptor Code
==============================
*/
var con = mysql.createConnection({
  host: "localhost",
  user: "username",
  password: "password",
  database: "peerBrain",
  dateStrings: "date",
  multipleStatements: true,
  supportBigNumbers : true
});
con.connect(function(err) {
  if (err) throw err;
});

function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max));
}
class peerMemoryObj {
  constructor(peerTree,reset){
    this.reset      = reset;
    this.isRoot     = null;
    this.status     = 'starting';
    this.net        = peerTree;
    this.receptor   = null;
    this.wcon       = new MkyWebConsole(this.net,con,this);
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
    if (this.reset)
      if (this.reset == 'rebuild')
        await this.reBuildDb(this.resetBlock);
      else 
        await this.resetDb(this.resetBlock);

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
  getBlockCtr(type){
    for (var bc of this.blockCtr)
     if (bc.type == type);
       return bc;
  } 
  resetBlockCtrs(){
    return new Promise( async (resolve,reject)=>{
      this.blockCtr = [];
      for (var btype of bcTypes){
        const block = await this.checkLastBlockNbr(btype);
        var blockCtr = {
          nbr  : block.nbr,
          nRec : block.nRec + 0,
          type : btype,
          maxBlockSize : this.maxBlockSize
        }
        this.blockCtr.push(blockCtr);
      }
      resolve (true);
    });
  }
  updatePMemcellDB(j){
    console.log('Reviewing PeerTree Nodes DB',j);
    var SQL = "SELECT count(*)nRec FROM peerBrain.peerMemCells where pcelAddress = '"+j.remIp+"'";
    con.query(SQL,(err, result, fields)=> {
      if (err) console.log(err);
      else {
        if (result[0].nRec == 0){
          SQL = "insert into peerBrain.peerMemCells (pcelAddress,pcelLastStatus,pcelLastMsg)";
          SQL += "values ('"+j.remIp+"','New',now())";
          con.query(SQL,(err, result, fields)=>{
            if (err) console.log(err);
          });
        }
	else {
          SQL = "update peerBrain.peerMemCells set pcelLastStatus = 'online',pcelLastMsg = now() ";
          SQL += "where pcelAddress = '"+j.remIp+"'";
          console.log(SQL);
          con.query(SQL,(err, result, fields)=>{
            if (err) console.log(err);
          });
	}		
      }
    });
  }	  
  doNodesDBMaint(){
    console.log('Reviewing PeerTree Nodes DB',this.net.nodes);
    this.net.nodes.forEach((node) => {
      var SQL = "SELECT count(*)nRec FROM peerBrain.peerMemCells where pcelAddress = '"+node.ip+"'";
      con.query(SQL, function (err, result, fields) {
        if (err) console.log(err);
        else {
          if (result[0].nRec == 0){
            SQL = "insert into peerBrain.peerMemCells (pcelAddress,pcelLastStatus,pcelLastMsg)";
            SQL += "values ('"+node.ip+"','New',now())";
            con.query(SQL, function (err, result, fields) {
              if (err) console.log(err);
            });
          }
        }
      });
    });	    
  }	  
  resetDb(blockNbr=null){
    return new Promise( (resolve,reject)=>{
      var SQL = "";
      SQL =  "truncate table peerBrain.peerMemCells; ";
      SQL += "truncate table peerBrain.peerMemoryCell; ";
      con.query(SQL, async (err, result, fields)=>{
        if (err) {console.log(err);reject(err);}
        else {
          resolve("OK");
        }
      });
    });
  }
  handleXhrError(j){
    if (!j.msg)
      return;    
    const msg = j.msg;
    if (msg.req == 'sendStatus'){
      var node = {
        ip : j.toHost,
        status : 'offline',
        lastMsg : null
      }
      this.group.updateGroup(node);
      return;
    }   
  }
  handleReq(res,j){
    //console.log('root recieved: ',j);
    if (j.req == 'pMemQryResult'){
      this.pushQryResult(j,res);
      return true;
    }
    if (j.req == 'storeMemory'){
      this.storeMemory(j,res);
      return true;
    }
    if (j.req == 'gotUAddMe'){
      this.group.addPeer(j.me);
      this.net.endRes(res,'');
      return true;
    }
    if (j.req == 'sendStatus'){
      this.group.me.status = this.status;
      this.net.endRes(res,'{"statusUpdate":'+JSON.stringify(this.group.me)+'}');
      return true;
    }
    if (!this.isRoot && this.status != 'Online'){
      this.net.endRes(res,'');
      return true;
    }
    return false;
  }
  handleReply(j){
    //console.log('\n====================\memCell reply handler',j);
    if (j.statusUpdate){
      this.group.updateGroup(j.statusUpdate);
      return;
    }
    //if (this.chain.handleReply(j))
    //  return;

   //console.log('\nNo Bank Reply Handler Found For: ',j);
  }
  handleBCast(j){
    //console.log('bcast received: ',j);
    if (!j.msg.to) {return;}
    if (j.msg.to == 'peerMemCells'){
      this.updatePMemcellDB(j);  
      if (j.msg.qry){
        if (j.msg.qry.qryType == 'bestMatch')
          this.doBestMatchQry(j.msg,j.remIp);
        else if (j.msg.qry.qryType == 'seqMatch')
	  this.doSeqMatchQry(j.msg,j.remIp);
      }
    } 
    return;
  }
  sayHelloPeerGroup(){
    var breq = {
      to : 'peerMemCells',
      token : 'some token'
    }
    console.log('bcast greeting to memoryCell group: ',breq);
    this.net.broadcast(breq);
    const gtime = setTimeout( ()=>{
      this.sayHelloPeerGroup();
    },50*1000);
  }
  bufferTransactions(j,to){
     const req = {
       msg : j,
       to : to
     }
     this.tranBuffer.push(req);
  }
  flushTranBuffer(){
    console.log('start flush tranBuffer');

    for (var j of this.tranBuffer){
      this.procBranchReq(j.msg,j.to);
      console.log('Flushing Transaction Buffer',j); 
    }
    this.tranBuffer = [];
  }
  isToday(d){
    let today = new Date(Date.now() -1000*3600*5).toISOString().slice(0, 10);
    if (today == d.slice(0,10))
      return true;
    else
      return false;
  }
  singleSpaceOnly(str){
    //remove eny extra spaces from string
    return str;
  }	  
  doBestMatchQry(msg,ip){
     var qtype = '';
     if (msg.qryType){
       qtype = " and pmcMemObjType = '"+qtype+"'";
     }
     var SQLr = "select pmcMownerID,pmcMemObjID,pmcMemObjNWords,count(*)nMatches,count(*)/pmcMemObjNWords score from peerBrain.peerMemoryCell ";
     SQLr += "where pmcMownerID = '"+msq.ownerID+"' "+qtype+" and (";
     qry = this.singleSpaceOnly(msg.qryStr);
     var words = qry.split(' ');
     var nwords   = memories.length;
     var SQL = "";
     var n = 1;
     var or = 'or ';
     words.forEach( (word) =>{
       if ($n == nwords){
	 or = '';
       }
       SQL += "pmcMemWord = '"+word+"' "+or; 
       $n = $n+1;
     });
     SQL += ")group by pmcMownerID,pmcMemObjID,pmcMemObjNWords ";
     SQL += "having score >= "+msg.reqScore+" ";
     SQL += "order by score desc";
     console.log(SQL);
     con.query(SQL, (err, result, fields)=> {
       if (err) console.log(err);
       else {
         if (result.length > 0){
           var qres = {
             req : 'pMemQryResult',
	     nRec : result.length,
             result : result,
             qry : msg		   
           }
           this.net.sendMsg(ip,qres);
         }
       }
     });
  }
  pushQryResult(j,res) {
    this.net.endRes(res,'{"result":"ok"}');
    this.receptor.procQryResult(j);
  }	  
  receptorReqStoreMem(j,toIp){
    console.log('receptorReqStoreMem',j);
    return new Promise( (resolve,reject)=>{	  
      const gtime = setTimeout( ()=>{
        console.log('Store Request Timeout:');
        resolve(null);
      },10*1000);  
      console.log('Store Memory To: ',toIp);
      var req = {
        req : 'storeMemory',
        memory : j.memory
      }

      this.net.sendMsg(toIp,req);
      this.net.on('mkyReply', r =>{
        if (r.memStoreRes){
          console.log('memStoreRes OK!!',r);
          clearTimeout(gtime);
	  resolve(r);
        }		    
      });
    });
  }	  
  storeMemory(j,res){
    console.log('got request store memory',j);
    var m = j.memory;
    const mUID = m.from;
    var memory = this.singleSpaceOnly(m.memStr);
    var memories = memory.split(' ');
    var nwords   = memories.length;  
    var SQLr = "insert into peerBrain.peerMemoryCell (pmcMownerID,pmcMemObjID,pmcMemObjType,pmcMemObjNWords,pmcMemWord,pmcWordSequence) ";
    var SQL = "";
    var n = 1;
    memories.forEach( (word) =>{
      if (word != ''){
        SQL += SQLr + "values ('"+m.from+"','"+m.memID+"','"+m.memType+"',"+nwords+",'"+word+"',"+n+");";
        n = n + 1;
      }
    });	    
    con.query(SQL , (err, result,fields)=>{
      if (err){
        console.log(err);
        this.net.endRes(res,JSON.stringify(err));
      }
      else {
        const hash = 'write hash function for memstore';
	this.net.endRes(res,'{"memStoreRes":true,"memStorHash":"' + hash + '"}');
      }
    });
  }
};
function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

module.exports.peerMemoryObj = peerMemoryObj;
module.exports.peerMemCellReceptor = peerMemCellReceptor;
