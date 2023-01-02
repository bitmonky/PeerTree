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
const attachReceptor = true;
if (attachReceptor == true){
  const recPort = 1335;
  console.log('ATTACHING - cellReceptor on port'+recPort);

  const options = {
    //key: fs.readFileSync('/etc/letsencrypt/live/admin.bitmonky.com/privkey.pem'),
    //cert: fs.readFileSync('/etc/letsencrypt/live/admin.bitmonky.com/fullchain.pem')
    key: fs.readFileSync('keys/privkey.pem'),
    cert: fs.readFileSync('keys/fullchain.pem')
  };
  const memToken = new peerMemToken();
  console.log(memToken);
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
	  j.memory.token = openMemKeyFile(j);
	  signMemRequest(j);
          res.end('{"result":"memOK","memory":"'+j.memory+'"}');
          return;
        }   
        res.end('OK');
      }
      else {
        res.end('Wellcome To The BitMonky KeyGEN Server\nUse end point /keyGEN to request key pair');
      }
    }
  });
  function openMemKeyFile(j){
    var memToken = {
      publicKey   : 'test',
      ownMUID     : 'f188ssd8x-d'  // create from public key using bitcoin wallet algorythm.
    };
    return memToken;
  }
  function signMemRequest(j){
    return;
  }
  bserver.listen(recPort);
  console.log('BitMonkyBanker Server running at admin.bitmonky.com:'+recPort);
}
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
  constructor(branchId,branchIp,branchNetwork,reset,resetTo=null){
    this.reset      = reset;
    this.resetBlock = resetTo;
    console.log('Reset To block: '+resetTo,this.resetBlock);
    this.isRoot     = null;
    this.status     = 'starting';
    this.net        = branchNetwork;
    this.net.broadcast("Hello Bit Monky Miners");
    this.wcon         = new MkyWebConsole(this.net,con,this);
    this.init();
    this.setNetErrHandle();
    this.doNodesDBMaint();
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
  reSumerizeDB(){
    return new Promise( (resolve,reject)=>{
      console.log('reload day and month sum log');
      var SQL  = "insert into tblGoldTranDaySum (gtdsDate,gtdsGoldType,gtdsSource,gtdsTycTax, ";
      SQL += "gtdsAmount,gtdsGoldRate,gtdsMUID) ";
      SQL += "SELECT date(gtlDate),gtlGoldType,gtlSource,sum(gtlTycTax),sum(gtlAmount) ";
      SQL += ",avg(gtlGoldRate),gtlMUID ";
      SQL += "FROM tblGoldTranLog ";
      SQL += "group by date(gtlDate),gtlMUID,gtlGoldType,gtlSource,gtlSrcID";
      con.query(SQL, (err, result, fields)=>{
        if (err) {console.log(err);resolve(false);return;}
        else console.log( "\nSummerized Days transactions...\n");
        SQL  = "insert into tblGoldTranMonthSum (gtmsDate,gtmsGoldType,gtmsSource,gtmsTycTax, ";
        SQL += "gtmsAmount,gtmsGoldRate,gtmsMUID) ";
        SQL += "SELECT concat(DATE_FORMAT(gtlDate,'%Y-%m'),'-01'),gtlGoldType,gtlSource,sum(gtlTycTax),sum(gtlAmount) ";
        SQL += ",avg(gtlGoldRate),gtlMUID ";
        SQL += "FROM tblGoldTranLog ";
        SQL += "where date(gtlDate) <= DATE(NOW() - INTERVAL 1 MONTH) ";
        SQL += "group by year(gtlDate),month(gtlDate),gtlMUID,gtlGoldType,gtlSource,gtlSrcID";
        con.query(SQL, (err, result, fields)=>{
          this.rollover  = false;
          if (err) {console.log(err);resolve(false);return;}
          else console.log( "\nSummerized Month transactions...\n");
          resolve(true);
        });
      });
    });
  }
  resetDb(blockNbr=null){
    return new Promise( (resolve,reject)=>{
      var SQL = "";
      if (!blockNbr){
        SQL = "truncate table mkyBank.tblGoldTranDaySum; ";
        SQL += "truncate table mkyBank.tblGoldTranMonthSum; ";
        SQL += "truncate table mkyBank.tblGoldTrans; ";
        SQL += "truncate table mkyBank.tblGoldTranLog;";
        SQL += "truncate table mkyBank.tblmkyWallets;";
        SQL += "truncate table mkyBlockC.tblmkyBlocks;";
        SQL += "truncate table mkyBlockC.tblmkyBlockTrans;";
      }
      else {
        SQL  = "truncate table mkyBank.tblGoldTranDaySum; ";
        SQL += "truncate table mkyBank.tblGoldTranMonthSum; ";
        SQL += "delete from mkyBank.tblGoldTrans        where gtrnBlockID > "+blockNbr+"; ";
        SQL += "delete from mkyBank.tblGoldTranLog      where gtlBlockID > "+blockNbr+"; ";
        SQL += "delete from mkyBlockC.tblmkyBlocks      where blockNbr > "+blockNbr+"; ";
        SQL += "delete from mkyBlockC.tblmkyBlockTrans  where tranBlockID > "+blockNbr+"; ";
      }
      con.query(SQL, async (err, result, fields)=>{
        if (err) {console.log(err);reject(err);}
        else {
          this.reSumerizeDB();
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
    if (j.req == 'changeBankStatus'){
      this.group.updateGroup(j.me);
      this.net.endRes(res,'');
      return true;
    }
    if (!this.isRoot && this.status != 'Online'){
      this.net.endRes(res,'');
      return true;
    }
    if (j.req == 'storeMemory'){
      this.storeMemory(j,res);
      return true;
    }
    return false;
  }
  handleReply(j){
   //console.log('\n====================\nmkyBanker reply handler',j);
    if (j.statusUpdate){
      this.group.updateGroup(j.statusUpdate);
      return;
    }
    //if (this.chain.handleReply(j))
    //  return;

   //console.log('\nNo Bank Reply Handler Found For: ',j);
  }
  handleBCast(j){
    if (!j.msg.to) {return;}
    if (j.msg.to == 'peerMemCells'){
      if (j.msg.qry){
        if (j.msg.qry.qryType == 'bestMatch')
          this.doBestMatchQry(j.msg,j.remIp);
        else if (j.msg.qry.qryType == 'seqMatch')
	  this.doSeqMatchQry(j.msg,j.remIp);
      }
    } 
    return;
  }
  procBranchReq(msg,to){
    if (msg.joinGroup){
      this.group.addPeer(msg.joinGroup);
      this.group.replyGotUAddMe(to);
      this.group.listGroup();
      return;
    }

    if (this.status != 'Online'){
      console.log('Service Not Ready... buffering Transactions');
      //if (msg.procBitMonkTran){
      this.bufferTransactions(msg,to);
      //}
      return;
    }
    if (msg.blockConf){
      this.confirmNewBlock(msg.blockConf,msg.payment);
      return;
      //this.net.sendMsg(to,req);
    }
    if (msg.createAcc){
      var wal = msg.createAcc
      this.createAccount(wal.pubKey,wal.MUID,to);
      return;
    }
    if (msg.procBitMonkTran){
      this.procBitMonkTran(msg);
      return;
    }
  }
  procBankersReq(msg,to){
    //console.log('\nProcBankersReq to '+ to,msg,to);
    if (msg.send == 'blistInfo'){
      var req = {
        req : 'bcReply',
        blistInfo : {
          ip  : this.branchIp,
          id  : this.branchId
        }
      }
      //console.log('response to banker node: ',req.blistInfo);
      this.net.sendMsg(to,req);
    }
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
  storeMemory(j,res){
    const mUID = j.mUID;
    var memories = j.mem.qry.split(' ');
    var nwords   = memories.length;  
    var SQLr = "insert into peerBrain.peerMemoryCell (pmcMownerID,pmcMemObjID,pmcMemType,pmcMemObjNWords,pmcMemWord,pmcWordSequence) ";
    var SQL = "";
    var n = 1;
    memories.forEach( (word) =>{
      if (word != ''){
        SQL += SQLr + "values ('"+j.mem.owner+"','"+j.mem.memID+"','"+j.mem.memType+"',"+nwords+",'"+word+"',"+n+");";
        n = n + 1;
      }
    });	    
    con.query(SQL , (err, result,fields)=>{
      if (err){
        console.log(err);
        this.net.endRes(res,JSON.stringify(err));
      }
      else {
        this.net.endRes(res,'{"memStorRes":true,"memStorHash":' + hash + '}');
      }
    });
  }
  createAccount(pubKey,wMUID,to){
    var net = this.net;
    let SQL = "select mwalID from tblmkyWallets where mwalMUID = '" + wMUID + "'";
    let branchId = this.branchId;
    console.log('create wallet acc send result to ',to);
    con.query(SQL, function (err, result, fields) {
      if (err)
        net.sendMsg(to,{bankResult:{newWallet:null,error:"database failed"}});
      else {
        if (result.length)
          net.sendMsg(to,{bankResult:{newWallet: result[0].mwalID ,status:"onFile"}});
        else {
          let SQL = "insert into tblmkyWallets (mwalPubKey,mwalGBranchID,mwalDate,mwalMUID) ";
          SQL += "values('" + pubKey + "'," + branchId + ",now(),'" + wMUID + "')";
          con.query(SQL, function (err, result, fields) {
            if (err)
              net.sendMsg(to,{bankResult:{newWallet:null,error:"database failed: "+SQL}});
            else {
              let SQL = "select mwalID from tblmkyWallets where mwalMUID = '"+ wMUID +"'";
              con.query(SQL, function (err, result, fields) {
                if (err) 
                  net.sendMsg(to,{bankResult:{newWallet:null,error:"database failed: "+SQL}});
                else {
                  net.sendMsg(to,{bankResult:{newWallet: result[0].mwalID }});
                }
              });
            }
          });
        }
      }
    });
  }
  sendLastWallets(res,lastWalMUID){
    var SQL = "select * from tblmkyWallets where mwalMUID > '"+lastWalMUID+"' order by mwalMUID ";
    var SQL = "select * from tblmkyWallets ";
   //console.log(SQL);
    con.query(SQL , (err, result,fields)=>{
      if (err){
        this.net.endRes(res,'"blockErr":' + JSON.stringify(err)+'}');
       //console.log('db error',SQL);
      }
      else {
        var trans = [];
        const dbres = Object.keys(result);
        dbres.forEach(function(key) {
          var tRec = result[key];
          trans.push(tRec);
        });
        if (trans.length == 0){
          this.net.endRes(res,'{"result":"No More Wallets To Send."}');
         //console.log('no wallets to send');
        }
        else {
          var myResponse = {
            bLastWallets : trans
          }
         //console.log('sending wallets',myResponse);
          this.net.endRes(res,JSON.stringify(myResponse));
        }
      }
    });
  }
  storeBlockChainRec(conf,trans,prevHash,minerID){
    var bank = this;
    return new Promise( (resolve,reject)=>{
      var SQL = "select count(*)nBlocks from mkyBlockC.tblmkyBlocks where blockChainID = "+conf.chainId+" and blockNbr = "+conf.blockID;
      con.query(SQL, async function (err, result, fields) {
        if (err) {console.log(err);reject(false);}
        else {
          var tRec = result[0];
          if (tRec.nBlocks == 0){
            SQL = "insert into mkyBlockC.tblmkyBlocks (blockNbr,blockHash,blockPrevHash,blockNOnce,blockTimestamp,blockChainID,";
            SQL += "blockMinerID,blockDifficulty,blockHashTime) ";
            SQL += "values ("+conf.blockID+",'"+conf.hash+"','"+prevHash+"',"+conf.nonce+","+conf.timestamp+","+conf.chainId;
            SQL += ","+minerID+","+conf.diff+","+Date.now()+")";
            con.query(SQL, async function (err, result, fields) {
              if (err) {console+log(err);reject(false);}
              else {
                var res = await bank.storeBlockTransData(trans,conf.blockID,conf.chainId);
                resolve(res);
              }
            });
          }
          else {
           //console.log('Block Already Exists'); 
            resolve(false);
          }
        }
      });
    });
  }
}
function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

module.exports.peerMemoryObj = peerMemoryObj;

