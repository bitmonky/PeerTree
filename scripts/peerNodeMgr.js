/****************************
BitMonky PeerNode Manager
****************************
*/

const webCon = require('https');
const fs           = require('fs');
const EC           = require('elliptic').ec;
const ec           = new EC('secp256k1');
const bitcoin      = require('bitcoinjs-lib');
const crypto       = require('crypto');
const port   = 1555;
const wfile  = 'keys/myBMGPWallet.key';

const apps = ['mkyNetMain30','peerMemoryCell','shardTreeCell'];

const options = {
  key: fs.readFileSync('keys/privkey.pem'),
  cert: fs.readFileSync('keys/fullchain.pem')
};

class bitMonkyWSrv {
  constructor(){
    this.wallet = new bitMonkyWallet();
    console.log(this.wallet);
    this.srv = webCon.createServer(options,  async (req, res) => {
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
              this.wallet.handleRequest(j,res);
            }
            else{ 
              res.end("No Handler Found For:\n\n "+JSON.stringify(j));
            }
          }
          catch(err) {
            //console.log("json parse error:",err);
            res.end("JSON PARSE Error: \n\n"+msg+"\n\n"+err);
          }
        }
        else {
          var welcome = 'Welcome To The BitMonky Wallet Server';
          welcome += '\n\nUse end point /netREQ/msg={json string} for access';
          res.end(welcome);
        }
      }
    });
    this.srv.listen(port);
    console.log('bitMonky Wallet Server running at http://localhost:'+port);
  }
};

class bitMonkyWallet{
   constructor(){
      this.publicKey   = null;
      this.privateKey  = null;
      this.signingKey  = null;
      this.openWallet();
      //this.testSend();	   
   }
   calculateHash(txt) {
      const crypto = require('crypto');
      return crypto.createHash('sha256').update(txt).digest('hex');
   }
   signToken(token) {
      const sig = this.signingKey.sign(calculateHash(token), 'base64');
      const hexSig = sig.toDER('hex');
      return hexSig;
   }
   openWallet(){
      var keypair = null;
      try {keypair =  fs.readFileSync(wfile);}
      catch {console.log('no wallet file found');}
      this.publicKey = null;
      if (keypair){
        try {
          const pair = keypair.toString();
          const j = JSON.parse(pair);
          this.publicKey     = j.publicKey;
          this.privateKey    = j.privateKey;
          this.ownMUID       = j.ownMUID;
          this.walletCipher  = j.walletCipher;
          this.signingKey    = ec.keyFromPrivate(this.privateKey);
        }
        catch(err) {console.log('wallet file not valid', err);process.exit();
        }
      }
      else {
        const key = ec.genKeyPair();
        this.publicKey = key.getPublic('hex');
        this.privateKey = key.getPrivate('hex');
        console.log('Generate a new wallet key pair and convert them to hex-strings');
        var mkybc = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+this.publicKey, 'hex') });
        this.branchMUID = mkybc.address;

        const pmc = ec.genKeyPair();
        this.pmCipherKey  = pmc.getPublic('hex');

        console.log('Generate a new wallet cipher key');
        mkybc = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+this.pmCipherKey, 'hex') });
        this.shardCipher = mkybc.address;

        var wallet = '{"ownMUID":"'+ this.branchMUID+'","publicKey":"' + this.publicKey + '","privateKey":"' + this.privateKey + '",';
        wallet += '"walletCipher":"'+this.shardCipher+'"}';
        console.log(wallet);
        fs.writeFile(wfile, wallet, function (err) {
          if (err) throw err;
          console.log('Wallet Created And Saved!');
        });
      }
   }
   signMsg(stok) {
     const sig = this.signingKey.sign(this.calculateHash(stok), 'base64');
     const hexSig = sig.toDER('hex');
     return hexSig;
   }
   testSend(){
     const stok = this.ownMUID+Date.now(); 	   
     var msg = {
       Address : this.ownMUID,
       sesTok  : stok,
       pubKey  : this.publicKey,
       sesSig  : this.signMsg(stok),
       action  : 'getToken'
     }
     this.sendPostRequest(msg);
   }
   async handleRequest(j,res){
     console.log(j);
     if (j.req == 'stopApp'){
       if (apps.includes(j.app)){
         let cmd = 'pm2 stop '+j.app;
         res.end(await this.runCmd(cmd));
         return;
       }
     }  
     if (j.req == 'startApp'){
       if (apps.includes(j.app)){
	 var rootMode = '';
         if (j.rootIp !== undefined){
           rootMode = ' -- "'+j.rootIp+'" "root"';
         }
         let cmd = 'pm2 start '+j.app+'.js'+rootMode;
         res.end(await this.runCmd(cmd));
         return;
       }
     }
     if (j.req == 'updateApp'){
       if (apps.includes(j.app)){
         let cmd = './get_'+j.app+'.sh';
         res.end(await this.runCmd(cmd));
         return;
       }
     }
     if (j.req == 'updateNodeMgr'){
       let cmd = 'curl https://admin.bitmonky.com/bitMDis/peerNodeMgrUpdate_debian.sh | bash';
       res.end(await this.runCmd(cmd));
       return;
     }
     else if (j.req == 'getNodeList'){
       let list = this.sendNodeList(j);
       res.end(list);
     }
     res.end('Handler Not Found: req '+j.req);
   }
   runCmd(cmd){
     const { exec } = require('child_process');
     return new Promise((resolve, reject)=>{
       console.log('Running Cmd: ',cmd);
       exec(cmd, (error, stdout, stderr) => {
         if (error) {
           console.error(`Error: ${error.message}`);
           resolve( error.message);
           return;
         }

         if (stderr) {
           console.error(`Standard Error: ${stderr}`);
           resolve(stderr);
           return;
         }

         console.log(`Standard Output: ${stdout}`);
         resolve(stdout);
         return;
       });
     });
   }
   sendNodeList(j){
     const nfile = '/peerTree/keys/myNodeList-'+j.port+'-'+j.nodeType+'.net';
     try {
       const data = fs.readFileSync(nfile, 'utf8');
       return data;
     }
     catch (err) {
       console.error(err);
       return '[]';
     }
   }
   handleResponse(data){
     console.log(data);
   }
   sendPostRequest(msg,endPoint='/whzon/gold/netWalletAPI.php'){
      const https = require('https');

      const data = JSON.stringify(msg);

      const options = {
        hostname : 'www.bitmonky.com',
        port     : this.port,
        path     : endPoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        } 
      }

      const req = https.request(options, res => {
        var body = '';

        res.on('data', (chunk)=>{
          body = body + chunk;
        });

        res.on('end',()=>{
          if (res.statusCode != 200) {
            console.log("Api call failed with response code " + res.statusCode);
          } 
	  else {
            this.handleResponse(JSON.parse(body));
          }
        });
      });

      req.on('error', error => {
         console.log(error);
      })

      req.write(data);
      req.end();
   } 
};

const myWallet = new bitMonkyWSrv();

module.exports.bitMonkyWSrv = bitMonkyWSrv;

