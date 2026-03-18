const https = require('https');
const fs = require('fs');

class PtreeReceptorObj {
  constructor(peerTree, recPort,secure=false) {
    this.peer           = peerTree;
    this.port           = recPort;
    this.secureReceptor = secure;
    this.allow          = ["127.0.0.1"];

    this.readConfigFile();

    const options = {
      key: fs.readFileSync('keys/privkey.pem'),
      cert: fs.readFileSync('keys/fullchain.pem')
    };

    this.server = https.createServer(options, (req, res) => {
      this._handleIncoming(req, res);
    });

    // Allowlist enforcement
    this.server.on('connection', sock => {
      if (this.secureRecptor && !this.allow.includes(sock.remoteAddress)) {
        console.log(`Rejected connection from ${sock.remoteAddress}`);
        sock.destroy();
      }
    });

    this.server.listen(this.port, () => {
      console.log(`PtreeReceptor running on port ${this.port}`);
      console.log(`Allowlist:`, this.allow);
    });
  }

  readConfigFile() {
    try {
      if (!this.secureReceptor) throw {message : 'PTreeRecetor: secureReceptor NOT set to true'}
      const raw = fs.readFileSync('keys/mailTree.conf').toString();
      const j = JSON.parse(raw);
      this.secureReceptor = j.receptor.secure;
      this.port           = j.receptor.port;
      this.allow          = j.receptor.allow;
    } catch (err) {
      this.secureReceptor == false;
      console.log('WARNING - Receptor Security Mode is OFF receptor is public::: !', err.message);
    }
  }

  _handleIncoming(req, res) {
    if (req.method !== 'POST') {
      res.writeHead(405);
      return res.end('POST only');
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 300_000_000) {
        console.log('Max POST size exceeded');
        req.destroy();
      }
    });

    req.on('end', () => {
      let json;
      try {
        json = JSON.parse(body);
      } catch {
        res.writeHead(400);
        return res.end('Invalid JSON');
      }

      this.handleReq(json, res);
    });
  }

  // Subclasses override this
  handleReq(msg, res) {
    res.writeHead(500);
    res.end('handleReq not implemented');
  }
}

module.exports = PtreeReceptorObj; 

/*
Sample Use Case.
// mailReceptor.js
const PtreeReceptor = require('./ptreeReceptorObj');

class MailReceptor extends PtreeReceptorObj {
  constructor(peerTree, port) {
    super(peerTree, port);
  }

  handleReq(msg, res) {
    switch (msg.req) {
      case 'ping':
        return this.handlePing(msg, res);

      case 'echo':
        return this.handleEcho(msg, res);

      default:
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Unknown request: ${msg.req}` }));
    }
  }

  handlePing(msg, res) {
    res.writeHead(200);
    res.end(JSON.stringify({ pong: true }));
  }

  handleEcho(msg, res) {
    res.writeHead(200);
    res.end(JSON.stringify({ echo: msg.data }));
  }
}

module.exports = MailReceptor;

*/
