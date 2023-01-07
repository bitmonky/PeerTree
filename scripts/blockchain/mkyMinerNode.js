/*
Dust Removed: Date: Dec 28, 2022
*/

const fs = require('fs');
const crypto = require('crypto');
const mkyPubKey = '04a5dc8478989c0122c3eb6750c08039a91abf175c458ff5d64dbf448df8f1ba6ac4a6839e5cb0c9c711b15e85dae98f04697e4126186c4eab425064a97910dedc';

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};
const {MkyWallet}     = require('./mkyWallet');
var   {MkyBlock}      = require('./mkyBlock');
const {MkyNetObj}     = require('./peerTree');
const {BranchList}    = require('./mkyBranchList.js');
const {MkyWebConsole} = require('./networkWebConsole.js');

const isRoot = process.argv[3];
var isMining = null;

class MkyMiner {
  constructor(){
     this.net          = new MkyNetObj(options); 
     this.net.nodeType = 'Block Miner';
     this.wcon         = new MkyWebConsole(this.net);
     this.block        = null;
     this.myBranch     = null;
     this.myBranchIp   = null;
     this.setUpMiner(); 
   }       
   async setUpMiner(){
    await this.net.netStarted();

    this.net.on('mkyReq', (res,j)=>{
       this.handleReq(res,j)
     });
     this.net.on('bcastMsg',j =>{
       if(j.msg.to == 'miners')
         if (j.msg.stop)
           this.stopMining(j.msg.block);
     });
     this.net.on('mkyReply', j =>{   
       //console.log('!!!!!!!!!!!!!!!!!mkyReply ->',j);
       if (j.bInfo)
         if (j.bInfo.difficulty){
           this.mineBlock(j);
         }
     });
     this.banks  = new BranchList(this.net);
     this.banks.getBranchList();
     const jbranch   = await this.banks.tryJoin();
     this.myBranch   = jbranch.id;
     this.myBranchIp = jbranch.ip;

     this.wallet = new MkyWallet(this.myBranch,this.myBranchIp,'miner');
     this.mine();

   }
   handleReq(res,j){
    //console.log('\n======================++++\nstart MINER REQ HANDLER',j);
    if (j.bankResult){
      if (j.bankResult.newWallet){
        this.updateWalletInfo(j);
      }
      this.net.endRes(res,'');
      return;
    } 
    if (this.banks.handleReq(res,j))
      return;
    
    //this.net.endRes(res,'No Miner Request Handler Found For: ' +j);
  }
  updateWalletInfo(j){
    this.wallet.branchWalID = j.bankResult.newWallet;
    this.wallet.status = 'registered';
    console.log('Thanks wallet registered',this.wallet.status);
  }
  mine(){
    const miner = this;
    if (miner.wallet.status != 'registered' )
      this.reqBankAccount();
    else {
      if(!this.block)
        this.getNewBlock();
      else
        if(!this.block.isMining)
          this.getNewBlock();
    }  
    var t = setTimeout(function (){
      miner.mine();
    },5*1351);
  }
  reqBankAccount(){
    var branch = this.banks.pickOne();
    this.myBranch   = branch.ip;
    this.myBranchID = branch.id;
    this.wallet.branchIp = branch.ip;
    this.wallet.branchID = branch.id;
    //this.wallet.openWallet();
    var breq = {
      to : 'bankers',
      branch : 2,
      createAcc : {
        pubKey    : this.wallet.publicKey,
        MUID      : this.wallet.branchMUID
      }
    }
    console.log('reqBankAcc',branch);
    this.net.broadcast(breq);
  }
  getNewBlock(){
    var req = {
      req : 'sendBlock'
    }
    const bank = this.banks.pickOne().ip;
    console.log('check for block to mine..',bank);
 
    this.net.sendMsg(this.banks.pickOne().ip,req);

  }
  mineBlock(j){
    console.log('Start Mining Block: ',j.bInfo);
    this.block = new MkyBlock(Date.now(),j.bInfo.number,j.trans,j.bInfo.prevHash,this.net,j.bInfo.branchId,j.bInfo.type);
    console.log(this.block.isMining);
    this.block.mineBlock(j.bInfo.difficulty,this.wallet,''+j.bInfo.goldRate);     
  }
  stopMining(block){
   //console.log('stop mining',block);
    if (!this.block) return;
    if (this.block.blockID !== block.blockID)
      return;
    if (this.block.checkSolution(block.diff,block.nonce,block.timestamp,block.hash))
      this.block.stopMining = true;
  }
}
/*******************
Create PeerTree Network Peer
*******************
*/
console.log('starting miner rig');
var miner = new MkyMiner();
