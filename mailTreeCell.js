process.title = 'mailTreeCell'
const fs = require('fs');

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};
//const {MkyNetNode,MkyNetObj,MkyNetTab}   = require('./peerTree');
const {PeerTreeNet}     = require('./peerTree');
const {mailTreeObj,mailTreeCellReceptor} = require('./mailTreeObj.js');

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
    netPort  : 13393,
    recpPort : 13395,
    monPort  : 13394,
    maxChildren : 25,
    netName  : 'mailTreeCell'
  }

  const mkyNet = new PeerTreeNet(options,borg.netName,borg.netPort,borg.monPort,borg.maxChildren);
  mkyNet.nodeType = borg.netName;

  main();

async function main(){
    const cell = new mailTreeObj(mkyNet,reset);
    await mkyNet.netStarted();
    mkyNet.updatePortalsFile(borg);
    startMailCell(cell);
}
function startMailCell(mcell){
    mcell.startCell();
    const mcellReceptor = new mailTreeCellReceptor(mcell,borg.recpPort);
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

