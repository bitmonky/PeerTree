/***************************************************
ftreeFileMgr App - ftreeFileMgrCell
Create Public Code Repos distibuted randomly accross the internet;
Status 2024-0131 - Incomplete
*/
process.title = 'ftreeFileMgrCell';

const fs = require('fs');

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};
//const {MkyNetNode,MkyNetObj,MkyNetTab}   = require('./peerTree');
const {PeerTreeNet}     = require('./peerTree');
const {ftreeFileMgrObj,ftreeFileMgrCellReceptor} = require('./ftreeFileMgrObj.js');


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
    netPort  : 13351,
    recpPort : 13381,
    monPort  : 13341,
    maxChildren : 3,
    netName  : 'ftreeFileMgrCell'
  }

  const peerNet = new PeerTreeNet(options,borg.netName,borg.netPort,borg.monPort,borg.maxChildren);
  peerNet.nodeType = borg.netName;

  if (isRoot == 'reset'){
    isRoot = null;
    reset = true;
  }
    
main();
async function main(){
  const scell = new ftreeFileMgrObj(peerNet,reset);
  await peerNet.netStarted();
  peerNet.updatePortalsFile(borg);
  startFtreeCell(scell);
}
var rBranch = null;
function startFtreeCell(scell){
    scell.startCell();
    const scellReceptor = new ftreeFileMgrCellReceptor(scell,borg.recpPort);
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
