const fs = require('fs');

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};
//const {MkyNetNode,MkyNetObj,MkyNetTab}   = require('./peerTree');
const {PeerTreeNet}     = require('./peerTree');
const {peerMemoryObj,peerMemCellReceptor} = require('./peerMemoryObj.js');

process.on('uncaughtException', (err) => {
    console.error('Unhandled Exception:', err);
    if (err.code === 'EADDRINUSE') {
      console.error(`Port is already in use. Exiting...`);
      process.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection:', reason);
});

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
    await mkyNet.netStarted();
    mkyNet.updatePortalsFile(borg);
    startMemoryCell();
}
function startMemoryCell(rBranch){
    var mcell = new peerMemoryObj(mkyNet,reset);
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

