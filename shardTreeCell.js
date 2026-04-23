/***************************************************
PeerTree App - ShardTreeCell
stores shards of files randomly accross the internet;
*/
process.title =  'shardTreeCell';

const fs = require('fs');

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};
//const {MkyNetNode,MkyNetObj,MkyNetTab}   = require('./peerTree');
const {PeerTreeNet}     = require('./peerTree');
const {shardTreeObj,shardTreeCellReceptor} = require('./shardTreeObj.js');

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
    netPort  : 13350,
    recpPort : 13355,
    monPort  : 13340,
    maxChildren : 25,
    netName  : 'shardTreeCell'
  }

  const peerNet = new PeerTreeNet(options,borg.netName,borg.netPort,borg.monPort,borg.maxChildren);
  peerNet.nodeType = borg.netName;

  if (isRoot == 'reset'){
    isRoot = null;
    reset = true;
  }
    
main();
async function main(){
  const cell = new shardTreeObj(peerNet,reset);
  await peerNet.netStarted();
  peerNet.updatePortalsFile(borg);
  if (!isRoot){
    startShardCell(cell);
  }
  else {
    rootBranch = true;
    startShardCell(rootBranch);
  }
}
var rBranch = null;
function startShardCell(scell){
    scell.startCell();
    const scellReceptor = new shardTreeCellReceptor(scell,borg.recpPort);
    scell.attachReceptor(scellReceptor);

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
