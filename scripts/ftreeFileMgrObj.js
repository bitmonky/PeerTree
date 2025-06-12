/******************************************************************
PeerTree - Object ftreeFileMgrObj

2024-0131 - Taken from peerShardTreeObj.js to be modified into the ftreeFileMgrObj
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
const base58       = require('bs58');
const mysql        = require('mysql');
const schedule     = require('node-schedule');
const {MkyWebConsole} = require('./networkWebConsole.js');
const {pcrypt}        = require('./peerCrypt');

addslashes  = require ('./addslashes');

const algorithm = 'aes256';
const maxTranCopies = 10;
const repoHealthCheckInterval = 5*60;
var   availTranNodes = 3; 


function hashToBase58(input) {
  const sha256Hash = crypto.createHash('sha256').update(input).digest(); // Binary (Buffer)
  return base58.encode(sha256Hash);
}
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
with a ftreeFileMgrCell on the PeerTree File Store network;
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

class ftreeFileMgrCellReceptor{
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
    var bserver = https.createServer(options, async (req, res) => {
      console.log('Receptor::->Check dbCon.state::',con.state);
      if (con.state === 'disconnected') {
        await con.connect();
      }      
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
	      this.processRequest(j,res);
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
    console.log('ftreeFileMgr fMgr Receptor running on port:'+this.port);
    //this.doLocalHealthCheck();
    //this.doBeginLocalFolderHealthCheck();
    //this.doBeginLocalFileMgrHealthCheck();
    this.doRepoHealthCheck();
  }
  processRequest(j,res){
     res.setHeader('Content-Type', 'application/json');
     res.writeHead(200);
     if (j.msg.req == 'createRepo'){
       this.reqCreateRepo(j.msg,res);
       return;
     }
     if (j.msg.req == 'locateMyMasterRepo'){
        this.doLocateMyMasterRepo(j.msg,res);
        return;
     }
     if (j.msg.req == 'createRepoFolder'){
       this.reqCreateRepoFolder(j.msg,res);
       return;
     }
     if (j.msg.req == 'deleteRepoFolder'){
       this.reqDeleteRepoFolder(j.msg,res);
       return;
     }
     if (j.msg.req == 'getMyRepoFilePath'){
       this.reqMyRepoFilePath(j.msg,res);
       return;
     }
     if (j.msg.req == 'getMyRepoList'){
       this.reqReadMyRepoList(res);
       return;
     }
     if (j.msg.req == 'getMyRepoFiles'){
       this.reqReadMyRepoFiles(j.msg,res);
       return;
     }
     if (j.msg.req == 'getRepoFileData'){
       this.reqGetRepoFileData(j.msg,res);
       return;
     }
     if (j.msg.req == 'insertRSfile'){
       this.reqInsertRSfile(j.msg,res);
       return;
     }
     if (j.msg.req == 'deleteRSfile'){
       this.reqDeleteRSfile(j.msg,res);
       return;
     }
     if (j.msg.req == 'requestShard'){
       this.reqRetrieveShard(j.msg,res);
       return;
     }
     if (j.msg.req == 'deleteShard'){
       this.reqDeleteRSfile(j.msg,res);
       return;
     }

     res.end('{"netReq":"action '+j.msg.req+' not found"}');
  } 
  async doLocateMyMasterRepo(j,res){
     var located = await this.locateMyRepoLocal(j.ownMUID);
     if (located){
        res.end(`{"result":true,"ip":"${this.peer.net.rnet.myIp}"}`);
        return;
     }
     located = await this.peer.locateMyMasterRepo(j.ownMUID);
     if (located){
       if (located.result){
         res.end(`{"result":true,"ip":"${located.ip}"}`);
         return;
       }
     } 
     res.end('{"result":false,"msg":"Master Repo Not Found!"}');
  }
  locateMyRepoLocal(muid){
    return new Promise((resolve,reject)=>{
      var SQL = `select count(*)as nRes FROM ftreeFileMgr.tblRepo where repoOwner = '${muid}'`;
      console.log('locateMyRepoLocal .: ',SQL);
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        resolve(result[0].nRes);
      });
    });
  }
  async doRepoHealthCheck(){
    console.log('Starting Repo Health Checks .:');
    var myRepos = await this.doReadMyRepoList();
    if (myRepos) {
      for (const rec of myRepos) {
        console.log('repoHealthCkc .:', rec.repoName);
        const j = {
          repo: {
            data   : { repoCopies: availTranNodes },
            name   : rec.repoName,
            from   : rec.repoOwner,
            repoID_master : rec.repoID_master
          },
        };

        const IPs = await this.peer.getActiveRepoList(j);
        console.log('getActiveRepoList::result .:', IPs);
        const cloned  = await this.hckReqCloneRepo(j,IPs);
        const folders = await this.doFolderHealthCheck(j);
        const files   = await this.doFileHealthCheck(j);
        const shards  = await this.doShardHealthCheck(j);
      }
    }      
    const gtime = setTimeout( ()=>{
      this.doRepoHealthCheck();
    },repoHealthCheckInterval*1000);
  }
  mergRepo(results){
    const mergedResults = results.reduce((acc, { result }) => {
      if (!acc.some(r => r.repoID_master === result.repoID_master)) {
        acc.push(result);
      }
      return acc;
    },[]);
    if (Array.isArray(mergedResults[0])) {
      return mergedResults[0];
    }
    return [];
  }
  async doLocalHealthCheck(){
    console.log('Starting Repo Local Health Checks .:');
    var offset = 0;
    var limit  = 50;
    var results = await this.peer.receptorReqReadMyRemoteRepos(this.shardToken.shardOwnMUID,limit,offset);
    console.log('nonmerg',results);
    results = this.mergRepo(results);
    console.log('MERGEDG',results);
    while (results.length > 0){
      offset = offset + limit;
      this.doReBuildLocalRepo(results);
      results = await this.peer.receptorReqReadMyRemoteRepos(this.shardToken.shardOwnMUID,limit,offset);
      results = this.mergRepo(results);
    }
    const dotime = setTimeout( ()=>{
      this.doLocalHealthCheck();
    },1*60*1000);
    return;

    var myRepos  = await this.doReadMyRepoList();
    if (myRepos) {
      for (const rec of myRepos) {
        console.log('repoHealthCkc .:', rec.repoName);
        const j = {
          repo: {
            data   : { repoCopies: availTranNodes },
            name   : rec.repoName,
            from   : rec.repoOwner,
            repoID_master : rec.repoID_master
          },
        };

        const IPs = await this.peer.getActiveRepoList(j);
        console.log('getActiveRepoList::result .:', IPs);
        const cloned  = await this.hckReqCloneRepo(j,IPs);
        const folders = await this.doFolderHealthCheck(j);
        const files   = await this.doFileHealthCheck(j);
        const shards  = await this.doShardHealthCheck(j);
      }
    }
    const gtime = setTimeout( ()=>{
      this.doRepoHealthCheck();
    },repoHealthCheckInterval*1000);
  }
  mergRepoFolders(results) {
    // Reduce results to merge unique entries based on repoID_master
    const mergedResults = results.reduce((acc, { result }) => {
        if (!acc.some(r => r.repoID_master === result.repoID_master && r.rfoldID_master === result.rfoldID_master)) {
            acc.push(result);
        }
        return acc;
    }, []);

    // Return the merged data properly
    if (Array.isArray(mergedResults[0])) {
        return mergedResults[0];
    }

    return [];
  }
  async doBeginLocalFolderHealthCheck(){
     const repos = await this.doReadMyRepoList();
     for (const repo of repos){
       await this.doLocalFolderHealthCheck(repo.repoID_master);
     }
    // Schedule next health check after 1 minute
    setTimeout(() => this.doBeginLocalFolderHealthCheck(), 60 * 1000);
  }
  doLocalFolderHealthCheck(repoID_master) {
    return new Promise(async(resolve,reject) => {
      console.log('Starting Repo Folder Local Health Checks .:');

      let offset = 0;
      const limit = 50;

      while (true) {
          // Fetch paginated remote folder data
          let results = await this.peer.receptorReqReadMyRemoteFolders(repoID_master, limit, offset);
          results = this.mergRepoFolders(results);

          // If no more records, break the loop
          if (results.length === 0) break;

          // Process the current batch
          this.doReBuildLocalRepoFolders(results);

          // Move to the next batch
          offset += limit;
      }
      resolve(true);
    });
  }
  mergRepoFileMgr(results) {
    // Reduce results to merge unique entries based on repoID_master,smgrID_master
    const mergedResults = results.reduce((acc, { result }) => {
        if (!acc.some(r => r.repoID_master === result.repoID_master && r.smgrID_master === result.smgrID_master)) {
            acc.push(result);
        }
        return acc;
    }, []);

    // Return the merged data properly
    if (Array.isArray(mergedResults[0])) {
        return mergedResults[0];
    }

    return [];
  }
  async doBeginLocalFileMgrHealthCheck(){
     const repos = await this.doReadMyRepoList();
     for (const repo of repos){
       await this.doLocalFileMgrHealthCheck(repo.repoID_master);
     }
    // Schedule next health check after 1 minute
    setTimeout(() => this.doBeginLocalFileMgrHealthCheck(), 10 * 60 * 1000);
  }
  doLocalFileMgrHealthCheck(repoID_master) {
    return new Promise(async(resolve,reject) => {
      console.log('Starting Repo FileMgr Local Health Checks .:');

      let offset = 0;
      const limit = 50;

      while (true) {
        // Fetch paginated remote folder data
        let results = await this.peer.receptorReqReadMyRemoteFileMgr(repoID_master, limit, offset);
        results = this.mergRepoFileMgr(results);

        // If no more records, break the loop
        if (results.length === 0) break;

        // Process the current batch
        this.doReBuildLocalRepoFileMgr(results);

        // Move to the next batch
        offset += limit;
      }
      resolve(true);
    });
  }
  hckReqCloneRepo(j,excludeIps){
    return new Promise( async (resolve,reject)=>{
      var maxClones = maxTranCopies;
      if (availTranNodes < maxTranCopies){
        maxClones = availTranNodes;
      }
      if ((maxClones - excludeIps.length) < 1){
        console.log('Repo '+j.repo.name+' Status .: healthy!');
        resolve(null);
        return;
      } 

      var repoID_master = j.repo.repoID_master;

      j.repo.data = await this.getLocalRepoRec(repoID_master);
      j.repo.data.repoCopies = maxClones - excludeIps.length;
      j.repo.nCopys = j.repo.data.repoCopies; 
      console.log('cloning Repo .: ',j.repo);

      var IPs = await this.peer.receptorReqNodeList(j,excludeIps);
      console.log('XXRANDNODES:',IPs);
      if (IPs.length == 0){
        console.log('{"result":"repoOK","nRecs":0,"repo":"No Nodes Available"}');
        resolve(null);
        return;
      }
      var n = 0;
      var hosts = [];
      var nStored = 0;
      for (var IP of IPs){
        try {
          var qres = await this.peer.receptorReqCreateRepo(j,IP);
          if (qres){
            nStored = nStored +1;
            hosts.push({host:qres.remMUID,ip:qres.remIp});
          }
        }
        catch(err) {
          console.log('repo storage failed on:',IP);
        }
        if (n==IPs.length -1){
          console.log('{"result":"repoOK","nStored":'+nStored+',"repo":'+JSON.stringify(j)+',"hosts":'+JSON.stringify(hosts)+'}');
          resolve('OK');
          return;
        }
        n = n + 1;
      }
      return;
    });
  }
  async doFolderHealthCheck(r){
    console.log('Starting Repo Folder Health Checks .:');
    var myRepoFolders = await this.hckReadMyRepoFolders(r);
    console.log('myRepoFolders .: ',myRepoFolders);
    if (myRepoFolders) {
      for (const rec of myRepoFolders) {
        console.log('repoHealthCkcFolders .:', r.repo.name,rec.rfoldName);
        const j = {
          repo: {
            data   : { repoCopies: availTranNodes },
            name   : r.repo.name,
            from   : r.repo.from,
            repoID_master : r.repo.repoID_master,
            folder : {
              fmasterID : rec.rfoldID_master,
              name : rec.rfoldName,
              path : rec.rfoldPath,
              parent : rec.rfoldParentID
            }
          }
        };

        const IPs    = await this.peer.getActiveRepoFolder(j);
        console.log('getActiveRepoFolderList::result .:', IPs);
        const cloned = await this.hckReqCloneRepoFolder(j,IPs);
      }
    }
  }
  hckReadMyRepoFolders(j){
    return new Promise((resolve,reject)=>{
      var SQL = "select tblRepoFolder.* FROM `ftreeFileMgr`.`tblRepoFolder` "+
        "where repoID_master = '"+j.repo.repoID_master+"'";
      console.log('hckReadMyRepoFolders .: ',SQL,j);
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        resolve(result);
      });
    });
  }
  hckReqCloneRepoFolder(j,excludeIps){
    return new Promise( async (resolve,reject)=>{
      var maxClones = maxTranCopies;
      if (availTranNodes < maxTranCopies){
        maxClones = availTranNodes;
      }
      if ((maxClones - excludeIps.length) < 1){
        console.log('Folder Check: '+j.repo.name+' .: '+j.repo.folder.name+'  Status .: healthy!');
        resolve(null);
        return;
      }

      var repoID_master = j.repo.repoID_master;

      j.repo.data = await this.getLocalRepoRec(repoID_master);
      j.repo.data.repoCopies = maxClones - excludeIps.length;
      j.repo.nCopys = j.repo.data.repoCopies;
      console.log('cloning Repo Folder .: ',j.repo);

      var IPs = await this.peer.receptorReqNodeList(j,excludeIps);
      console.log('XXRANDNODES:',IPs);
      if (IPs.length == 0){
        console.log('{"result":"folderOK","nCloned":0,"folder":"'+j.repo.folder.name+' No Nodes Available"}');
      var fid = null;
      if (j.repo.parentID === null){
        fid = " and rfoldParentID is null ";
      }
      else {
        fid = " and rfoldParentID ="+j.repo.parentID;
      }
        resolve(null);
        return;
      }
      var n = 0;
      var hosts = [];
      var nStored = 0;
      for (var IP of IPs){
        try {
          var qres = await this.peer.receptorReqCreateFolder(j,IP);
          if (qres){
            nStored = nStored +1;
            hosts.push({host:qres.remMUID,ip:qres.remIp});
          }
        }
        catch(err) {
          console.log('repoFolder cloning failed on:',IP,err);
        }
        if (n==IPs.length -1){
          console.log('{"result":"folderOK","nCloned":'+nStored+',"folder":'+JSON.stringify(j)+',"hosts":'+JSON.stringify(hosts)+'}');
          resolve('OK');
          return;
        }
        n = n + 1;
      }
      return;
    });
  }
  hckReqCloneRepoFile(j, excludeIps) {
    return new Promise(async (resolve, reject) => {
      const maxClones = maxTranCopies;
      const adjustedClones = availTranNodes < maxTranCopies ? availTranNodes : maxTranCopies;
    
      if ((adjustedClones - excludeIps.length) < 1) {
        console.log(`Repo ${j.repo.name} .: ${j.repo.file.name} Status .: healthy!`);
        resolve(null);
        return;
      }

      const repoID_master = j.repo.repoID_master;
      j.repo.data = await this.getLocalRepoRec(repoID_master);
      j.repo.data.repoCopies = adjustedClones - excludeIps.length;
      j.repo.nCopys = j.repo.data.repoCopies;
      console.log('Cloning Repo File .:', j.repo);

      const IPs = await this.peer.receptorReqNodeList(j, excludeIps);
      console.log('XXRANDNODES:', IPs);
    
      if (IPs.length === 0) {
        console.log(`{"result":"fileOK","nCloned":0,"file":"${j.repo.file.name} No Nodes Available"}`);
        resolve(null);
        return;
      }

      let nStored = 0;
      const hosts = [];
    
      for (const [index, IP] of IPs.entries()) {
        try {
          const qres = await this.peer.receptorReqCreateFile(j, IP);
          if (qres) {
            nStored++;
            hosts.push({ host: qres.remMUID, ip: qres.remIp });
          }
        } catch (err) {
          console.log('repoFile cloning failed on:', IP, err);
        }
      
        if (index === IPs.length - 1) {
          console.log(JSON.stringify({
            result: "fileOK",
            nCloned: nStored,
            file: j.repo.file,
            hosts: hosts
          }));
          resolve('OK');
          return;
        }
      }
    });
  }
  async doFileHealthCheck(r) {
    console.log('Starting Repo File Health Checks:');
    const myRepoFiles = await this.hckReadMyRepoFiles(r);
  
    if (myRepoFiles) {
      for (const rec of myRepoFiles) {
        console.log('repoHealthCkcFiles:', r.repo.name, rec.smgrFileName);
        if (rec.smgrID_master !== null) {
          const j = {
            repo: {
              data: { repoCopies: availTranNodes },
              name: r.repo.name,
              from: r.repo.from,
              repoID_master: r.repo.repoID_master,
              file: {
                fileID_master: rec.smgrID_master,
                name: rec.smgrFileName,
                data : rec
              }
            }
          };
          const IPs = await this.peer.getActiveRepoFile(j);
          console.log('getActiveRepoFileList::result:', IPs);
          const cloned = await this.hckReqCloneRepoFile(j, IPs);
        }
      }
    }
  }
  hckReadMyRepoFiles(j){
    return new Promise((resolve,reject)=>{
      var SQL = "select tblShardFileMgr.* FROM `ftreeFileMgr`.`tblShardFileMgr` "+
        "where repoID_master = '"+j.repo.repoID_master+"'";
      console.log('hckReadMyRepoFiles .: ',SQL,j);
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        resolve(result);
      });
    });
  }
  async doShardHealthCheck(r) {
    console.log('Starting Repo Shard Health Checks:');
    const myRepoShards = await this.hckReadMyRepoShards(r);

    if (myRepoShards) {
      for (const rec of myRepoShards) {
        console.log('repoHealthCkcShards:', r.repo.name, rec.sfilShardHash);

        const j = {
          repo: {
            data: { repoCopies: availTranNodes },
            name: r.repo.name,
            from: r.repo.from,
            repoID_master: r.repo.repoID_master,
            shard: {
              shardID_master: rec.sfilID_master,
              sfilShardHash: rec.sfilShardHash,
              data : rec
            }
          }
        };
        const IPs = await this.peer.getActiveRepoShard(j);
        console.log('getActiveRepoShardList::result:', IPs);
        const cloned = await this.hckReqCloneRepoShard(j, IPs);
      }
    }
  } 
  hckReqCloneRepoShard(j, excludeIps) {
    return new Promise(async (resolve, reject) => {
      const maxClones = maxTranCopies;
      const adjustedClones = availTranNodes < maxTranCopies ? availTranNodes : maxTranCopies;

      if ((adjustedClones - excludeIps.length) < 1) {
        console.log(`Repo ${j.repo.name} .: ${j.repo.shard.sfilShardHash} Status .: healthy!`);
        resolve(null);
        return;
      }

      const repoID_master = j.repo.repoID_master;
      j.repo.data = await this.getLocalRepoRec(repoID_master);
      j.repo.data.repoCopies = adjustedClones - excludeIps.length;
      j.repo.nCopys = j.repo.data.repoCopies;
      console.log('Cloning Repo Shard .:', j.repo);

      const IPs = await this.peer.receptorReqNodeList(j, excludeIps);
      console.log('XXRANDNODES:', IPs);

      if (IPs.length === 0) {
        console.log(`{"result":"shardOK","nCloned":0,"shard":"${j.repo.shard.sfilShardHash} No Nodes Available"}`);
        resolve(null);
        return;
      }

      let nStored = 0;
      const hosts = [];

      for (const [index, IP] of IPs.entries()) {
        try {
          const qres = await this.peer.receptorReqCreateShard(j, IP);
          if (qres) {
            nStored++;
            hosts.push({ host: qres.remMUID, ip: qres.remIp });
          }
        } catch (err) {
          console.log('repoShard cloning failed on:', IP, err);
        }

        if (index === IPs.length - 1) {
          console.log(JSON.stringify({
            result: "shardOK",
            nCloned: nStored,
            shard: j.repo.shard,
            hosts: hosts
          }));
          resolve('OK');
          return;
        }
      }
    });
  }
  hckReadMyRepoShards(j){
    return new Promise((resolve,reject)=>{
      var SQL = "select * FROM `ftreeFileMgr`.`tblShardFiles` "+
        "where repoID_master = '"+j.repo.repoID_master+"'";
      console.log('hckReadMyRepoShards .: ',SQL,j);
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        resolve(result);
      });
    });
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
  async reqCreateRepo(j,res){
    console.log('CreateRepoReq:',j);
    var newRepoID = null;
    if(await this.repoExists(j.repo.name,j.repo.from) > 0){
      res.end('{"result":"repoFail","nRecs":0,"repo":"Repo Already Exists"}');
      return;
    }
    const pj = await this.createLocalRepo(j.repo);
    console.log('Local Repo Create Status:',pj);
    if (!pj.result){	  
      res.end('{"result":"repoFail","nRecs":0,"repo":"'+pj.msg+'"}');
      return;
    }
    newRepoID = pj.value;

    j.repo.data = await this.getLocalRepoRec(newRepoID);
    console.log(JSON.stringify(j.repo));

    var IPs = await this.peer.receptorReqNodeList(j);
    console.log('XXRANDNODES:',IPs);
    if (IPs.length == 0){
      res.end('{"result":"repoOK","nRecs":0,"repo":"No Nodes Available"}');
      return;
    }
    var n = 0;
    var hosts = [];
    var nStored = 0;
    for (var IP of IPs){
      try {
        var qres = await this.peer.receptorReqCreateRepo(j,IP);
        if (qres){
          nStored = nStored +1;
          hosts.push({host:qres.remMUID,ip:qres.remIp});
        }
      }
      catch(err) {
        console.log('repo storage failed on:',IP);
      }
      if (n==IPs.length -1){
        res.end('{"result":"repoOK","nStored":'+nStored+',"repo":'+JSON.stringify(j)+',"hosts":'+JSON.stringify(hosts)+'}');
        return;
      }
      n = n + 1;
    }
    return;
  }
  async reqReadMyRepoList(res){
    const result = {
      result  : true,
      list    : await this.doReadMyRepoList()
    }
    res.end(JSON.stringify(result));
  }
  doReadMyRepoFolders(j){
    return new Promise((resolve,reject)=>{
      var fid = null;
      if (j.repo.parentID === null){
        fid = " and rfoldParentID is null ";
      }
      else {
        fid = " and rfoldParentID ="+j.repo.parentID;
      }
      var SQL = "select tblRepoFolder.* FROM `ftreeFileMgr`.`tblRepo` "+
        "inner join `ftreeFileMgr`.`tblRepoFolder` on `tblRepo`.`repoID_master` = `tblRepoFolder`.`repoID_master` "+
        "where repoName = '"+j.repo.name+"' and repoOwner = '"+j.repo.from+"' "+fid;
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        resolve(result);
      });
    });
  }
  doReadMyRepoList(){
    return new Promise((resolve,reject)=>{
      var SQL = "select * FROM `ftreeFileMgr`.`tblRepo` where NOT repoType = 'Public'";
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        resolve(result);
      });
    });
  }
  async reqReadMyRepoFiles(j,res){
    const result = {
      result  : true,
      folders : await this.doReadMyRepoFolders(j),
      list    : await this.doReadMyRepoFiles(j)
    }
    res.end(JSON.stringify(result));
  }
  doReadMyRepoFiles(j){
    return new Promise((resolve,reject)=>{
      var fld = ' and smgrFileFolderID is null';      
      if(j.repo.parentID !== null){
        fld = ' and smgrFileFolderID = '+j.repo.parentID;
      }
      var SQL = "select tblShardFileMgr.* FROM `ftreeFileMgr`.`tblRepo` "+
        "inner join `ftreeFileMgr`.`tblShardFileMgr` on `tblRepo`.`repoID_master` = `tblShardFileMgr`.`repoID_master` "+
        "where repoName = '"+j.repo.name+"' and repoOwner = '"+j.repo.from+"' "+fld;
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        resolve(result);
      });
    });
  }
  async reqGetRepoFileData(j,res){
    var fdata = await this.doReadRepoLocalFileShards(j);
    var result = null;
    if (fdata){
      result = {
        result  : true,
        file    : fdata
      }
    }
    else {
      result = {result : false,error:'File not found.'}
    }
    res.end(JSON.stringify(result));
  }
  doReadRepoLocalFileShards(j){
    return new Promise(async (resolve,reject)=>{
      var repoID_master = await this.repoIsMaster(j.repo.name,j.repo.from);
      if (!repoID_master){
        resolve(null);
        return;
      }
      console.log(j);
      var fileInfo = await this.getFileCheckSum(j.repo.file,j.repo.path,j.repo.name,j.repo.from);
      if (!fileInfo){
        resolve(null);
        return;
      }
      var outpath = j.repo.path
      if(outpath === null){outpath = '/';}
      var SQL = "select sfilShardHash shardID,sfilShardID shardHID,sfilNCopies as nStored,sfilCheckSum as fposition FROM `ftreeFileMgr`.`tblRepo` " +
        "inner join `ftreeFileMgr`.`tblShardFileMgr` on  `tblRepo`.`repoID_master` = `tblShardFileMgr`.`repoID_master` " +
        "inner join `ftreeFileMgr`.`tblShardFiles` on sfilFileMgrID = smgrID_master " +
        "where `tblRepo`.`repoID_master` = '"+repoID_master+"' and smgrFileName = '"+j.repo.file+"' and smgrFilePath = '"+outpath+"' " +
        "order by smgrID";
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        console.log(SQL,result);
        resolve({owner:j.repo.from,filename:outpath+'/'+j.repo.file,shards:result,fileInfo:fileInfo});
      });
    });
  }
  getFileCheckSum(filename,fpath,rname,owner){
    
    if (fpath === null){
      fpath = "= '/'";
    }
    else {
      fpath = "= '"+fpath+"'";
    }
    return new Promise((resolve,reject)=>{
      var SQL = "select smgrCheckSum,smgrFileType FROM `ftreeFileMgr`.`tblRepo` "+
         "inner join `ftreeFileMgr`.`tblShardFileMgr` on `tblRepo`.`repoID_master` = `tblShardFileMgr`.`repoID_master` "+
         "where repoName = '"+rname+"' and repoOwner = '"+owner+"' and smgrFileName = '"+filename+"' and smgrFilePath "+fpath;
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        console.log(SQL,result);
        if (result.length > 0){
          resolve({checkSum:result[0].smgrCheckSum,fileType:result[0].smgrFileType});
          return;
        }
        console.log(SQL+' No Results Returned');
        resolve(null);
      });
    });
  }
  repoIsMaster(name,owner){
    return new Promise((resolve,reject)=>{
      var SQL = "select repoID_master,repoID_master FROM `ftreeFileMgr`.`tblRepo` "+
        "where repoName = '"+name+"' and repoOwner = '"+owner+"' and repoType = 'Master'";
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        if (result.length > 0){
          resolve(result[0].repoID_master);
          return;
        }
        resolve(null);
      });
    });
  }
  repoExists(name,owner){
    return new Promise((resolve,reject)=>{
      var SQL = "select count(*)nRec FROM `ftreeFileMgr`.`tblRepo` where repoName = '"+name+"' and repoOwner = '"+owner+"'";
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        resolve(result[0].nRec);
      });
    });
  }
  repoFolderExists(masterID,rfoldMasterID){
    return new Promise((resolve,reject)=>{
      var SQL = "select count(*)nRec FROM `ftreeFileMgr`.`tblRepoFolder` where repoID_master  = '"+masterID+"' and rfoldID_master = '"+rfoldMasterID+"'";
      console.log('repoFOLDEREXISTS',SQL);
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        resolve(result[0].nRec);
      });
    });
  }
  repoFileMgrExists(masterID,rfileMgrMasterID){
    return new Promise((resolve,reject)=>{
      var SQL = "select count(*)nRec FROM `ftreeFileMgr`.`tblShardFileMgr` where repoID_master  = '"+masterID+"' and smgrID_master = '"+rfileMgrMasterID+"'";
      console.log('repoFILEMGREXISTS',SQL);
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        resolve(result[0].nRec);
      });
    });
  }
  repoFileExists(filename,rname,owner,path){
    return new Promise((resolve,reject)=>{
      var SQL = "select count(*)nRec FROM `ftreeFileMgr`.`tblRepo` "+
         "inner join `ftreeFileMgr`.`tblShardFileMgr` on `tblRepo`.`repoID_master` = `tblShardFileMgr`.`repoID_master` "+
         "where repoName = '"+rname+"' and repoOwner = '"+owner+"' and smgrFileName = '"+filename+"' and smgrFilePath='"+path+"'";
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        resolve(result[0].nRec);
      });
    });
  }
  getRepoHash(repo,repoID_master,con){
    return new Promise((resolve,reject)=>{
      var hstr = repo.ownerMUID+repo.name;
      var SQL = "select smgrID, concat(smgrFileName,smgrCheckSum,smgrDate,smgrExpires,smgrEncrypted,smgrFileType,smgrFileSize,"+
          "smgrFVersionNbr,smgrSignature,smgrShardList,smgrFileFolderID,smgrFilePath) hstr, "+
          "concat(sfilCheckSum,sfilShardHash,sfilNCopies,sfilDate,sfilExpires,sfilEncrypted,sfilShardID) sfilStr "+
          "FROM `ftreeFileMgr`.`tblShardFileMgr`"+
          "inner join  `ftreeFileMgr`.`tblShardFiles` on sfilFileMgrID = smgrID "+
          "where smgrRepoID = '"+repoID_master+"'";
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
        }
        else {
          var smgrID = null;
          if (result.length == 0){
            resolve(this.shardToken.calculateHash(hstr));
          }
          else {
            result.forEach( (rec)=>{
              hstr = hstr+rec.hstr+rec.sfilStr;
            });
            resolve(this.shardToken.calculateHash(hstr));
          }
        }
      });
    });
  }
  async reqCreateRepoFolder(j,res){
    const result = {
      result : await this.createLocalFolder(j.repo),
      msg : "OK"
    }
    res.end(JSON.stringify(result));
    const newFolderID = result.result;

    j.repo.folderData = await this.getLocalRepoFolderRec(newFolderID);
    console.log(JSON.stringify(j.repo));

    var IPs = await this.peer.receptorReqNodeList(j);
    console.log('Folder::XXRANDNODES:',IPs);
    if (IPs.length == 0){
      res.end('{"result":"repoOK","nRecs":0,"repoFolder":"No Nodes Available"}');
      return;
    }
    var n = 0;
    var hosts = [];
    var nStored = 0;
    for (var IP of IPs){
      try {
        var qres = await this.peer.receptorReqCreateFolder(j,IP);
        if (qres){
          nStored = nStored +1;
          hosts.push({host:qres.remMUID,ip:qres.remIp});
        }
      }
      catch(err) {
        console.log('repo folder storage failed on:',IP);
      }
      if (n==IPs.length -1){
        res.end('{"result":"repoOK","nStored":'+nStored+',"repo":'+JSON.stringify(j)+',"hosts":'+JSON.stringify(hosts)+'}');
        return;
      }
      n = n + 1;
    }
  }
  async reqDeleteRepoFolder(j,res){
    const result = {
      result : await this.deleteLocalFolder(j.repo,j.remFolderID),
      msg : "OK"
    }
    res.end(JSON.stringify(result));
    const remFolderID = result.result;

    j.repo.folderData = await this.getLocalRepoFolderRec(newFolderID);
    console.log(JSON.stringify(j.repo));

    var IPs = await this.peer.receptorReqNodeList(j);
    console.log('removeFolder::XXRANDNODES:',IPs);
    if (IPs.length == 0){
      res.end('{"result":"repoOK","nRecs":0,"repoFolder":"No Nodes Available"}');
      return;
    }
    var n = 0;
    var hosts = [];
    var nRemoved = 0;
    for (var IP of IPs){
      try {
        var qres = await this.peer.receptorReqDeleteFolder(j,IP);
        if (qres){
          nRemoved = nRemoved +1;
          hosts.push({host:qres.remMUID,ip:qres.remIp});
        }
      }
      catch(err) {
        console.log('repo folder removale failed on:',IP);
      }
      if (n==IPs.length -1){
        res.end('{"result":"repoOK","nRemoved":'+nRemoved+',"repo":'+JSON.stringify(j)+',"hosts":'+JSON.stringify(hosts)+'}');
        return;
      }
      n = n + 1;
    }
  }
  async reqMyRepoFilePath(j,res){
    var folders = [];
    if (j.repo.fname === null || j.repo.fname == ''){
      res.end(JSON.stringify({result:true,path:'/',folders:[]}));
      return;
    }
    var path = "/"+j.repo.fname;
    var folderID = j.repo.folderID;
    folders.push({name:j.repo.fname,fnbr:j.repo.folderID});
    var pf = null;
    while (folderID){
      pf = await this.getParentFolder(folderID);
      if (pf){
        folderID = pf.parentID;
        if (folderID){
          path = '/'+pf.name+path;
          folders.push({name:pf.name,fnbr:folderID});
        }
        else if (pf.name){
          path = '/'+pf.name+path;
        }
      }
      else {
        res.end(JSON.stringify({result:false,error:'Failed To Get Path Form Database'}));
        return;
      }
    }
    const result = {
      result : true,
      path   : path,
      folders : folders
    }
    res.end(JSON.stringify(result));
  }
  getParentFolder(folderID){
    return new Promise(async (resolve,reject)=>{
      var SQL = "SELECT SubR.rfoldName, SubR.rfoldParentID " + 
      "FROM `ftreeFileMgr`.`tblRepoFolder` R " +
      "INNER JOIN ( " +
      "SELECT rfoldName,rfoldID_master, rfoldParentID " +
      "FROM `ftreeFileMgr`.`tblRepoFolder` " +
      ") AS SubR " +
      "ON SubR.rfoldID_master = R.rfoldParentID " +
      "WHERE R.rfoldID_master = "+folderID;
      console.log(SQL);
      con.query(SQL , async (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
        }
        else {
          console.log(result);
          if (result.length === 0){
            resolve ({name: null,parentID:null});      
          }
          else {
            resolve ({name:result[0].rfoldName,parentID:result[0].rfoldParentID});
          }
        }
      });
    });
  }
  createLocalFolder(repo){
    return new Promise(async (resolve,reject)=>{
      if (repo.parent === null){
        repo.parent = 'null';
      }
      const repoID_master = await this.getRepoID(repo);
      repo.nCopys  = await this.getRepoNCopys(repo);
      var SQL = "INSERT INTO `ftreeFileMgr`.`tblRepoFolder` (`rfoldRepoID`,`rfoldName`,`rfoldParentID`) "+
        "VALUES ('"+repoID_master+"','"+repo.folder+"',"+repo.parent+");" +
        "SELECT LAST_INSERT_ID() AS newFolderID;";
      var newFolderID = null;
      con.query(SQL , async (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(false);
        }
        else {
          console.log(result);
          result.forEach((rec,index)=>{
            if(index === 1){
              newFolderID = rec[0].newFolderID;
            }
          });
          if (newFolderID){
            newFolderID = await this.updateTableMasterID(newFolderID,'tblRepoFolder','rfoldID');
          }
          resolve (newFolderID);
        }
      });
    });
  }
  updateTableMasterID(newKeyID,table,key){
    return new Promise(async (resolve,reject)=>{
      const SQL = "update "+table+" set "+key+"_master = '"+newKeyID+"' where "+key+" = '"+newKeyID+"'";
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
        }
        else {
          resolve(newKeyID);
        }
      });
    });
  }
  doReBuildLocalRepo(results){
     results.forEach((rec) => {
       this.doInsertRepo(rec);
     });
  }  
  async doInsertRepo(rec){
    const repo = await this.repoExists(rec.repoName,rec.repoOwner);
    if (repo){
      return;
    }
    var SQL = `INSERT INTO ftreeFileMgr.tblRepo 
      (repoID_master,repoName,repoPubKey,repoOwner,repoLastUpdate,repoSignature,repoHash,repoCopies,repoType) 
      VALUES ('${rec.repoID_master}','${rec.repoName}','${rec.repoPubKey}','${rec.repoOwner}','${rec.repoLastUpdate}','${rec.repoSignature}','${rec.repoHash}',${rec.repoCopies},'Master');`;
    con.query(SQL , (err, result,fields)=>{
      if (err){
        console.log(err);
        return null;
      }
      else {
        return true;
      }
    });
  }
  async doReBuildLocalRepoFolders(results) {
    for (const rec of results) {
        await this.doInsertRepoFolders(rec);
    }
  }

  doInsertRepoFolders(rec) {
    return new Promise(async (resolve,reject) => {
      const folderExists = await this.repoFolderExists(rec.repoID_master,rec.rfoldID_master);
      console.log('folderExists',folderExists);
      if (folderExists) {
        resolve(null);
        return;
      }

      var SQL = `INSERT INTO ftreeFileMgr.tblRepoFolder 
        (repoID_master, rfoldID_master, rfoldRepoID, rfoldName, rfoldParentID) 
        VALUES ('${rec.repoID_master}', ${rec.rfoldID_master}, ${rec.rfoldRepoID}, '${rec.rfoldName}', ${rec.rfoldParentID});`;
      console.log(SQL);
      con.query(SQL, (err, result, fields) => {
        if (err) {
          console.log('Error inserting folder:', err);
          resolve(null);
          return;
        }
        else {
          resolve(true);
          return;
        }
      });
    });
  }
  async doReBuildLocalRepoFileMgr(results) {
    for (const rec of results) {
        await this.doInsertRepoFileMgr(rec);
    }
  }

  doInsertRepoFileMgr(rec) {
    return new Promise(async (resolve,reject) => {
      const fileMgrExists = await this.repoFileMgrExists(rec.repoID_master,rec.smgrID_master);
      console.log('fileMgrExists',fileMgrExists);
      if (fileMgrExists) {
        resolve(null);
        return;
      }

    var SQL = `INSERT INTO ftreeFileMgr.tblShardFileMgr 
      (repoID_master, smgrID_master, smgrRepoID, smgrFileName, smgrCheckSum, smgrDate, smgrExpires, smgrEncrypted, smgrFileType, smgrFileSize, 
      smgrFVersionNbr, smgrSignature, smgrShardList, smgrFileFolderID, smgrFilePath) 
      VALUES ('${rec.repoID_master}', ${rec.smgrID_master}, ${rec.smgrRepoID}, '${rec.smgrFileName}', '${rec.smgrCheckSum}',${rec.smgrDate ? `'${rec.smgrDate}'` : 'NULL'}, 
      ${rec.smgrExpires ? `'${rec.smgrExpires}'` : 'NULL'}, ${rec.smgrEncrypted}, '${rec.smgrFileType}', ${rec.smgrFileSize}, ${rec.smgrFVersionNbr}, '${rec.smgrSignature}', 
      '${rec.smgrShardList}', ${rec.smgrFileFolderID}, '${rec.smgrFilePath}');`;
      console.log(SQL);
      con.query(SQL, (err, result, fields) => {
        if (err) {
          console.log('Error inserting folder:', err);
          resolve(null);
          return;
        }
        else {
          resolve(true);
          return;
        }
      });
    });
  }
  createLocalRepo(repo){
    return new Promise((resolve,reject)=>{
      const repoID_master =  hashToBase58(repo.name + repo.from);
      var SQL = "INSERT INTO `ftreeFileMgr`.`tblRepo` " +
      "(`repoID_master`,`repoName`,`repoPubKey`,`repoOwner`,`repoLastUpdate`,`repoSignature`,`repoHash`,`repoCopies`,`repoType`) " +
      "VALUES ('"+repoID_master+"','"+repo.name+"','"+repo.pubKey+"','"+repo.from+"',now(),'NS','NA',"+repo.nCopys+",'Master');" +
      "SELECT LAST_INSERT_ID() AS newRepoID;";
      var newRepoID = null
      return pool.getConnection((err, con)=>{
        if (err){ return dbConFail(resolve,'CreateLocalRepo Conection Failed');}
      
	return con.beginTransaction((err)=>{
          if (err) { 
	    return dbFail(con,resolve,'CreatLocalRep begTransaction Failed');
	  }
          else {      
            return con.query(SQL , async (err, result,fields)=>{
              if (err){return dbFail(con,resolve,'Insert Local Repo Failed');}
              else {
                result.forEach((rec,index)=>{ 
	          if(index === 1){	  
	            newRepoID = rec[0].newRepoID;
                  }
	        });
	        const rhash = await this.getRepoHash(repo,newRepoID,con)
                const sig = await this.updateAndSignRepo(newRepoID,repo.from+repo.name+rhash,rhash,con);		
                console.log('YYYYYYYYY:',sig);
		if (!sig){
		  return dbFail(con,resolve,'Update Signature Failed');	
		}
		con.commit((err)=> {
                  if (err) {return dbFail(con,resolve,'Local Commit Failed');}
	  	  else {
		    console.log('New RepoID IS:',newRepoID);
                    return dbResult(con,resolve,newRepoID);
	          }
		});
	      }		
	    });
	  } 	    
	});
      });	      
    });
  }
  getLocalRepoFolderRec(folderID){
    return new Promise((resolve,reject)=>{
      var SQL = "select * from  `ftreeFileMgr`.`tblRepoFolder` where rfoldID_master="+folderID;
      return pool.getConnection((err, con)=>{
        if (err){ return resolve(null);}

        return con.query(SQL , (err, result,fields)=>{
          if (err){
            console.log(err);
            con.release();
            return resolve(null);
          }
          con.release();
          return  resolve(result[0]);
        });
      });
    });
  }
  getLocalRepoRec(repoID_master){
    return new Promise((resolve,reject)=>{
      var SQL = "select * from  `ftreeFileMgr`.`tblRepo` where repoID_master='"+repoID_master+"'";
      return pool.getConnection((err, con)=>{
        if (err){ return resolve(null);}

        return con.query(SQL , (err, result,fields)=>{
          if (err){
            console.log(err);
	    con.release();
            return resolve(null);
          }
          con.release();		  
          return  resolve(result[0]);
        });
      });	      
    });
  }
  updateAndSignRepo(repoID_master,token,rhash,con){
    return new Promise((resolve,reject)=>{
      var signature = this.shardToken.signToken(token);
      console.log('Signing Token: ',token);
      var SQL = "update `ftreeFileMgr`.`tblRepo` " +
      "set repoPubKey = '"+this.shardToken.publicKey+"',repoSignature = '"+signature+"',repoHash = '"+rhash+"',repoLastUpdate=now() "+
      "where repoID_master = '"+repoID_master+"'";
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(false);
        }
        else {
          resolve (true);
        }
      });
    });
  }
  getRepoID(r){
    return new Promise((resolve,reject)=>{
      var SQL = "select repoID_master from  `ftreeFileMgr`.`tblRepo` where repoOwner='"+r.from+"' and repoName='"+r.name+"'";
      con.query(SQL , async (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
     	  return;	
        }
        else {
          if (result.length > 0){
	    resolve(result[0].repoID_master);
            return;		  
          }	
          console.log('Repo File Not Found: '+SQL);
	  resolve(null);
        }
      });
    });
  }
  getRepoNCopys(r){
    return new Promise((resolve,reject)=>{
      var SQL = "select repoCopies from  `ftreeFileMgr`.`tblRepo` where repoOwner='"+r.from+"' and repoName='"+r.name+"'";
      con.query(SQL , async (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        else {
          if (result.length > 0){
            resolve(result[0].repoCopies);
            return;
          }
          console.log('Repo File Not Found: '+SQL);
          resolve(null);
        }
      });
    });
  }
  insertLocalFileShard(s,fileID,repoID_master,shardNbr,con){
    return new Promise(async (resolve,reject)=>{
      console.log('InsertLocalFileShard::',s);
      s.startPos = s.startPos ?? 0;
      var SQL = "INSERT INTO `ftreeFileMgr`.`tblShardFiles` (`repoID_master`,`sfilFileMgrID`,`sfilCheckSum`,`sfilShardHash`,`sfilNCopies`,`sfilDate`,"+
        "`sfilExpires`, `sfilEncrypted`,`sfilShardID`) VALUES "+
        "('"+repoID_master+"',"+fileID+",'"+s.startPos+"','"+s.shardID+"',"+s.nStored+",now(),now(),0,'"+s.shardHID+"')";
      con.query(SQL , async (err, result,fields)=>{
        if (err){
          console.log(err);
          console.log('s::',s);
          resolve(false);
        }
        else {
          const sfilID_master = result.insertId;
          const uSQL = `update ftreeFileMgr.tblShardFiles set sfilID_master = ${sfilID_master} where sfilID = ${result.insertId}`;
          con.query(uSQL , async (err, result,fields)=>{
            if (err){
              console.log(err);
              resolve(false);
            }
            else { 
              resolve (true);
            }
          });
        }   
      });
    });
  }
  async insertLocalFileShards(shards,fileID,repoID_master,con,sfilID_master){
    var result = false;
    for(let i = 0; i < shards.length; i++) {
      result = await this.insertLocalFileShard(shards[i],fileID,repoID_master,i,con,sfilID_master); 
      if (!result){
        break;
      }      
    }
    return result;
  }
  getRepoFileID(repo){
    return new Promise(async (resolve,reject)=>{
      var fileID = null;
      var repoID_master = null;
      console.log('getRepFileID::',repo);
      var f = repo.file;
      var SQL = "SELECT tblRepo.repoID_master,smgrID_master FROM ftreeFileMgr.tblRepo " + 
        "inner join ftreeFileMgr.tblShardFileMgr on `tblRepo`.`repoID_master` = `tblShardFileMgr`.`repoID_master` " +
        "where  repoName = '"+repo.name+"' and repoOwner = '"+repo.from+"' " +
        "and smgrFileName = '"+repo.file+"' and smgrFilePath = '"+repo.path+"';";
      return pool.getConnection((err, con)=>{
        if (err){ return dbConFail(resolve,'getRepoFileID::getConnection Failed');}
        return con.query(SQL , async (err, result,fields)=>{
          if (err){
            return dbFail(con,resolve,'getRepoFileID::sql look failed'+SQL);
          }
          console.log(SQL,result);
          if (result.length === 0){
            return dbFail(con,resolve,'getRepoFileID::sql empty set'+SQL);
          }		  
	  fileID = result[0].smgrID_master;
          repoID_master = result[0].repoID_master;		
	  return dbResult(con,resolve,{fileID:fileID,repoID_master:repoID_master});
        });		
      });		
    });
  }	  
  deleteLocalRepoFile(repo,doSignRepo=true){
    return new Promise(async (resolve,reject)=>{
      var repoFileID = null;
      var repoID_master     = null;
      var qr = await this.getRepoFileID(repo);

      if (qr.result){
	repoFileID = qr.value.fileID;
        repoID_master     = qr.value.repoID_master;
      }
      var f = repo.file;
      var SQL = "Delete From `ftreeFileMgr`.`tblShardFileMgr` where repoID_master = '"+repoID_master+"' and smgrID_master = "+repoFileID+";"+
        "Delete From `ftreeFileMgr`.`tblShardFiles` where repoID_master = '"+repoID_master+"' and sfilFileMgrID = "+repoFileID;

      console.log('deleteLocalRepoFile::',SQL);

      return pool.getConnection((err, con)=>{
        if (err){ return dbConFail(resolve,'DeleteLocalRepFile::getConnection Failed');}
        return con.query(SQL , async (err, result,fields)=>{
          if (err){
            return dbFail(con,resolve,'Delete File Record Failed');
          }
          var actionFail = null;
	  result.forEach((rec,index)=>{
            //check each result for success;
	    console.log('delete result::',rec);
	    if(index === 1){
             // newRFileID = rec[0].newRFileID;
            }
          });
	  if (actionFail){
            return dbFail(con,resolve,'DeleteLocalRepoFile::insertLocalFileShards Failed Rolled Back');
	  }	  
          if (doSignRepo){
            const rhash = await this.getRepoHash(repo,repoID_master,con);
            await this.updateAndSignRepo(repoID_master,repo.from+repo.name+rhash,rhash,con);
          }
          return dbResult(con,resolve,repoID_master);
	});	
      });
    });
  }
  insertLocalRepoFile(repo,doSignRepo=true){
    return new Promise(async (resolve,reject)=>{
      var repoID_master = await this.getRepoID(repo);
      if (!repoID_master){
        return dbFail(con,resolve,'InsertLocalRepoFile::Failed - Repository Not Found');
      }    
      var f = repo.file;
      if (repo.folderID === null || repo.folderID == ''){
        repo.folderID = 'null';
      }
      console.log(repo);
      // Update *** the smgrFileSize field is now used to store the file pointer for random access.
      f.chunksize = f.chunksize ?? 0;

      if (await this.repoFileExists(f.filename,repo.name,repo.from,repo.path) > 0){
        resolve(`Insert File Record Failed ${f.filename}, repo: ${repo.name} path:${repo.path}`);
        return;
      }
      
      const SQL = `INSERT INTO tblShardFileMgr 
        (repoID_master, smgrFileName, smgrCheckSum, smgrDate, smgrExpires, smgrEncrypted, 
        smgrFileType, smgrFileSize, smgrFVersionNbr, smgrSignature, smgrShardList, smgrFileFolderID, smgrFilePath) 
        VALUES (?, ?, ?, NOW(), NOW(), ?, ?, ?, 0, 'NA', 'NA', ?, ?);
      `;

      // Parameters to safely pass values
      const params = [
        repoID_master,
        f.filename,
        f.checksum,
        f.encrypt,
        f.ftype,
        f.chunksize,
        repo.folderID === 'null' || repo.folderID === undefined ? null : repo.folderID,
        repo.path
      ];
      return pool.getConnection((err, con)=>{
        if (err){ return dbConFail(resolve,'InsertLocalRepFile::getConnection Failed');}
        return con.query(SQL,params, async (err, result,fields)=>{
          if (err){
            console.log(err,SQL,params);
            return dbFail(con,resolve,'Insert File Record Failed'+SQL);
          }
          var newRFileID = result.insertId;
          if (newRFileID){
            newRFileID = await this.updateTableMasterID(newRFileID,'tblShardFileMgr','smgrID');
            if (!newRFileID){
              return dbFail(con,resolve,'Insert File Record Failed on UpdateMaster'+SQL);
            }
          }
          if (this.insertLocalFileShards(repo.file.shards,newRFileID,repoID_master,con)){
            if (doSignRepo){
	      const rhash = await this.getRepoHash(repo,repoID_master,con);
              await this.updateAndSignRepo(repoID_master,repo.from+repo.name+rhash,rhash,con);
            }		    
            console.log('XXXXXXXXXXX');
	    return dbResult(con,resolve,repoID_master);
          }
          else {
            return dbFail(con,resolve,'InsertLocalRepoFile::insertLocalFileShards Failed');
	  }
	});	
      });
    });
  }
  async reqInsertRSfile(j,res){
    console.log('Insert Repo Shard File:',j);
    var newFileRepoID = null;
    if (await this.repoFileExists(j.repo.file.filename,j.repo.name,j.repo.from,j.repo.path) > 0){
      res.end('{"result":false,"nRecs":0,"repo":"Repo'+j.repo.name+' File Aready Exists: '+j.repo.file+'"}');
      return;
    }
    
    const pj = await this.insertLocalRepoFile(j.repo);
    if (!pj.result){
      res.end('{"result":false,"nRecs":0,"repo":"'+pj.msg+'"}');
      return;
    }
    newFileRepoID = pj.value;  
    console.log('Got newFileID: ',newFileRepoID);

    j.repo.data = await this.getLocalRepoRec(newFileRepoID);

    var IPs = await this.peer.getActiveRepoList(j);
    if (IPs.length == 0){
      res.end('{"result":false,"nRecs":0,"repo":"No Nodes Available For File Insert"}');
      return;
    }
    var n = 0;
    var hosts = [];
    var nStored = 0;
    for (var IP of IPs){
      try {
        var qres = await this.peer.receptorReqUpdateRepoInsertFile(j,IP);
        if (qres){
          nStored = nStored +1;
          hosts.push({host:qres.remMUID,ip:qres.remIp});
        }
      }
      catch(err) {
        console.log('repo storage failed on:',IP);
      }
      if (n==IPs.length -1){
        res.end('{"result":"repoInsertFileOK","nStored":'+nStored+',"repo":'+JSON.stringify(j)+',"hosts":'+JSON.stringify(hosts)+'}');
      }
      n = n + 1;
    }
    return;
  }
  async reqDeleteRSfile(j,res){
    console.log('Delete Repo Shard File:',j);
    var delFileRepoID = null;
    const pj = await this.deleteLocalRepoFile(j.repo);
    if (!pj.result){
      res.end('{"result":false,"nRecs":0,"repo":"'+pj.msg+'"}');
      return;
    }
    delFileRepoID = pj.value;
    console.log('Got delFileID: ',delFileRepoID);

    j.repo.data = await this.getLocalRepoRec(delFileRepoID);

    var IPs = await this.peer.getActiveRepoList(j);
    console.log('activeRepoList::',IPs);
    if (IPs.length == 0){
      res.end('{"result":false,"nRecs":0,"repo":"No Nodes Available For File Delete"}');
      return;
    }
    var n = 0;
    var hosts = [];
    var nStored = 0;
    for (var IP of IPs){
      try {
        var qres = await this.peer.receptorReqUpdateRepoDeleteFile(j,IP);
        if (qres){
          nStored = nStored +1;
          hosts.push({host:qres.remMUID,ip:qres.remIp});
        }
      }
      catch(err) {
        console.log('repo delete file failed on:',IP);
      }
      if (n==IPs.length -1){
        res.end('{"result":"repoDeleteFileOK","nStored":'+nStored+',"repo":'+JSON.stringify(j)+',"hosts":'+JSON.stringify(hosts)+'}');
      }
      n = n + 1;
    }
    return;
  }
};
/*----------------------------
End Receptor Code
=============================
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
    database: "ftreeFileMgr",
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
  database: "ftreeFileMgr",
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
class ftreeFileMgrObj {
  constructor(peerTree,reset){
    this.reset      = reset;
    this.isRoot     = null;
    this.status     = 'starting';
    this.net        = peerTree;
    this.receptor   = null;
    this.wcon       = new MkyWebConsole(this.net,con,this,'ftreeFileMgrCell');
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
      SQL =  "truncate table ftreeFileMgr.tblRepo; ";
      SQL += "truncate table ftreeFileMgr.tblRepoFolder; ";
      SQL += "truncate table ftreeFileMgr.tblShardFileMgr; ";
      SQL += "truncate table ftreeFileMgr.tblShardFiles; ";
      SQL += "truncate table ftreeFileMgr.tblShardHosts; ";

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
      to : 'ftreeCells',
      req : 'hello'
    }
    //console.log('bcast greeting to shardCell group: ',breq);
    this.net.broadcast(breq);
    const gtime = setTimeout( ()=>{
      this.sayHelloPeerGroup();
    },50*1000);
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
  async handleReq(res,j){
    console.log('reqHandle::->Check dbCon.state::',con.state);
    if (con.state === 'disconnected') {
      await con.connect();
    }
    //console.log('root recieved: ',j);
    if (j.req == 'fetchRepo'){
      this.fetchRepo(j,res);
      return true;
    }
    if (j.req == 'storeRepo'){
      this.storeRepo(j,res);
      return true;
    }
    if (j.req == 'storeRepoFolder'){
      this.storeRepoFolder(j,res);
      return true;
    }
    if (j.req == 'storeRepoFile'){
      this.storeRepoFile(j,res);
      return true;
    }
    if (j.req == 'storeRepoShard'){
      this.storeRepoShard(j,res);
      return true;
    }
    if (j.req == 'updateRepoInsertFile'){
      this.updateRepoInsertFile(j,res);
      return true;
    }
    if (j.req == 'updateRepoDeleteFile'){
      this.updateRepoDeleteFile(j,res);
      return true;
    }
    if (!this.isRoot && this.status != 'Online'){
      this.net.endRes(res,'');
      return true;
    }
    return false;
  }
  async handleReply(j){
    //console.log('replyHandle::->Check dbCon.state::',con.state);
    if (con.state === 'disconnected') {
      await con.connect();
    }
    if (j.reply == 'helloBack'){
      this.doCountMyPeers(j.remIp);
    }
    //console.log('\n====================\nXXXshardCell reply handler',j);
  }
  async handleBCast(j){
    //console.log('BCast::Check dbCon.state::->',con.state);
    if (con.state === 'disconnected') {
      await con.connect();
    }
    //console.log('bcast received: ',j);
    if (!j.msg.to) {return;}
    if (j.remIp == this.net.nIp) {console.log('ignoring bcast to self',this.net.nIp);return;} // ignore bcasts to self.
    if (j.msg.to == 'ftreeCells'){
      if (j.msg.req){
        if (j.msg.req == 'hello'){
          this.doReplyHelloBack(j.remIp);
        }
        if (j.msg.req == 'sendActiveRepo'){
          this.doSendActiveRepo(j.msg,j.remIp);
        }
        if (j.msg.req == 'sendMyRepoList'){
          this.doSendMyRepoList(j.msg,j.remIp);
        } 
        if (j.msg.req == 'sendMyFolderList'){
          this.doSendMyFolderList(j.msg,j.remIp);
        }
        if (j.msg.req == 'sendMyFileMgrList'){
          this.doSendMyFileMgrList(j.msg,j.remIp);
        }
        if (j.msg.req == 'sendMyMasterRIP'){
          this.doSendMyMasterRIP(j.msg,j.remIp);
        }
        if (j.msg.req == 'sendActiveRepoFolder'){
          this.doSendActiveRepoFolder(j.msg,j.remIp);
        }
        if (j.msg.req == 'sendActiveRepoFile'){
          this.doSendActiveRepoFile(j.msg,j.remIp);
        }
        if (j.msg.req == 'sendActiveRepoShard'){
          this.doSendActiveRepoShard(j.msg,j.remIp);
        }
        if (j.msg.req == 'deleteShard'){
          this.doDeleteShardByOwner(j.msg,j.remIp);
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
      console.log('remote wallet address does not match publickey',sig,mkybc.address);
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
   async doSendMyMasterRIP(j,remIp){
     const result = await this.receptor.locateMyRepoLocal(j.owner);
     if (result) {
       var qres = {
         req : 'sendMyMasterRIPResult',
         result : true,
         ip : this.net.rnet.myIp
       }
       this.net.sendReply(remIp,qres); 
       return;    
     } 
     this.net.sendReply(remIp,{req:'sendMyMasterRIPResult',result:false});
   }
   doSendMyRepoList(j,remIp){
     var SQL = `select * from ftreeFileMgr.tblRepo where repoOwner = '${j.repoOwner}' and repoType = 'Public' limit ${j.limit} offset ${j.offset}`;
     console.log('doSendMyRepos: '+SQL,j);
     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log('error reading repo ',err);
       }
       else {
         var repo = null;
         if (result.length == 0){
           console.log('repo Not Found On This Node.');
           return;
         }
         else {
           var qres = {
             req    : 'sendMyRepoListResult',
             result : result
           }
           //console.log('sending activeRepoResult :',qres);
           this.net.sendReply(remIp,qres);
         }
       }
     });
  }
  doSendMyFolderList(j, remIp) {
    var SQL = `SELECT * FROM ftreeFileMgr.tblRepoFolder 
               WHERE repoID_master = '${j.repoID_master}' 
               LIMIT ${j.limit} OFFSET ${j.offset}`;
    
    console.log('doSendMyFolderList: ' + SQL, j);

    con.query(SQL, async (err, result, fields) => {
        if (err) {
            console.log('Error reading folders', err);
            return;
        }

        if (result.length === 0) {
            console.log('Folder Not Found On This Node.');
            return;
        }

        var qres = {
            req: 'sendMyFolderListResult',
            result: result
        };

        this.net.sendReply(remIp, qres);
    });
  }
  doSendMyFileMgrList(j, remIp) {
    var SQL = `SELECT * FROM ftreeFileMgr.tblShardFileMgr
               WHERE repoID_master = '${j.repoID_master}'
               LIMIT ${j.limit} OFFSET ${j.offset}`;

    console.log('doSendMyFileMgrList: ' + SQL, j);

    con.query(SQL, async (err, result, fields) => {
        if (err) {
            console.log('Error reading folders', err);
            return;
        }

        if (result.length === 0) {
            console.log('Repo FileMgr Not Found On This Node.');
            return;
        }

        var qres = {
            req: 'sendMyFileMgrListResult',
            result: result
        };

        this.net.sendReply(remIp, qres);
    });
  }
  doSendActiveRepo(j,remIp){
     var SQL = "select * from ftreeFileMgr.tblRepo where repoOwner = '"+j.repo.from+"' and repoName = '"+j.repo.name+"'";
     console.log('doSendActiveRep: '+SQL,j);
     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log('error reading repo ',err);
       }
       else {
         var repo = null;
         if (result.length == 0){
           console.log('repo Not Found On This Node.');
           return;
         }
         else {
           repo = result[0];
           var qres = {
             req  : 'activeRepoIP',
             repo : repo
           }
           //console.log('sending activeRepoResult :',qres);
           this.net.sendReply(remIp,qres);
         }
       }
     });
  }
  doSendActiveRepoFolder(j,remIp){
     var SQL = "select * from ftreeFileMgr.tblRepoFolder where rfoldID_master = '"+j.repo.folder.fmasterID+"' and repoID_master = '"+j.repo.repoID_master+"'";
     console.log('doSendActiveRepoFolder: '+SQL,j);
     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log('error reading repo folder ',err);
       }
       else {
         var repo = null;
         if (result.length == 0){
           console.log('repo folder Not Found On This Node.');
           return;
         }
         else {
           repo = result[0];
           var qres = {
             req  : 'activeRepoFolderIP',
             repo : repo
           }
           //console.log('sending activeRepoFolderResult :',qres);
           this.net.sendReply(remIp,qres);
         }
       }
     });
  }
  doSendActiveRepoFile(j,remIp){
     var SQL = "select * from ftreeFileMgr.tblShardFileMgr where smgrID_master = '"+j.repo.file.fileID_master+"' and repoID_master = '"+j.repo.repoID_master+"'";
     console.log('doSendActiveRepoFile: '+SQL,j);
     con.query(SQL , async(err, result,fields)=>{
       if (err){
         console.log('error reading repo file ',err);
       }
       else {
         var repo = null;
         if (result.length == 0){
           console.log('repo file Not Found On This Node.');
           return;
         }
         else {
           repo = result[0];
           var qres = {
             req  : 'activeRepoFileIP',
             repo : repo
           }
           //console.log('sending activeRepoFileResult :',qres);
           this.net.sendReply(remIp,qres);
         }
       }
     });
  }
  doSendActiveRepoShard(j,remIp){
    var SQL = "select * from ftreeFileMgr.tblShardFiles where sfilID_master = '"+j.repo.shard.shardID_master+"' and repoID_master = '"+j.repo.repoID_master+"'";
    console.log('doSendActiveRepoShard: '+SQL,j);
    con.query(SQL , async(err, result,fields)=>{
      if (err){
        console.log('error reading repo shard ',err);
      }
      else {
        var repo = null;
        if (result.length == 0){
          console.log('repo shard Not Found On This Node.');
          return;
        }
        else {
          repo = result[0];
          var qres = {
            req  : 'activeRepoShardIP',
            repo : repo
          }
          this.net.sendReply(remIp,qres);
        }
      }
    });
  }
  async updateRepoDeleteFile(r,remIp){
      var result = false;
      var ermsg  = null;
      var doSignRepo = false;
      const pj = await this.receptor.deleteLocalRepoFile(r.repo,doSignRepo);
      result = pj.result;
      if (result){
        if (await this.doUpdateRepoHash(r.repo)){
          result = true;
        }
        else {ermsg = 'Update Repo Hash Record Failed In Delete Repo File action.';}
      }
      else {ermsg = 'Update Repo Delete File Record Failed: '+pj.msg;}

      var qres = {
        req : 'updateRepoDeleteFileResult',
        result : result,
        ermsg : ermsg
      }
      this.net.sendReply(remIp,qres);
  }
  async updateRepoInsertFile(r,remIp){
      var result = false;
      var ermsg  = null;
      var doSignRepo = false;
      const pj = await this.receptor.insertLocalRepoFile(r.repo,doSignRepo);
      result = pj.result;
      if (result){
        if (await this.doUpdateRepoHash(r.repo)){
	  result = true;
	}
	else {ermsg = 'Update Repo Hash Record Failed';}      
      }
      else {ermsg = 'Update Repo Insert File Record Failed: '+pj.msg;}

      var qres = {
        req : 'updateRepoInsertFileResult',
        result : result,
        ermsg : ermsg
      }
      this.net.sendReply(remIp,qres);	  
  }
  doUpdateRepoHash(repo){
    return new Promise(async(resolve,reject)=>{
      var repoID_master = await this.receptor.getRepoID(repo);
      var SQL = "update `ftreeFileMgr`.`tblRepo` " +
      "set repoSignature = '"+repo.data.repoSignature+"',repoHash = '"+repo.data.repoHash+"',repoLastUpdate='"+repo.data.repoLastUpdate+
      "' where repoID_master = '"+repoID_master+"'";
      console.log('Updating Repo Hash: ',repo);
      console.log('Updating Repo Hash: ',SQL);
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(false);
        }
        else {
          resolve (true);
        }
      });
    });
  }
  storeRepo(j,remIp){
    console.log('got full request store repo',j);
    j.repo.signature = this.composeRepoSig(j.repo.data);
    console.log('got request store repo',j.repo.signature);
    if (!this.isValidSig(j.repo.signature)){
      console.log('Repo Signature Invalid... NOT stored');
      this.net.sendReply(remIp,{reply : 'repoStoreRes',result :false,error : "Invalid Signature For Request"});
      return;
    }
    var SQL = "select repoID_master from ftreeFileMgr.tblRepo where repoID_master = '"+j.repo.data.repoID_master+"'";

    con.query(SQL , async(err, result,fields)=>{
      if (err){
        console.log(err);
        var qres = {
          reply : 'repoStoreRes',
          result : false,
          error : err,
          repoID_master : null
        }
        this.net.sendReply(remIp,qres);
        return null;
      }
      else {
        var repoID_master = null;
        if (result.length == 0){
          repoID_master = await this.createNewRepo(j.repo);
          console.log('New Repo Created:',repoID_master);
          if (!repoID_master){
            var qres = {
              reply : 'repoStoreRes',
              result : false,
              error : "failed to create new repo record for repoOwner",
              repoID_master : null
            }
            this.net.sendReply(remIp,qres);
            return null;
          }
          else {
            var qres = {
              reply : 'repoStoreRes',
              result : true,
              repoID_master : repoID_master
            }
            console.log('sending repoStoreRes:'+remIp,qres);
            this.net.sendReply(remIp,qres);
          }
        }
        else {
          var qres = {
            reply : 'repoStoreRes',
            result : false,
            error : 'Something Fishy Happend',
            repoID_master : repoID_master
          }
          console.log('sending storeRepo:'+remIp,qres);
          this.net.sendReply(remIp,qres);
        }
      }
    });
  }
  createNewRepo(r){
    return new Promise((resolve,reject)=>{
      const d = r.data;
      const repoID_master =  hashToBase58(d.repoName + d.repoOwner);
      var SQL = "INSERT INTO `ftreeFileMgr`.`tblRepo` " +
        "(`repoID_master`,`repoName`,`repoPubKey`,`repoOwner`,`repoLastUpdate`,`repoSignature`,`repoHash`,`repoCopies`,`repoType`) " +
        "VALUES ('"+repoID_master+"','"+d.repoName+"','"+d.repoPubKey+"','"+d.repoOwner+"','"+d.repoLastUpdate+"','"+d.repoSignature+"','"+d.repoHash+"',"+d.repoCopies+
        ",'Public');" +
        "SELECT LAST_INSERT_ID() AS newRepoID;";
      con.query(SQL , async (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
        }
        else {
          var newRepoID = null;
          result.forEach((rec,index)=>{
            if(index === 1){
              newRepoID = rec[0].newRepoID;
            }
          });
          resolve(newRepoID);
        }
      });
    });
  }
  createNewRepoFolder(r){
    return new Promise((resolve,reject)=>{
      console.log('CreateNewRepoFolder::',r);
      const d = r.data;
      const f = r.folder;
      var SQL = "INSERT INTO `ftreeFileMgr`.`tblRepoFolder` (`repoID_master`,`rfoldID_master`,`rfoldName`,`rfoldParentID`) "+
          "VALUES ('"+d.repoID_master+"',"+f.fmasterID+",'"+f.name+"',"+f.parent+");" +
          "SELECT LAST_INSERT_ID() AS newFolderID;";
      con.query(SQL , async (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
        }
        else {
          var newFolderID = null;
          result.forEach((rec,index)=>{
            if(index === 1){
              newFolderID = rec[0].newFolderID;
            }
          });
          resolve(newFolderID);
        }
      });
    });
  }
  storeRepoFolder(j,remIp){
    console.log('got full request store repo Folder',j);
    
    var SQL = "select rfoldID from ftreeFileMgr.tblRepoFolder where repoID_master = '"+j.repo.data.repoID_master+"' and rfoldID_master = '"+j.repo.folder.fmasterID+"'";
    console.log(SQL);
    con.query(SQL , async(err, result,fields)=>{
      if (err){
        console.log(err);
        var qres = {
          reply : 'repoStoreFolderRes',
          result : false,
          error : err,
          rfoldID_master : null
        }
        this.net.sendReply(remIp,qres);
        return null;
      }
      else {
        var rfoldID_master = null;
        console.log(result);
        if (result.length == 0){
          rfoldID_master = await this.createNewRepoFolder(j.repo);
          console.log('New Repo Folder Created:',rfoldID_master);
          if (!rfoldID_master){
            var qres = {
              reply : 'repoStoreFolderRes',
              result : false,
              error : "failed to create new repo record for repoOwner",
              rfoldID_master : null
            }
            this.net.sendReply(remIp,qres);
            return null;
          }
          else {
            var qres = {
              reply : 'repoStoreFolderRes',
              result : true,
              rfoldID_master : rfoldID_master
            }
            console.log('sending repoStoreFolderRes:'+remIp,qres);
            this.net.sendReply(remIp,qres);
          }
        }
        else {
          var qres = {
            reply : 'repoStoreFolderRes',
            result : false,
            error : 'Something Fishy Happend',
            rfoldID_master : rfoldID_master
          }
          console.log('sending storeRepoFolder:'+remIp,qres);
          this.net.sendReply(remIp,qres);
        }
      }
    });
  }
  storeRepoFile(j, remIp) {
    console.log('Received file storage request', j);
  
    const SQL = `
      SELECT smgrID FROM ftreeFileMgr.tblShardFileMgr 
      WHERE repoID_master = '${j.repo.data.repoID_master}'
      AND smgrID_master = '${j.repo.file.fileID_master}'
    `;
  
    console.log('File check SQL:', SQL);
  
    con.query(SQL, async (err, result, fields) => {
      if (err) {
        console.error('Database error:', err);
        this.net.sendReply(remIp, {
          reply: 'repoStoreFileRes',
          result: false,
          error: err.message,
          smgrID_master: null
        });
        return;
      }

      let smgrID_master = null;
    
      if (result.length === 0) {
        try {
          smgrID_master = await this.createNewRepoFile(j.repo);
          console.log('New file record created:', smgrID_master);
        
          if (!smgrID_master) {
            this.net.sendReply(remIp, {
              reply: 'repoStoreFileRes',
              result: false,
              error: "File creation failed",
              smgrID_master: null
            });
            return;
          }
        
          this.net.sendReply(remIp, {
            reply: 'repoStoreFileRes',
            result: true,
            smgrID_master: smgrID_master,
            fileSize: j.repo.file.size,
            checksum: j.repo.file.checksum
          });
        } catch (createErr) {
          console.error('File creation error:', createErr);
          this.net.sendReply(remIp, {
            reply: 'repoStoreFileRes',
            result: false,
            error: createErr.message
          });
        }
      } else {
        console.log('File already exists:', result[0].smgrID);
        this.net.sendReply(remIp, {
          reply: 'repoStoreFileRes',
          result: false,
          error: 'File version conflict',
          smgrID_master: result[0].smgrID
        });
      }
    });
  }
  storeRepoShard(j, remIp) {
    console.log('Received shard storage request', j);

    const SQL = `
      SELECT sfilID FROM ftreeFileMgr.tblShardFiles
      WHERE repoID_master = '${j.repo.data.repoID_master}'
      AND sfilID_master = '${j.repo.shard.shardID_master}'
    `;

    console.log('Shard check SQL:', SQL);

    con.query(SQL, async (err, result, fields) => {
      if (err) {
        console.error('Database error:', err);
        this.net.sendReply(remIp, {
          reply: 'repoStoreShardRes',
          result: false,
          error: err.message,
          sfilID_master: null
        });
        return;
      }

      let sfilID_master = null;

      if (result.length === 0) {
        try {
          sfilID_master = await this.createNewRepoShard(j.repo);
          console.log('New shard record created:', sfilID_master);

          if (!sfilID_master) {
            this.net.sendReply(remIp, {
              reply: 'repoStoreShardRes',
              result: false,
              error: "Shard creation failed",
              sfilID_master: null
            });
            return;
          }

          this.net.sendReply(remIp, {
            reply: 'repoStoreShardRes',
            result: true,
            sfilID_master: sfilID_master,
            shardHash: j.repo.shard.sfilShardHash
          });
        } catch (createErr) {
          console.error('Shard creation error:', createErr);
          this.net.sendReply(remIp, {
            reply: 'repoStoreShardRes',
            result: false,
            error: createErr.message
          });
        }
      } else {
        console.log('Shard already exists:', result[0].sfilID);
        this.net.sendReply(remIp, {
          reply: 'repoStoreShardRes',
          result: false,
          error: 'Shard conflict',
          sfilID_master: result[0].sfilID
        });
      }
    });
  }
  async createNewRepoFile(repoData) {
    const fileSQL = `
      INSERT INTO tblShardFileMgr (
        repoID_master, smgrID_master, smgrFileName, 
        smgrFilePath, smgrCheckSum, smgrFileSize,
        smgrFileFolderID, smgrFileType, smgrFVersionNbr
      ) VALUES (
        '${repoData.repoID_master}',
        ${repoData.file.fileID_master},  
        '${repoData.file.name}',
        '${repoData.file.data.smgrFilePath}',
        '${repoData.file.data.smgrCheckSum}',
        ${repoData.file.data.smgrFileSize},
        ${repoData.file.data.smgrFileFolderID || 'NULL'},
        '${repoData.file.data.smgrFileType}',
        ${repoData.file.data.smgrFVersionNbr}
      )`;

    return new Promise((resolve, reject) => {
      con.query(fileSQL, (err, result) => {
        if (err) {
          console.error('File insertion error:', err);
          reject(err);
        } else {
          console.log('Inserted file with ID:', result.insertId);
          resolve(result.insertId);
        }
      });
    });
  }
  async createNewRepoShard(repoData) {
    const shardSQL = `
      INSERT INTO tblShardFiles (
        repoID_master, sfilID_master, sfilFileMgrID,
        sfilCheckSum, sfilShardHash, sfilNCopies
      ) VALUES (
        '${repoData.repoID_master}',
        ${repoData.shard.shardID_master},
        ${repoData.shard.data.sfilFileMgrID},
        '${repoData.shard.data.sfilCheckSum}',
        '${repoData.shard.data.sfilShardHash}',
        ${repoData.shard.data.sfilNCopies}
      )`;

    return new Promise((resolve, reject) => {
      con.query(shardSQL, (err, result) => {
        if (err) {
          console.error('Shard insertion error:', err);
          reject(err);
        } else {
          console.log('Inserted shard with ID:', result.insertId);
          resolve(result.insertId);
        }
      });
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
      to : 'ftreeCells',
      req : 'stopNodeGenIP',
      work  : work
    }
    this.net.broadcast(req);
  }
  getActiveRepoList(j){
    console.log('getActiveRepoList',j);
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const maxIP = j.repo.data.repoCopies;
      console.log('Check repo nCopys::',maxIP,j.repo.name);
      var   IPs = [];
      const gtime = setTimeout( ()=>{
        console.log('getActiveRepoList Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(IPs);
      },1.5*1000);

      var req = {
        to : 'ftreeCells',
        req : 'sendActiveRepo',
        repo : j.repo
      }

      this.net.broadcast(req);
      this.net.on('mkyReply', mkyReply = (r)=>{
        if (r.req == 'activeRepoIP'){
          //console.log('mkyReply Active Repo is:',r.remIp);
          if (this.verifyActiveRepo(r)){
            if (IPs.length <= maxIP){
              //console.log('Pushing remIp::',r.remIp,IPs.length,maxIP);
              IPs.push(r.remIp);
            }
            if (IPs.length == maxIP){
              clearTimeout(gtime);
              this.net.removeListener('mkyReply', mkyReply);
              //console.log('Resolving IPs',IPs);
              resolve(IPs);
            }
          }
        }
      });
    });
  }
  verifyActiveRepo(r){
     //console.log('verifyActiveRepo: ',r.repo.repoName);
     var signature = this.composeRepoSig(r.repo);
     //console.log('building ActiveRep Signature',signature);
     if (this.isValidSig(signature)){ 
       //console.log('ActiveRep Signature Is Valid:');
       return true;
     }
     return false;
  }	  
  locateMyMasterRepo(muid){
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const gtime = setTimeout( ()=>{
        console.log('locateMyMasterRepo Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(null);
      },1.5*1000);

      var req = {
        to   : 'ftreeCells',
        req  : 'sendMyMasterRIP',
        owner : muid
      }

      this.net.broadcast(req);
      this.net.on('mkyReply', mkyReply = (r)=>{
        if (r.req == 'sendMyMasterRIPResult'){
          resolve(r);
        }
        clearTimeout(gtime);
        this.net.removeListener('mkyReply', mkyReply);
      });
    });
  }
  getActiveRepoFolder(j){
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const maxIP = j.repo.data.repoCopies;
      console.log('Check repoFolder nCopys::',maxIP,j.repo.name);
      var   IPs = [];
      const gtime = setTimeout( ()=>{
        console.log('getActiveRepoFolder Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(IPs);
      },1.5*1000);

      var req = {
        to   : 'ftreeCells',
        req  : 'sendActiveRepoFolder',
        repo : j.repo
      }

      this.net.broadcast(req);
      this.net.on('mkyReply', mkyReply = (r)=>{
        if (r.req == 'activeRepoFolderIP'){
          if (this.verifyActiveRepoFolder(r)){
            if (IPs.length <= maxIP){
              IPs.push(r.remIp);
            }
            if (IPs.length == maxIP){
              clearTimeout(gtime);
              this.net.removeListener('mkyReply', mkyReply);
              resolve(IPs);
            }
          }
        }
      });
    });
  }
  getActiveRepoFile(j) {
    return new Promise((resolve, reject) => {
      let mkyReply = null;
      const maxIP = j.repo.data.repoCopies;
      console.log('Check repoFile nCopys::', maxIP, j.repo.name);
      let IPs = [];
    
      const gtime = setTimeout(() => {
        console.log('getActiveRepoFile Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(IPs);
      }, 1.5 * 1000);

      const req = {
        to: 'ftreeCells',
        req: 'sendActiveRepoFile',  
        repo: j.repo
      };

      this.net.broadcast(req);
      this.net.on('mkyReply', mkyReply = (r) => {
        if (r.req === 'activeRepoFileIP') {  
          if (this.verifyActiveRepoFile(r)) {  
            if (IPs.length <= maxIP) {
              IPs.push(r.remIp);
            }
            if (IPs.length === maxIP) {
              clearTimeout(gtime);
              this.net.removeListener('mkyReply', mkyReply);
              resolve(IPs);
            }
          }
        }
      });
    });
  }
  getActiveRepoShard(j) {
    return new Promise((resolve, reject) => {
      let mkyReply = null;
      const maxIP = j.repo.data.repoCopies;
      console.log('Check repoShard nCopys::', maxIP, j.repo.name);
      let IPs = [];

      const gtime = setTimeout(() => {
        console.log('getActiveRepoShard Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(IPs);
      }, 1.5 * 1000);

      const req = {
        to: 'ftreeCells',
        req: 'sendActiveRepoShard',
        repo: j.repo
      };

      this.net.broadcast(req);
      this.net.on('mkyReply', mkyReply = (r) => {
        if (r.req === 'activeRepoShardIP') {
          if (this.verifyActiveRepoShard(r)) {
            if (IPs.length <= maxIP) {
              IPs.push(r.remIp);
            }
            if (IPs.length === maxIP) {
              clearTimeout(gtime);
              this.net.removeListener('mkyReply', mkyReply);
              resolve(IPs);
            }
          }
        }
      });
    });
  }
  verifyActiveRepoFile(r){
    return true;
  }
  verifyActiveRepoFolder(r){
    return true;
  }
  verifyActiveRepoShard(r){
    return true;
  }
  receptorReqReadMyRemoteRepos(ownMUID,limit,offset){
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const maxIP = this.myPeers.length || 3;
      var   results = [];
      const gtime = setTimeout( ()=>{
        console.log('Send My Remote Repos List Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(results);
      },2.5*1000);

      const msg = {
        to        : 'ftreeCells',
        req       : 'sendMyRepoList',
        repoOwner : ownMUID,
        limit     : limit,
        offset    : offset
      }
      console.log(msg);
      this.net.broadcast(msg);    
      this.net.on('mkyReply', mkyReply = (r)=>{
        if (r.req == 'sendMyRepoListResult'){
          console.log('mkyReply Remote Repo List:',r.remIp);
          if (results.length <= maxIP){
            results.push({result:r.result,remIp:r.remIp});
          }
          else {
            clearTimeout(gtime);
            this.net.removeListener('mkyReply', mkyReply);
            resolve(results);
          }
        }
      });
    });
  }
  receptorReqReadMyRemoteFolders(repoID_master, limit, offset) {
    return new Promise((resolve, reject) => {
        let mkyReply = null;
        const maxIP = this.myPeers.length || 3;
        let results = [];

        // Set timeout to handle request failures
        const gtime = setTimeout(() => {
            console.log('Send My Remote Folders List Request Timeout:');
            this.net.removeListener('mkyReply', mkyReply);
            resolve(results);
        }, 2.5 * 1000);

        // Prepare and broadcast request message
        const msg = {
            to: 'ftreeCells',
            req: 'sendMyFolderList',
            repoID_master : repoID_master,
            limit: limit,
            offset: offset
        };

        console.log(msg);
        this.net.broadcast(msg);

        // Listen for remote responses
        this.net.on('mkyReply', mkyReply = (r) => {
            if (r.req === 'sendMyFolderListResult') {
                console.log('mkyReply Remote Folder List:', r.remIp);
                if (results.length <= maxIP) {
                    results.push({ result: r.result, remIp: r.remIp });
                } else {
                    clearTimeout(gtime);
                    this.net.removeListener('mkyReply', mkyReply);
                    resolve(results);
                }
            }
        });
    });
  }
  receptorReqReadMyRemoteFileMgr(repoID_master, limit, offset) {
    return new Promise((resolve, reject) => {
        let mkyReply = null;
        const maxIP = this.myPeers.length || 3;
        let results = [];

        // Set timeout to handle request failures
        const gtime = setTimeout(() => {
            console.log('Send My Remote FileMgr List Request Timeout:');
            this.net.removeListener('mkyReply', mkyReply);
            resolve(results);
        }, 2.5 * 1000);

        // Prepare and broadcast request message
        const msg = {
            to: 'ftreeCells',
            req: 'sendMyFileMgrList',
            repoID_master : repoID_master,
            limit: limit,
            offset: offset
        };

        console.log(msg);
        this.net.broadcast(msg);

        // Listen for remote responses
        this.net.on('mkyReply', mkyReply = (r) => {
            if (r.req === 'sendMyFileMgrListResult') {
                console.log('mkyReply Remote FileMgr List:', r.remIp);
                if (results.length <= maxIP) {
                    results.push({ result: r.result, remIp: r.remIp });
                } else {
                    clearTimeout(gtime);
                    this.net.removeListener('mkyReply', mkyReply);
                    resolve(results);
                }
            }
        });
    });
  }
  receptorReqNodeList(j,excludeIps=[]){
    return new Promise( (resolve,reject)=>{
      console.log('receptorReqNodeList::',j);
      var mkyReply = null;
      const maxIP = j.repo.nCopys;
      var   IPs = [];
      const gtime = setTimeout( ()=>{
        console.log('Send Node List Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(IPs);
      },1.5*1000);

      var req = {
        to     : 'ftreeCells',
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
  receptorReqUpdateRepoInsertFile(j,toIp){
    //console.log('receptorReqUpdateRepoInsertFile',j);
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const gtime = setTimeout( ()=>{
        console.log('Update Repo Insert File Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(null);
      },5000);
      console.log('Store Repo To: ',toIp);
      var req = {
        req : 'updateRepoInsertFile',
        repo : j.repo
      }

      this.net.sendMsg(toIp,req);
      this.net.on('mkyReply',mkyReply = (r) =>{
        if (r.req == 'updateRepoInsertFileResult' && r.remIp == toIp){
          clearTimeout(gtime);
          this.net.removeListener('mkyReply', mkyReply);
          resolve(r);
        }
      });
    });
  }
  receptorReqUpdateRepoDeleteFile(j,toIp){
    //console.log('receptorReqDeleteRepo',j);
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const gtime = setTimeout( ()=>{
        console.log('Update Repo Delete File Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(null);
      },5000);
      console.log('Delete Repo File On: ',toIp);
      var req = {
        req : 'updateRepoDeleteFile',
        repo : j.repo
      }

      this.net.sendMsg(toIp,req);
      this.net.on('mkyReply',mkyReply = (r) =>{
        if (r.req == 'updateRepoDeleteFileResult' && r.remIp == toIp){
          clearTimeout(gtime);
          this.net.removeListener('mkyReply', mkyReply);
          resolve(r);
        }
      });
    });
  }
  receptorReqCreateRepo(j,toIp){
    //console.log('receptorReqCreateRepo',j);
    return new Promise( (resolve,reject)=>{	  
      var mkyReply = null;
      const gtime = setTimeout( ()=>{
        console.log('Create New Repo Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(null);
      },5000);  
      console.log('Store Repo To: ',toIp);
      //j.repo.signature = this.composeRepoSig(j.repo.data);
      var req = {
        req : 'storeRepo',
	repo : j.repo
      }

      this.net.sendMsg(toIp,req);
      this.net.on('mkyReply',mkyReply = (r) =>{
        if (r.reply == 'repoStoreRes' && r.remIp == toIp){ 
          clearTimeout(gtime);   
          this.net.removeListener('mkyReply', mkyReply);
	  resolve(r);
        }		    
      });
    });
  }	
  receptorReqCreateFolder(j,toIp){
    //console.log('receptorReqCreateRepo',j);
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const gtime = setTimeout( ()=>{
        console.log('Create New Repo Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(null);
      },5000);
      console.log('Store Repo To: ',toIp);
      //j.repo.signature = this.composeRepoSig(j.repo.data);
      var req = {
        req : 'storeRepoFolder',
        repo : j.repo
      }

      this.net.sendMsg(toIp,req);
      this.net.on('mkyReply',mkyReply = (r) =>{
        if (r.reply == 'repoStoreFolderRes' && r.remIp == toIp){
          clearTimeout(gtime);
          this.net.removeListener('mkyReply', mkyReply);
          resolve(r);
        }
      });
    });
  }
  receptorReqCreateFile(j, toIp) {
    return new Promise((resolve, reject) => {
      let mkyReply = null;
      const gtime = setTimeout(() => {
        console.log('Create New File Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(null);
      }, 5000);

      console.log('Store File To:', toIp);
      const req = {
        req: 'storeRepoFile', 
        repo: j.repo
      };

      this.net.sendMsg(toIp, req);
      this.net.on('mkyReply', mkyReply = (r) => {
        if (r.reply === 'repoStoreFileRes' && r.remIp === toIp) {  
          clearTimeout(gtime);
          this.net.removeListener('mkyReply', mkyReply);
          resolve(r);
        }
      });
    });
  }
  receptorReqCreateShard(j, toIp) {
    return new Promise((resolve, reject) => {
      let mkyReply = null;
      const gtime = setTimeout(() => {
        console.log('Create New Shard Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(null);
      }, 5000);

      console.log('Store Shard To:', toIp);
      const req = {
        req: 'storeRepoShard',
        repo: j.repo
      };

      this.net.sendMsg(toIp, req);
      this.net.on('mkyReply', mkyReply = (r) => {
        if (r.reply === 'repoStoreShardRes' && r.remIp === toIp) {
          clearTimeout(gtime);
          this.net.removeListener('mkyReply', mkyReply);
          resolve(r);
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

module.exports.ftreeFileMgrObj = ftreeFileMgrObj;
module.exports.ftreeFileMgrCellReceptor = ftreeFileMgrCellReceptor;
