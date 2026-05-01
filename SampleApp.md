# 🌱 YourOrganism — A Minimal PeerTree Organism Example

This repository contains a minimal example of how to build a custom **PeerTree organism**.  
It shows how to:

- create a new organism type  
- attach it to the PeerTree network  
- define request/response handlers  
- expose an HTTP receptor  
- send RPC-style JSON messages between nodes  

This example is intentionally simple and is meant as a starting point for building more complex distributed organisms.

---

## 🚀 What This Example Demonstrates

- A fully functional PeerTree cell (`yourOrganismCell.js`)
- A custom organism logic class (`yourOrganismObj.js`)
- A receptor that exposes an HTTP endpoint (`YourOrganismReceptor`)
- A working request/response RPC pair:
  - `doSomeWorkReq`
  - `doSomeWorkReqResult`

Every node is a **clone**.  
There is **no client/server** — any node can send or handle the work request.

---

## 📦 File Overview

yourOrganismCell.js     → Boots the PeerTree cell
yourOrganismObj.js      → Your organism logic (RPC handlers, work requests)
ptreeReceptorObj.js     → Base receptor class (from PeerTree)
peerTree.js             → Core PeerTree network engine
keys/                   → Your TLS certs


---

## 🔧 Running a Cell

Each cell requires TLS keys:

keys/privkey.pem
keys/fullchain.pem


Then start a node:

```bash
node yourOrganismCell.js
```

Each node will:

join the PeerTree network

attach its receptor

listen for requests

participate in the organism structure

🧠 How the Example Works
1. The Organism Logic
YourOrganismObj defines:

how to send a work request

how to handle that request

how to send a reply

Example RPC:

```JS
let response = await this.doMakeSomeWorReq(toIp, { whoIs: 'peter' });
```

The handler responds with:

```JS
{ "jsonResData": "hello peter how are you?" }
```
2. The Receptor
YourOrganismReceptor exposes an HTTP endpoint.

Calling:

Code
```JS
 curl -k -X POST https://localhost:12397/netREQ \
  -H "Content-Type: application/json" \
  -d '{"msg":{"req":"echo"}}'
```

Triggers:

an internal RPC to another PeerTree node

logs the response

returns it to the HTTP client

This shows how to bridge HTTP → PeerTree RPC → HTTP.

3. The Cell Boot File
yourOrganismCell.js:

loads TLS keys

creates the PeerTree network

instantiates your organism

attaches the receptor

wires PeerTree events

starts the cell

This is the same pattern used by all PeerTree organisms.

🧩 Extending the Organism
To add more RPC handlers:

Add a new request type in handleReq

Add a matching handler method

Add a matching reply identifier

Optionally expose it through the receptor

Example:

```JS
if (j.req === 'myNewReq') {
  this.handleMyNewReq(j);
  return true;
}
```
🧬 About PeerTree
PeerTree is a biologically‑inspired distributed system where:

nodes behave like cells

the network self‑organizes

branches compete and converge

the structure heals under churn

every node is a clone with equal capability

This example shows how to build your own “organism” on top of that substrate.

BOOT file.
```JS
/*
* ---------------------------
* FILE: yourOranismCell.js
* ---------------------------
*/

// Declare a unique tree type/name
process.title = 'yourOrganismCell';

const fs = require('fs');

// Load your self‑signed certs
const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};

// Require the PeerTree base class
const { PeerTreeNet } = require('./peerTree');

// Import your organism logic
const { YourOrganismObj, YourOrganismReceptor } = require('./yourOrganismObj.js');

/*
 * Configure communication ports for this organism
 */

let parm = process.argv[2];
console.log('parm', parm);

let reset = null;
if (parm === 'rootReset') {
  reset = true;
}

// Select some unique ports for your organism
// define the tree depth. (higher the maxChildren per peer the flatter the tree... less hops for broadcasts)  
const borg = {
  netPort: 12396,
  recpPort: 12397,
  monPort: 12398,
  maxChildren: 3,
  netName: process.title
};

// Create the PeerTree network instance
const mkyNet = new PeerTreeNet(
  options,
  borg.netName,
  borg.netPort,
  borg.monPort,
  borg.maxChildren
);

mkyNet.nodeType = borg.netName;

// Start the cell
main();

async function main() {
  // Create your organism instance
  const cell = new YourOrganismObj(mkyNet, reset);

  // Start the PeerTree network
  await mkyNet.netStarted();

  // Update portals file (for discovery)
  mkyNet.updatePortalsFile(borg);

  // Attach receptors and event handlers
  startYourOrganismCell(cell);
}

// Initialize network event handlers
function startYourOrganismCell(cell) {
  // If your organism has a startup routine
  if (typeof cell.startCell === 'function') {
    cell.startCell();
  }

  // Create and attach receptor
  const cellReceptor = new YourOrganismReceptor(cell, borg.recpPort);
  cell.attachReceptor(cellReceptor);

  // Wire PeerTree events to your organism handlers
  cell.net.on('mkyReq', (res, j) => {
    cell.handleReq(res, j);
  });

  cell.net.on('bcastMsg', j => {
    if (cell.handleBCast) cell.handleBCast(j);
  });

  cell.net.on('mkyReply', j => {
    if (cell.handleReply) cell.handleReply(j);
  });

  cell.net.on('xhrFail', j => {
    if (cell.handleXhrError) cell.handleXhrError(j);
  });
}
```
Application File:

```JS
/*
* ------------------------
* FILE: yourOranismObj.js
* ------------------------
*
* PeerTree App Creation Sample
*/
const PtreeReceptor = require('./ptreeReceptorObj');
const { MkyWebConsole } = require('./networkWebConsole.js');

class YourOrganismObj {
  constructor(peerTree, reset) {
    this.isCoreNET = false;
    this.reset        = reset;
    this.isRoot       = null;
    this.status       = 'starting';
    this.net          = peerTree;
    this.receptor     = null;
    this.wcon         = new MkyWebConsole(this.net,null,this,process.title);
}
  attachReceptor(inReceptor){
    this.receptor = inReceptor;
  }
  // --------------------------------------------------------------------
  // Create a work request method (RPC)
  // --------------------------------------------------------------------
  async doMakeSomeWorkReq(toIp, jsonDataPkg) {
    const msg = {
      req: 'doSomeWorkReq',             // request identifier
      response: 'doSomeWorkReqResult',  // expected reply identifier
      data: jsonDataPkg
    };

    let doTry = await this.net.reqReply.waitForReply(toIp, msg);

    if (doTry.result === "OK") {
      return doTry.jsonResData;
    }

    // timeout or xhrFail
    return doTry.result;
  }

  // --------------------------------------------------------------------
  // Matching Request Handler
  // --------------------------------------------------------------------
  doSomeWorkReq(j) {
    let who = j.data.whoIs;

    const reply = {
      reqId: j.reqId,                     // required
      response: 'doSomeWorkReqResult',    // MUST match request
      result: 'OK',                       // required 'OK' for success or 'SOME_ERROR_CODE' if the work fails
      jsonResData: `hello ${who} how are you?`
    };

    // send reply back to requester
    this.net.sendReply(j.remIp, reply);
  }

  // --------------------------------------------------------------------
  // Add request handler in handleReq
  // --------------------------------------------------------------------
  async handleReq(remIp, j) {

    if (j.req === 'doSomeWorkReq') {
      this.doSomeWorkReq(j);
      return true;
    }

    // more handlers here...

    return false;
  }
}

/*
   Notes :
   All nodes are exact clones. There is no client/server.
   Any node can send or handle this work request.
*/

// ----------------------------------------------------------------------
// Receptor
// ----------------------------------------------------------------------
class YourOrganismReceptor extends PtreeReceptor {
  constructor(peerTree, port) {
    super(peerTree, port);

    // IMPORTANT:
    // receptor must know the organism instance
    this.net = peerTree; 
  }

  async handleReq(j, res) {
    switch (j.msg.req) {
      case 'echo':
        return await this.handleEcho(j.msg, res);

      default:
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Unknown request: ${j.msg.req}` }));
    }
  }

  async handleEcho(msg, res) {
    let toIp = '127.0.0.1';

    // call the organism RPC method
    let response = await this.net.doMakeSomeWorkReq(toIp, { whoIs: 'peter' });
    console.log(response);

    res.writeHead(200);
    res.end(JSON.stringify(response)+'\n');
  }
}

module.exports.YourOrganismObj      = YourOrganismObj;
module.exports.YourOrganismReceptor = YourOrganismReceptor;

```

📚 Next Steps
You can extend this example to build:

distributed sensor networks

cooperative robotics

environmental monitoring swarms

multi‑agent coordination systems

JSON‑based distributed applications


