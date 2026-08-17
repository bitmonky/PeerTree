// Boot file for the lab probe cell - identical to cronoTreeCell.js except for
// the organism class it instantiates.
process.title = 'cronoTreeCell';

const fs = require('fs');
const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};

const { PeerTreeNet } = require('./peerTree');
const { ProbeObj, ProbeReceptor } = require('./probeObj.js');

const borg = {
  netPort: 13396,
  recpPort: 13397,
  monPort: 13398,
  maxChildren: 3,
  netName: process.title
};

const mkyNet = new PeerTreeNet(options, borg.netName, borg.netPort, borg.monPort, borg.maxChildren);
mkyNet.nodeType = borg.netName;

main();

async function main() {
  const cell = new ProbeObj(mkyNet, null);
  await mkyNet.netStarted();
  mkyNet.updatePortalsFile(borg);

  cell.startCell();
  const cellReceptor = new ProbeReceptor(cell, borg.recpPort);
  cell.attachReceptor(cellReceptor);

  cell.net.on('mkyReq', (res, j) => cell.handleReq(res, j));
  cell.net.on('bcastMsg', j => cell.handleBCast(j));
  cell.net.on('mkyReply', j => cell.handleReply && cell.handleReply(j));
  cell.net.on('xhrFail', j => cell.handleXhrError && cell.handleXhrError(j));
}
