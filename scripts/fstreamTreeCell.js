process.title = 'fstreamTreeCell';

const fs = require('fs');

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};

const {PeerTreeNet}     = require('./peerTree');
const {FstreamTreeObj,FstreamTreeReceptor} = require('./fstreamTreeObj.js');


/*
********************************
* Create PeerTree Network Peer
********************************
*/

  var parm = process.argv[2];
  console.log('parm',parm);
  var reset = null
  if (parm == 'rootReset'){
    reset = true;
  }
  const borg = {
    netPort  : 13399,
    recpPort : 13400,
    monPort  : 13401,
    maxChildren : 25,
    netName  : process.title
  }
 
  const mkyNet = new PeerTreeNet(options,borg.netName,borg.netPort,borg.monPort,borg.maxChildren);
  mkyNet.nodeType = borg.netName;

  main();

async function main(){
    const cell = new FstreamTreeObj(mkyNet,reset);
    await mkyNet.netStarted();
    mkyNet.updatePortalsFile(borg);
    startFstreamCell(cell);
}
function startFstreamCell(cell){
    cell.startCell();
    const cellReceptor = new FstreamTreeReceptor(cell,borg.recpPort);
    cell.attachReceptor(cellReceptor);

    cell.net.on('mkyReq',(res,j)=>{
      cell.handleReq(res,j);
    });
    cell.net.on('bcastMsg',j =>{
      cell.handleBCast(j);
    });
    cell.net.on('mkyReply', j =>{
      cell.handleReply(j);
    });
    cell.net.on('xhrFail', j =>{
      console.error('xhrFail is->',j);
      cell.handleXhrError(j);
    });
}

