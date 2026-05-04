#!/bin/bash

# CronoTreeCell updater for Debian/Ubuntu
# (Fetches updated files only — no configuration)

# Open CronoTree + PeerTree ports
ufw allow 1441/tcp
ufw allow 13396/tcp
ufw allow 13397/tcp
ufw allow 13398/tcp

# Ensure /peerTree exists
mkdir -p /peerTree
cd /peerTree

# Fetch updated CronoTree core files
curl -s https://admin.bitmonky.com/bitMDis/ptreeReceptorObj.js  -o ptreeReceptorObj.js
curl -s https://admin.bitmonky.com/bitMDis/btraderOrganObj.js   -o btraderOrganObj.js
curl -s https://admin.bitmonky.com/bitMDis/btraderOrganCell.js  -o btraderOrganCell.js
curl -s https://admin.bitmonky.com/bitMDis/peerTree.js          -o peerTree.js
curl -s https://admin.bitmonky.com/bitMDis/peerCrypt.js         -o peerCrypt.js
curl -s https://admin.bitmonky.com/bitMDis/mkyDatef.js          -o mkyDatef.js
curl -s https://admin.bitmonky.com/bitMDis/networkWebConsole.js -o networkWebConsole.js
curl -s https://admin.bitmonky.com/bitMDis/bitWebMoniter.js     -o bitWebMoniter.js
curl -s https://admin.bitmonky.com/bitMDis/pstartBTraderCell.sh -o pstartBTraderCell.sh

echo "CronoTreeCell files updated!"
echo "Run with: pm2 start cronoTreeCell.js"

node btraderOrganCell.js
