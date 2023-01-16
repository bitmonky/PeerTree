/******************************************************************
PeerTree - Object shardTreeObj  

2023-0109 - Taken from peerMemoryObj.js to be modified into the shardTreeObj 
*/

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
const {MkyWebConsole} = require('./networkWebConsole.js');
const {pcrypt}        = require('./peerCrypt');

addslashes  = require ('./addslashes');

/*********************************************
PeerTree Receptor Node: listens on port 1335
==============================================
This port is used for your regular apps to interact
with a shardTreeCell on the PeerTree File Store network;
*/

class peerShardToken{
   constructor(){
      this.publicKey   = null;
      this.privateKey  = null;
      this.signingKey  = null;
      this.openWallet();
   }

   openWallet(){
      var keypair = null;
      try {keypair =  fs.readFileSync('keys/peerShardToken.key');}
      catch {console.log('no wallet file found');}
      this.publicKey = null;
      if (keypair){
        try {
          const pair = keypair.toString();
          const j = JSON.parse(pair);
          console.log(j);
          this.publicKey     = j.publicKey;
          this.privateKey    = j.privateKey;
          this.shardOwnMUID  = j.shardOwnMUID;
	  this.shardCipher   = j.shardCipher;
          this.crypt         = new pcrypt(this.shardCipher);
          this.signingKey    = ec.keyFromPrivate(this.privateKey);
        }
        catch {console.log('wallet file not valid');process.exit();}
      }
      else {
        const key = ec.genKeyPair();
        this.publicKey = key.getPublic('hex');
        this.privateKey = key.getPrivate('hex');

        console.log('Generate a new wallet key pair and convert them to hex-strings');
        var mkybc = bitcoin.payments.p2pkh({ pubkey: new Buffer(''+this.publicKey, 'hex') });
        this.branchMUID = mkybc.address;

        const pmc = ec.genKeyPair();
        this.pmCipherKey  = pmc.getPublic('hex');

        console.log('Generate a new wallet cipher key');
        mkybc = bitcoin.payments.p2pkh({ pubkey: new Buffer(''+this.pmCipherKey, 'hex') });
        this.shardCipher = mkybc.address;

        var wallet = '{"shardOwnMUID":"'+ this.branchMUID+'","publicKey":"' + this.publicKey + '","privateKey":"' + this.privateKey + '",';
        wallet += '"shardCipher":"'+this.shardCipher+'"}';
        fs.writeFile('keys/peerShardToken.key', wallet, function (err) {
          if (err) throw err;
         //console.log('Wallet Created And Saved!');
        });
      } 
    } 
}; 

const recPort = 1335;

class shardTreeCellReceptor{
  constructor(peerTree){
    this.peer = peerTree;
    console.log('ATTACHING - cellReceptor on port'+recPort);
    this.results = ['empty'];
    const options = {
      //key: fs.readFileSync('/etc/letsencrypt/live/admin.bitmonky.com/privkey.pem'),
      //cert: fs.readFileSync('/etc/letsencrypt/live/admin.bitmonky.com/fullchain.pem')
      key: fs.readFileSync('keys/privkey.pem'),
      cert: fs.readFileSync('keys/fullchain.pem')
    };
    this.shardToken = new peerShardToken();
    console.log(this.shardToken);
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
              }
              catch {j = JSON.parse('{"result":"json parse error:"}');console.log('POST Reply Error: ',j)}
              res.setHeader('Content-Type', 'application/json');
              res.writeHead(200);
              if (j.req == 'storeShard'){
                this.reqStoreShard(j,res);
                return;
	      }	      
	      res.end('{"netReq":"action '+j.req+' not found"}');
            });
          }
	}	
        else {
          res.end('Wellcome To The PeerTree KeyGEN Server\nUse end point /keyGEN to request key pair');
        }
      }
    });
  
    bserver.listen(recPort);
    console.log('peerTree Shard Receptor running on port:'+recPort);
  }
  procQryResult(j){
    console.log('incoming search result:',j);
  }
  openShardKeyFile(j){
    const bitToken = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+this.shardToken.publicKey, 'hex') }); 
    var mToken = {
      publicKey   : this.shardToken.publicKey,
      ownMUID     : bitToken.address,
      privateKey  : this.shardToken.privateKey  // create from public key using bitcoin wallet algorythm.
    };
    return mToken;
  }
  async doSearch(j,res){
    this.results = {result : 0, msg : 'no results found'};
    var breq = {
      to : 'shardTreeCells',
      qry : j.qry
    }
    console.log('bcast search request to shardCell group: ',breq);
    this.peer.net.broadcast(breq);
    const qres = await this.getSearchResults(j);
    res.end(JSON.stringify(qres));
  }
  getSearchResults(j){
    return new Promise( async(resolve,reject)=>{
      await sleep(2*1000);
      resolve('{"result": 1,"data":'+JSON.stringify(this.results)+'}');
    });
  }
  reqStoreShard(j,res){
    j.shard.token = this.openShardKeyFile(j);
    var SQL = "SELECT scelAddress FROM shardTree.shardCells ";
    SQL += "where scelLastStatus = 'online' and  timestampdiff(second,scelLastMsg,now()) < 50 order by rand() limit 1";
    console.log(SQL);
    var nStored = 0;
    con.query(SQL, (err, result, fields)=> {
      if (err) {console.log(err);}
      else {
        if (result.length == 0){
          res.end('{"result":"shardOK","nRecs":0,"shard":"No Nodes Available"}');
	}	
	result.forEach(async(rec,n) =>{ 
          try {
            var qres = await this.peer.receptorReqStoreShard(j,rec.scelAddress);
            if (qres){
	      nStored = nStored +1;
	    }    
          }
	  catch(err) {
            console.log('shard storage failed on:',rec.scelAddress);
          }
          if (n==result.length -1){
            j.shard.token.privateKey = '**********';
            j.shard.token.publicKey  = '**********';
            res.end('{"result":"shardOK","nStored":'+nStored+',"shard":'+JSON.stringify(j)+'}');
	  }	
	});
      } 		  
    });
  }
  signShardRequest(j){
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
  database: "shardTree",
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
class shardTreeObj {
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
    if (this.reset){
      await this.resetDb(this.resetBlock);
    }
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
  updatePShardcellDB(j){
    //console.log('Reviewing PeerTree Nodes DB',j);
    var SQL = "SELECT count(*)nRec FROM peerBrain.peerShardCells where pcelAddress = '"+j.remIp+"'";
    con.query(SQL,(err, result, fields)=> {
      if (err) console.log(err);
      else {
        if (result[0].nRec == 0){
          SQL = "insert into peerBrain.peerShardCells (pcelAddress,pcelLastStatus,pcelLastMsg)";
          SQL += "values ('"+j.remIp+"','New',now())";
          con.query(SQL,(err, result, fields)=>{
            if (err) console.log(err);
          });
        }
	else {
          SQL = "update peerBrain.peerShardCells set pcelLastStatus = 'online',pcelLastMsg = now() ";
          SQL += "where pcelAddress = '"+j.remIp+"'";
          //console.log(SQL);
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
      var SQL = "SELECT count(*)nRec FROM peerBrain.peerShardCells where pcelAddress = '"+node.ip+"'";
      con.query(SQL, function (err, result, fields) {
        if (err) console.log(err);
        else {
          if (result[0].nRec == 0){
            SQL = "insert into peerBrain.peerShardCells (pcelAddress,pcelLastStatus,pcelLastMsg)";
            SQL += "values ('"+node.ip+"','New',now())";
            con.query(SQL, function (err, result, fields) {
              if (err) console.log(err);
            });
          }
        }
      });
    });	    
  }	  
  resetDb(){
    return new Promise( (resolve,reject)=>{
      var SQL = "";
      SQL =  "truncate table peerBrain.peerShardCells; ";
      SQL += "truncate table peerBrain.peerShardCell; ";
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
    if (j.req == 'pShardQryResult'){
      this.pushQryResult(j,res);
      return true;
    }
    if (j.req == 'storeShard'){
      this.storeShard(j,res);
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
    //console.log('\n====================\shardCell reply handler',j);
    if (j.statusUpdate){
      this.group.updateGroup(j.statusUpdate);
      return;
    }
  }
  handleBCast(j){
    //console.log('bcast received: ',j);
    if (!j.msg.to) {return;}
    if (j.msg.to == 'peerShardCells'){
      this.updatePShardcellDB(j);  
      if (j.msg.qry){
        if (j.msg.qry.qryStyle == 'sendShard')
          this.doSendShardToOwner(j.msg,j.remIp);
      }
    } 
    return;
  }
  sayHelloPeerGroup(){
    var breq = {
      to : 'peerShardCells',
      token : 'some token'
    }
    //console.log('bcast greeting to shardCell group: ',breq);
    this.net.broadcast(breq);
    const gtime = setTimeout( ()=>{
      this.sayHelloPeerGroup();
    },50*1000);
  }
  doSendShardToOwner(j,remIp){
     console.log('shard request from: ',remIp);
     console.log('here is the req..',j);
     var SQL = "select sownID from shardTree.shardOwners where sownMUID = '"+j.shard.from+"'";
     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log(err);
       }
       else {
         var sownID = null;
         if (result.length == 0){
           console.log('Shard Owner Not Found On This Node.');
         }
         else {
           sownID = result[0].length;
           var SQL = "select shardData from shardTree.shards where sownID = "+sownID+" and shardHash = '"+j.shard.hash+"'";
           console.log(SQL);
           con.query(SQL, (err, result, fields)=> {
             if (err) console.log(err);
             else {
               if (result.length > 0){
                 var qres = {
                   req : 'pShardDataResult',
 	           data : result[0].shardData,
                   qry : j		   
                 }
                 this.net.sendMsg(ip,qres);
               } 
	       else {
		 console.log('Shard Not Stored On This Node.');
	       }
             }		    
           });
         }
       }
     });
  }
  receptorReqStoreShard(j,toIp){
    console.log('receptorReqStoreShard',j);
    return new Promise( (resolve,reject)=>{	  
      const gtime = setTimeout( ()=>{
        console.log('Store Request Timeout:');
        resolve(null);
      },10*1000);  
      console.log('Store Shard To: ',toIp);
      var req = {
        req : 'storeShard',
	shard : j.shard
      }

      this.net.sendMsg(toIp,req);
      this.net.on('mkyReply', r =>{
        if (r.shardStoreRes){
          console.log('shardStoreRes OK!!',r);
          clearTimeout(gtime);
	  resolve(r);
        }		    
      });
    });
  }	
  createNewSOWN(sown){
    return new Promise((resolve,reject)=>{
      var SQL = "insert into shardTree.shardOwner (sownMUID) values ('"+j.shard.ownMUID+"');";
      SQL += "SELECT LAST_INSERT_ID()newSownID;";
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
	  resolve(null);
        }
        else {
          resolve(result[0].newSownID);
        }
      });
    });
  }
  storeShard(j,remIp){
    console.log('got request store shard',j);
    var SQL = "select sownID from shardTree.shardOwners where sownMUID = '"+j.shard.from+"'";
    con.query(SQL , async(err, result,fields)=>{
      if (err){
        console.log(err);
        this.net.endRes(remIp,'{"shardStoreRes":false,"error":"'+err+'"');
      }
      else {
        var sownID = null;
	if (result.length == 0){
          sownID = await this.createNewSOWN(j.shard.from);
          if (!sownID){
            this.net.endRes(remIp,'{"shardStoreRes":false,"error":"failed to create new owner record for shardOwner"}');
            return null;
          }
	}
        else {
	  sownID = result[0].length;
	}
      }

      SQL = "insert into shardTree.shard (shardOwnerID,shardHash,shardDate,shardExire,shardData) ";
      SQL += "values("+sownID+",'"+j.shard.hash+"',now(),null,'"+j.shard.data+"')";
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          this.net.endRes(remIp,'{"shardStoreRes":false,"error":"'+err+'"');
        }
        else {
          const hash = 'write hash function for shardstore';
	  this.net.endRes(remIp,'{"shardStoreRes":true,"shardStorHash":"' + hash + '"}');
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

module.exports.shardTreeObj = shardTreeObj;
module.exports.shardTreeCellReceptor = shardTreeCellReceptor;
