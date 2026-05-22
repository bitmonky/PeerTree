/******************************************************************
PeerTree - Object shardTreeObj  

2023-0109 - Taken from peerMemoryObj.js to be modified into the shardTreeObj 
*/

//const config       = require('./config.js');
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
PeerTree Receptor Node: listens on port 1335
==============================================
This port is used for your regular apps to interact
with a shardTreeCell on the PeerTree File Store network;
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
	fs.writeFile('keys/peerShardToken.key', wallet, function (err) {
          if (err) throw err;
         //console.log('Wallet Created And Saved!');
        });
      } 
    } 
}; 

class shardTreeCellReceptor{
  constructor(peerTree,recPort=1335){
    this.peer      = peerTree;
    this.port      = recPort;
    this.allow     = ["127.0.0.1"];
    this.endPoints = null;
    this.nWatch    = 5;
    this.endPointWatchTimer = 5*60*1000;

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
      else if (req.url.indexOf('/storeShard') === 0) {
        if (req.method === 'POST') {

          const urlObj = new URL(req.url, `http://${req.headers.host}`);

          const meta = {
            hash:    urlObj.searchParams.get('hash'),
            hashID:  urlObj.searchParams.get('hashID'),
            encrypt: urlObj.searchParams.get('encrypt') === '1',
            expires: parseInt(urlObj.searchParams.get('expires')),
            nCopys:  parseInt(urlObj.searchParams.get('nCopys')),
            pass:    urlObj.searchParams.get('pass'),
            fptr:    parseInt(urlObj.searchParams.get('fptr')),
            index:   parseInt(urlObj.searchParams.get('index')),
            from:    urlObj.searchParams.get('from'),
            xIP:     urlObj.searchParams.getAll('xIP') // optional
          };

          console.log(`/storeShard:: req`,meta);
          // Validate required fields
          if (!meta.hashID || isNaN(meta.index)) {
            res.statusCode = 400;
            console.log('{"error":"missing hashID or index"}');
            return res.end('{"error":"missing hashID or index"}');
          }

          // Prepare to receive raw binary
          const chunks = [];
          const hash = crypto.createHash('sha256');

          req.on('data', chunk => {
            chunks.push(chunk);
            hash.update(chunk);
          });

          // Build the request object for shardTreeCell
          req.on('end', () => {
            const shardBuf = Buffer.concat(chunks);
            const shardId  = hash.digest('hex');
            console.log(`shardBuffer:: `,shardId,shardBuf);      
            if (meta.hash !== shardId) {
              res.statusCode = 400;
              return res.end('{"error":"data hash NOT matching hashID or index"}');
            }
            const reqObj = {
              sIndex : meta.index,
              shard  : {
                from    : meta.from,
                hash    : shardId,      // recomputed from binary
                hashID  : meta.hashID,  // provided by sender
                data    : shardBuf,     // raw binary
                encrypt : meta.encrypt,
                expires : meta.expires,
                nCopys  : meta.nCopys,
                pass    : meta.pass,
                fptr    : meta.fptr,
                xIP     : meta.xIP
              }
            };

            // handle new shard
            this.reqStoreShard(reqObj,res);
          });

          req.on('error', err => {
            res.statusCode = 500;
            res.end('{"error":"stream error"}');
          });
        }
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
              if (j.msg.req == 'storeShard'){
                console.log(`store shar:`,j);
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                this.reqStoreShard(j.msg,res);
                return;
	      }	      
              if (j.msg.req == 'requestShard'){
                // must wait for writeHead... to get content lenth;
                this.reqRetrieveShard(j.msg,res);
                return;
              }
              if (j.msg.req == 'deleteShard'){
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                this.reqDeleteShard(j.msg,res);
                return;
              }
              if (j.msg.req == 'openBinStream'){
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                this.openBinStream(j.msg,res);
                return;
              }
              if (j.msg.req == 'selectEndPoints'){
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
                this.selectEndPoints(j.msg,res);
                return;
              }
              res.setHeader('Content-Type', 'application/json');
              res.writeHead(200);
	      res.end('{"netReq":"action '+j.msg.req+' not found"}');
            });
          }
	}	
        else {
          res.writeHead(200);
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
    console.log('peerTree Shard Receptor running on port:'+this.port);
    this.watchEndPoints();
  }
  readConfigFile(){
     var conf = null;
     try {conf =  fs.readFileSync('keys/shardTree.conf');}
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

    j.shard.token = this.openShardKeyFile(j);
    j.shard.signature = this.signRequest(j);

    j.shard.signature = this.signRequest(j);
    const dres = await this.peer.receptorReqDeleteMyShard(j);
    if (dres.length == 0)
      res.end(JSON.stringify({result : 0, msg : 'no shards deleted'}));
    else
      res.end(JSON.stringify({result:1,shardID:j.shard.hash,nDeleted:dres.length,hosts:dres}));
  }
  bufferToBase64(arr){
    if (!Array.isArray(arr)) {
      return null;
    }
    var i, str = '';
    for (i = 0; i < arr.length; i++) {
      str += '%' + ('0' + arr[i].toString(16)).slice(-2);
    }
    return decodeURIComponent(str);
  }
  async reqRetrieveShard(j, res) {
    const stime = Date.now();
    let shardBuf = await this.peer.receptorReqSendMyShard(j);
    
    if (!shardBuf) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end('{"result":0,"msg":"no results found"}');
      return;
    }

    // decrypt if needed
    if (j.shard.encrypted) {
      try {
        shardBuf = decrypt(shardBuf, this.shardToken.shardCipher);
      } catch (e) {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end('{"result":0,"msg":"decrypt failed"}');
        return;
      }
    }

    // send raw binary shard
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': shardBuf.length
    });
    
    console.log(`reqRetrieveShard():: sending:`,shardBuf);
    res.end(shardBuf);
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
  fixHosts(xIPS){
    let hosts = []; 
    xIPS.forEach((IP,index) => {
      hosts.push({host:index,ip:IP});
    });
    return hosts;
  }
  async watchEndPoints() {
    try {
      const j = { shard: { nCopys: this.nWatch } };

      console.log(`watchEndPoints():: fetching endpoints…`);

      let IPs = await this.peer.receptorReqNodeList(j);

      // Normalize into full URLs
      IPs = IPs.map(IP => `https://${IP}:${this.port}`);

      // Store them
      this.endPoints = [...IPs];

      console.log(`watchEndPoints():: updated endpoints:`, this.endPoints);

    } catch (err) {
      console.error("watchEndPoints() error:", err);
    }

    // Schedule next update
    setTimeout(() => this.watchEndPoints(), this.endPointWatchTimer);
  }
  openBinStream(j,res){
    return res.end(`{"result":"STREAM_META_ACK"}`);
  }
  selectEndPoints(j, res) {
    if (!this.endPoints || this.endPoints.length === 0) {
      return res.end(`{"result":"noEndpoints"}`);
    }

    res.end(JSON.stringify({
      result: "listOK",
      useReceptors: this.endPoints
    }));
  }


  async reqStoreShard(j,res){
    console.log(`reqStoreShard():: `,j);
    if (!j.shard.xIP) j.shard.xIP = [];
    if (!j.shard.pass) j.shard.pass = 1;
    if (!j.shard.maxn) j.shard.maxn = 3;
    
    if (j.shard.pass > 1){
      let xIP = await this.peer.receptorReqSendShardHost(j,j.shard.xIP);
      let xIPs = [...new Set([...xIP, ...j.shard.xIP])];
      const nShards = xIP.length + j.shard.xIP.length;
      j.shard.nCopys = j.shard.maxn - nShards;

      if (j.shard.nCopys < 1){
        res.end(`{"result":"shardOK","nStored":${nShards},"shardID":"${j.shard.hash}","hosts":${JSON.stringify(this.fixHosts(xIPs))}}`);
        return;
      }
      j.shard.xIP = xIPs;      
    }

    const startT = Date.now();
    console.log('reqStoreShard::begin:',startT);
    var IPs = await this.peer.receptorReqNodeList(j,j.shard.xIP);
    console.log('XXRANDNODES:',IPs,'CompleteTime::',startT - Date.now());
    if(j.shard.encrypt == 1){
      j.shard.data = encrypt(j.shard.data,this.shardToken.shardCipher);
      //j.shard.data = j.shard.data.toString('base64');
    }
    j.shard.token = this.openShardKeyFile(j);
    j.shard.signature = this.signRequest(j);

    if (IPs.length == 0){
      res.end('{"result":"shardOK","nRecs":0,"shard":"No Nodes Available"}');
      return;
    }
    var n = 0;
    var hosts = [];
    const results = [];

    // Start all three calls concurrently
    let blob = j.shard.data;
    j.shard.data = null;

    IPs.forEach((IP) => {
      this.peer.receptorReqStoreShard(j,IP,blob)
     .then((r) => {
        var rcon = { qres: r, IP: IP };
        results.push(rcon);
      })
      .catch((e) => {
        console.log('shard storage failed', e);
      });
    });

    console.log('Waiting For Peer Responses');

    // Check All Response for success or failure; 
    var trys = 0;
    var nStored = 0;
    const id = setInterval(() => {
      if (results.length == IPs.length){
        clearInterval(id);
        for (var r of results) {
          if (r.qres) {
            nStored++;
            hosts.push({host:r.qres.remMUID,ip:r.qres.remIp});
          }
        }
        console.log('All Shards Saved::TotalTime',Date.now() - startT,'shardID: ',j.shard.hash,'nStored::',nStored);
        res.end('{"result":"shardOK","nStored":'+nStored+',"shardID":"'+j.shard.hash+'","hosts":'+JSON.stringify(hosts)+'}');
          
      }
      trys++;
      if (trys > 25) {
        clearInterval(id);
        console.log('Interval stopped.',results);
        res.end('{"result":"FAILED","nStored":'+nStored+',"shardID":"'+j.shard.hash+'","hosts":'+JSON.stringify(hosts)+'}');
      }
    }, 300); 
    return;
  }
}
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
    database: "shardTree",
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
class shardTreeObj {
  constructor(peerTree,reset){
    this.reset      = reset;
    this.isRoot     = null;
    this.status     = 'starting';
    this.net        = peerTree;
    this.receptor   = null;
    this.wcon       = new MkyWebConsole(this.net,con,this,'shardTreeCell');

    this.net.DStream.attachCell(this); // Attach network binary transport.
  }
  startCell(){
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
  }
  async handleReq(res,j){
    //console.log('root recieved: ',j);
    if (j.req == 'pShardQryResult'){
      this.pushQryResult(j,res);
      return true;
    }
    if (j.req === 'getFile'){
      this.doHandleSendByBin(j);
      return true;
    }
    if (j.req === 'waitForShard'){
      this.waitForShard(j);
      return true;
    }
    if (j.req === 'sendByBinShard'){
      this.sendByBinShard(j);
      return true;
    }
    if (j.req === 'storeShard'){
      this.storeShard(j,res);
      return true;
    }
    if (!this.isRoot && this.status != 'Online'){
      this.net.endRes(res,'');
      return true;
    }
    return false;
  }
  handleReply(j){
    //console.log('\n====================\nXXXshardCell reply handler',j);
  }
  handleBCast(j){
    //console.log('bcast received: ',j);
    if (j.remIp == this.net.nIp) {console.log('ignoring bcast to self',this.net.nIp);return;} // ignore bcasts to self.
    if (!j.msg.to) {return;}
    if (j.msg.to == 'shardCells'){
      this.updatePShardcellDB(j);  
      if (j.msg.req){
        if (j.msg.req == 'sendShardHost')
          this.doSendShardHost(j.msg,j.remIp);
        if (j.msg.req == 'sendShard')
          this.doSendShardToOwner(j.msg,j.remIp);
        if (j.msg.req == 'deleteShard')
          this.doDeleteShardByOwner(j.msg,j.remIp);
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
      to : 'shardCells',
      token : 'some token'
    }
    //console.log('bcast greeting to shardCell group: ',breq);
    this.net.broadcast(breq);
    const gtime = setTimeout( ()=>{
      this.sayHelloPeerGroup();
    },50*1000);
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
  doSendShardHost(j,remIp){
     if (j.xIPs.includes(this.net.nIp)){
       return;
     }
     var SQL = `select sownID from shardTree.shardOwners where sownMUID = '${j.shard.from}'`;
     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log(err);
       }
       else {
         var sownID = null;
         if (result.length != 0){
           sownID = result[0].sownID;
           var SQL = `select shardHash from shardTree.shards where shardOwnerID = ${sownID} and shardHash = '${j.shard.hash}'`;
           con.query(SQL, (err, result, fields)=> {
             if (err) console.log(err);
             else {
               if (result.length > 0){
                 var qres = {
                   req : 'sendShardHostRes',
                   ip  : this.net.nIp,
                   hostname : this.net.peerMUID
                 }
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
  doSendShardToOwner(j,remIp){
     //console.log('shard request from: ',remIp);
     console.log('here is the req..',j);
     var SQL = "select sownID from shardTree.shardOwners where sownMUID = '"+j.shard.ownerID+"'";
     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log(err);
       }
       else {
         var sownID = null;
         if (result.length == 0){
           console.log('DoSendShardToOwner:: Shard Owner Not Found On This Node.');
           return;
         }
         else {
           sownID = result[0].sownID;
           var fsdat = null;
	   const fname = ftreeRoot+sownID+'-'+j.shard.hash+'.srd'; 
           try {
             if (!fs.existsSync(fname)) {
               return;  // file does not exist
             } else {
	       var qres = {
                 req     : 'pShardDataResult',
                 status  : 'SHARD_AVAILABLE',
                 sownId  : sownID,
                 shardId : j.shard.hash,
               }
               console.log('sending shard result:',qres);
               this.net.sendReply(remIp,qres);
             }
           }    
           catch (err) {
             console.log('error reading from srootTree::Shared Not On Node');
             //console.log('Wallet Created And Saved!');
           }
           return;
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
  doPowStop(remIp){
    this.net.gpow.doStop(remIp);
  }
  doPow(j,remIp){
    if (j.xnodes.includes(this.net.nIp)){
      return;
    }
    this.net.gpow.doPow(2,j.work,remIp);
  }
  /******************************************************
  Delete All Shard Files And Owner Record from this node
  =======================================================
  */
  doDeleteAllByOwner(j,remIp){

     if (!this.isValidSig(j.shard.signature)){
       console.log('Shard Signature Invalid... NOT deleted');
       return;
     }
     var SQL = "select sownID from shardTree.shardOwners where sownMUID = '"+j.shard.ownerID+"'";
     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log('shard delete',err);
       }
       else {
         var sownID = null;
         if (result.length == 0){
           console.log('doDeleteAllByOwner:: Shard Owner Not Found On This Node.');
           return;
         }
         else {
           sownID = result[0].sownID;
           var fsdat = null;
           const fname = ftreeRoot+sownID+'-*.srd';
           fs.unlink(fname, (err)=>{
             if (err) {console.log('shard delete all.. File not found:',fname);}
             else {
               var SQL = "delete from shardTree.shardOwners where sownMUID = '"+j.shard.ownerID+"'";
               con.query(SQL , async(err, result,fields)=>{
                 if (err){
                   console.log('shard delete all fail',err);
                 }
	       });	       
               var qres = {
                 req : 'delAllShardsResult',
                 result : 1,
                 qry : j
               }
               //console.log('sending shard delete result:',qres);
               this.net.sendReply(remIp,qres);
             }
           });
           return;
         }
       }
     });
  }
  /******************************************************
  Delete Shard File Specified By Owner from this nodee
  =======================================================
  */
  doDeleteShardByOwner(j,remIp){
     if (!this.isValidSig(j.shard.signature)){
       console.log('Shard Signature Invalid... NOT deleted');
       return;
     }
     var SQL = "select sownID from shardTree.shardOwners where sownMUID = '"+j.shard.ownerID+"'";
     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log('shard delete',err);
       }
       else {
         var sownID = null;
         if (result.length == 0){
           console.log('Shard Owner Not Found On This Node.');
           return;
         }
         else {
           sownID = result[0].sownID;
           var fsdat = null;
           const fname = ftreeRoot+sownID+'-'+j.shard.hashID+'.srd';
           fs.unlink(fname, (err)=>{
             if (err) {
               console.log('shard delete file not found:',fname);
             }
	     else {
               SQL = `delete from shardTree.shards where shardOwnerID = ${sownID} and shardHash='${j.shard.hash}' and shardHashID = '${j.shard.hashID}' `;
               con.query(SQL , async(err, result,fields)=>{
                 if (err){
                    console.log('db shards delete shard error',err);
                 }
                 else {
                   if (result.affectedRows > 0) {
                     var qres = {
                       req : 'pShardDeleteResult',
                       result   : 1,
                       ip       : this.net.nIp,
                       hostname : this.net.peerMUID,
                       hash     : j.shard.hash
                     }
                     //console.log('sending shard delete result:',qres);
                     this.net.sendReply(remIp,qres);
                   }
                   else {console.log(`no shard db record to delete.`)}
                 }
               });
             }
           });
           return;
         }
       }
     });
  }
  receptorReqDeleteMyShard(j){
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      var n = 0;
      const hosts = [];
      const gtime = setTimeout( ()=>{
        console.log('Shard Delete Request Timeout At:'+n+' for:',j.shard.hash);
        this.net.removeListener('mkyReply', mkyReply);
        resolve(hosts);
      },0.75*1000);
      var req = {
        to    : 'shardCells',
        req   : 'deleteShard',
        shard : j.shard
      }

      this.net.broadcast(req);
      this.net.on('mkyReply',mkyReply = (r) =>{
        //console.log('mkyReply DeleteShard is:',r);
        if (r.req == 'pShardDeleteResult' && r.hash == j.shard.hash){
          n += 1;
          hosts.push({host:r.hostname,ip:r.ip});
          console.log('shardDelete responses:',n);
          if (n >= j.shard.nCopys){
            clearTimeout(gtime);
            this.net.removeListener('mkyReply', mkyReply);
            resolve(hosts);
          }
        }
      });
    });
  }
  receptorReqStopIPGen(work){
    var req = {
      to : 'shardCells',
      req : 'stopNodeGenIP',
      work  : work
    }
    this.net.broadcast(req);
  }
  receptorReqNodeList(j,excludeIps=[]){
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const maxIP = j.shard.nCopys;
      var   IPs = [];
      const gtime = setTimeout( ()=>{
        console.log('Send Node List Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(IPs);
      },7*1000);

      var req = {
        to     : 'shardCells',
        req    : 'sendNodeList',
        nodes  : maxIP,
        xnodes : excludeIps,
        work   : crypto.randomBytes(20).toString('hex') 
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
  receptorReqSendShardHost(j,xIP){
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const hosts = [];
      const gtime = setTimeout( ()=>{
        j.shard.data = 'REMOVED';
        console.log('Send Shard Hosts Request Timeout:',j,hosts);
        this.net.removeListener('mkyReply', mkyReply);
        resolve(hosts);
      },1.5*1000);

      var req = {
        to : 'shardCells',
        req : 'sendShardHost',
        shard : j.shard,
        xIPs  : j.shard.xIP
      }

      this.net.broadcast(req);
      this.net.on('mkyReply',mkyReply = (r) =>{
        if (r.req == 'sendShardHostRes'){
          hosts.push(r.ip);
          if (host.length >= j.shard.maxn){
            clearTimeout(gtime);
            this.net.removeListener('mkyReply', mkyReply);
            resolve(hosts);
          }
        }
      });
    });
  }
  receptorReqSendMyShard(j){
    return new Promise((resolve,reject)=>{
      var mkyReply = null;
      const gtime = setTimeout( ()=>{
        console.log(' receptorReqSendMyShard):: Send Shard Request Timeout:',j);
        this.net.removeListener('mkyReply', mkyReply);
        resolve(null);
      },950);
      console.log('bptorReqSendMyShard()::  request for shard data: ',j);
      var req = {
        to    : 'shardCells',
	req   : 'sendShard',
        shard : j.shard
      }
      let responses = 0;
      this.net.broadcast(req);
      this.net.on('mkyReply',mkyReply = async (r) =>{
        console.log(`receptorReqSendMyShard():: heard`,r);
	if (r.req === 'pShardDataResult' && j.shard.hash === r.shardId && r.status === 'SHARD_AVAILABLE'){
          clearTimeout(gtime);
          this.net.removeListener('mkyReply', mkyReply);
          if (responses === 0){
            responses++;
            console.log(' receptorReqSendMyShard():: shardData found for shard.hashID: ',r);
            const shard = await this.doSendByBinStream(r.remIp,r);
            resolve(shard);
          }
        }
      });
    });
  }
  async doSendByBinStream(ip,r){
    let msg = {
      req      : 'sendByBinShard',
      response : 'sendByBinShardResult',
      shardId  : r.shardId,
      sownId   : r.sownId
    }
    let doTry = await this.net.reqReply.waitForReply(ip,msg);
    if (doTry.result === 'OK'){
      const shardBuf = await this.doWaitForShard(r.shardId,doTry.strReqId);
      return shardBuf;
    }
    return null;
  }
  doWaitForShard(shardId,reqId){
    return new Promise( (resolve) =>{
      var mkyReply = null;
      const gtime = setTimeout( ()=>{
        console.log('doWaitForShard():: wait for Shard binary Timeout:',shardId);
        this.net.removeListener('shardReady', mkyReply);
        resolve(null);
      },950);

      this.net.on('shardReady',mkyReply = (s) =>{
        console.log(`doWaitForShard():: heard for reqId: ${reqId}`,s);
        console.log(`boob`);
        if (s.reqId === reqId){  
          clearTimeout(gtime);
          this.net.removeListener('shardReady', mkyReply);    
          resolve(s.buffer);
        }
      });
 
    });
  }
  doHandleSendByBin(j){
    this.net.emit('shardReady',j);
  }
  async sendByBinShard(j){
    console.log(`attaching DStreamMgr`);
    this.net.DStream.attachCell(this);
    const msg = {
      req      : 'getFile',
      response : 'getFileResult',
      filename : ftreeRoot+j.sownId+'-'+j.shardId+'.srd',
      shardId  : j.shardId
    }
    let reply = {
      reqId    : j.reqId,
      response : 'sendByBinShardResult',
      result   : 'OK',
      strReqId : null
    }
 
    let doSend = await this.net.DStream.sendMsg(msg,j.remIp,'memFile');
    if (doSend.result !== 'STREAM_META_ACK'){
      console.log(`File : ${msg.filename} faild`);
      reply.result = 'SEND_BIN_FAILED';
    }
    reply.strReqId = doSend.reqId;
    
    this.net.sendReply(j.remIp, reply);  
    return true;
  }
  receptorReqStoreShard(j,toIp,blob){
    console.log('receptorReqStoreShard',j);
    return new Promise(async (resolve,reject)=>{	  
      var mkyReply = null;
      const gtime = setTimeout( ()=>{
        console.log('Store Request Timeout:5000');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(null);
      },5000);  
      console.log('Store Shard To: ',toIp);
      const msg = {
        req      : 'waitForShard',
        response : 'waitForShardResult',
        shardId  : j.shard.hash,
        sownId   : j.shard.from
      }
      let doTry = await this.net.reqReply.waitForReply(toIp,msg);
      console.log(`receptorReqStoreShard():: doTry`,doTry);
      if (!doTry.result === 'OK'){
        resolve(null);
        return;
      }

      const dmsg = {
        req      : 'getFile',
        response : 'getFileResult',
        filename : {
          req   : 'storeShard',
          shard : j.shard,
        }
      }

      let doSend = await this.net.DStream.sendMsg(dmsg,toIp,'memFile',5,blob);
      if (doSend.result !== 'STREAM_META_ACK'){
        console.log(`binarySend : ${msg.filename} failed`,doSend);
        resolve(null);
        return;
      }
      console.log(`receptorReqStoreShard():: `,j);
      
      this.net.on('mkyReply',mkyReply = (r) =>{
        if (r.shardStoreRes && r.remIp == toIp){
          console.log('shardStoreRes OK!!');
          clearTimeout(gtime);
          this.net.removeListener('mkyReply', mkyReply);
	  resolve(r);
        }		    
      });
    });
  }	
  async waitForShard(j){
    let reply = {
      reqId    : j.reqId,
      response : 'waitForShardResult',
      result   : 'OK'
    }
    this.net.sendReply(j.remIp,reply);
    let stream = await this.waitForStoreShardBuf(j.shardId);
    if (stream)
      this.storeShard(stream,j.remIp);
  }
  async waitForStoreShardBuf(shardId){
    return new Promise( (resolve) =>{
      var mkyReply = null;
      const gtime = setTimeout( ()=>{
        console.log('waitForStoreShardBuf():: wait for Shard binary Timeout:',shardId);
        this.net.removeListener('shardReady', mkyReply);
        resolve(null);
      },950);

      this.net.on('shardReady',mkyReply = (s) =>{
        console.log(`waitForStoreShardBuf():: heard for reqId: ${shardId}`,s);
        if (s.fileInfo.shard.hash === shardId){ 
          console.log(`waitForStoreShardBuf():: received shard`,shardId);
          clearTimeout(gtime);
          this.net.removeListener('shardReady', mkyReply);
          resolve(s);
        }
      });

    });
  }
  createNewSOWN(sown){
    return new Promise((resolve,reject)=>{
      var SQL = "insert into shardTree.shardOwners (sownMUID) values ('"+sown+"');";
      SQL += "SELECT LAST_INSERT_ID() AS newSownID;";
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
	  resolve(null);
        }
        else {
          const nres = result[1];
          resolve(nres[0].newSownID);
        }
      });
    });
  }
  createInvoiceRec(sownID,hash,sig,hashID){
    var invSig = {
       token : sig.token,
       sig   : sig.signature
    }
    var SQL = "INSERT INTO `shardTree`.`shards` SET ?";
    var values = {
      shardOwnerID : sownID,
      shardHash    : hash,
      shardHashID  : hashID,
      shardDate    : new Date(),
      shardExpire  : null,
      shardOwnSignature : JSON.stringify(invSig)
    };
    con.query(SQL ,values, (err, result,fields)=>{
      if (err){
        console.log(err);
      }
    });
  }
  storeShard(j,remIp){
    console.log(`storeShare():: j is `,j);
    j.shard = j.fileInfo.shard;
    j.shard.data = j.buffer;

    console.log('got request store shard',j.shard.signature);
    if (!this.isValidSig(j.shard.signature)){
      console.log('Shard Signature Invalid... NOT stored');
      this.net.endRes(remIp,'{"shardStoreRes":false,"error":"Invalid Signature For Request"}');
      return;
    }
    var SQL = "select sownID from shardTree.shardOwners where sownMUID = '"+j.shard.from+"'";
    con.query(SQL , async(err, result,fields)=>{
      if (err){
        console.log(err);
        this.net.endRes(remIp,'{"shardStoreRes":false,"error":"'+err+'"}');
        return;
      }
      else {
        var sownID = null;
	if (result.length == 0){
          sownID = await this.createNewSOWN(j.shard.from);
          if (!sownID){
            console.log('{"shardStoreRes":false,"error":"failed to create new owner record for shardOwner"}',remIp);
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
          this.net.endRes(remIp,'{"shardStoreRes":false,"error":"'+err+'"}');
          return;
        }
        else {
          if (result[0].nRec > 0){
	    console.log("Shard Record exists");
            const shardf = ftreeRoot + sownID + '-' + j.shard.hash + '.srd';

            fs.stat(shardf, async (err, stats) => {
              if (err || stats.size === 0) {
                // File missing or empty → delete if needed
                try { fs.unlinkSync(shardf); } catch {}
                console.log("Shard missing or empty:", shardf);
              }

              // File exists → verify SHA-256
              try {
                const fileBuf = fs.readFileSync(shardf);
                const crypto = require('crypto');
                const hash = crypto.createHash('sha256').update(fileBuf).digest('hex');

                if (hash !== j.shard.hash) {
                  console.warn("Shard hash mismatch, deleting:", shardf);

                  // Delete corrupted shard
                  try { fs.unlinkSync(shardf); } catch {}
                }

                // Hash matches → shard is valid
                console.log("Shard already exists and is valid:", shardf);
                this.net.endRes(remIp,'{"shardStoreRes":true,"shardStorHash":"' + j.shard.hash + '"}');
                return;

              } catch (e) {
                console.error("Error verifying shard:", e);
                this.net.endRes(remIp, `{"shardStoreRes":false,"error":"Verify error"}`);
                return;
              }
            });
	  }
        }
        console.log(ftreeRoot + sownID + '-' + j.shard.hash + '.srd', j.shard.data);
        fs.writeFile(ftreeRoot + sownID + '-' + j.shard.hash + '.srd', j.shard.data, (err) => {
          if (err) {
            console.log('error writing srootTree:', err);
            this.net.endRes(remIp, '{"shardStoreRes":false,"error":"' + err + '"}');
          }
	  else {
	    this.createInvoiceRec(sownID,j.shard.hash,j.shard.signature,j.shard.hashID);
            this.net.endRes(remIp,'{"shardStoreRes":true,"shardStorHash":"' + j.shard.hash + '"}');
            console.log('{"shardStoreRes":true,"shardStorHash":"' + j.shard.hash + '"}',remIp);
	  }
        });
      });
    });
  }
  deleteShardOrphinRecord(SQL){
    con.query(SQL , async(err, result,fields)=>{
      if (err){
        console.log(err);
      }
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
