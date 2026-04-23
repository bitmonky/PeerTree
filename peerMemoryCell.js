process.title = 'peerMemoryCell';

const fs = require('fs');

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};
//const {MkyNetNode,MkyNetObj,MkyNetTab}   = require('./peerTree');
const {PeerTreeNet}     = require('./peerTree');
const {peerMemoryObj,peerMemCellReceptor} = require('./peerMemoryObj.js');

/*******************
Create PeerTree Network Peer
*******************
*/

  var parm = process.argv[3];

  var reset = null
  if (parm == 'rootReset'){
    reset = true;
  }
  
  const borg = {
    netPort  : 1336,
    recpPort : 1335,
    monPort  : 1339,
    maxChildren : 25,
    netName  : 'peerMemoryCell'
  }

  const mkyNet = new PeerTreeNet(options,borg.netName,borg.netPort,borg.monPort,borg.maxChildren);
  mkyNet.nodeType = borg.netName;

  main();

async function main(){
    const mcell = new peerMemoryObj(mkyNet,reset);
    await mkyNet.netStarted();
    mkyNet.updatePortalsFile(borg);
    startMemoryCell(mcell);
}
function startMemoryCell(mcell){
    mcell.startCell();
    const mcellReceptor = new peerMemCellReceptor(mcell,borg.recpPort);
    mcell.attachReceptor(mcellReceptor);

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
      mcell.handleXhrError(j);
    });
}

