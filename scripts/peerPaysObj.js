/******************************************************************
PeerPay - Object peerPaysObj

2024-0131 - Taken from peerShardTreeObj.js to be modified into the peerPaysObj
Status - Incomplete
*/
var dateFormat     = require('./mkyDatef');
const EventEmitter = require('events');
const https        = require('https');
const fs           = require('fs');
const EC           = require('elliptic').ec;
const ec           = new EC('secp256k1');
const bitcoin      = require('bitcoinjs-lib');
const crypto       = require('crypto');
const mysql        = require('mysql');
const schedule     = require('node-schedule');
const {MkyWebConsole} = require('./networkWebConsole.js');
const {pcrypt}        = require('./peerCrypt');

addslashes  = require ('./addslashes');

const algorithm = 'aes256';
const maxTranCopies = 10;
var   availTranNodes = 3; 

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

/*********************************************
PeerPay Receptor Node: listens on port 
==============================================
This port is used for your regular apps to interact
with a peerPayCell on the PeerPay Payment network;
*/
const ftreeRoot = 'ftree/';

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
      const sig = this.signingKey.sign(calculateHash(token), 'base64');
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

class peerPaysCellReceptor{
  constructor(peerTree,recPort=13361){
    this.peer = peerTree;
    this.port = recPort;
    this.allow = ["127.0.0.1"];
    this.readConfigFile();
    console.log('ATTACHING - cellReceptor on port'+recPort);
    console.log('GRANTING cellRecptor access to :',this.allow);
    this.results = ['empty'];
    const options = {
      key: fs.readFileSync('keys/privkey.pem'),
      cert: fs.readFileSync('keys/fullchain.pem')
    };
    this.shardToken = new peerShardToken();
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

              if (j.msg.req == 'makeUserTransaction'){
                this.reqMakeUserTransaction(j.msg,res);
                return;
	      }	      
              if (j.msg.req == 'getUserBalance'){
                this.reqUserBalance(j.msg,res);
                return;
              }
              if (j.msg.req == 'getUserTransactions'){
                this.reqUserTransactions(j.msg,res);
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
    console.log('peerPays Payment Receptor running on port:'+this.port);
  }
  readConfigFile(){
     var conf = null;
     try {conf =  fs.readFileSync('keys/ftreeFileMgr.conf');}
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
  openShardKeyFile(j){
    const bitToken = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+this.shardToken.publicKey, 'hex') }); 
    var mToken = {
      publicKey   : this.shardToken.publicKey,
      ownMUID     : bitToken.address,
      privateKey  : '************' // create from public key using bitcoin wallet algorythm.
    };
    return mToken;
  }
  async reqDeleteShard(j,res){
    var dres = {result : 0, msg : 'no shards deleted'};

    j.shard.token = this.openShardKeyFile(j);
    j.shard.signature = this.signRequest(j);

    j.shard.signature = this.signRequest(j);
    dres = await this.peer.receptorReqDeleteMyShard(j);
    res.end('{"result" : '+dres+'}');
  }
  bufferToBase64(arr){
    var i, str = '';
    for (i = 0; i < arr.length; i++) {
      str += '%' + ('0' + arr[i].toString(16)).slice(-2);
    }
    return decodeURIComponent(str);
  }
  signRequest(j){
    const stoken = j.shard.token.ownMUID + new Date(); 
    const sig = {
      ownMUID : j.shard.token.ownMUID,
      token : stoken,
      pubKey : this.shardToken.publicKey,
      signature : this.shardToken.signToken(stoken)
    }
    return sig;
  }
  async reqMakeUserTransaction(j,res){
    console.log('reqMakeUserTransaction:',j);
    
    const bal = await this.peer.receptorReqUserBalance(j);
    if (bal.balance < j.trans.payment.amount){
      res.end('{"result":"tranFail","balance":'+bal.balance+',"confirms":'+bal.confirms+',"error" : "Insuficient Funds..."}');
      return;
    }

    var IPs = await this.peer.receptorReqNodeList(j);
    availTranNodes = IPs.length;

    console.log('XXRANDNODES:',IPs,availTranNodes);
    if (IPs.length == 0){
      res.end('{"result":"transFail","nRecs":0,"peerPays":"No Nodes Available Right Now"}');
      return;
    }
    var n = 0;
    var hosts = [];
    var nStored = 0;
    for (var IP of IPs){
      try {
        var qres = await this.peer.receptorReqMakeUserTrans(j,IP);
        if (qres){
          nStored = nStored +1;
          hosts.push({host:qres.remMUID,ip:qres.remIp});
        }
      }
      catch(err) {
        console.log('peerPays transaction failed on:',IP);
      }
      console.log('n is:',n,'length:: ',IPs.length);
      if (n==IPs.length -1){
        await this.reqConfirmUserTrans(IPs,j);
        res.end('{"result":"tranOK","nCopies":'+nStored+',"txID":'+j.trans.payment.tx+',"hosts":'+JSON.stringify(hosts)+'}');
        return;
      }
      n = n + 1;
    }
    return;
  }
  reqConfirmUserTrans(hosts,j){
    return new Promise( async (resolve,reject)=>{
      var nConf = 0;
      console.log('reqConfirmUserTrans::',hosts,j);
      for (var IP of hosts){
        try {
          var qres = await this.peer.receptorReqConfirmUserTrans(j,IP);
          if (qres){
            nConf = nConf +1;
          }
        }
        catch(err) {
          console.log('peerPays transaction failed on:',IP);
        }
      }
      resolve(nConf);
    });
  }
  async reqUserBalance(j,res){
    const balance = await this.peer.receptorReqUserBalance(j);
    const result = {
      result : true,
      balance : balance
    }
    res.end(JSON.stringify(result));
  }
  async reqUserTransactions(j,res){
    const tranList = await this.peer.receptorReqUserTransactions(j);
    const result = {
      result : true,
      transactions : tranList
    }
    res.end(JSON.stringify(result));
  }};
/*----------------------------
End Receptor Code
=============================
*/
var dba = null
try {dba =  fs.readFileSync('paysdbconf');}
catch {console.log('database config file `dbconf` NOT Found.');}
try {dba = JSON.parse(dba);}
catch {console.log('Error parsing `dbconf` file');}

let con = createConnection();

function createConnection() {
  const connection = mysql.createConnection({
    host:"127.0.0.1",
    user: dba.user,
    password: dba.pass,
    database: "peerPay",
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

var mysqlp = require('mysql2');
var pool  = mysqlp.createPool({
  connectionLimit : 100,
  host            : '127.0.0.1',
  user: dba.user,
  password: dba.pass,
  database: "peerPay",
  dateStrings     : "date",
  multipleStatements: true,
  supportBigNumbers : true
});

pool.on('connection', (connection) => {
  connection.on('error', (err) => {
    console.error('BORG:POOL:Connection error:', err);
    if (err.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
      console.log('Removing faulty connection...');
      connection.destroy(); // Remove bad connection
    }
  });
});

function dbConFail(resolve,msg){
  console.log(msg);
  return resolve({result:false,msg:'dbERROR : '+msg});
}
function dbResult(con,resolve,value){
  con.release();
  return resolve({result:true,value:value});
}
function dbFail(con,resolve,msg){
  con.rollback();
  con.release();
  console.log('dbFAIL::',msg);
  return resolve({result:false,msg:'dbERROR : '+msg});
}
function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max));
}
class peerPaysObj {
  constructor(peerTree,reset){
    this.reset      = reset;
    this.isRoot     = null;
    this.status     = 'starting';
    this.net        = peerTree;
    this.receptor   = null;
    this.wcon       = new MkyWebConsole(this.net,con,this,'peerPaysCell');
    this.myPeers    = [];
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
      await this.resetDb();
    }
  }
  /****************************************************************
  Local Modules
  =================================================================
  */
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
  resetDb(){
    return new Promise( (resolve,reject)=>{
      var SQL = "";
      SQL =  "truncate table peerPay.accounts; ";
      SQL += "truncate table peerPay.accountsFolder; ";
      SQL += "truncate table peerPay.gPowKeys; ";
      SQL += "truncate table peerPay.payCells; ";
      SQL += "truncate table peerPay.qryLedgerResults; ";

      return pool.getConnection((err, con)=>{
        if (err){
          return dbConFail(resolve,err);
        }
        return con.query(SQL, async (err, result, fields)=>{
          if (err) {return dbFail(con,resolve,err+SQL);}
          console.log('Database Reset: connection released');
          return dbResult(con,resolve,'OK');
        });
      });
    });
  }
  sayHelloPeerGroup(){
    var breq = {
      to : 'peerPayCells',
      req : 'hello',
    }
    //console.log('bcast greeting to shardCell group: ',breq);
    this.net.broadcast(breq);
    const gtime = setTimeout( ()=>{
      this.sayHelloPeerGroup();
    },12*1000);
  }
  /*******************************************************************
  Network Handlers
  ====================================================================
  */
  handleXhrError(j){
    if (!j.msg)
      return;    
    const msg = j.msg;
  }
  handleReq(res,j){
    //console.log('root recieved: ',j);
    if (j.req == 'makeUserTrans'){
      this.doMakeUserTrans(j,res);
      return true;
    }
    if (j.req == 'confirmUserTrans'){
      this.doConfirmUserTrans(j,res);
      return true;
    }
    if (!this.isRoot && this.status != 'Online'){
      this.net.endRes(res,'');
      return true;
    }
    return false;
  }
  handleReply(j){
    //console.log('\n====================\nXXXPayCell reply handler',j);
    if (j.reply == 'helloBack'){
      this.doCountMyPeers(j.remIp);
    }
  }
  handleBCast(j){
    //console.log('bcast received: ',j);
    if (j.remIp == this.net.nIp) {console.log('ignoring bcast to self',this.net.nIp);return;} // ignore bcasts to self.
    if (!j.msg.to) {return;}
    if (j.msg.to == 'peerPayCells'){
      if (j.msg.req){
        if (j.msg.req == 'sendUserBalance'){
          this.doSendUserBalance(j.msg,j.remIp);
        }
        if (j.msg.req == 'sendUserTransactions'){
          this.doSendUserTransactions(j.msg,j.remIp);
        }
        if (j.msg.req == 'sendNodeList'){
          console.log('DOPOW xxxx',j.remIp);
          this.doPow(j.msg,j.remIp);
        }
        if (j.msg.req == 'hello'){
          this.doReplyHelloBack(j.remIp);
        }
        if (j.msg.req == 'stopNodeGenIP'){
          console.log('DOPOW stopNodeGenIP-XX Received:',j.remIp);
          this.doPowStop(j.remIp);
        }
      }
    } 
    return;
  }
  /******************************************************************************
  Shared Modules:
  ===============================================================================
  */
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
  /********************************************************************************
  Remote Peer To Peer Modules (Replies):
  =================================================================================
  */
  doSendUserBalance(j,remIp){
     var qres = {
        req : 'sendUserBalanceRes',
        result : false,
        balance : null
     }
     var SQL = `SELECT pledToAdr,pledFromAdr,pledToBalance,pledFrBalance, pledUnixTime from pLedger  
        where (pledToAdr = '${j.user}' or pledFromAdr = '${j.user}') and pledTxStatus = 1 order by pledUnixTime desc limit 1`;

     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log('error reading pLedger ',err);
         qres.msg = 'Database Error:: '+ err;
       }
       else {
         var repo = null;
         if (result.length == 0){
           console.log('User Not Found On This Node.');
           qres.msg = 'User Not Found On This Node';
         }
         else {
           qres.result = true;
           qres.balance = result[0];
         }
       }
       //console.log('sending sendUserBalanceRes :',qres);
       this.net.sendReply(remIp,qres);
     });
  }
  doSendUserTransactions(j,remIp){
     var qres = {
        req : 'sendUserTransactionRes',
        result : false,
        transactions : null
     }
     var SQL = `SELECT * from pLedger
        where (pledToAdr = '${j.user}' or pledFromAdr = '${j.user}') and pledTxStatus = 1 order by pledUnixTime desc `;

     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log('error reading pLedger ',err);
         qres.msg = 'Database Error:: '+ err;
       }
       else {
         var repo = null;
         if (result.length == 0){
           console.log('User Not Found On This Node.');
           qres.msg = 'No User Transaction On This Node';
         }
         else {
           qres.result = true;
           qres.transactions = result;
         }
       }
       //console.log('sending sendUserTransactions :',qres);
       this.net.sendReply(remIp,qres);
     });
  }
  doConfirmUserTrans(j,remIp){
    const checkSQL = `
        update pLedger set pledTxStatus = 1
        WHERE pledTx = '${j.trans.payment.tx}';
    `;
    console.log('doConfirmUserTrans::SQL:',checkSQL,j);
    con.query(checkSQL, async (err, result) => {
      if (err) {
        console.log('Error confirming transaction: ', err);
        this.net.sendReply(remIp, {
          req: 'confirmUserTransRes',
          status: 'error',
          message: 'Database error'
        });
        return;
      }
      this.net.sendReply(remIp, {
        req: 'confirmUserTransRes',
        status: 'success'
      });
    });
  }
  async doMakeUserTrans(j,remIp){  //verifyAndInsertTransaction(j, remIp) {
    // 1. Verify the signature
    const isSignatureValid = this.verifySignature(j.trans.payment);
    if (!isSignatureValid) {
        console.log('Invalid signature. Transaction rejected.');
        this.net.sendReply(remIp, {
            req: 'makeUserTransRes', 
            status: 'error',
            message: 'Invalid signature'
        });
        return;
    }

    // 2. Check if the transaction already exists
    const checkSQL = `
        SELECT COUNT(*) AS count 
        FROM pLedger 
        WHERE pledTx = '${j.trans.payment.tx}';
    `;

    con.query(checkSQL, async (err, result) => {
        if (err) {
            console.log('Error checking for duplicate transaction: ', err);
            this.net.sendReply(remIp, {
                req: 'makeUserTransRes',
                status: 'error',
                message: 'Database error'
            });
            return;
        }

        if (result[0].count > 0) {
            console.log('Transaction already exists. Duplicate rejected.');
            this.net.sendReply(remIp, {
                req: 'makeUserTransRes',
                status: 'error',
                message: 'Duplicate transaction'
            });
            return;
        }

        // 3. Get Transantion User Current Balances
        const bFrom = await this.receptorReqUserBalance(j);
        const bTo   = await this.receptorReqUserBalance(j,j.trans.payment.to);

        j.trans.payment.frBalance = bFrom.balance - j.trans.payment.amount;
        j.trans.payment.toBalance = Number(bTo.balance)   + Number(j.trans.payment.amount);
        
        if (j.trans.payment.frBalance < 0){
            console.log('Transaction Rejected Reason - NSF.');
            this.net.sendReply(remIp, {
                req: 'makeUserTransRes',
                status: 'error',
                message: 'NSF'
            });
            return;
        }

        // 4. If signature is valid and transaction is not a duplicate, insert it
        this.doInsertTransaction(j, remIp);
    });
  }

  // Helper function to verify the signature
  verifySignature(payment) {
    const crypto = require('crypto');
    return true; //CDDDDG REMOVE IN PROD XXXXX
    try {
      const publicKey = payment.signKey; // Assuming signKey is the public key
      const verifier = crypto.createVerify('SHA256');
      verifier.update(payment.tx + payment.from + payment.to + payment.amount + payment.unixTime);
      return verifier.verify(publicKey, payment.signature, 'hex');
    }
    catch(err) {
      console.log('Verify Signature Error::', err);
      return null;
    }
  }
  doInsertTransaction(j, remIp) {
    console.log(j);
    var SQL = `
        INSERT INTO pLedger (
            pledPacID, pledTx, pledToAdr, pledFromAdr, pledAmount, 
            pledUnixTime, pledDate, pledToBalance,pledFrBalance, pledTxStatus, 
            pledSignature, pledSignKey
        ) VALUES (
            ${j.trans.payment.pacID}, '${j.trans.payment.tx}', '${j.trans.payment.to}', '${j.trans.payment.from}', 
            ${j.trans.payment.amount}, ${j.trans.payment.unixTime}, '${j.trans.payment.date}', 
            ${j.trans.payment.toBalance},${j.trans.payment.frBalance}, 0, '${j.trans.payment.signature}', 
            '${j.trans.payment.signKey}'
        );
    `;

    console.log('doInsertTransaction: ' + SQL, j);

    con.query(SQL, async (err, result, fields) => {
        if (err) {
            console.log('Error inserting into pLedger: ', err);
            this.net.sendReply(remIp, {
                req: 'makeUserTransRes',
                status: 'error',
                message: 'Database error'
            });
        } else {
            console.log('Transaction inserted successfully:', result);
            this.net.sendReply(remIp, {
                req: 'makeUserTransRes',
                status: 'success',
                insertedId: result.insertId
            });
        }
    });
  }  
  composeRepoSig(j){
    var sig = {
      pubKey    : j.repoPubKey,
      ownMUID   : j.repoOwner,
      token     : j.repoOwner+j.repoName+j.repoHash,
      signature : j.repoSignature
    }
    return sig;
  }
  /**********************************************************************
  Local Node BroadCasts:
  =======================================================================
  */
  receptorReqStopIPGen(work){
    var req = {
      to : 'peerPayCells',
      req : 'stopNodeGenIP',
      work  : work
    }
    this.net.broadcast(req);
  }
  getActivePayerList(j){
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const maxIP = j.repo.nCopys;
      var   IPs = [];
      const gtime = setTimeout( ()=>{
        console.log('Send Node List Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(IPs);
      },7*1000);

      var req = {
        to : 'peerPayCells',
        req : 'sendActivePayer',
        repo : j.repo
      }

      this.net.broadcast(req);
      this.net.on('mkyReply', mkyReply = (r)=>{
        if (r.req == 'activePayerIP'){
          console.log('mkyReply Active Payer is:',r);
          if (this.verifyActivePayer(r)){
            if (IPs.length < maxIP){
              IPs.push(r.remIp);
            }
            else {
              clearTimeout(gtime);
              this.net.removeListener('mkyReply', mkyReply);
              resolve(IPs);
            }
          }
        }
      });
    });
  }
  verifyActivePayer(r){
     console.log('verifyActivePayer: ',r);
     var signature = this.composeRepoSig(r.repo);
     console.log('building ActiveRep Signature',signature);
     if (this.isValidSig(signature)){ 
       console.log('ActiveRep Signature Is Valid:',signature);
       return true;
     }
     return false;
  }	  
  receptorReqNodeList(j){
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const maxIP = availTranNodes; //j.trans.payment.nCopies;
      console.log('receptorReqNodeList::',j.trans);
      var   IPs = [];
      const gtime = setTimeout( ()=>{
        console.log('Send Node List Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(IPs);
      },17*1000);

      var req = {
        to : 'peerPayCells',
        req : 'sendNodeList',
        nodes : maxIP,
        work  : crypto.randomBytes(20).toString('hex') 
      }

      this.net.broadcast(req);
      this.net.on('mkyReply', mkyReply = (r)=>{
        if (r.req == 'pNodeListGenIP'){
          console.log('mkyReply NodeGen is:',r);
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
  doPowStop(remIp){
    this.net.gpow.doStop(remIp);
  }
  doPow(j,remIp){
    this.net.gpow.doPow(2,j.work,remIp);
  }
  doReplyHelloBack(remIp){
    var reply = {
      to   : 'peerPayCells',
      reply : 'helloBack'
    }
    //console.log('Sending reply helloBack::',remIp,reply);
    this.net.sendReply(remIp,reply);
  }
  doCountMyPeers(remIp){
    if (!this.isInMyPeers(remIp)){
      this.myPeers.push({IP:remIp,lastCall:Date.now()});
    }

    // count peers but first check lastCall time;
    const ctime = Date.now(); 
    const ptimeout = 20000;
    // Use filter to safely create a new array without timed-out peers
    this.myPeers = this.myPeers.filter(p => {
      const timeSinceLastCall = ctime - p.lastCall;
      return timeSinceLastCall <= ptimeout;
    });
    if (availTranNodes != this.myPeers.length){
      availTranNodes = this.myPeers.length;
      console.log('availTranNodes is now',availTranNodes);
    }
    return;    
  }
  isInMyPeers(remIp){
     for (let p of this.myPeers){
       if (p.IP === remIp){
         p.lastCall = Date.now();
         return true;
       }
     }
     return false;
  }
  /****************************************************************************
  Peer To Peer Requests:
  =============================================================================
  */
  extractBalance(r,userUID){
    //console.log('ExtractingBalance::',r,userUID);
    if (userUID == r.pledToAdr)
      return r.pledToBalance;
    return r.pledFrBalance;
  }
  receptorReqMakeUserTrans(j,toIp){
    console.log('receptorReqMakeUserTrans',j);
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const gtime = setTimeout( ()=>{
        console.log('PeerPay MakeUserTrans Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(null);
      },20000);

      var req = {
        to   : 'peerPayCells',
        req  : 'makeUserTrans',
        user : j.userUID,
        trans : j.trans
      }

      console.log('sending request: ',req,toIp);
      this.net.sendMsg(toIp,req);

      // Handle bcast replies;

      this.net.on('mkyReply',mkyReply = (r) =>{
        console.log('Got Response:: ', r);
        if (r.req == 'makeUserTransRes' && r.remIp == toIp){
          clearTimeout(gtime);
          this.net.removeListener('mkyReply', mkyReply);
          resolve(r);
        }
      });
    });
  }
  receptorReqConfirmUserTrans(j,toIp){
    console.log('receptorReqConfirmUserTrans',j);
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const gtime = setTimeout( ()=>{
        console.log('PeerPay ConfirmUserTrans Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(null);
      },5000);

      var req = {
        to   : 'peerPayCells',
        req  : 'confirmUserTrans',
        user : j.userUID,
        trans : j.trans
      }

      console.log('sending request: ',req,toIp);
      this.net.sendMsg(toIp,req);

      // Handle bcast replies;

      this.net.on('mkyReply',mkyReply = (r) =>{
        console.log('Got Response:: ', r);
        if (r.req == 'confirmUserTransRes' && r.remIp == toIp){
          clearTimeout(gtime);
          this.net.removeListener('mkyReply', mkyReply);
          resolve(r);
        }
      });
    });
  }
  receptorReqUserBalance(j,adrTo=null){
    console.log('receptorReqUserBalance',j,'adrTo:',adrTo);
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      var bal = {
         balance : 0,
         time    : 0,
         confirms : 0
      }
      const gtime = setTimeout( ()=>{
        console.log('PeerPay GetUserBalance Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(bal);
      },3000);
      var reqAdr = j.userUID ?? j.user;
      if (adrTo) {
        reqAdr = adrTo;
      } 
      var req = {
        to   : 'peerPayCells',
        req  : 'sendUserBalance',
        user : reqAdr
      }

      //console.log('bcasting request: ',req);
      this.net.broadcast(req);

      // Handle bcast replies;

      this.net.on('mkyReply',mkyReply = (r) =>{
        console.log('Got Response:: ', r,'bal::',bal);
        if (r.req == 'sendUserBalanceRes' && r.result ){
          bal.balance = this.extractBalance(r.balance,reqAdr);
          if (r.balance.pledUinixTime > bal.time) {
             bal.confirms = 1;
          }
          else {
             bal.confirms += 1;
          }
          bal.time = r.balance.pledUnixTime;

          var maxConf = maxTranCopies;
          if (availTranNodes < maxTranCopies){
             maxConf = availTranNodes;
          } 
          if (bal.confirms > maxConf - 1){
            clearTimeout(gtime);
            this.net.removeListener('mkyReply', mkyReply);
            resolve(bal);
          }
        }
      });
    });
  }

  receptorReqUserTransactions(j){
    //console.log('receptorReqUserTransactions',j);
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      var uTrans = {
        result : false,
        transactions: []
      }
      const gtime = setTimeout( ()=>{
        console.log('PeerPay GetUserTransaction Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(uTrans);
      },20000);
      var reqAdr = j.userUID ?? j.user;
      var req = {
        to   : 'peerPayCells',
        req  : 'sendUserTransactions',
        user : reqAdr
      }

      //console.log('bcasting request: ',req);
      this.net.broadcast(req);

      // Handle bcast replies;
      var nres = 0;
      this.net.on('mkyReply',mkyReply = (r) =>{
        //console.log('Got Response::nodes: ',availTranNodes, r);
        if (r.req == 'sendUserTransactionRes' && r.result ){
          nres += 1;
          for (let trans of r.transactions){
            if (!this.isInTList(uTrans.transactions,trans.pledTx)) {
               trans.confirms = 1;
               uTrans.transactions.push(trans);
            }
            else {
               this.incrementConfirms(uTrans.transactions,trans.pledTx);
            }
          }
          //console.log('nres::',nres,'availNodes::',availTranNodes);
          if (nres >= availTranNodes){
            clearTimeout(gtime);
            this.net.removeListener('mkyReply', mkyReply);
            resolve(uTrans);
            return;
          }
        }
      });
    });
  }
  incrementConfirms(trans,tx){
    for (let t of trans){
      if (t.pledTx === tx){
        t.confirms += 1;
        return;
      }
    }
  }
  isInTList(trans,tx){
    for (let t of trans){
      if (t.pledTx === tx){
        return true;
      }
    }
    return false;
  }
};
function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

module.exports.peerPaysObj = peerPaysObj;
module.exports.peerPaysCellReceptor = peerPaysCellReceptor;
