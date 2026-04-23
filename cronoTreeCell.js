// Declair A Unique Tree Type/Name  
process.title = 'cronoTreeCell';

const fs = require('fs');

// Link your self signed certs 
const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};

// Require the PeerTree Base Class
const {PeerTreeNet}     = require('./peerTree');

// Import The Application Code For Your Tree Type
const {CronoTreeObj,CronoTreeReceptor} = require('./cronoTreeObj.js');


/*
 * Configure cronoTreeCell Communcation Ports
 *
*/

  var parm = process.argv[2];
  console.log('parm',parm);
  var reset = null
  if (parm == 'rootReset'){
    reset = true;
  }
  const borg = {
    netPort  : 13396,
    recpPort : 13397,
    monPort  : 13398,
    maxChildren : 3,
    netName  : process.title
  }
 
  const mkyNet = new PeerTreeNet(options,borg.netName,borg.netPort,borg.monPort,borg.maxChildren);
  mkyNet.nodeType = borg.netName;

  //Start The Cell.
  main();

async function main(){
    const cell = new CronoTreeObj(mkyNet,reset);
    await mkyNet.netStarted();
    mkyNet.updatePortalsFile(borg);
    startCronoCell(cell);
}

// Initialize Network Event Handlers

function startCronoCell(cell){
    cell.startCell();
    const cellReceptor = new CronoTreeReceptor(cell,borg.recpPort);
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
      cell.handleXhrError(j);
    });
}

