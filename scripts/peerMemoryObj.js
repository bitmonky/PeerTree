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
const mysql        = require('mysql2');
const schedule     = require('node-schedule');
const {MkyWebConsole} = require('./networkWebConsole.js');
const {pcrypt}        = require('./peerCrypt');

addslashes  = require ('./addslashes');

/*********************************************
PeerTree Receptor Node: listens on port 1335
==============================================
This port is used for your regular apps to interact
with a memoryCell on the PeerTree Memory network;
*/
class pSearchMgr{
   constructor(){
     this.searches = [];
     this.nPushes = 0;
   }
   /***********************************************
   isThere - gets the index for a given search key.
   If not found creatres and ads it to the list
   */
   isThere(qry){
     const inId = qry.key;
     var i = null;
     this.searches.every((item,n) =>{
       if (item.id == inId){
         i = n;
         return false;
       } 
       return true;
     });
     if(i === null){
       this.searches.push({id:inId,time: qry.timestamp,data : []});
       return this.searches.length -1;
     }
     return i;
   }
   getIndexOf(inId){
     var i = null;
     this.searches.every((item,n) =>{
       if (item.id == inId){
         i = n;
         return false;
       }
       return true;
     });
     return i;
   }
   /*****************************************
   add a list of results to existing list by
   iterating through the 'results' pushing them onto the end.
   when done 'qsort' the full list.
   */
   contains (qIndex,key){
     const items = this.searches[qIndex].data;
     for (let i = 0; i < items.length; i++) {
       if (items[i].pmcMemObjID == key){
	 return true;
       }
     }
     return false;	   
   }
   qpush(qry,results){
     const qIndex = this.isThere(qry);
     this.nPushes++;
     results.forEach((item, n)=>{
       if(!this.contains(qIndex,item.pmcMemObjID)){
	 this.searches[qIndex].data.push(item);
       }	       
     });
     this.qsort(qry);
   }
   qsort(qry){
     const qIndex = this.isThere(qry);
     this.searches[qIndex].data;    
     this.searches[qIndex].data.sort((a, b) => {
       const scoreA = Number(a.score); 
       const scoreB = Number(b.score); 
       if (scoreA < scoreB) {
         return 1;
       }
       if (scoreA > scoreB) {
         return -1;
       }
       // scores must be equal
       return 0;
     });
   }
};

class peerMemToken{
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
      try {keypair =  fs.readFileSync('keys/peerMemToken.key');}
      catch {console.log('no wallet file found');}
      this.publicKey = null;
      if (keypair){
        try {
          const pair = keypair.toString();
          const j = JSON.parse(pair);
          this.publicKey    = j.publicKey;
          this.privateKey   = j.privateKey;
          this.memOwnMUID   = j.memOwnMUID;
	  this.memCipher    = j.memCipher;
          this.crypt        = new pcrypt(this.memCipher);
  	  this.signingKey   = ec.keyFromPrivate(this.privateKey);
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
        this.memCipher = mkybc.address;

        var wallet = '{"memOwnMUID":"'+ this.branchMUID+'","publicKey":"' + this.publicKey + '","privateKey":"' + this.privateKey + '",';
        wallet += '"memCipher":"'+this.memCipher+'"}';
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
    this.results = ['empty'];
    this.searches = [];
    const options = {
      key: fs.readFileSync('keys/privkey.pem'),
      cert: fs.readFileSync('keys/fullchain.pem')
    };
    this.memToken = new peerMemToken();
    this.smgr     = new pSearchMgr;
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
          //console.log('mkyReq',j);

          if (j.req == 'storeMemory'){
	    this.prepMemoryReq(j,res);
            return;
          }   
          if (j.req == 'searchMemory'){
            this.doSearch(j,res);
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
  isThere(inId){
    var i = null;
    this.searches.every((item,n) =>{
      if (item.id == inId){
        i = n;
        return false;
      }
      return true;
    });
    if(i === null){
      this.searches.push({id:inId,data : []});
      return this.searches.length -1;
    }
    return i;
  } 
  procQryResult(j){
    //console.log('incoming search result:',j);
    var SQL = null;
    this.smgr.qpush(j.qry.qmgr,j.result);
    return;
}
  openMemKeyFile(j){
    const bitToken = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+this.memToken.publicKey, 'hex') }); 
    var mToken = {
      publicKey   : this.memToken.publicKey,
      ownMUID     : bitToken.address,
      privateKey  : '***********'  //this.memToken.privateKey  // create from public key using bitcoin wallet algorythm.
    };
    return mToken;
  }
  async doSearch(j,res){
    console.log('doSearch qkey is: ',j.qry.key);
    var qry = {
      key  : j.qry.key,
      timestamp : Date.now(),
      qryStr    : j.qry.qryStr,
      data : [] // results list from a search; 
    }
    this.qIndex = this.smgr.isThere(qry);
    //this.searchIndex = this.isThere(j.qry.key);
    this.results = {result : 0, msg : 'no results found'};
    var breq = {
      to : 'peerMemCells',
      qry : j.qry,
      qmgr : qry
    }
    console.log('bcast search request to memoryCell group: ',breq.qmgr);
    this.peer.net.broadcast(breq);
    const qres = await this.getSearchResults(j);
    res.end(JSON.stringify(qres));
  }
  getSearchResults(j){
    return new Promise( async(resolve,reject)=>{
      var skey = j.qry.key;
      var trys = 0;
      var result = [];
      var cindex = null;
      while (trys < 10){
        await sleep(1500);
        console.log('SearchMGR::Try:'+trys,this.smgr);
        cindex = this.smgr.getIndexOf(skey);      
        result = [...this.smgr.searches[cindex].data];
        this.smgr.searches.splice(cindex,1);
        if (result.length > 0){
          result.sort((a, b) =>{
            const scoreA = Number(a.score);
            const scoreB = Number(b.score);
            if (scoreA < scoreB) {
              return 1;
            }
            if (scoreA > scoreB) {
              return -1;
            }
            // scores must be equal
            return 0;
          });

	  console.log('Sorted Result Set::',result);
          
          resolve('{"result": 1,"data":'+JSON.stringify(result)+'}');
          return;
        }
	trys = trys +1; 
      }
      resolve('{"result": 1,"data":'+JSON.stringify(result)+'}');
      return;
    });
  }
  signRequest(j){
    const stoken = j.memory.token.ownMUID + new Date();
    const sig = {
      token : stoken,
      pubKey : this.memToken.publicKey,
      signature : this.memToken.signToken(stoken)
    }
    return sig;
  }
  prepMemoryReq(j,res){
    j.memory.token = this.openMemKeyFile(j);
    j.memory.signature = this.signRequest(j);
    var SQL = "SELECT pcelAddress FROM peerBrain.peerMemCells ";
    SQL += "where pcelLastStatus = 'online' and  timestampdiff(second,pcelLastMsg,now()) < 50 ";
    SQL += "and NOT pcelAddress = '"+this.peer.net.rnet.myIp+"' order by rand() limit "+j.memory.nCopys;
     //console.log(SQL);
    var nStored = 0;
    con.query(SQL,async (err, result, fields)=> {
      if (err) {console.log(err);}
      else {
        if (result.length == 0){
          res.end('{"result":"memOK","nRecs":0,"memory":"No Nodes Available"}');
          return;
	}
	var n = 0;      
	for (var rec of result){ 
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
            j.memory.token.privateKey = '**********';
            j.memory.token.publicKey  = '**********';
            res.end('{"result":"memOK","nStored":'+nStored+',"memory":'+JSON.stringify(j)+'}');
	  }	
          n = n + 1;		
	}
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
var dba = null
try {dba =  fs.readFileSync('dbconf');}
catch {console.log('database config file `dbconf` NOT Found.');}
try {dba = JSON.parse(dba);}
catch {console.log('Error parsing `dbconf` file');}

var con = mysql.createConnection({
  host: "localhost",
  user: "username",
  password: dba.pass,
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
class Word {
  constructor(word, count) {
    this.word = word;
    this.count = count;
  }
}
class peerMemoryObj {
  constructor(peerTree,reset){
    this.reset    = reset;
    this.isRoot   = null;
    this.status   = 'starting';
    this.net      = peerTree;
    this.receptor = null;
    this.wcon     = new MkyWebConsole(this.net,con,this,'peerMemoryCell');
    this.init();
    this.setNetErrHandle();
    this.sayHelloPeerGroup();
    this.resetSearchDb();
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
  updatePMemcellDB(j){
    //console.log('Reviewing PeerTree Nodes DB',j);
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
  resetSearchDb(){
    /* set timeout to restart this function every 60 seconds
    */
    const t = setTimeout(async()=>{
      await this.resetSearchDb();
    },60*1000);
    return new Promise( (resolve,reject)=>{
      var SQL = "";
      SQL =  "truncate table peerBrain.peerSearchResults; ";
      con.query(SQL, async (err, result, fields)=>{
        if (err) {console.log(err);resolve("FAIL");}
        else {
          resolve("OK");
        }
      });
    });
  }
  resetDb(){
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
  }
  handleBCast(j){
    //console.log('bcast received: ',j);
    if (!j.msg.to) {return;}
    if (j.msg.to == 'peerMemCells'){
      this.updatePMemcellDB(j);  
      if (j.msg.qry){
        if (j.msg.qry.qryStyle == 'bestMatch')
          this.doBestMatchQry(j.msg,j.remIp);
        else if (j.msg.qry.qryStyle == 'seqMatch')
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
    //console.log('bcast greeting to memoryCell group: ',breq);
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
  getQryScope(j){
    var r = {search:'',join :''};
    if (j.qry.scope == 'city')
      r.search = ' and pmcCityID = '+j.qry.scopeID+' ';
    if (j.qry.scope == 'state')
      r.search = ' and plocStateID = '+j.qry.scopeID+' ';
    if (j.qry.scope == 'country')
      r.search = ' and plocCountryID = '+j.qry.scopeID+' ';
    if (j.qry.scope == 'wregion')
      r.search = ' and plocWRegionID = '+j.qry.scopeID+' ';
    if (j.qry.scope)
      r.join = ' inner join peerBrain.peerMemLocations on plocCityID = pmcCityID ';
    return r;
  }
  doBestMatchQry(j,ip){
     console.log('search from: ',ip);
     console.log('here is the search..',j);
     var qry = this.singleSpaceOnly(j.qry.qryStr);
     var scope = this.getQryScope(j);
     var words = qry.split(' ');
     var nwords   = words.length;
     var orderBy  = "order by score desc ";
     var limit    = null;

     var qtype = '';
     if (j.qry.qryType){
       qtype = " and pmcMemObjType = '"+j.qry.qryType+"'";
     }
     if (j.qry.qryOrder){
       orderBy = j.qry.qryOrder;
     }
     if (j.qry.qryLimit){
       limit = j.qry.qryLimit;
       orderBy += ' '+limit;
     }
     var SQLr = "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';";
     SQLr += "select pmcMownerID,pmcMemObjID,pmcMemObjNWords,count(*) nMatches,";
     SQLr += "sum(pmcWordWeight)*(count(*) + 1.0/(1.0 + TIMESTAMPDIFF(hour,pmcMemTime,now()))) score ";
     SQLr += "from peerBrain.peerMemoryCell ";
     if (scope.join){
       SQLr += scope.join;
     }	     
     SQLr += "where pmcMownerID = '"+j.qry.ownerID+"' "+scope.search + qtype+" and (";
     var SQL = SQLr;
     var n = 1;
     var or = 'or ';
     words.forEach( (word) =>{
       if (n == nwords){
	 or = '';
       }
       SQL += "pmcMemWord = '"+word+"' "+or; 
       n = n+1;
     });
     SQL += ")group by pmcMownerID,pmcMemObjID ";
     SQL += "having score >= "+j.qry.reqScore+" ";
     SQL += orderBy;
     console.log(SQL);
     con.query(SQL, (err, result, fields)=> {
       if (err) console.log(err);
       else {
         console.log('RESULT::',result);
         if (result[1].length > 0){
           var qres = {
             req : 'pMemQryResult',
	     nRec : result[1].length,
             result : result[1],
             qry : j		   
           }
           this.dumpQryResultsToLog(j,scope,qtype,words,nwords);
           this.net.sendMsg(ip,qres);
         }
       }
     });
  }
  dumpQryResultsToLog(j,scope,qtype,words,nwords){
     var SQLr = "select pmcMemObjID,pmcMemWord,pmcMemObjNWords,pmcWordWeight,pmcMemTime ";
     SQLr += "from peerBrain.peerMemoryCell ";
     SQLr += "where pmcMownerID = '"+j.qry.ownerID+"' "+scope.search + qtype+" and (";
     var SQL = SQLr;
     var n = 1;
     var or = 'or ';
     words.forEach( (word) =>{
       if (n == nwords){
         or = '';
       }
       SQL += "pmcMemWord = '"+word+"' "+or;
       n = n+1;
     });
     SQL += ") order by pmcMemObjID,pmcWordWeight desc";
     console.log('QryDUMP::',SQL);
     con.query(SQL, (err, result, fields)=> {
       if (err) console.log(err);
       else {
         console.log('RESULT::',result);
         if (result[0].length > 0){
           result[0].forEach((rec)=>{
             console.log(rec);
           });
         }
       }
     });
  }
  pushQryResult(j,res) {
    this.net.endRes(res,'{"result":"ok"}');
    this.receptor.procQryResult(j);
    //this.receptor.results = j.result;
  }	  
  receptorReqStoreMem(j,toIp){
    //console.log('receptorReqStoreMem',j);
    return new Promise( (resolve,reject)=>{	  
      var mkyReply = null;
      const gtime = setTimeout( ()=>{
        console.log('Store Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(null);
      },2.5*1000);  
      //console.log('Store Memory To: ',toIp);
      var req = {
        req : 'storeMemory',
        memory : j.memory
      }

      this.net.sendMsg(toIp,req);
      this.net.on('mkyReply',mkyReply = (r) =>{
        if (r.memStoreRes){
          clearTimeout(gtime);
          this.net.removeListener('mkyReply', mkyReply);
          if (r.memStoreRes === false){
            resolve(null);
          }
          else {
            console.log('memStoreRes OK!!',r);
            resolve(r);
          }
	}
      });
    });
  }	  
  incrementWord(list,inWord){
    //console.log('incrememtWord',list);
    for (let word of list) {
      if (word.word == inWord){
	word.count = word.count + 1;
	return;
      }	      
    }
  }
  weightList(list){
    var wlist = [];
    var temp  = [];
    var lweight = 0;	  
    list.forEach((word)=>{
      let lword = new Word(word.toLowerCase(),1);
      if (word.length > 1){
        if (temp.includes(word)){
          this.incrementWord(wlist,word);
        }  	      
        else {
	  temp.push(word);
	  wlist.push(lword);
	  lweight += word.length;
      	}	
      }
    });
    var res = {
      words : wlist,
      weight : lweight
    }
    return res;
  }	  
  checkPeerLoc(j,res){
    var SQL = "select count(*)nMem from peerBrain.peerMemLocations where plocCityID = "+ j.cityID;
    var locOK = false;
    con.query(SQL , (err, result,fields)=>{
      if (err){
        console.log(err);
        this.net.endRes(res,'{"memStoreRes":false,"error":'+JSON.stringify(err)+'}');
      }
      else {
        if (result[0].nMem == 0){
          var SQL  = "insert into peerBrain.peerMemLocations (plocCityID,plocStateID,plocCountryID,plocWRegionID) ";
              SQL += "values ("+j.cityID+","+j.stateID+","+j.countryID+","+j.worldRegionID+") ";
          con.query(SQL , (err, result,fields)=>{
            if (err){
              console.log(err);
              this.net.endRes(res,'{"memStoreRes":false,"error":'+JSON.stringify(err)+'}');
	    }
            else {
	      locOK = true;
	    }
          });
        }
	else {
	  locOK = true;
        }		
      }
    });	    
    return locOK;
  }	    
  storeMemory(j,res){
    console.log('got request store memory',j);
    var m = j.memory;
    if (!m.memStr){
      console.log('Memory String Is Null');
      this.net.endRes(res,'{"memStoreRes":false,"error":"Null Memory String"}');
      return;
    }
    if (!m.cityID){
      m.cityID = 'null';
      m.date   = 'now()';
    }	    
    else {
      m.date = "'"+m.date+"'";	    
      this.checkPeerLoc(m,res);
    }
    const mUID = m.from;
    var SQL = "select count(*)nMem from peerBrain.peerMemoryCell ";
    SQL += "where pmcMownerID = '"+mUID+"' and pmcMemObjID = '"+m.memID+"' and pmcMemObjType='"+m.memType+"' ";
    con.query(SQL , (err, result,fields)=>{
      if (err){
        console.log(err);
        this.net.endRes(res,'{"memStoreRes":false,"error":'+JSON.stringify(err)+'}');
      }
      else {
        if (result[0].nMem == 0){
          if (m.weights){
            memories = m.weights;
            wlist = {words:[],weight:1};
          }
          else {
            var memory   = this.singleSpaceOnly(m.memStr);
            var memories = memory.split(' ');
            var wlist    = this.weightList(memories);
            memories     = wlist.words;
          } 
          var nwords   = memories.length;  
          var SQLr  = "insert into peerBrain.peerMemoryCell (pmcMownerID,pmcMemObjID,pmcMemObjType,pmcMemObjNWords,";
	      SQLr += "pmcMemWord,pmcWordCount,pmcWordSequence,pmcMemTWeight,pmcCityID,pmcMemTime,pmcWordWeight) ";
          var SQL = "";
          var n = 1;
          memories.forEach( (word) =>{
            console.log('words::',word);
            if (m.weights){
              word.count = 1
            }
            else {
              word.weight = 1;
            }
            word.word = word.word.replace("'","");
            if (Buffer.byteLength(word.word, 'utf8') <= 145){
              SQL += SQLr + "values ('"+m.from+"','"+m.memID+"','"+m.memType+"',"+nwords+",'"+word.word+"',"+word.count+","+
 	 	   n+","+wlist.weight+","+m.cityID+","+m.date+","+word.weight+");";
            }
            n = n + 1;
          });	    
          console.log(SQL);
	  con.query(SQL , (err, result,fields)=>{
            if (err){
              console.log(err);
              this.net.endRes(res,'{"memStoreRes":false,"error":'+JSON.stringify(err)+'}');
            }
            else {
              const hash = crypto.createHash('sha256').update(SQL).digest('hex');
	      this.net.endRes(res,'{"memStoreRes":true,"memStorHash":"' + hash + '"}');
            }
          });
        }
	else {
          console.log('Memory Already Stored::MSQL',m.memID);
          const ahash = crypto.createHash('sha256').update(m.memID).digest('hex');
          this.net.endRes(res,'{"memStoreRes":true,"memStorHash":"' + ahash + '"}');
          //this.net.endRes(res,'{"memStoreRes":false,"msg":"Memory Already Stored"}');
	}
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
