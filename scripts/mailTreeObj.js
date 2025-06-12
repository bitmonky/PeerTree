
/******************************************************************
PeerTree - Object mailTreeObj  

2023-0109 - Taken from mailTreeObj.js to be modified into the mailTreeObj 
*/

//const config        = require('./config.js');
var dateFormat        = require('./mkyDatef');
const EventEmitter    = require('events');
const https           = require('https');
const fs              = require('fs');
const EC              = require('elliptic').ec;
const ec              = new EC('secp256k1');
const bitcoin         = require('bitcoinjs-lib');
const crypto          = require('crypto');
const mysql           = require('mysql');
const schedule        = require('node-schedule');
const {MkyWebConsole} = require('./networkWebConsole.js');
const {pcrypt}        = require('./peerCrypt');
const {BorgECMail}    = require('./BorgECMail.js');

addslashes  = require ('./addslashes');

const algorithm = 'aes256';

function encrypt(buffer,pword){
  pword = pword.substr(0,31);
  var cipher = crypto.createCipher(algorithm,pword);
  var crypted = Buffer.concat([cipher.update(buffer),cipher.final()]);
  return crypted; //.toString('base64');
}
 
function decrypt(buffer,pword){
  pword = pword.substr(0,31);
  var decipher = crypto.createDecipher(algorithm,pword);
  var dec = Buffer.concat([decipher.update(buffer) , decipher.final()]);
  return dec;
}
function calculateHash(txt) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(txt).digest('hex');
}
function deriveKey(password) {
    const salt = crypto.randomBytes(16); // Generate a random salt for additional security
    const iterations = 100000; // More iterations = stronger security
    const keyLength = 32; // AES-256 requires a 256-bit key (32 bytes)
    const digest = 'sha256'; // Hashing algorithm used in PBKDF2

    const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, keyLength, digest);
    return { key: derivedKey.toString('hex'), salt: salt.toString('hex') };
}

// Example usage
const bitcoinAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"; // Example Bitcoin address
const derived = deriveKey(bitcoinAddress);

console.log("Derived Key:", derived.key);
console.log("Salt:", derived.salt);
/*********************************************
PeerMail Receptor Node: listens on port 1335
==============================================
This port is used for your regular apps to interact
with a mailTreeCell on the mailTree message network;
*/
const ftreeRoot = 'ftree/';

class peerMailToken{
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
      const sig = this.signingKey.sign(calculateHash(token), 'base64');
      const hexSig = sig.toDER('hex');
      return hexSig;
   }   
   openWallet(){
      var keypair = null;
      try {keypair =  fs.readFileSync('keys/peerMailToken.key');}
      catch {console.log('no wallet file found');}
      this.publicKey = null;
      if (keypair){
        try {
	  const pair = keypair.toString();
	  const j = JSON.parse(pair);
          this.publicKey     = j.publicKey;
          this.privateKey    = j.privateKey;
          this.mailOwnMUID  = j.mailOwnMUID;
	  this.mailCipher   = j.mailCipher;
          this.crypt         = new pcrypt(this.mailCipher);
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
        this.mailCipher = mkybc.address;

        var wallet = '{"mailOwnMUID":"'+ this.branchMUID+'","publicKey":"' + this.publicKey + '","privateKey":"' + this.privateKey + '",';
        wallet += '"mailCipher":"'+this.mailCipher+'"}';
        console.log(wallet);
	fs.writeFile('keys/peerMailToken.key', wallet, function (err) {
          if (err) throw err;
         //console.log('Wallet Created And Saved!');
        });
      } 
    } 
}; 

class mailTreeCellReceptor{
  constructor(peerTree,recPort){
    this.peer = peerTree;
    this.port = recPort;
    this.allow = ["127.0.0.1"];
    
    this.readConfigFile();
    this.activeNodes = [];
    console.log('ATTACHING - cellReceptor on port'+recPort);
    console.log('GRANTING cellRecptor access to :',this.allow);
    this.results = ['empty'];
    const options = {
      key: fs.readFileSync('keys/privkey.pem'),
      cert: fs.readFileSync('keys/fullchain.pem')
    };
    this.mailToken = new peerMailToken();
    console.log(this.mailToken);
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
              if (j.msg.req == 'getInBoxKey'){
                 this.reqInBoxKey(j.msn,res);
                 return;
              }
              if (j.msg.req == 'registerInBox'){
                this.reqRegisterInBox(j.msg,res);
                return;
              }
              if (j.msg.req == 'sendMail'){
                this.reqStoreMail(j.msg,res);
                return;
	      }	      
              if (j.msg.req == 'getMyMail'){
                this.reqRetrieveMail(j.msg,res);
                return;
              }
              if (j.msg.req == 'deleteMail'){
                this.reqStoreMail(j.msg,res);
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
  
    bserver.on('connection', (sock)=> {
      if (this.allow.indexOf(sock.remoteAddress) < 0){
        //sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      } 
    });
    bserver.listen(this.port);
    console.log('peerTree Mail Receptor running on port:'+this.port);
  }
  readConfigFile(){
     var conf = null;
     try {conf =  fs.readFileSync('keys/mailTree.conf');}
     catch {console.log('no config file found');}
     if (conf){
       try {
         conf = conf.toString();
         const j = JSON.parse(conf);
         this.port   = j.receptor.port;
         this.allow  = j.receptor.allow;
       }
       catch(err) {
         console.log('conf file not valid', err);
       }
     }
  }
  openMailKeyFile(j){
    const bitToken = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+this.mailToken.publicKey, 'hex') }); 
    var mToken = {
      publicKey   : this.mailToken.publicKey,
      ownMUID     : bitToken.address,
      privateKey  : '************' // create from public key using bitcoin wallet algorythm.
    };
    return mToken;
  }
  async reqDeleteMail(j,res){
    var dres = {result : 0, msg : 'no mails deleted'};
    j.mail.signature = this.signRequest(j);
    dres = await this.peer.receptorReqDeleteMyMail(j);
    if (dres){
      res.end('{"result" : 1}');
    }
    else {
      res.end('{"result" : 0}');
    }
  }
  bufferToBase64(arr){
    var i, str = '';
    for (i = 0; i < arr.length; i++) {
      str += '%' + ('0' + arr[i].toString(16)).slice(-2);
    }
    return decodeURIComponent(str);
  }
  async reqInBoxKey(j,res){
    const pubKey = await this.peer.receptorReqInBoxKey(j);
    if (pubKey){
      res.end(JSON.stringify({result:true,pubKey:pubKey}));
      return;
    }
    res.end(JSON.stringify({result:false}));
  }
  async reqRegisterInBox(j,res){
    const isRegistered = await this.peer.receptorReqInBoxKey({ownMUID:j.ownMUID});
    if (isRegistered){
      res.end(JSON.stringify({result:true}));
    }
    var IPs = await this.peer.receptorReqNodeList(j);
    if (IPs.length == 0){
      res.end('{"result":false,"nRecs":0,"repo":"No Nodes Available"}');
      return;
    }
    var n = 0;
    var hosts = [];
    var nStored = 0;
    for (var IP of IPs){
      try {
        var qres = await this.peer.receptorReqRegisterInBox(j,IP);
        if (qres){
          nStored = nStored +1;
          hosts.push({host:qres.remMUID,ip:qres.remIp});
        }
      }
      catch(err) {
        console.log('repo storage failed on:',IP);
      }
      if (n==IPs.length -1){
        console.log('{"result":"repoOK","nStored":'+nStored+',"request":'+JSON.stringify(j)+',"hosts":'+JSON.stringify(hosts)+'}');
        res.end('{"result":true,"nStored":'+nStored+'}');
        return;
      }
      n = n + 1;
    }   
    return;
  } 
  async reqRegisterInbox(j, res) {
    try {
        const IPs = await this.peer.receptorReqNodeList(j);
        if (IPs.length === 0) {
            res.end('{"result":false,"nRecs":0,"repo":"No Nodes Available"}');
            return;
        }

        let nStored = 0;
        const hosts = [];
        
        // Use Promise.all for parallel execution of requests
        await Promise.all(IPs.map(async (IP) => {
            try {
                const qres = await this.peer.receptorReqRegisterInBox(j, IP);
                if (qres) {
                    nStored += 1;
                    hosts.push({ host: qres.remMUID, ip: qres.remIp });
                }
            } catch (err) {
                console.log('repo storage failed on:', IP);
            }
        }));

        // Send response after all requests are completed
        res.end(`{"result":true,"nStored":${nStored},"repo":${JSON.stringify(j)},"hosts":${JSON.stringify(hosts)}}`);
    } catch (err) {
        console.error('Error processing request:', err);
        res.end('{"result":false,"error":"An error occurred"}');
    }
  }
  async reqRetrieveMail(j,res){
    var data = {result : 0, msg : 'no results found'};
    var stime = Date.now();
    data = await this.peer.receptorReqSendMyMail(j);
    if (j.mail.encrypted) {
      var scrm  = Buffer.from(data.data.data).toString();
      scrm  = decrypt(Buffer.from(scrm,'base64'),this.mailToken.mailCipher);
      data.data = scrm.toJSON();

    }
    data.data = this.bufferToBase64(data.data.data);
    console.log('Mail Request Time: ',Date.now() - stime);
    if (data){
      res.end('{"result": 1,"data" : '+JSON.stringify(data)+'}');
    }
    else {
      res.end('{"result" : 0, "msg" : "no results found"}');
    }
  }
  signRequest(j){
    const stoken = j.mail.token.ownMUID + new Date(); 
    const sig = {
      ownMUID : j.mail.token.ownMUID,
      token : stoken,
      pubKey : this.mailToken.publicKey,
      signature : this.mailToken.signToken(stoken)
    }
    return sig;
  }
  reqStoreMail(j,res){
    if(j.mail.encrypt){
      j.mail.data = encrypt(j.mail.data,this.mailToken.mailCipher);
      j.mail.data = j.mail.data.toString('base64');
    }
    j.mail.token = this.openMailKeyFile(j);
    j.mail.signature = this.signRequest(j);
    var SQL = "SELECT mcelAddress FROM mailTree.mailCells ";
    SQL += "where mcelLastStatus = 'online' and  timestampdiff(second,mcelLastMsg,now()) < 50 order by rand() limit "+j.mail.nCopys;
    //console.log(SQL);
    var nStored = 0;
    con.query(SQL,async (err, result, fields)=> {
      if (err) {console.log(err);}
      else {
        if (result.length == 0){
          res.end('{"result":"mailOK","nRecs":0,"mail":"No Nodes Available"}');
          return;
	}	
        var n = 0;
	var hosts = [];
	for (var rec of result){ 
          try {
            var qres = await this.peer.receptorReqStoreMail(j,rec.mcelAddress);
            if (qres){
	      nStored = nStored +1;
	      hosts.push({host:qres.remMUID,ip:qres.remIp});	    
	    }    
          }
	  catch(err) {
            console.log('mail storage failed on:',rec.mcelAddress);
          }
          if (n==result.length -1){
            j.mail.token.privateKey = '**********';
            j.mail.token.publicKey  = '**********';
            res.end('{"result":"mailOK","nStored":'+nStored+',"mail":'+JSON.stringify(j)+',"hosts":'+JSON.stringify(hosts)+'}');
	  }	
          n = n + 1;
	}
      } 		  
    });
  }
};
/*----------------------------
End Receptor Code
==============================
*/
var dba = null
try {dba =  fs.readFileSync('dbconf');}
catch {console.log('database config file `dbconf` NOT Found.');}
try {dba = JSON.parse(dba);}
catch {console.log('Error parsing `dbconf` file');}
let con = createConnection();

function createConnection() {
  const connection = mysql.createConnection({
    host:"127.0.0.1",
    user: dba.user,
    password: dba.pass,
    database: "mailTree",
    dateStrings: "date",
    multipleStatements: true,
    supportBigNumbers : true
  });
  connection.connect((err) => {
    if (err) {
      console.error('Error connecting to database:', err);
      setTimeout(createConnection, 2000); // Retry connection
    } else {
      console.log('Connected to database');
    }
  });

  connection.on('error', (err) => {
    console.error('BORG:MySQL Error:', err);
    if (err.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR' || err.code === 'ECONNRESET') {
      console.log('Reconnecting after fatal error...');
      connection.destroy();
      con = createConnection(); // Reconnect after fatal error
    }
  });

  return connection;
}

function heartbeat() {
  con.ping((err) => {
    if (err) {
      console.error('BORG::mySQL::Heartbeat failed, attempting to reconnect...', err);
      con.destroy();
      con = createConnection();
    }
  });
}
setInterval(heartbeat, 15000);
console.log('Heartbeat system initialized.');

function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max));
}
class mailTreeObj {
  constructor(peerTree,reset){
    this.reset      = reset;
    this.isRoot     = null;
    this.status     = 'starting';
    this.net        = peerTree;
    this.receptor   = null;
    this.wcon       = new MkyWebConsole(this.net,con,this,'mailTreeCell');
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
  receptorReqNodeList(j,excludeIps=[]){
    return new Promise( (resolve,reject)=>{
      console.log('receptorReqNodeList::',j);
      var mkyReply = null;
      const maxIP = j.nCopies;
      var   IPs = [];
      const gtime = setTimeout( ()=>{
        console.log('Send Node List Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(IPs);
      },1.5*1000);

      var req = {
        to     : 'mailCells',
        req    : 'sendNodeList',
        nodes  : maxIP,
        xnodes : excludeIps,
        work   : crypto.randomBytes(20).toString('hex')
      }

      this.net.broadcast(req);
      this.net.on('mkyReply', mkyReply = (r)=>{
        if (r.req == 'pNodeListGenIP'){
          console.log('mkyReply NodeGen is:',r.remIp);
          if (IPs.length <= maxIP){
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
  doPowStop(remIp){
    this.net.gpow.doStop(remIp);
  }
  doPow(j,remIp){
    if (j.xnodes.includes(this.net.nIp)){
      return;
    }
    this.net.gpow.doPow(2,j.work,remIp);
  }
  updatePMailcellDB(j){
    //console.log('Reviewing PeerTree Nodes DB',j);
    var SQL = "SELECT count(*)nRec FROM mailTree.mailCells where mcelAddress = '"+j.remIp+"'";
    con.query(SQL,(err, result, fields)=> {
      if (err) console.log(err);
      else {
        if (result[0].nRec == 0){
          SQL = "insert into mailTree.mailCells (mcelAddress,mcelLastStatus,mcelLastMsg)";
          SQL += "values ('"+j.remIp+"','New',now())";
          con.query(SQL,(err, result, fields)=>{
            if (err) console.log(err);
          });
        }
	else {
          SQL = "update mailTree.mailCells set mcelLastStatus = 'online',mcelLastMsg = now() ";
          SQL += "where mcelAddress = '"+j.remIp+"'";
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
      var SQL = "SELECT count(*)nRec FROM mailTree.mailCells where mcelAddress = '"+node.ip+"'";
      con.query(SQL, function (err, result, fields) {
        if (err) console.log(err);
        else {
          if (result[0].nRec == 0){
            SQL = "insert into mailTree.mailCells (mcelAddress,mcelLastStatus,mcelLastMsg)";
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
      SQL =  "truncate table mailTree.mailCells; ";
      SQL += "truncate table mailTree.mailOwners; ";
      SQL += "truncate table mailTree.mails; ";
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
  handleReq(remIp,j){
    //console.log('root recieved: ',j);
    if (j.req == 'registerInBox'){
      this.doRegisterInBox(j,remIp);
    }
    if (j.req == 'pMailQryResult'){
      this.pushQryResult(j,remIp);
      return true;
    }
    if (j.req == 'storeMail'){
      this.storeMail(j,remIp);
      return true;
    }
    if (j.req == 'gotUAddMe'){
      this.group.addPeer(j.me);
      this.net.endRes(res,'');
      return true;
    }
    if (j.req == 'sendStatus'){
      this.group.me.status = this.status;
      this.net.endRes(remIp,'{"statusUpdate":'+JSON.stringify(this.group.me)+'}');
      return true;
    }
    if (!this.isRoot && this.status != 'Online'){
      this.net.endRes(remIp,'');
      return true;
    }
    return false;
  }
  handleReply(r){
    if (r.req == 'helloBack'){
      this.receptor.activeNodes.push({mNodeID:r.mNodeID,IP:r.remIp});
      return;
    }
    if (r.statusUpdate){
      this.group.updateGroup(r.statusUpdate);
      return;
    }
  }
  handleBCast(j){
    //console.log('bcast received: ',j);
    if (!j.msg.to) {return;}
    if (j.msg.to == 'mailCells'){
      this.updatePMailcellDB(j);  
      if (j.msg.req){
        if (j.msg.req == 'hello'){
          var qres = {req : 'helloBack', mNodeID : this.net.peerMUID };
          this.net.sendReply(j.remIp,qres);
        }
        if (j.msg.req == 'sendInBoxKey'){
          this.doSendInBoxKey(j.msg,r.remIp);
        }
        if (j.msg.req == 'sendMail'){
          this.doSendMailToOwner(j.msg,j.remIp);
        }
        if (j.msg.req == 'deleteMail'){
          this.doDeleteMailByOwner(j.msg,j.remIp);
        }
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
      to  : 'mailCells',
      req : 'hello'
    }
    if (this.receptor){
      this.receptor.activeNodes = [];
    } else {console.log('Receptor Not Ready!',this.receptor);}

    this.net.broadcast(breq);
    const gtime = setTimeout( ()=>{
      this.sayHelloPeerGroup();
    },15*1000);
  }
  isValidSig(sig) {
    if (!sig){console.log('remMessage signature is null',sig);return false;}
    if (sig.hasOwnProperty('pubKey') === false) {console.log('remSig.pubKey is undefined',sig);return false;}
    if (!sig.pubKey) {console.log('remSig.pubKey is empty',sig);return false;}

    if (!sig.signature || sig.signature.length === 0) {
       return false;
    }

    // check public key matches the remotes address
    var mkybc = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+sig.pubKey, 'hex') });
    if (sig.ownMUID !== mkybc.address){
      console.log('remote wallet address does not match publickey',sig);
      return false;
    }
    //verify the signature token with the public key
    const publicKey = ec.keyFromPublic(sig.pubKey,'hex');
    return publicKey.verify(calculateHash(sig.token), sig.signature);
  }
  doSendInBoxKey(j,remIp){
     var res = {
       req : 'sendInBoxKeyResult',
       result : false
     }
     if (this.isValidSig(j.sig)){
       //*store the public key and reply true
       const SQL = `select msubPubKey from mailTree.mailSubscriber where msubMUID = '${j.ownMUID}'`;
       con.query(SQL , (err, result,fields)=>{
         if (err){
           console.log(err);
           result.msg = err;
         }
         else {
           if (result.length > 0){
             res.result = true;
             res.publicKey = result[0].msubPubKey;
           }
         }
         this.net.sendReply(remIp,JSON.stringify(res));
       });
     }
     else {
        res.msg = 'invalid signature mailBox not created';
        this.net.sendReply(remIp,JSON.stringify(res));
     }
   }
   doRegisterInBox(j,remIp){
     var res = {
       req : 'registerInBoxResult',
       result : false
     }
     if (this.isValidSig(j.sig)){
       //*store the public key and reply true
       const SQL = `insert into mailTree.mailSubscriber (msubMUID,msubPubKey) values ('${j.sig.ownMUID}','${j.sig.pubKey}')`;
       con.query(SQL , (err, result,fields)=>{
         if (err){
           console.log(err);
           result.msg = err;
         }
         else {
           res.result = true;
         }
         this.net.sendReply(remIp,JSON.stringify(res));
       });
     } 
     else {
        res.msg = 'invalid signature mailBox not created';
        this.net.sendReply(remIp,JSON.stringify(res));
     }  
  }
  doSendMailToOwner(j,remIp){
     //console.log('mail request from: ',remIp);
     //console.log('here is the req..',j);
     var SQL = "select sownID from mailTree.mailOwners where sownMUID = '"+j.mail.ownerID+"'";
     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log(err);
       }
       else {
         var sownID = null;
         if (result.length == 0){
           console.log('Mail Owner Not Found On This Node.');
           return;
         }
         else {
           sownID = result[0].sownID;
           var fsdat = null;
	   const fname = ftreeRoot+sownID+'-'+j.mail.hash+'.srd'; 
           try {
             fsdat =  fs.readFileSync(fname);
	     var qres = {
               req : 'pMailDataResult',
               data : fsdat,
               qry : j
             }
             //console.log('sending mail result:',qres);
             this.net.sendReply(remIp,qres);
           }    
           catch (err) {
             console.log('error reading from srootTree:',err);
             //console.log('Wallet Created And Saved!');
           }
           return;
           var SQL = "select mailData from mailTree.mails where mailOwnerID = "+sownID+" and mailHash = '"+j.mail.hash+"'";
           //console.log(SQL);
           con.query(SQL, (err, result, fields)=> {
             if (err) console.log(err);
             else {
               if (result.length > 0){
                 var qres = {
                   req : 'pMailDataResult',
 	           data : result[0].mailData,
                   qry : j		   
                 }
                 //console.log('sending mail result:',qres);
		 this.net.sendReply(remIp,qres);
               } 
	       else {
		 console.log('Mail Not Stored On This Node.');
	       }
             }		    
           });
         }
       }
     });
  }
  /******************************************************
  Delete All Mail Files And Owner Record from this node
  =======================================================
  */
  doDeleteAllByOwner(j,remIp){

     if (!this.isValidSig(j.mail.signature)){
       console.log('Mail Signature Invalid... NOT deleted');
       return;
     }
     var SQL = "select sownID from mailTree.mailOwners where sownMUID = '"+j.mail.ownerID+"'";
     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log('mail delete',err);
       }
       else {
         var sownID = null;
         if (result.length == 0){
           console.log('Mail Owner Not Found On This Node.');
           return;
         }
         else {
           sownID = result[0].sownID;
           var fsdat = null;
           const fname = ftreeRoot+sownID+'-*.srd';
           fs.unlink(fname, function (err) {
             if (err) {console.log('mail delete all.. File not found:',fname);}
             else {
               var SQL = "delete from mailTree.mailOwners where sownMUID = '"+j.mail.ownerID+"'";
               con.query(SQL , async(err, result,fields)=>{
                 if (err){
                   console.log('mail delete all fail',err);
                 }
	       });	       
               var qres = {
                 req : 'delAllMailsResult',
                 result : 1,
                 qry : j
               }
               //console.log('sending mail delete result:',qres);
               this.net.sendReply(remIp,qres);
             }
           });
           return;
         }
       }
     });
  }
  /******************************************************
  Delete Mail File Specified By Owner from this nodee
  =======================================================
  */
  doDeleteMailByOwner(j,remIp){
     if (!this.isValidSig(j.mail.signature)){
       console.log('Mail Signature Invalid... NOT deleted');
       return;
     }
     var SQL = "select sownID from mailTree.mailOwners where sownMUID = '"+j.mail.ownerID+"'";
     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log('mail delete',err);
       }
       else {
         var sownID = null;
         if (result.length == 0){
           console.log('Mail Owner Not Found On This Node.');
           return;
         }
         else {
           sownID = result[0].sownID;
           var fsdat = null;
           const fname = ftreeRoot+sownID+'-'+j.mail.hash+'.srd';
           fs.unlink(fname, function (err) {
             if (err) {console.log('mail delete file not found:',fname);}
	     else {
	       var qres = {
                 req : 'pMailDeleteResult',
                 result : 1,
		 qry : j
               }
               //console.log('sending mail delete result:',qres);
               this.net.sendReply(remIp,qres);
             }
           });
           return;
         }
       }
     });
  }
  receptorReqInBoxKey(j){
    return new Promise( (resolve,reject)=>{
      const gtime = setTimeout( ()=>{
        console.log('Request User InBoxKey Request Timeout:',j);
        resolve(null);
      },1000);

      const bcast = {
        to   : 'mailCells',
        req  : 'sendInBoxKey',
        MUID : j.ownMUID
      }
      this.net.broadcast(req);
      this.net.once('mkyReply', r =>{
        //console.log('mkyReply is:',r);
        if (r.req == 'sendInBoxKeyResult'){
          if (r.result === true){
            clearTimeout(gtime);
            resolve(r.publicKey);
          } 
        }
      });
    });
  }
  receptorReqRegisterInBox(j,toIp){
    return new Promise( (resolve,reject)=>{
      const gtime = setTimeout( ()=>{
        console.log('Register User InBox Request Timeout:',j);
        resolve(null);
      },1000);
      //console.log('bcasting reques for mail data: ',j);
      var req = {
        to   : 'mailCells',
        req  : 'registerInBox',
        data : j
      }

      this.net.sendMsg(toIp,req);
      this.net.once('mkyReply', r =>{
        //console.log('mkyReply is:',r);
        if (r.req == 'registerInBoxResult' && r.remIp == toIp){
          //console.log('mailData Request',r);
          clearTimeout(gtime);
          resolve(r);
        }
      });
    });
  }
  receptorReqSendMyMail(j){
    return new Promise( (resolve,reject)=>{
      const gtime = setTimeout( ()=>{
        console.log('Send Mail Request Timeout:',j);
        resolve(null);
      },20*1000);
      //console.log('bcasting reques for mail data: ',j);
      var req = {
        to : 'mailCells',
	req : 'sendMail',
        mail : j.mail
      }

      this.net.broadcast(req);
      this.net.once('mkyReply', r =>{
        //console.log('mkyReply is:',r);
	if (r.req == 'pMailDataResult'){
          //console.log('mailData Request',r);
          clearTimeout(gtime);
          resolve(r);
        }
      });
    });
  }
  receptorReqStoreMail(j,toIp){
    //console.log('receptorReqStoreMail',j);
    return new Promise( (resolve,reject)=>{	  
      const gtime = setTimeout( ()=>{
        console.log('Store Request Timeout:');
        resolve(null);
      },10*1000);  
      console.log('Store Mail To: ',toIp);
      var req = {
        req : 'storeMail',
	mail : j.mail
      }

      this.net.sendMsg(toIp,req);
      this.net.once('mkyReply', r =>{
        if (r.mailStoreRes && r.remIp == toIp){
          //console.log('mailStoreRes OK!!',r);
          clearTimeout(gtime);
	  resolve(r);
        }		    
      });
    });
  }	
  createNewSOWN(sown){
    return new Promise((resolve,reject)=>{
      var SQL = "insert into mailTree.mailOwners (sownMUID) values ('"+sown+"');";
      SQL += "SELECT LAST_INSERT_ID() AS newSownID;";
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
  createInvoiceRec(sownID,hash,sig){
    var invSig = {
       token : sig.token,
       sig   : sig.signature
    }
    var SQL = "INSERT INTO `mailTree`.`mails` SET ?";
    var values = {
      mailOwnerID : sownID,
      mailHash    : hash,
      mailDate    : new Date(),
      mailExpire  : null,
      mailOwnSignature : JSON.stringify(invSig)
    };
    con.query(SQL ,values, (err, result,fields)=>{
      if (err){
        console.log(err);
      }
    });
  }
  storeMail(j,remIp){
    console.log('got request store mail',j.mail.signature);
    if (!this.isValidSig(j.mail.signature)){
      console.log('Mail Signature Invalid... NOT stored');
        this.net.endRes(remIp,'{"mailStoreRes":false,"error":"Invalid Signature For Request"');
        return;
    }
    var SQL = "select sownID from mailTree.mailOwners where sownMUID = '"+j.mail.from+"'";
    con.query(SQL , async(err, result,fields)=>{
      if (err){
        console.log(err);
        this.net.endRes(remIp,'{"mailStoreRes":false,"error":"'+err+'"');
        return;
      }
      else {
        var sownID = null;
	if (result.length == 0){
          sownID = await this.createNewSOWN(j.mail.from);
          if (!sownID){
            this.net.endRes(remIp,'{"mailStoreRes":false,"error":"failed to create new owner record for mailOwner"}');
            return null;
          }
	}
        else {
	  sownID = result[0].sownID;
	}
      }
      
      SQL = "SELECT count(*)nRec FROM `mailTree`.`mails` WHERE mailOwnerID = "+sownID+" and mailHash = '"+j.mail.hash+"'";
      con.query(SQL , async(err, result,fields)=>{
        if (err){
          console.log(err);
          this.net.endRes(remIp,'{"mailStoreRes":false,"error":"'+err+'"');
          return;
        }
        else {
          if (result[0].nRec > 0){
	    console.log("Mail Record exists");
            this.net.endRes(remIp,'{"mailStoreRes":false,"error":"Mail Record exists"');
            return;
	  }
        }
        fs.writeFile(ftreeRoot+sownID+'-'+j.mail.hash+'.srd', j.mail.data, (err)=> {
          if (err) {
            console.log('error writing srootTree:', err);
            this.net.endRes(remIp,'{"mailStoreRes":false,"error":"'+err+'"');
            //console.log('Wallet Created And Saved!');
	  }
	  else {
	    this.createInvoiceRec(sownID,j.mail.hash,j.mail.signature);
            this.net.endRes(remIp,'{"mailStoreRes":true,"mailStorHash":"' + j.mail.hash + '"}');
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

module.exports.mailTreeObj = mailTreeObj;
module.exports.mailTreeCellReceptor = mailTreeCellReceptor;
