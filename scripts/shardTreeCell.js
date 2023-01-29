/***************************************************
PeerTree App - ShardTreeCell
stores shards of files randomly accross the internet;
*/

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
  const peerNet = new PeerTreeNet(options,'shardNet',13350,13340);
  peerNet.nodeType = 'shardCell';

  if (isRoot == 'reset'){
    isRoot = null;
    reset = true;
  }
    
main();
async function main(){
  await peerNet.netStarted();
  var rootBranch = false;
  if (!isRoot){
    startShardCell(rootBranch);
  }
  else {
    rootBranch = true;
    startShardCell(rootBranch);
  }
}
var rBranch = null;
function startShardCell(){
    var scell = new shardTreeObj(peerNet,reset);
    const scellReceptor = new shardTreeCellReceptor(scell,13355);
    scell.attachReceptor(scellReceptor);
    if (rBranch){
      console.log('\nNEW>>>SETTING shardCell TO ROOT');
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
