/*
Dust Removed: Date: Dec 28, 2022
*/

const crypto = require('crypto');
const mkyPubKey = '04a5dc8478989c0122c3eb6750c08039a91abf175c458ff5d64dbf448df8f1ba6ac4a6839e5cb0c9c711b15e85dae98f04697e4126186c4eab425064a97910dedc';

class MkyBlock {
  constructor(timestamp, blockID, newBlock, previousHash,network,branchId,btype,chainId=null) {
    if (btype == 'tblGoldTrans') chainId = 1;
    this.goldRate = '0.0';
    this.net = network;
    this.branchId = branchId;
    this.type = btype;
    this.chainId = chainId
    this.previousHash = previousHash;
    this.timestamp = timestamp;
    this.blockID = blockID;
    if (newBlock){
      this.firstRec = newBlock[0];
      this.lastRec  = newBlock[newBlock.length -1]; 
    }
    this.transactions = newBlock;
    this.nonce = 0;
    this.hash = "";
    this.isMining = false;
    this.MUID;
    this.stopMining = null;
  }
  async calculateHash() {
    var data = this.previousHash + this.timestamp + JSON.stringify(this.transactions) + this.nonce + mkyPubKey;
    var hash = crypto.createHash('sha256').update(data).digest('hex');
    return hash;
  }
  minerReward(){
    return '50.000000000';
  }
  maxBlockSize(qsize,cmax){
    const def = 50;
    if (!cmax)
      return def;
    if (qsize > cmax + cmax *.1)
      return Math.floor(cmax + cmax * .1);
    return cmax;
  }
  async mineBlock(difficulty,wallet,goldRate) {
    this.isMining = true;
    this.goldRate = goldRate;
    this.stopMining = false;
    this.wallet = wallet;
    this.MUID = wallet.branchMUID;
    var msg = "Mining New Block... ";
    msg = msg + " Block Number: " + this.blockID;
    msg = msg + " Difficulty Level: " + difficulty;
    msg = msg + " ";
    msg = msg + " ";
   //console.log(msg);
    this.repeatHash(difficulty);
  }
  checkSolution(difficulty,nonce,timestamp,chkHash){
    var data = this.previousHash + timestamp + JSON.stringify(this.transactions) + nonce + mkyPubKey;
    var hash = crypto.createHash('sha256').update(data).digest('hex');
    if (hash == chkHash && chkHash.substring(0, difficulty) == Array(difficulty + 1).join('0'))
      return true;
    return false;
  }
  async repeatHash(difficulty){
    if (!this.stopMining && this.hash.substring(0, difficulty) !== Array(difficulty + 1).join('0')) {
      this.nonce = Math.floor(Math.random() * Math.floor(9999999999999));
      this.hash = await this.calculateHash();
      //console.log(difficulty+':'+this.nonce+'-'+ this.blockID,this.hash);
      var timeout = setTimeout( ()=>{this.repeatHash(difficulty);},1);
    }
    else {
      if (!this.stopMining){
        var breq = {
          to      : 'bankers',
          branch  : 2,
          MUID    : this.MUID,
          payment : this.wallet.makePaymentRec(this.minerReward(),'BMiner Reward',''+this.goldRate,this.blockID,this.type),
          blockConf : {
            nonce    : this.nonce,
            hash      : this.hash,
            diff      : difficulty,
            blockID   : this.blockID,
            timestamp : this.timestamp,
            branch    : this.branchId,
            type      : this.type,
            date      : Date.now(),
            firstRec  : this.firstRec,
            lastRec   : this.lastRec
          }
        }
       //console.log('block minded info: ',breq);
        this.net.broadcast(breq);
      }
      this.stopMining = false;
      this.isMining = false;
     //console.log('Final Hash: '+this.hash);
    } 
  }
  hasValidTransactions() {
    return true;
    for (const tx of this.transactions) {
      if (!tx.isValid()) {
        return false;
      }
    }
    return true;
  }
}
module.exports.MkyBlock = MkyBlock;

