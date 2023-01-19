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
   calculateHash(txt) {
      const crypto = require('crypto');
      return crypto.createHash('sha256').update(txt).digest('hex');
   }
   signToken(token) {
      const sig = this.signingKey.sign(this.calculateHash(token), 'base64');
      const hexSig = sig.toDER('hex');
      return hexSig;
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
          this.publicKey     = j.publicKey;
          this.privateKey    = j.privateKey;
          this.shardOwnMUID  = j.shardOwnMUID;
	  this.shardCipher   = j.shardCipher;
          this.crypt         = new pcrypt(this.shardCipher);
          this.signingKey    = ec.keyFromPrivate(this.privateKey);
        }
        catch(err) {console.log('wallet file not valid', err);process.exit();
	}
      }
      else {
        const key = ec.genKeyPair();
        this.publicKey = key.getPublic('hex');
        this.privateKey = key.getPrivate('hex');

        console.log('Generate a new wallet key pair and convert them to hex-strings');
        var mkybc = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+this.publicKey, 'hex') });
        this.branchMUID = mkybc.address;

        const pmc = ec.genKeyPair();
        this.pmCipherKey  = pmc.getPublic('hex');

        console.log('Generate a new wallet cipher key');
        mkybc = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+this.pmCipherKey, 'hex') });
        this.shardCipher = mkybc.address;

        var wallet = '{"shardOwnMUID":"'+ this.branchMUID+'","publicKey":"' + this.publicKey + '","privateKey":"' + this.privateKey + '",';
        wallet += '"shardCipher":"'+this.shardCipher+'"}';
        console.log(wallet);
	fs.writeFile('keys/peerShardToken.key', wallet, function (err) {
          if (err) throw err;
         //console.log('Wallet Created And Saved!');
        });
      } 
    } 
}; 

class shardTreeCellReceptor{
  constructor(peerTree,recPort=1335){
    this.peer = peerTree;
    this.port = recPort;
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
      if (req.url == '/keyGEN'){
        // Generate a new key pair and convert them to hex-strings
        const key = ec.genKeyPair();
        const publicKey = key.getPublic('hex');
        const privateKey = key.getPrivate('hex');
        console.log('pub key length' + publicKey.length,publicKey);
        console.log('priv key length' + privateKey.length,publicKey);
        res.writeHead(200);
        res.end('{"publicKey":"' + publicKey + '","privateKey":"' + privateKey + '"}');
      }
      else {
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
              }
              catch(err){
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
	        res.end('{"result":"json parse error:","data","'+body+'"}');
		console.log('json error : ',body);
                return;
	      }	 
	      res.setHeader('Content-Type', 'application/json');
              res.writeHead(200);
              if (j.msg.req == 'storeShard'){
                this.reqStoreShard(j.msg,res);
                return;
	      }	      
              if (j.msg.req == 'requestShard'){
                this.reqRetrieveShard(j.msg,res);
                return;
              }

	      res.end('{"netReq":"action '+j.msg.req+' not found"}');
            });
          }
	}	
        else {
          res.end('Wellcome To The PeerTree KeyGEN Server\nUse end point /keyGEN to request key pair');
        }
      }
    });
  
    bserver.listen(this.port);
    console.log('peerTree Shard Receptor running on port:'+this.port);
  }
  openShardKeyFile(j){
    const bitToken = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+this.shardToken.publicKey, 'hex') }); 
    var mToken = {
      publicKey   : this.shardToken.publicKey,
      ownMUID     : bitToken.address,
      privateKey  : '************' // create from public key using bitcoin wallet algorythm.
    };
    return mToken;
  }
  async reqRetrieveShard(j,res){
    var data = {result : 0, msg : 'no results found'};
    data = await this.peer.receptorReqSendMyShard(j);
    if (data){
      res.end('{"result": 1,"data" : '+JSON.stringify(data)+'}');
    }
    else {
      res.end('{"result" : 0, "msg" : "no results found"}');
   }
  }
  signRequest(j){
    const stoken = j.shard.token.ownMUID + new Date(); 
    const sig = {
      token : stoken,
      pubKey : this.shardToken.publicKey,
      signature : this.shardToken.signToken(stoken)
    }
    return sig;
  }
  reqStoreShard(j,res){
    j.shard.token = this.openShardKeyFile(j);
    j.shard.signature = this.signRequest(j);
    var SQL = "SELECT scelAddress FROM shardTree.shardCells ";
    SQL += "where scelLastStatus = 'online' and  timestampdiff(second,scelLastMsg,now()) < 50 order by rand() limit "+j.shard.nCopys;
    //console.log(SQL);
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
    var SQL = "SELECT count(*)nRec FROM shardTree.shardCells where scelAddress = '"+j.remIp+"'";
    con.query(SQL,(err, result, fields)=> {
      if (err) console.log(err);
      else {
        if (result[0].nRec == 0){
          SQL = "insert into shardTree.shardCells (scelAddress,scelLastStatus,scelLastMsg)";
          SQL += "values ('"+j.remIp+"','New',now())";
          con.query(SQL,(err, result, fields)=>{
            if (err) console.log(err);
          });
        }
	else {
          SQL = "update shardTree.shardCells set scelLastStatus = 'online',scelLastMsg = now() ";
          SQL += "where scelAddress = '"+j.remIp+"'";
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
      var SQL = "SELECT count(*)nRec FROM shardTree.shardCells where scelAddress = '"+node.ip+"'";
      con.query(SQL, function (err, result, fields) {
        if (err) console.log(err);
        else {
          if (result[0].nRec == 0){
            SQL = "insert into shardTree.shardCells (scelAddress,scelLastStatus,scelLastMsg)";
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
      SQL =  "truncate table shardTree.shardCells; ";
      SQL += "truncate table shardTree.shardOwners; ";
      SQL += "truncate table shardTree.shards; ";
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
    if (j.msg.to == 'shardCells'){
      this.updatePShardcellDB(j);  
      if (j.msg.req){
        if (j.msg.req == 'sendShard')
          this.doSendShardToOwner(j.msg,j.remIp);
      }
    } 
    return;
  }
  sayHelloPeerGroup(){
    var breq = {
      to : 'shardCells',
      token : 'some token'
    }
    //console.log('bcast greeting to shardCell group: ',breq);
    this.net.broadcast(breq);
    const gtime = setTimeout( ()=>{
      this.sayHelloPeerGroup();
    },50*1000);
  }
  doSendShardToOwner(j,remIp){
     //console.log('shard request from: ',remIp);
     //console.log('here is the req..',j);
     var SQL = "select sownID from shardTree.shardOwners where sownMUID = '"+j.shard.ownerID+"'";
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
           sownID = result[0].sownID;
           var SQL = "select shardData from shardTree.shards where shardOwnerID = "+sownID+" and shardHash = '"+j.shard.hash+"'";
           //console.log(SQL);
           con.query(SQL, (err, result, fields)=> {
             if (err) console.log(err);
             else {
               if (result.length > 0){
                 var qres = {
                   req : 'pShardDataResult',
 	           data : result[0].shardData,
                   qry : j		   
                 }
                 //console.log('sending shard result:',qres);
		 this.net.sendReply(remIp,qres);
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
  receptorReqSendMyShard(j){
    return new Promise( (resolve,reject)=>{
      const gtime = setTimeout( ()=>{
        console.log('Store Request Timeout:',j);
        resolve(null);
      },10*1000);
      //console.log('bcasting reques for shard data: ',j);
      var req = {
        to : 'shardCells',
	req : 'sendShard',
        shard : j.shard
      }

      this.net.broadcast(req);
      this.net.once('mkyReply', r =>{
        //console.log('mkyReply is:',r);
	if (r.req == 'pShardDataResult'){
          //console.log('shardData Request',r);
          clearTimeout(gtime);
          resolve(r);
        }
      });
    });
  }
  receptorReqStoreShard(j,toIp){
    //console.log('receptorReqStoreShard',j);
    return new Promise( (resolve,reject)=>{	  
      const gtime = setTimeout( ()=>{
        console.log('Store Request Timeout:');
        resolve(null);
      },10*1000);  
      //console.log('Store Shard To: ',toIp);
      var req = {
        req : 'storeShard',
	shard : j.shard
      }

      this.net.sendMsg(toIp,req);
      this.net.once('mkyReply', r =>{
        if (r.shardStoreRes){
          //console.log('shardStoreRes OK!!',r);
          clearTimeout(gtime);
	  resolve(r);
        }		    
      });
    });
  }	
  createNewSOWN(sown){
    return new Promise((resolve,reject)=>{
      var SQL = "insert into shardTree.shardOwners (sownMUID) values ('"+sown+"');";
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
    //console.log('got request store shard',j);
    var SQL = "select sownID from shardTree.shardOwners where sownMUID = '"+j.shard.from+"'";
    con.query(SQL , async(err, result,fields)=>{
      if (err){
        console.log(err);
        this.net.endRes(remIp,'{"shardStoreRes":false,"error":"'+err+'"');
        return;
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
	  sownID = result[0].sownID;
	}
      }
      SQL = "SELECT count(*)nRec FROM `shardTree`.`shards` WHERE shardOwnerID = "+sownID+" and shardHash = '"+j.shard.hash+"'";
      con.query(SQL , async(err, result,fields)=>{
        if (err){
          console.log(err);
          this.net.endRes(remIp,'{"shardStoreRes":false,"error":"'+err+'"');
          return;
        }
        else {
          if (result[0].nRec > 0){
	    console.log("Shard Record exists");
            this.net.endRes(remIp,'{"shardStoreRes":false,"error":"Shard Record exists"');
            return;
	  }
        }
	      
        SQL = "INSERT INTO `shardTree`.`shards` SET ?";
        var values = {
          shardOwnerID : sownID,
          shardHash    : j.shard.hash,
          shardDate    : new Date(),
          shardExpire  : null,
          shardData    : j.shard.data
        };
        con.query(SQL ,values, (err, result,fields)=>{
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
