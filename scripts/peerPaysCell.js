/***************************************************
ftreeFileMgr App - ftreeFileMgrCell
Create Public Code Repos distibuted randomly accross the internet;
Status 2024-0131 - Incomplete
*/
const fs = require('fs');

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};
//const {MkyNetNode,MkyNetObj,MkyNetTab}   = require('./peerTree');
const {PeerTreeNet}     = require('./peerTree');
const {peerPaysObj,peerPaysCellReceptor} = require('./peerPaysObj.js');

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

  const borg = {
    netPort  : 13390,
    recpPort : 13392,
    monPort  : 13391,
    maxChildren : 25,
    netName  : 'peerPaysCell'
  }

  const peerNet = new PeerTreeNet(options,borg.netName,borg.netPort,borg.monPort,borg.maxChildren);
  peerNet.nodeType = borg.netName;

  if (isRoot == 'reset'){
    isRoot = null;
    reset = true;
  }
    
main();
async function main(){
  await peerNet.netStarted();
  peerNet.updatePortalsFile(borg);
  startFtreeCell();
}
var rBranch = null;
function startFtreeCell(){
    var scell = new peerPaysObj(peerNet,reset);
    const scellReceptor = new peerPaysCellReceptor(scell,borg.recpPort);
    scell.attachReceptor(scellReceptor);
    if (rBranch){
      console.log('\nNEW>>>SETTING ftreeCell TO ROOT');
      scell.isRoot = true;
    }
    scell.net.on('mkyReq',(res,j)=>{
      scell.handleReq(res,j);
    });
    scell.net.on('bcastMsg',j =>{
      scell.handleBCast(j);
    });
    scell.net.on('mkyReply', j =>{
      scell.handleReply(j);
    });
    scell.net.on('xhrFail', j =>{
      scell.handleXhrError(j);
    });
}
