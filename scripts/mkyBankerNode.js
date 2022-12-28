/*
Dust Removed: Date: Dec 28, 2022
*/

const fs = require('fs');

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};
const {MkyNetNode,MkyNetObj,MkyNetTab}   = require('./peerTree');
const {MkyTransaction,MkyBank} = require('./mkyBanker');

/*******************
Create PeerTree Network Peer
*******************
*/

  var isRoot = process.argv[3];
  var rBlockID = process.argv[4];

  var reset = null
  if (isRoot == 'rootReset'){
    isRoot == 'root';
    reset = true;
  }
  if (isRoot == 'rootRebuild'){
    isRoot == 'root';
    reset = 'rebuild';
  }
  const mkyNet = new MkyNetObj(options);
  mkyNet.nodeType = 'Banker';
  const myIp = mkyNet.netIp();

  if (isRoot == 'reset'){
    isRoot = null;
    reset = true;
  }
    
main();
async function main(){
  await mkyNet.netStarted();
  var rootBranch = false;
  if (!isRoot){
    startBank(rootBranch);
  }
  else {
    rootBranch = true;
    startBank(rootBranch);
  }
}
function startBank(rBranch){
    var bank = new MkyBank('02',myIp,mkyNet,reset,rBlockID);
    if (rBranch){
      console.log('\nNEW>>>SETTING BANKER TO ROOT');
      bank.isRoot = true;
    }
    bank.net.on('mkyReq',(res,j)=>{
      bank.handleReq(res,j);
    });
    bank.net.on('bcastMsg',j =>{
      bank.handleBCast(j);
    });
    bank.net.on('mkyReply', j =>{
      bank.handleReply(j);
    });
    bank.net.on('xhrFail', j =>{
      bank.handleXhrError(JSON.parse(j));
    });
}

