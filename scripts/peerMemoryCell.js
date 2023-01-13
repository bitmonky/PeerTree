const fs = require('fs');

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};
const {MkyNetNode,MkyNetObj,MkyNetTab}   = require('./peerTree');
const {peerMemoryObj,peerMemCellReceptor} = require('./peerMemoryObj.js');

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
    var mcell = new peerMemoryObj(mkyNet,reset);
    const mcellReceptor = new peerMemCellReceptor(mcell);
    mcell.attachReceptor(mcellReceptor);
    if (rBranch){
      console.log('\nNEW>>>SETTING memCell TO ROOT');
      mcell.isRoot = true;
    }
    mcell.net.on('mkyReq',(res,j)=>{
      mcell.handleReq(res,j);
    });
    mcell.net.on('bcastMsg',j =>{
      mcell.handleBCast(j);
    });
    mcell.net.on('mkyReply', j =>{
      mcell.handleReply(j);
    });
    mcell.net.on('xhrFail', j =>{
      console.log('xhrFail is->',j);
      mcell.handleXhrError(JSON.parse(j));
    });
}

