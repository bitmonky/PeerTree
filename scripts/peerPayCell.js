/******************************************************************
PeerTree - Payment App peerPayCell

2023-0123 - Taken from peerMemoryCell.js to be modified into the peerPayCell App
*/

const fs = require('fs');

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};
const {MkyNetNode,MkyNetObj,MkyNetTab}   = require('./peerTree');
const {peerPayObj,peerPayCellReceptor} = require('./peerPayObj.js');

/*******************
Create PeerTree Network Peer
*******************
*/

  var isRoot = process.argv[3];

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
  mkyNet.nodeType = 'memoryCell';

  if (isRoot == 'reset'){
    isRoot = null;
    reset = true;
  }
    
main();
async function main(){
  await mkyNet.netStarted();
  var rootBranch = false;
  if (!isRoot){
    startMemoryCell(rootBranch);
  }
  else {
    rootBranch = true;
    startMemoryCell(rootBranch);
  }
}
function startMemoryCell(rBranch){
    var paycell = new peerPayObj(mkyNet,reset);
    const paycellReceptor = new peerPayCellReceptor(paycell);
    paycell.attachReceptor(paycellReceptor);
    if (rBranch){
      console.log('\nNEW>>>SETTING memCell TO ROOT');
      paycell.isRoot = true;
    }
    paycell.net.on('mkyReq',(res,j)=>{
      paycell.handleReq(res,j);
    });
    paycell.net.on('bcastMsg',j =>{
      paycell.handleBCast(j);
    });
    paycell.net.on('mkyReply', j =>{
      paycell.handleReply(j);
    });
    paycell.net.on('xhrFail', j =>{
      console.log('xhrFail is->',j);
      paycell.handleXhrError(JSON.parse(j));
    });
}

