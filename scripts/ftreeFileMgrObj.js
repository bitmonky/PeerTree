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
const mysql        = require('mysql2');
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
              if (j.msg.req == 'createRepo'){
                this.reqCreateRepo(j.msg,res);
                return;
	      }	      
              if (j.msg.req == 'createRepoFolder'){
                this.reqCreateRepoFolder(j.msg,res);
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
        "inner join `ftreeFileMgr`.`tblRepoFolder` on repoID = rfoldRepoID "+
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
        "inner join `ftreeFileMgr`.`tblShardFileMgr` on repoID = smgrRepoID "+
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
      var repoID = await this.repoIsMaster(j.repo.name,j.repo.from);
      if (!repoID){
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
      var SQL = "select sfilShardHash shardID ,sfilNCopies nStored FROM `ftreeFileMgr`.`tblRepo` " +
        "inner join `ftreeFileMgr`.`tblShardFileMgr` on repoID = smgrRepoID " +
        "inner join `ftreeFileMgr`.`tblShardFiles` on sfilFileMgrID = smgrID " +
        "where repoID = "+repoID+" and smgrFileName = '"+j.repo.file+"' and smgrFilePath = '"+outpath+"' " +
        "order by smgrID";
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        console.log(SQL,result);
        resolve({owner:j.repo.from,filename:outpath+'/'+j.repo.file,shards:result,fileInfo:fileInfo,});
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
         "inner join `ftreeFileMgr`.`tblShardFileMgr` on repoID = smgrRepoID "+
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
      var SQL = "select repoID FROM `ftreeFileMgr`.`tblRepo` "+
        "where repoName = '"+name+"' and repoOwner = '"+owner+"' and repoType = 'Master'";
      con.query(SQL , (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
          return;
        }
        if (result.length > 0){
          resolve(result[0].repoID);
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
  repoFileExists(filename,rname,owner){
    return new Promise((resolve,reject)=>{
      var SQL = "select count(*)nRec FROM `ftreeFileMgr`.`tblRepo` "+
         "inner join `ftreeFileMgr`.`tblShardFileMgr` on repoID = smgrRepoID "+
         "where repoName = '"+rname+"' and repoOwner = '"+owner+"' and smgrFileName = '"+filename+"'";
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
  getRepoHash(repo,repoID,con){
    return new Promise((resolve,reject)=>{
      var hstr = repo.ownerMUID+repo.name;
      var SQL = "select smgrID, concat(smgrFileName,smgrCheckSum,smgrDate,smgrExpires,smgrEncrypted,smgrFileType,smgrFileSize,"+
          "smgrFVersionNbr,smgrSignature,smgrShardList,smgrFileFolderID,smgrFilePath) hstr, "+
          "concat(sfilCheckSum,sfilShardHash,sfilNCopies,sfilDate,sfilExpires,sfilEncrypted,sfilShardNbr) sfilStr "+
          "FROM `ftreeFileMgr`.`tblShardFileMgr`"+
          "inner join  `ftreeFileMgr`.`tblShardFiles` on sfilFileMgrID = smgrID "+
          "where smgrRepoID = "+repoID;
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
          path = pf.name+path;
          folders.push({name:pf.name,fnbr:folderID});
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
      var SQL = "select rfoldName,rfoldParentID from `ftreeFileMgr`.`tblRepoFolder` where rfoldID = "+folderID;
      con.query(SQL , async (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
        }
        else {
          console.log(result);
          resolve ({name:result[0].rfoldName,parentID:result[0].rfoldParentID});
        }
      });
    });
  }
  createLocalFolder(repo){
    return new Promise(async (resolve,reject)=>{
      if (repo.parent === null){
        repo.parent = 'null';
      }
      const repoID = await this.getRepoID(repo);

      var SQL = "INSERT INTO `ftreeFileMgr`.`tblRepoFolder` (`rfoldRepoID`,`rfoldName`,`rfoldParentID`) "+
        "VALUES ("+repoID+",'"+repo.folder+"',"+repo.parent+");" +
        "SELECT LAST_INSERT_ID()newFolderID;";
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
          resolve (newFolderID);
        }
      });
    });
  }
  createLocalRepo(repo){
    return new Promise((resolve,reject)=>{
      var SQL = "INSERT INTO `ftreeFileMgr`.`tblRepo` " +
      "(`repoName`,`repoPubKey`,`repoOwner`,`repoLastUpdate`,`repoSignature`,`repoHash`,`repoCopies`,`repoType`) " +
      "VALUES ('"+repo.name+"','"+repo.pubKey+"','"+repo.from+"',now(),'NS','NA',"+repo.nCopys+",'Master');" +
      "SELECT LAST_INSERT_ID()newRepoID;";
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
  getLocalRepoRec(repoID){
    return new Promise((resolve,reject)=>{
      var SQL = "select * from  `ftreeFileMgr`.`tblRepo` where repoID="+repoID;
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
  updateAndSignRepo(repoID,token,rhash,con){
    return new Promise((resolve,reject)=>{
      var signature = this.shardToken.signToken(token);
      console.log('Signing Token: ',token);
      var SQL = "update `ftreeFileMgr`.`tblRepo` " +
      "set repoPubKey = '"+this.shardToken.publicKey+"',repoSignature = '"+signature+"',repoHash = '"+rhash+"',repoLastUpdate=now() "+
      "where repoID = "+repoID;
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
      var SQL = "select repoID from  `ftreeFileMgr`.`tblRepo` where repoOwner='"+r.from+"' and repoName='"+r.name+"'";
      con.query(SQL , async (err, result,fields)=>{
        if (err){
          console.log(err);
          resolve(null);
     	  return;	
        }
        else {
          if (result.length > 0){
	    resolve(result[0].repoID);
            return;		  
          }	
          console.log('Repo File Not Found: '+SQL);
	  resolve(null);
        }
      });
    });
  }
  insertLocalFileShard(s,fileID,repoID,shardNbr,con){
    return new Promise(async (resolve,reject)=>{
      var SQL = "INSERT INTO `ftreeFileMgr`.`tblShardFiles` (`sfilFileMgrID`,`sfilCheckSum`,`sfilShardHash`,`sfilNCopies`,`sfilDate`,"+
        "`sfilExpires`, `sfilEncrypted`, `sfilShardNbr`) VALUES "+
        "("+fileID+",'NA','"+s.shardID+"',"+s.nStored+",now(),now(),0,"+shardNbr+")";
      con.query(SQL , async (err, result,fields)=>{
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
  async insertLocalFileShards(shards,fileID,repoID,con){
    var result = false;
    for(let i = 0; i < shards.length; i++) {
      result = await this.insertLocalFileShard(shards[i],fileID,repoID,i,con); 
      if (!result){
        break;
      }      
    }
    return result;
  }
  getRepoFileID(repo){
    return new Promise(async (resolve,reject)=>{
      var fileID = null;
      var repoID = null;
      console.log('getRepFileID::',repo);
      var f = repo.file;
      var SQL = "SELECT repoID,smgrID FROM ftreeFileMgr.tblRepo " + 
        "inner join ftreeFileMgr.tblShardFileMgr on repoID = smgrRepoID " +
        "where  repoName = '"+repo.name+"' and repoOwner = '"+repo.from+"' " +
        "and smgrFileName = '"+repo.file.filename+"' and smgrFilePath = '"+repo.path+"';";
      return pool.getConnection((err, con)=>{
        if (err){ return dbConFail(resolve,'getRepoFileID::getConnection Failed');}
        return con.query(SQL , async (err, result,fields)=>{
          if (err){
            return dbFail(con,resolve,'getRepoFileID::sql look failed'+sql);
          }
          console.log(SQL,result);
          if (result.length === 0){
            return dbFaile(con,resolve,'getRepoFileID::sql empty set'+sql);
          }		  
	  fileID = result[0].smgrID;
          repoID = result[0].repoID;		
	  return dbResult(con,resolve,{fileID:fileID,repoID:repoID});
        });		
      });		
    });
  }	  
  deleteLocalRepoFile(repo,doSignRepo=true){
    return new Promise(async (resolve,reject)=>{
      var repoFileID = null;
      var repoID     = null;
      var qr = await this.getRepoFileID(repo);

      if (qr.result){
	repoFileID = qr.value.fileID;
        repoID     = qr.value.repoID;
      }
      var f = repo.file;
      var SQL = "Delete From `ftreeFileMgr`.`tblShardFileMgr` where smgrID = "+repoFileID+";"+
        "Delete From `ftreeFileMgr`.`tblShardFiles` where sfilFileMgrID = "+repoFileID;
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
            const rhash = await this.getRepoHash(repo,repoID,con);
            await this.updateAndSignRepo(repoID,repo.from+repo.name+rhash,rhash,con);
          }
          return dbResult(con,resolve,repoID);
	});	
      });
    });
  }
  insertLocalRepoFile(repo,doSignRepo=true){
    return new Promise(async (resolve,reject)=>{
      var repoID = await this.getRepoID(repo);

      var f = repo.file;
      if (repo.folderID === null || repo.folderID == ''){
        repo.folderID = 'null';
      }
      console.log(repo);
      var SQL = "INSERT INTO `ftreeFileMgr`.`tblShardFileMgr` (`smgrRepoID`,`smgrFileName`,`smgrCheckSum`,`smgrDate`,`smgrExpires`,`smgrEncrypted`,"+
        "`smgrFileType`,`smgrFileSize`,`smgrFVersionNbr`,`smgrSignature`,`smgrShardList`,`smgrFileFolderID`,`smgrFilePath`) "+
        "VALUES ("+repoID+",'"+f.filename+"','"+f.checksum+"',now(),now(),'"+f.encrypt+"','"+f.ftype+"',"+
        "0,0,'NA','NA',"+repo.folderID+",'"+repo.path+"');"+
        "SELECT LAST_INSERT_ID()newRFileID;";
      return pool.getConnection((err, con)=>{
        if (err){ return dbConFail(resolve,'InsertLocalRepFile::getConnection Failed');}
        return con.query(SQL , async (err, result,fields)=>{
          if (err){
            return dbFail(con,resolve,'Insert File Record Failed'+SQL);
          }
          var newRFileID = null;
          result.forEach((rec,index)=>{
           if(index === 1){
             newRFileID = rec[0].newRFileID;
           }
          });
          if (this.insertLocalFileShards(repo.file.shards,newRFileID,repoID,con)){
            if (doSignRepo){
	      const rhash = await this.getRepoHash(repo,repoID,con);
              await this.updateAndSignRepo(repoID,repo.from+repo.name+rhash,rhash,con);
            }		    
            console.log('XXXXXXXXXXX');
	    return dbResult(con,resolve,repoID);
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
    if (await this.repoFileExists(j.repo.file,j.repo.name,j.repo.from) > 0){
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

var con = mysql.createConnection({
  host: "localhost",
  user: dba.user,
  password: dba.pass,
  database: "ftreeFileMgr",
  dateStrings: "date",
  multipleStatements: true,
  supportBigNumbers : true
});
con.connect(function(err) {
  if (err) throw err;
});

var mysqlp = require('mysql2');
var pool  = mysqlp.createPool({
  connectionLimit : 100,
  host            : 'localhost',
  user: dba.user,
  password: dba.pass,
  database: "ftreeFileMgr",
  dateStrings     : "date",
  multipleStatements: true,
  supportBigNumbers : true
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
      token : 'some token'
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
  handleReq(res,j){
    //console.log('root recieved: ',j);
    if (j.req == 'fetchRepo'){
      this.fetchRepo(j,res);
      return true;
    }
    if (j.req == 'storeRepo'){
      this.storeRepo(j,res);
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
  handleReply(j){
    //console.log('\n====================\nXXXshardCell reply handler',j);
  }
  handleBCast(j){
    //console.log('bcast received: ',j);
    if (!j.msg.to) {return;}
    if (j.msg.to == 'ftreeCells'){
      if (j.msg.req){
        if (j.msg.req == 'sendActiveRepo')
          this.doSendActiveRepo(j.msg,j.remIp);
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
             req : 'activeRepoIP',
             repo : repo
           }
           //console.log('sending activeRepoResult :',qres);
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
      var repoID = await this.receptor.getRepoID(repo);
      var SQL = "update `ftreeFileMgr`.`tblRepo` " +
      "set repoSignature = '"+repo.data.repoSignature+"',repoHash = '"+repo.data.repoHash+"',repoLastUpdate='"+repo.data.repoLastUpdate+
      "' where repoID = "+repoID;
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
    var SQL = "select repoID from ftreeFileMgr.tblRepo where repoOwner = '"+j.repoOwner+"' && repoName = '"+j.repoName+"'";

    con.query(SQL , async(err, result,fields)=>{
      if (err){
        console.log(err);
        var qres = {
          reply : 'repoStoreRes',
          result : false,
          error : err,
          repoID : null
        }
        this.net.sendReply(remIp,qres);
        return null;
      }
      else {
        var repoID = null;
        if (result.length == 0){
          repoID = await this.createNewRepo(j.repo);
          console.log('New Repo Created:',repoID);
          if (!repoID){
            var qres = {
              reply : 'repoStoreRes',
              result : false,
              error : "failed to create new repo record for repoOwner",
              repoID : null
            }
            this.net.sendReply(remIp,qres);
            return null;
          }
          else {
            var qres = {
              reply : 'repoStoreRes',
              result : true,
              repoID : repoID
            }
            console.log('sending storeRepo:'+remIp,qres);
            this.net.sendReply(remIp,qres);
          }
        }
        else {
          var qres = {
            reply : 'repoStoreRes',
            result : false,
            error : 'Something Fishy Happend',
            repoID : repoID
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
    var SQL = "INSERT INTO `ftreeFileMgr`.`tblRepo` " +
      "(`repoName`,`repoPubKey`,`repoOwner`,`repoLastUpdate`,`repoSignature`,`repoHash`,`repoCopies`,`repoType`) " +
      "VALUES ('"+d.repoName+"','"+d.repoPubKey+"','"+d.repoOwner+"','"+d.repoLastUpdate+"','"+d.repoSignature+"','"+d.repoHash+"',"+d.repoCopies+
      ",'Public');" +
      "SELECT LAST_INSERT_ID()newRepoID;";
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
        to : 'ftreeCells',
        req : 'sendActiveRepo',
        repo : j.repo
      }

      this.net.broadcast(req);
      this.net.on('mkyReply', mkyReply = (r)=>{
        if (r.req == 'activeRepoIP'){
          console.log('mkyReply Active Repo is:',r);
          if (this.verifyActiveRepo(r)){
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
  verifyActiveRepo(r){
     console.log('verifyActiveRepo: ',r);
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
      const maxIP = j.repo.nCopys;
      var   IPs = [];
      const gtime = setTimeout( ()=>{
        console.log('Send Node List Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(IPs);
      },7*1000);

      var req = {
        to : 'ftreeCells',
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
  /****************************************************************************
  Peer To Peer Requests:
  =============================================================================
  */
  receptorReqUpdateRepoInsertFile(j,toIp){
    //console.log('receptorReqCreateRepo',j);
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
        if (r.req = 'updateRepoInsertFileResult' && r.remIp == toIp){
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
        if (r.req = 'updateRepoDeleteFileResult' && r.remIp == toIp){
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
};
function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

module.exports.ftreeFileMgrObj = ftreeFileMgrObj;
module.exports.ftreeFileMgrCellReceptor = ftreeFileMgrCellReceptor;
