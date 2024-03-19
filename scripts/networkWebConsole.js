const {MkyDbMonitor} = require('./bitWebMoniter.js');

/****************************
PeerTree Web Moniter Tool
****************************
Dust Removed: Date: Dec 28, 2022
*/

const webCon = require('http');
const fs = require('fs');

const options = {
  //key: fs.readFileSync('/etc/letsencrypt/live/admin.bitmonky.com/privkey.pem'),
  //cert: fs.readFileSync('/etc/letsencrypt/live/admin.bitmonky.com/fullchain.pem')
};
class MkyWebConsole {
  constructor(network,db=null,bank=null,peerAppName='shardTreeCell'){
    this.db  = db;
    this.bank = bank;
    this.appName = peerAppName;
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
              else if (j.what == 'getErLog'){
                var report = await this.sendErLog(j);
                res.end(report);
              }
              else if (j.what == 'getConsole'){
                var report = await this.sendConsole(j);
                res.end(report);
              }
              else if (j.what == 'flushLogs'){
                var report = this.flushLogs();
                res.end(report);
              }
              else { 
                res.end("No what Handler Found For:\n\n "+JSON.stringify(j));
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
          var welcome = 'Welcome To The PeerTree KeyGEN Server\nUse end point /keyGEN to request key pair';
          welcome += '\n\nUse end point /netREQ/msg={json string} for bitGold Moniter';
          res.end(welcome);
        }
      }
    });
    this.srv.listen(this.net.wmon);
    console.log('PeerTree networkWebConsole Server running at admin.bitmonky.com:'+this.net.wmon);
  }
  flushLogs(){
    const { exec } = require('child_process');
    exec('pm2 flush '+this.appName, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        return;
      }
    }); 
    console.log(this.appName+ ': Log files flushed');
    return this.appName + ': Log files flushed';
  }
  async sendErLog(j){
    const log = await readTextFileToArrayAsync('/root/.pm2/logs/'+this.appName+'-out.log');
    var erlogPg = {
      pageNbr    : j.pageNbr,
      pageLength : j.pageLength,
      page       : paginateArray(log, j.pageNbr, j.pageLength) 
    }
    return JSON.stringify(erlogPg);
  }
  async sendConsole(j){
    const log = await readTextFileToArrayAsync('/root/.pm2/logs/'+this.appName+'-error.log');
    var erlogPg = {
      pageNbr    : j.pageNbr,
      pageLength : j.pageLength,
      page       : paginateArray(log, j.pageNbr, j.pageLength)
    }
    return JSON.stringify(erlogPg);
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
function readTextFileToArrayAsync(filename) {
  return new Promise((resolve, reject) => {
    fs.readFile(filename, 'utf8', (err, data) => {
      if (err) {
        resolve(err.message.split('\n'));
      } else {
        const linesArray = data.split('\n');
        resolve(linesArray);
      }
    });
  });
}
function paginateArray(logs, pageNumber, pageLength) {
    const startIndex = (pageNumber - 1) * pageLength;
    const endIndex = startIndex + pageLength;
    return logs.slice(startIndex, endIndex);
}
module.exports.MkyWebConsole = MkyWebConsole;

