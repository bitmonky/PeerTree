process.title = 'borgAgentCell';

const fs = require('fs');

// Create a writable stream for errors
const errorLogStream = fs.createWriteStream('borgAgentErrors.log', { flags: 'a' });

// Override console.error to write to the file
console.error = function (...args) {
    errorLogStream.write(args.join(' ') + '\n');
};

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};
//const {MkyNetNode,MkyNetObj,MkyNetTab}   = require('./peerTree');
const {PeerTreeNet}     = require('./peerTree');
const {borgAgentObj,borgAgentCellReceptor} = require('./borgAgentObj.js');


/*******************
Create PeerTree Network Peer
*******************
*/

  var parm = process.argv[2];
  console.log('parm',parm);
  var reset = null
  if (parm == 'rootReset'){
    reset = true;
  }
  const borg = {
    netPort  : 13550,
    recpPort : 1396,
    monPort  : 13551,
    maxChildren : 25,
    netName  : 'borgAgentCell'
  }

 
  const mkyNet = new PeerTreeNet(options,borg.netName,borg.netPort,borg.monPort,borg.maxChildren);
  mkyNet.nodeType = borg.netName;

  var streamOptions = null;
  if (parm == 'streamOn'){
    streamOptions = {
      key: fs.readFileSync('/etc/letsencrypt/live/16zvq6amrcxsz6bcnprshhdtjcel3thits.borgios.net/privkey.pem'),
      cert: fs.readFileSync('/etc/letsencrypt/live/16zvq6amrcxsz6bcnprshhdtjcel3thits.borgios.net/fullchain.pem'),
    };
  }
  main();

async function main(){
    await mkyNet.netStarted();
    mkyNet.updatePortalsFile(borg);
    startMemoryCell();
}
function startMemoryCell(rBranch){
    var mcell = new borgAgentObj(mkyNet,reset);
    const mcellReceptor = new borgAgentCellReceptor(mcell,borg.recpPort);
    console.log('Checking For Borg Stream Option::',streamOptions);
    if (streamOptions){
      console.log('Initiate Borg Stream Monitor');
      mcellReceptor.initWebStreamViewer(streamOptions);
    }
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
      console.error('xhrFail is->',j);
      mcell.handleXhrError(j);
    });
}

