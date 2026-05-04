process.title = 'btraderOrganCell';

const fs = require('fs');
const { PeerTreeNet } = require('./peerTree');
const { BTraderOrganObj, BTraderReceptor } = require('./btraderOrganObj.js');

// TLS keys for PeerTreeNet
const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};

// Borg cell configuration
const borg = {
  netPort: 11396,     // PeerTree network port
  recpPort: 11397,    // HTTP receptor port
  monPort: 11398,     // PeerTree monitor port
  maxChildren: 3,     // PeerTree branching factor
  netName: process.title
};

// Create PeerTree network instance
const mkyNet = new PeerTreeNet(
  options,
  borg.netName,
  borg.netPort,
  borg.monPort,
  borg.maxChildren
);

async function main() {
  // Start PeerTree networking
  await mkyNet.netStarted();

  // Create the trading organism
  const cell = new BTraderOrganObj(mkyNet);

  // Attach organism to PeerTree network
  mkyNet.organismObj = cell;

  // Update portals.json for discovery
  mkyNet.updatePortalsFile(borg);

  // Attach receptor + event handlers
  startCell(cell);
}

function startCell(cell) {
  // HTTP receptor for buy/sell requests
  const receptor = new BTraderReceptor(cell, borg.recpPort);
  cell.attachReceptor(receptor);

  // Wire PeerTree events to organism handlers
  cell.net.on('mkyReq', (res, j) => cell.handleReq(res, j));
  cell.net.on('bcastMsg', j => cell.handleBCast(j));
}

main();

