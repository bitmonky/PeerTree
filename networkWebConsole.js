const {MkyDbMonitor} = require('./bitWebMoniter.js');

/****************************
BitMonky Web Moniter Tool
****************************
*/

const webCon = require('http');
const fs = require('fs');

const options = {
  //key: fs.readFileSync('/etc/letsencrypt/live/admin.bitmonky.com/privkey.pem'),
  //cert: fs.readFileSync('/etc/letsencrypt/live/admin.bitmonky.com/fullchain.pem')
};
class MkyWebConsole {
  constructor(network,db=null,bank=null){
    this.db  = db;
    this.bank = bank;
    this.dbMon = new MkyDbMonitor(db,bank);
    this.net = network;
    this.srv = webCon.createServer(options, async (req, res) => {
      res.writeHead(200);
      if (req.url == '/keyGEN'){
        res.end('KeyGEN not available on netCon');
      }
      else {
        if (req.url.indexOf('/netREQ/msg=') == 0){
          var msg = req.url.replace('/netREQ/msg=','');
          msg = msg.replace(/\+/g,' ');
          msg = decodeURI(msg);
          msg = msg.replace(/%3A/g,':');
          msg = msg.replace(/%2C/g,',');
          msg = msg.replace(/\\%2F/g,'/');
          var j = null;
          try {
            j = JSON.parse(msg);
            //console.log(j);
            if (j.req){
              if (this.db){
                this.dbMon.handleReq(j,res);
              } 
              if (j.what == 'getNode'){
                var report = this.sendReport();
                res.end(report);
              }
            }
            else 
              res.end("No Handler Found For:\n\n "+JSON.stringify(j));
          }
          catch(err) {
            //console.log("json parse error:",err);
            res.end("JSON PARSE Error: \n\n"+msg+"\n\n"+err);
          }
        }
        else {
          var welcome = 'Welcome To The BitMonky KeyGEN Server\nUse end point /keyGEN to request key pair';
          welcome += '\n\nUse end point /netREQ/msg={json string} for bitGold Moniter';
          res.end(welcome);
        }
      }
    });
    this.srv.listen(this.net.wmon);
    console.log('BitMonky networkWebConsole Server running at admin.bitmonky.com:'+this.net.wmon);
  }
  sendReport(){
    var node = {
      r        : this.net.rnet.r,
      ip       : this.net.rnet.myIp,
      err      : this.net.rnet.err,
      new      : this.net.rnet.newNode,
      status   : this.net.rnet.status,
      type     : this.net.nodeType,
      nodes    : this.net.nodes,
      msgQue   : this.net.msgQue,
      maxPeers : this.net.maxPeers
    }
    return JSON.stringify(node);
  }
};

module.exports.MkyWebConsole = MkyWebConsole;

