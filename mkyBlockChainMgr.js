const EC           = require('elliptic').ec;
const ec           = new EC('secp256k1');
const crypto       = require('crypto');
const {MkyBlock}   = require('./mkyBlock');
const mkyPubKey    = '04a5dc8478989c0122c3eb6750c08039a91abf175c458ff5d64dbf448df8f1ba6ac4a6839e5cb0c9c711b15e85dae98f04697e4126186c4eab425064a97910dedc';
const hRateTicks   = 14;

class RegTransaction{
  constructor(tran,db,sig,bctr,maxBSize,blockID){
    this.tran = tran;
    this.db   = db;
    this.sig  = sig;
    this.bctr = bctr;
    this.maxBlockSize = maxBSize;
    this.blockId = blockID;
  }
  calculateHash() {
    return crypto.createHash('sha256').update(JSON.stringify(this.tran)).digest('hex');
  }
  saveTransaction(){
    var gtrnBlockID = null;
    if (this.bctr){
      /* increment block counter and save */
      console.log(this.bctr);
      gtrnBlockID = this.bctr.nbr;
      this.bctr.nRec++;
      if (this.bctr.nRec >= this.maxBlockSize){
        this.bctr.nRec = 0;
        this.bctr.nbr++;
      }
    }
    else 
      gtrnBlockID = this.blockId;

    const tran    = this.tran;
    const sig     = this.sig;

    var SQL = "Select count(*)nRec from tblGoldTrans where gtrnSyncKey = '"+tran.syncKey+"'";
    var db = this.db
    this.db.query(SQL, function (err, result, fields) {
      if (err)console.log(err);
      else {
        if (result[0].nRec == 0){
          SQL = "insert into tblGoldTrans (gtrnAmount,gtrnGoldType,gtrnSource,gtrnSrcID,gtrnTycTax,gtrnTaxHold,gtrnCityID,gtrnGoldRate,gtrnMUID,";
          SQL += "gtrnSyncKey,gtrnSignature,gtrnDate,gtrnQApp) ";
          SQL += "values ("+tran.gtlAmount+",'"+tran.gtlGoldType+"','"+tran.gtlSource+"',"+tran.gtlSrcID+",";
          SQL += tran.gtlTycTax+","+tran.gtlTaxHold+","+tran.gtlCityID+","+tran.gtlGoldRate+",'"+tran.gtlMUID+"',";
          SQL += "'"+tran.syncKey+"','"+sig+"','"+tran.gtlDate+"','"+tran.gtlQApp+"')";
          db.query(SQL, function (err, result, fields) {
            if (err){console.log(err);}
          });
        }
      }
    });
  }
  getWalletPubKey(){
    const tran = this.tran;
    return new Promise( (resolve,reject)=>{
      const SQL = "select mwalPubKey from tblmkyWallets where mwalMUID = '"+tran.gtlMUID+"'";
      this.db.query(SQL, function (err, result, fields) {
        if (err) {console.log(err);resolve(null);}
        else {
          if (result.length == 0){
            resolve(mkyPubKey);
          }
          else {
           //console.log('Public Key For Wallet Found For Tran Verify');
            resolve(result[0].mwalPubKey);
          }
        }
      });

    });
  }
  async confirmAndSave() {
    if (!this.tran.gtlMUID){
     //console.log('RegTransaction :No Wallet MUID in this transaction',this.tran);
      //process.exit();
      return;
    }
    if (!this.sig || this.sig.length === 0) {
     //console.log ('No signature in this transaction');
      return;
    }
    const wKey = await this.getWalletPubKey();
  
    if (!wKey){
     //console.log ('Empty Wallet Public Key Found.'); 
      return;
    }
    const publicKey = ec.keyFromPublic(wKey, 'hex');
    if (publicKey.verify(this.calculateHash(), this.sig)){
      this.saveTransaction();
    }
    else {
      //console.log('BlockChain: Trans verification Fail... transaction dropped.',this.tran);
      //console.log('BlockChain: signature tried',this.sig);
      //console.log('wpubkey',wKey);
      this.saveTransaction();
    } 
  }
}
class MkyChainsMgr {
   constructor(root){
     this.nodes = [];
     this.root  = root;
   }
   update(c){
     var node = {
       chainId : c.id,
       type    : c.type,
       hash    : c.hash,
       host    : c.host,
       height  : c.height,
       nMatches: 1
     }
     var breakFor = {};
     try {
       this.nodes.forEach( (n)=>{
         if (n.hash == c.hash && n.chainId == c.id && n.height == c.height){
           nMatches++;
           throw breakFor;
         }
       });
       this.nodes.push(node);
     }
     catch(e){}
     this.list();
   }
   kill(c){
     this.nodes.forEach( (n, index, object)=>{
       if (n.host == c.host){
         object.splice(index,1)
       }
     });
   }
   bestHost(chainId){
     var max = 0;
     var hosts = []; 
     this.nodes.forEach( (n, index, object)=>{
       if (n.chainId == chainId){
         if (n.nMatches > max){
           max = n.nMatches;
         }
       }
     });
     console.log('BestHost Max: ',max);
     this.nodes.forEach( (n, index, object)=>{
       if (n.nMatches == max){
         hosts.push(n.host);
       }
     });
     max = hosts.length;
     if(!max)
       return this.root;
     const n = Math.floor(Math.random() * Math.floor(max));
     return hosts[n];
   }
   list(){
    //console.log('\n***********************\nBlock Chain Status Report ');
    //console.log('Best Host Chain 1: ',this.bestHost(1));
     this.nodes.forEach( (n)=>{
       //console.log(n);
     });
   }
}
class MkyBlockChainMgr{
  constructor(bank,db){
    this.bank   = bank;
    this.db     = db;
    this.chains = null;
    this.bcount = 1;
    this.chainId = 0;
    this.type   = null;
    this.chainHeights = [];
    this.chainMgr = new MkyChainsMgr(this.bank.net.getNetRootIp());
    this.hrTicker      = 1;
    this.confWallets   = false;
    this.confBCs       = false;
    this.confTrans     = false;
    this.hashRate      = 60.0;
    this.calBlockID    = null;
    this.startBlockReq = null;
    this.vfchain       = null;
    this.init();
  }
  async init(){
    this.chainCtr = [];
    this.chains   = await this.getChainList();
    console.log(this.chainCtr);
    this.reportChainList();
    //await this.verifyFullChain('tblGoldTranLog',1);
    await this.zeroTransactionPool();
    this.type     = this.chains[this.chainId].bchaSrcTable;
    this.bcount   = await this.getChainHeight(this.type);
    this.lastTran = await this.getLastTransaction();
    this.lastWal  = ''; //await this.getLastWallet();
    console.log('bcount starting at: ',this.bcount);
    console.log('Branch BlockChains',this.chains.length);
    console.log('Last Transaction Time',this.lastTran);
    this.syncChains();
    this.status();
  }
  reqBankAccount(){
    this.bank.bankWallet.openWallet();
    var breq = {
      to : 'bankers',
      branch : 2,
      createAcc : {
        pubKey    : this.bank.bankWallet.publicKey,
        MUID      : this.bank.bankWallet.branchMUID
      }
    } 
    console.log('bcast wallet account req: ',breq);
    this.bank.net.broadcast(breq);
    this.bank.createAccount(this.bank.bankWallet.publicKey,this.bank.bankWallet.branchMUID,this.bank.net.rnet.myIp);
    this.bank.bankWallet.status = 'registered';
  }
  async syncChains(){
    this.type = this.chains[this.chainId].bchaSrcTable;
    const chain = this;
    var pollTime = .5;
    if (chain.bank.bankWallet.status != 'registered')
      this.reqBankAccount();
    else {
      if (this.bank.isRoot && this.bank.status != 'rebuilding database'){
        this.bank.status = 'Online';
        this.bank.group.changeMyStatus('Online');
        return;
      }

      if(this.bank.status == 'starting'){
        //console.log('Startup Verifying Block Chains');
        if (!this.confWallets)
          this.requestWallets();
        else {
          if (!this.confBCs){
            this.requestChainHeight(this.type,this.bcount);
            if (!this.vfchain)
              this.requestBlock(this.type,this.bcount +1);
          }  
          else {
            this.requestTrans();
            return;
          }
        }
      }
    }
    var t = setTimeout(function (){
      if(chain.bank.status != 'Online')
        chain.syncChains();
    },Math.floor(pollTime*1351));
  }
  handleReq(res,j){
    //this.bank.net.endRes(res,'');
    return false;
  }
  getNextChain(){
    return new Promise( async (resolve)=>{
      console.log('getNextChain starting',this.chainId);
      await this.verifyFullChain(this.type,this.chainId);
      this.chainId = this.chainId +1;
      if (this.chainId > 4){
        this.chainId = 0;
        this.confBCs = true;
        console.log('\n\nConfBCs complete!...');
  
        this.bank.maxBlockSize = await this.getMaxBlockSize('tblGoldTranLog');
        this.bank.status='Online';
        this.bank.group.changeMyStatus('Online');
        resolve(true);
        return;
      }
      console.log('getting next chain',this.chainId);
      this.type = this.chains[this.chainId].bchaSrcTable;
      console.log('chain type is now',this.type);
      this.bcount = await this.getChainHeight(this.type); 
      console.log('this.bcount',this.bcount);
      resolve(true);
    });
  }
  getMaxBlockSize(type){
    return new Promise( (resolve,reject)=>{
      const SQL = "select bchaMaxBlockSize from mkyBlockC.tblmkyBlockChain where bchaSrcTable  = '"+type+"'";
      this.db.query(SQL, (err, result, fields)=>{
        if (err) {console.log(err);resolve(this.bank.maxBlockSize);}
        else {
          if (result.length == 0){
            resolve(result[0].bchaMaxBlockSize);
          }
          else {
            console.log('No Max Block Size Record Found... using default');
            resolve(this.bank.maxBlockSize);
          }
        }
      });
    });
  }
  async verifyFullChain(ctype,cid){
    var bank = this.bank;
    console.log('setting sdfdfd this.vfchain to true from ',this.vfchain);
    this.vfchain = true;

    return new Promise( async (resolve,reject)=>{
      console.log('\nVERIFY CHAIN '+cid,ctype);
      var branchId = this.bank.branchId;
      var nblocks = await this.getChainHeight(ctype);
      console.log('nblocks',nblocks);
      var tbl = this.type;
      for (var nblock = this.chainCtr[cid] +1; nblock <= nblocks;nblock++){
        var SQL = "select blockHash,blockPrevHash,blockNOnce,blockTimestamp,blockDifficulty,tranBlockData from mkyBlockC.tblmkyBlocks ";
        SQL += "inner join mkyBlockC.tblmkyBlockTrans on tranBlockChainID = blockChainID and tranBlockID = blockNbr ";
        SQL += "where tranBlockID = "+nblock;
        await this.verifyBlock(SQL,ctype,nblock,branchId,cid);
      }
      this.chainCtr[cid] = nblock;
      if (cid < 2){
        if (this.chainCtr[0] < this.chainCtr[1])
          this.chainCtr[0] = this.chainCtr[1];
        else
          this.chainCtr[1] = this.chainCtr[0];
      }
      console.log('Blocks Verified: '+nblock+' cid: '+cid,this.chainCtr);
      resolve('ok')
      this.vfchain = false;
    });
  }
  verifyBlock(SQL,ctype,nblock,branchId,cid,rebuild=null){
    const chain = this;
    //console.log('verify block:'+rebuild,nblock);
    return new Promise( (resolve,reject)=>{
      chain.db.query(SQL ,async (err, result,fields)=>{
        if (err){console.log(err);resolve(false) }
        else {
          if (result.length == 0){
           //console.log('no blocks to verify');
            resolve(false);
          } 
          else {
            var rec = result[0];
            var trans = JSON.parse(rec.tranBlockData);

            var prevHash = await chain.bank.getBlockPreviousHash(nblock -1);
            var vBlock = new MkyBlock(rec.blockTimestamp, nblock, trans, prevHash,null,branchId,ctype,cid);
            if (vBlock.checkSolution(rec.blockDifficulty,rec.blockNOnce,rec.blockTimestamp,rec.blockHash)){
              //console.log('block '+nblock+' for '+ctype+' verified!');
              if (rebuild){
                const bInfo = {
                  blockNbr   : rec.blockNbr,
                  blockID    : rec.blockNbr,
                  type       : ctype,
                  trans      : trans,
                  nonce      : rec.blockNOnce,
                  hash       : rec.blockHash,
                  prevHash   : rec.blockPrevHash,
                  timestamp  : rec.blockTimestamp,
                  branchId   : rec.bchaBranchID,
                  minerId    : rec.blockMinerID,
                  diff       : rec.blockDifficulty,
                  hrTicker   : this.hrTicker,
                  hashTime   : rec.blockHashTime
                }
                await this.pushBlock(bInfo,ctype,rebuild);
              }
              resolve('ok');
            }
            else {
             //console.log('block '+nblock+' for '+ctype+' verify FAILED!');
              process.exit();
            }
          }
        }
      });
    });
  }

  async handleReply(j){  
    if (j.bInfo){
      console.log('got bInfo',j.bInfo);
      if (!j.bInfo.blockNbr){
        console.log('End of Chain: ',this.bank.status);
        this.startBlockReq = false;
        if (this.chainId == this.chains.length -1){
          console.log('End of chain list');
          if (!this.confTrans){
            this.bank.status = 'Sync Transactions';
            this.requestTrans();
          }
          else{  
            this.bank.status = 'Online';
            this.bank.group.changeMyStatus('Online');
            this.bcount = 1;
            this.chainId = 0;
          }
        }
        else {
          console.log('fetchin next chain');
          await this.getNextChain();
        }
        return true;
      }
      else {
        this.pushBlock(j.bInfo,this.type);
        if (this.type == 'tblGoldTrans' || this.type == 'tblGoldTranLog')
          this.hrTicker = j.bInfo.hrTicker;
        return true;
      }
    }
    if (j.rqChainHeight){
      this.pushChainHeight(j);
      return true;
    }
    if (j.bLastWallets) {
     //console.log('here are your wallets',j.bLastWallets);
      this.pushLastWallet(j.bLastWallets);
      return true;
    }
    if (j.hrTicker){
      if (j.type == 'tblGoldTrans' || j.type == 'tblGoldTranLog')
        this.hrTicker = j.hrTicker;
      return true;      
    }
    if (j.bLastTrans) {
      this.pushLastTrans(j.bLastTrans);
      return true;
    }
    if (j.result == 'No Transactions To Send Right Now.'){
      console.log(j.result);
      if (this.chainId == this.chains.length -1){
       //console.log('returning status to Online');
        this.bank.status = 'Online';
        this.bank.group.changeMyStatus('Online');
      }
      else
         await this.getNextChain();
      //console.log(j.result);
      return true;
    }
    //console.log ('no chain reply handler: ');
    return false;
  }
  getChainsHeight(type){
    for ( var chain of this.chainHeights){
      if (chain.type == type)
        return chain.height;
    }
    return null;
  }
  pushChainHeight(j){
    const ch = {
      type  : j.forType,
      height: j.rqChainHeight,
      hash  : j.rqChainHash,    
      id    : j.chainId,
      host  : j.host
    }
    console.log('pushing Chain height',ch); 
    this.chainHeights.forEach( (chain)=>{
      if (chain.type == ch.type && chain.host == ch.host){
        chain.height = ch.height;
        chain.hash   = ch.hash;
        this.chainMgr.update(ch);
        return;
      }
    }); 
    //console.log('pushing chain height:',ch);
    this.chainHeights.push(ch);
    this.chainMgr.update(ch);
  }
  async pushLastWallet(wallets){
   //console.log('syncing wallet file',wallets.length);
    const db = this.db;
    for (var wal of wallets){
      var wsave = await this.saveWallet(wal);
      this.lastWal =  wal.mwalMUID;
    }
    this.confWallets = true;
  }
  saveWallet(wal){
    return new Promise( (resolve,reject)=>{
      let SQL = "select count(*)nRec from tblmkyWallets where mwalMUID = '"+wal.mwalMUID+"'";
      const db = this.db;
      this.db.query(SQL, function (err, result, fields) {
        if (err)console.log(err),reject(err);
        else {
          if (result[0].nRec == 0){
            SQL = "insert into tblmkyWallets (mwalPubKey,mwalGBranchID,mwalDate,mwalMUID) ";
            SQL += "values('" + wal.mwalPubKey + "'," + wal.mwalGBranchID + ",'"+wal.mwalDate+"','" + wal.mwalMUID + "')";
            db.query(SQL, function (err, result, fields) {
              if (err) {console.log(err); reject(err);}
              resolve(true);
            });
          }
          else {
            resolve(false);
          }
        }
      });
    });
  }
  async pushLastTrans(trans){
    console.log('synchronising transaction file');
    var n = 0;
    for (var tran of trans){
      var trand = {
        gtlDate     : tran.gtrnDate,
        gtlGoldType : tran.gtrnGoldType,
        gtlSource   : tran.gtrnSource,
        gtlSrcID    : tran.gtrnSrcID,
        gtlTycTax   : tran.gtrnTycTax,
        gtlAmount   : tran.gtrnAmount,
        gtlCityID   : tran.gtrnCityID,
        gtlTaxHold  : tran.gtrnTaxHold,
        gtlGoldRate : tran.gtrnGoldRate,
        syncKey     : tran.gtrnSyncKey,
        gtlQApp     : tran.gtrnQApp,
        gtlMUID     : tran.gtrnMUID
      }
      var sig = tran.gtrnSignature;
      var blockId = tran.gtrnBlockID;
      var conf = new RegTransaction(trand,this.db,sig,null,null,blockId);
      await conf.confirmAndSave();
      this.lastTran =  {
        date : tran.gtrnDate,
        key  : tran.gtrnSyncKey
      }
      n++;
    }
    console.log('transactions sync complete');
    await this.bank.resetBlockCtrs();
    this.confTrans = true;
    this.confBCs   = true;
    this.bank.status = 'Online';
    this.requestMissingTransactions();
    this.bank.group.changeMyStatus('Online');
    this.bank.flushTranBuffer();

    console.log('tblGoldTran Syncronized:'+n+' records added');
  }
  async pushMissingTrans(trans){
   //console.log('syncing transaction file');
    var n = 0;
    for (var tran of trans){
      var trand = {
        gtlDate     : tran.gtrnDate,
        gtlGoldType : tran.gtrnGoldType,
        gtlSource   : tran.gtrnSource,
        gtlSrcID    : tran.gtrnSrcID,
        gtlTycTax   : tran.gtrnTycTax,
        gtlAmount   : tran.gtrnAmount,
        gtlCityID   : tran.gtrnCityID,
        gtlTaxHold  : tran.gtrnTaxHold,
        gtlGoldRate : tran.gtrnGoldRate,
        syncKey     : tran.gtrnSyncKey,
        gtlQApp     : tran.gtrnQApp,
        gtlMUID     : tran.gtrnMUID
      }
      var sig = tran.gtrnSignature;
      var blockId = tran.gtrnBlockID;
      var conf = new RegTransaction(trand,this.db,sig,null,null,blockId);
      await conf.confirmAndSave();
      this.lastTran =  {
        date : tran.gtrnDate,
        key  : tran.gtrnSyncKey
      }
      n++;
    }
/*
    await this.bank.resetBlockCtrs();
    this.confTrans = true;
    this.confBCs   = true;
    this.bank.status = 'Online';
    this.bank.group.changeMyStatus('Online');
    this.bank.flushTranBuffer();
*/
  }
  pushBlock(conf,type,rebuild=null){
    return new Promise( async (resolve,reject)=>{
      console.log('pushing block'+conf.blockNbr);
      const transStr = JSON.stringify(conf.trans);

      var chainHeight  = await this.getChainHeight(type);
      var targetHeight = this.getChainsHeight(type)

      if (targetHeight < chainHeight)
        targetHeight = chainHeight;
    
      if (chainHeight > 0 &&  conf.blockNbr > targetHeight +1){
        console.log('chainHeight ',chainHeight);
        console.log('conf.blockNbr',conf.blockNbr);
        console.log('targetHeight',targetHeight);
/*      this.startBlockReq = false;
        resolve(false);
        return;
*/
      }

      //console.log ('updating chain '+type+' from network',this.bank.isRoot);
      if (this.bank.isRoot && !rebuild){
       //console.log('Banker Is Root');
        this.bank.status = 'Online';
        this.bank.group.changeMyStatus('Online');
        this.startBlockReq = false;
        resolve(false);
        return;
      }
      const bank = this.bank;
      conf.type = type;
      var prevHash       = await bank.getBlockPreviousHash(conf.blockNbr -1);
      var chainId        = await bank.getBlockChainId(conf.type);
      var block          = new MkyBlock(conf.timestamp,conf.blockNbr,conf.trans,prevHash,null,conf.branchId,conf.type,chainId);
      block.previousHash = prevHash;
      block.timestamp    = conf.timestamp;
      var minerID        = 0;

      if (block.checkSolution(conf.diff,conf.nonce,conf.timestamp,conf.hash)){
        conf.chainId = chainId;
        //const transStr = JSON.stringify(conf.trans);

        if (rebuild){ 
          //var res = await bank.storeBlockTransData(transStr,conf.blockID,conf.chainId);
          var res = await this.storeBlockToTranLog(transStr);
          await this.setChainDifficulty(conf.diff,conf.type)
        }
        else {
          var sres = await this.storeBlockChainRec(conf,transStr,prevHash,conf.minerId);
          if (sres){
            console.log('Sync block confirmed!');
          }
          else {
            console.log('sync data error saving to database');
          }
        }
      }
      else {
        console.log('Sync block confirmatin FAIL');
      }
      this.bcount = this.bcount +1;
      this.startBlockReq = false;
      resolve(true);
    });
  }
  addTranLogRec(rec){
    var bank = this.bank;
    var db   = this.db
    return new Promise( (resolve,reject)=>{
      var SQL = "select count(*)nBlocks from mkyBank.tblGoldTranLog where syncKey = '"+rec.syncKey+"'";
      db.query(SQL, async function (err, result, fields) {
        if (err) {console.log(err);reject(false);}
        else {
          var tRec = result[0];
          if (tRec.nBlocks == 0){
            SQL = "insert into tblGoldTranLog (gtlDate,gtlGoldType,gtlSource,gtlSrcID,gtlTycTax,gtlAmount,gtlCityID ";
            SQL += ",gtlTaxHold,gtlGoldRate,syncKey,gtlQApp,gtlMUID,gtlBlockID,gtlSignature) ";
            SQL += "values ('"+rec.gtlDate+"','"+rec.gtlGoldType+"','"+rec.gtlSource+"',"+rec.gtlSrcID+","+rec.gtlTycTax+",";
            SQL += rec.gtlAmount+","+rec.gtlCityID+","+rec.gtlTaxHold+","+rec.gtlGoldRate+",'"+rec.syncKey;
            SQL += "','"+rec.gtlQApp+"','"+rec.gtlMUID+"',"+rec.gtlBlockID+",'"+rec.gtlSignature+"')";
            console.log(SQL.substr(0,60), rec.gtlBlockID);
            db.query(SQL, async function (err, result, fields) {
              if (err) {console.log(err);reject(false);}
              else {
                resolve(true);
              }
            });
          }
          else {
            SQL = "update tblGoldTranLog set gtlBlockID = "+rec.gtlBlockID+" where syncKey = '"+rec.syncKey+"'";
            db.query(SQL, async function (err, result, fields) {
              if (err) {console.log(err);reject(false);}
              else
                resolve(true);
            });
          }
        }
      });
    });
  }
  addGoldTransRec(rec){
    var bank = this.bank;
    var db   = this.db
    return new Promise( (resolve,reject)=>{
      var SQL = "select count(*)nBlocks from mkyBank.tblGoldTrans where gtrnSyncKey = '"+rec.syncKey+"'";
      db.query(SQL, async function (err, result, fields) {
        if (err) {console.log(err);reject(false);}
        else {
          var tRec = result[0];
          if (tRec.nBlocks == 0){
            SQL = "insert into mkyBank.tblGoldTrans (gtrnDate,gtrnGoldType,gtrnSource,gtrnSrcID,gtrnTycTax,gtrnAmount,gtrnCityID ";
            SQL += ",gtrnTaxHold,gtrnGoldRate,gtrnSyncKey,gtrnQApp,gtrnMUID,gtrnBlockID,gtrnSignature,gtrnBlockConfirmed) ";
            SQL += "values ('"+rec.gtlDate+"','"+rec.gtlGoldType+"','"+rec.gtlSource+"',"+rec.gtlSrcID+","+rec.gtlTycTax+",";
            SQL += rec.gtlAmount+","+rec.gtlCityID+","+rec.gtlTaxHold+","+rec.gtlGoldRate+",'"+rec.syncKey;
            SQL += "','"+rec.gtlQApp+"','"+rec.gtlMUID+"',"+rec.gtlBlockID+",'"+rec.gtlSignature+"',now())";
            console.log(SQL.substr(0,60), rec.gtlBlockID);
            db.query(SQL, async function (err, result, fields) {
              if (err) {console.log(err);reject(false);}
              else {
                resolve(true);
              }
            });
          }
          else {
            SQL = "update tblGoldTrans set gtrnBlockID = "+rec.gtlBlockID+" where gtrnSyncKey = '"+rec.syncKey+"'"; 
            db.query(SQL, async function (err, result, fields) {
              if (err) {console.log(err);reject(false);}
              else 
                resolve(true);
            });
          }
        }
      });
    });
  }
  storeBlockToTranLog(trans){
    return new Promise( async (resolve,reject)=>{
      trans = JSON.parse(trans);

      var result = false;
      for (var rec of trans){
        if (!this.bank.isToday(rec.gtlDate))
          result = await this.addTranLogRec(rec);
        else
          result = await this.addGoldTransRec(rec);
      }
      resolve(result);
      return;
    }); 
  }
  storeBlockChainRec(conf,trans,prevHash,minerID){
    //console.log(conf);

    var bank  = this.bank;
    var db    = this.db;
    var chain = this;
    return new Promise( (resolve,reject)=>{
      var SQL = "select count(*)nBlocks from mkyBlockC.tblmkyBlocks where blockChainID = "+conf.chainId+" and blockNbr = "+conf.blockID;
      db.query(SQL, async function (err, result, fields) {
        if (err) {console.log(err);reject(false);}
        else {
          var tRec = result[0];
          if (tRec.nBlocks == 0){
            SQL = "insert into mkyBlockC.tblmkyBlocks (blockNbr,blockHash,blockPrevHash,blockNOnce,blockTimestamp,blockChainID,";
            SQL += "blockMinerID,blockDifficulty,blockHashTime) ";
            SQL += "values ("+conf.blockID+",'"+conf.hash+"','"+prevHash+"',"+conf.nonce+","+conf.timestamp+","+conf.chainId+","+minerID;
            SQL += ","+conf.diff+","+conf.hashTime+")";
            db.query(SQL, async function (err, result, fields) {
              if (err) {console.log(err);reject(false);}
              else {
                var res = await bank.storeBlockTransData(trans,conf.blockID,conf.chainId);
                var res = chain.storeBlockToTranLog(trans);
                await chain.setChainDifficulty(conf.diff,conf.type)
                resolve(res);
              }
            });
          }
          else {
           //console.log('Block Already Exists');
            resolve(true);
          }
        }
      });
    });
  }
  reportChainList(){
    for (var chain of this.chains){
     //console.log(chain.bchaSrcTable,chain.bchaID);
      this.requestChainHeight(chain.bchaSrcTable,1);
    }
  }
  getChainList(){
    return new Promise( (resolve,reject)=>{
      var SQL =  "select * from mkyBlockC.tblmkyBlockChain ";
      SQL += "order by bchaID ";
      this.db.query(SQL , (err, result,fields)=>{
        if (err){console.log(err); resolve(null) }
        else {
          var trans = [];
          const dbres = Object.keys(result);
          dbres.forEach( (key)=>{
            var tRec = result[key];
            trans.push(tRec);
            this.chainCtr.push(0); 
          });
          resolve(trans);
        }
      });
    });
  }
  async calibrateHashRate(type,blockID){
    console.log('Calibrate '+blockID,this.calBlockID);
    this.hrTicker++;
    if (this.hrTicker == hRateTicks)
      this.hrTicker = 1;

    if (this.calBlockID == blockID)
      return;
    this.calBlockID = blockID;
    if (type == 'tblGoldTrans')
      type = 'tblGoldTranLog';
    const hRate = await this.getChainHashRate(type)
    console.log('\n***********\nhash Rate check: ',hRate)
    if (this.hrTicker == 1){
      if ( hRate > 90)
        this.incChainDifficulty(-1,type);
      if ( hRate < 30)
        this.incChainDifficulty(1,type);
      return;
    }
  }
  setChainDifficulty(amt,type){
    return new Promise( (resolve,reject)=>{
      var search = " where bchaSrcTable = '"+type+"' ";
      if (type == 'tblGoldTranLog')
        search = " where (bchaSrcTable = 'tblGoldTranLog' or bchaSrcTable = 'tblGoldTrans') ";
      var SQL =  "update mkyBlockC.tblmkyBlockChain set bchaLastTick = "+this.hrTicker+",bchaDifficulty = "+amt;
      SQL += ",bchaMaxBlockSize = "+this.bank.maxBlockSize+" "+search;
      this.db.query(SQL , async function (err, result,fields) {
        if (err){console.log(err);resolve(false);}
        else
          resolve(true);
      });
    });
  }
  incChainDifficulty(amt,type){
    var search = " where bchaSrcTable = '"+type+"' ";
    if (type == 'tblGoldTranLog')
      search = " where (bchaSrcTable = 'tblGoldTranLog' or bchaSrcTable = 'tblGoldTrans') ";
    search += " and bchaDifficulty +1*("+amt+") > 2";
    var SQL =  "update mkyBlockC.tblmkyBlockChain set bchaDifficulty = bchaDifficulty + 1*("+amt+") "+search;
    //console.log('incrementing difficulty',SQL);
    this.db.query(SQL , async function (err, result,fields) {
      if (err){console.log(err);}
      else
        console.log(type+' Chain Difficulty changed by',amt);
    });
  }
  getChainHashRate(type){
    if (type == 'tblGoldTrans')
      type = 'tblGoldTranLog';
    return new Promise( (resolve,reject)=>{
      var SQL =  "SELECT blockTimestamp as blockHashTime FROM mkyBlockC.tblmkyBlocks ";
      SQL += "inner join mkyBlockC.tblmkyBlockChain on blockChainID = bchaID "
      SQL += "where NOT blockHashTime is null and bchaSrcTable = '"+type+"' ";
      SQL += "order by blockNbr desc limit "+hRateTicks;
      this.db.query(SQL , async function (err, result,fields) {
        if (err){console.log(err); throw err; }
        else
          if (result.length > 1){
            var trans = [];
            const dbres = Object.keys(result);
            dbres.forEach(function(key) {
              var tRec = result[key];
              trans.push(tRec);
            });
            const rate =( result[0].blockHashTime - result[result.length-1].blockHashTime)/(result.length -1);
            resolve (rate/1000);
          }
          else
            resolve(60.0);
      });
    });
  }
  getChainHeight(type){
    if (type == 'tblGoldTrans')
      type = 'tblGoldTranLog';
    return new Promise( (resolve,reject)=>{
      var SQL =  "select blockNbr from mkyBlockC.tblmkyBlocks ";
      SQL += "inner join mkyBlockC.tblmkyBlockChain on blockChainID = bchaID "
      SQL += "where bchaSrcTable = '"+type+"' ";
      SQL += "order by blockID desc limit 1";
      //console.log('chain height',SQL);  
      this.db.query(SQL , async function (err, result,fields) {
        if (err){console.log(err); throw err; }
        else
          if (result.length)
            resolve(result[0].blockNbr);
          else
            resolve(0);
      });
    });
  }
  getChainHash(type){
    return new Promise( (resolve,reject)=>{
      var SQL =  "select blockHash from mkyBlockC.tblmkyBlocks ";
      SQL += "inner join mkyBlockC.tblmkyBlockChain on blockChainID = bchaID "
      SQL += "where bchaSrcTable = '"+type+"' ";
      SQL += "order by blockID desc limit 1";

      this.db.query(SQL , async function (err, result,fields) {
        if (err){console.log(err); resolve(null); }
        else
          if (result.length)
            resolve(result[0].blockHash);
          else
            resolve(null);
      });
    });
  }
  status(){
    var mgr = this;
    //console.log('\nSevice Status: ',this.bank.isRoot);
    this.bank.banks.showStatus();
    for (var chain of this.chains){
      var SQL =  "select blockNbr from mkyBlockC.tblmkyBlocks ";
      SQL += "inner join mkyBlockC.tblmkyBlockChain on blockChainID = bchaID "
      SQL += "where bchaSrcTable = '"+chain.bchaSrcTable+"' ";
      SQL += "order by blockID desc limit 1";
      this.db.query(SQL , async function (err, result,fields) {
        if (err){console.log(err); }
        else
          if (result.length){
            //console.log('Block Chain '+chain.bchaSrcTable+ ' height = ',result[0].blockNbr);
          }
      });
    }
    var t = setTimeout(function (){
      mgr.status();
    },5*1351);
  }
  getLastWallet(){
    return new Promise( (resolve,reject)=>{
      var SQL =  "select mwalDate from tblmkyWallets ";
      SQL += "order by mwalMUID desc limit 1";
      this.db.query(SQL , async function (err, result,fields) {
        if (err){console.log(err); throw err; }
        else
          if (result.length)
            resolve(result[0].mwalMUID);
          else
            resolve(null);
      });
    });
  }
  async requestMissingTransactions(){
    const keys = await this.getTransSyncKeys();
    var to = this.chainMgr.bestHost(1);
    if (!to)
      return false;
    if (keys){
      var req = {
        req      : 'sendMissingTrans',
        keys     : keys
      }
      console.log('requesting Any Missing Transactions '+to,req);
      //this.bank.net.sendMsg(to,req);
      return true;
    }
    return false;
  }
  getTransSyncKeys(){
    var key = this.lastTran.date+this.lastTran.key;
    return new Promise( (resolve,reject)=>{
      var SQL =  "select gtrnSyncKey from tblGoldTrans where gtrnBlockID is null"; //concat(gtrnDate,gtrnSyncKey) < '"+key+"' ";
      this.db.query(SQL , async function (err, result,fields) {
        if (err){console.log(err); throw err; }
        else
          if (result.length)
            resolve(result);
          else
            resolve(null);
      });
    });
  }
  zeroTransactionPool(){
    return new Promise( (resolve,reject)=>{
      var SQL =  "delete from tblGoldTrans where gtrnBlockID is null";
      this.db.query(SQL , async function (err, result,fields) {
        if (err){console.log(err); resolve(false);}
        else
          resolve(true);
      });
    });
  }
  getLastTransaction(){
    return new Promise( (resolve,reject)=>{
      var SQL =  "select gtrnDate,gtrnSyncKey from tblGoldTrans ";
      SQL += "order by gtrnDate desc,gtrnSyncKey desc limit 1";
      this.db.query(SQL , async function (err, result,fields) {
        if (err){console.log(err); resolve({date : '',keys : ''});}
        else
          if (result.length)
            resolve({date : result[0].gtrnDate, key : result[0].gtrnSyncKey});
          else
            resolve({date : '',keys : ''});
      });
    });
  }
  requestWallets(){
    var to = this.chainMgr.bestHost(1);
    if (!to){ 
      console.log ('bestHost Missing');
      return false;
    }
    var req = {
      req  : 'sendWallets',
      lastWalMUID : this.lastWal
    }
    console.log('requesting wallets',req);
    console.log('send wallet req to',to);
    this.bank.net.sendMsg(to,req);
    return true;
  }
  async requestTrans(){
    var to = this.chainMgr.bestHost(1);
    if (!to)
      return false;
    var req = {
      req  : 'sendTrans',
      lastTimeStamp : this.lastTran
    }
    console.log('requesting block'+to,req);
    this.bank.net.sendMsg(to,req);
    this.requestLastTick();
    return true;
  }
  requestLastTick(){
    if (this.type != 'tblGoldTrans')
      return;
    var to = this.chainMgr.bestHost(1);
    if (!to)
      return false;
    var req = {
      req  : 'sendLastTick',
      type : this.type
    }
    console.log('requesting lastTick'+to,req);
    this.bank.net.sendMsg(to,req);
    return true;
  }
  async requestChainHeight(type,myHeight){
    if (myHeight == 0) myHeight = 1;
    //const chainId = await this.bank.getBlockChainId(type);
    //var to = this.bank.banks.pickOne();
    //if (!to)
    //  return myHeight;
    var req = {
      req      : 'sendChainHeight',
      type     : type,
      myHeight : myHeight
    }
   //console.log('requesting blockchain height',req);
    this.bank.group.msgGroup(req);
    return true;
  }
  async requestBlock(type,nbr){
    if (this.startBlockReq)
      return true;
    console.log('this.startBlockReq',this.startBlockReq);

    this.startBlockReq = true;
    const chainId = await this.bank.getBlockChainId(type);
    var to = this.chainMgr.bestHost(chainId);
    if (!to)
      return false;
    var req = {
      req      : 'sendBlockNbr',
      type     : type,
      blockNbr : nbr
    }
    console.log('requesting blocki: '+to,req);
    this.bank.net.sendMsg(to,req);
    return true;
  }
}

module.exports.MkyBlockChainMgr = MkyBlockChainMgr;
module.exports.RegTransaction = RegTransaction;
