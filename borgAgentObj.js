/******************************************************************
PeerTree - Object borgAgentObj  

2025-0417 - Taken from peerMemoryObj.js to be modified into borgAgentObj.js 
*/

var dateFormat     = require('./mkyDatef');
const EventEmitter = require('events');
const https        = require('https');
const fs           = require('fs');
const EC           = require('elliptic').ec;
const ec           = new EC('secp256k1');
const bitcoin      = require('bitcoinjs-lib');
const crypto       = require('crypto');
const schedule     = require('node-schedule');
const {MkyWebConsole}  = require('./networkWebConsole.js');
const {BorgAccessAPI}  = require('./borgAccessAPI.js');
const {BorgAgentBrain} = require('./borgAgentBrain.js');
const {BorgECMail}     = require('./BorgECMail.js');

const express = require('express');
const app = express();
const appPort = 8443; // Default port for HTTPS

const {pcrypt}     = require('./peerCrypt');
const axios        = require('axios');

addslashes  = require ('./addslashes');

const algorithm = 'aes256';
const MKYC_portDeepSeek = 13581;

function encrypt(buffer,pword){
  pword = pword.substr(0,31);
  var cipher = crypto.createCipher(algorithm,pword);
  var crypted = Buffer.concat([cipher.update(buffer),cipher.final()]);
  return crypted; //.toString('base64');
}
 
function decrypt(buffer,pword){
  pword = pword.substr(0,31);
  var decipher = crypto.createDecipher(algorithm,pword);
  var dec = Buffer.concat([decipher.update(buffer) , decipher.final()]);
  return dec;
}
function calculateHash(txt) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(txt).digest('hex');
}

/*********************************************
PeerTree Receptor Node: listens on port 1335
==============================================
This port is used for your regular apps to interact
with a borgAgentCell on the PeerTree File Store network;
*/
const ftreeRoot = 'ftree/';
const fetch = require('node-fetch');

class peerAgentToken{
   constructor(){
      this.publicKey   = null;
      this.privateKey  = null;
      this.signingKey  = null;
      this.openWallet();
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
      try {keypair =  fs.readFileSync('keys/peerAgentToken.key');}
      catch {console.log('no wallet file found');}
      this.publicKey = null;
      if (keypair){
        try {
	  const pair = keypair.toString();
	  const j = JSON.parse(pair);
          this.publicKey     = j.publicKey;
          this.privateKey    = j.privateKey;
          this.agentOwnMUID  = j.agentOwnMUID;
	  this.agentCipher   = j.agentCipher;
          this.crypt         = new pcrypt(this.agentCipher);
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
        this.agentMUID = mkybc.address;

        const pmc = ec.genKeyPair();
        this.pmCipherKey  = pmc.getPublic('hex');

        console.log('Generate a new wallet cipher key');
        mkybc = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+this.pmCipherKey, 'hex') });
        this.agentCipher = mkybc.address;

        var wallet = '{"agentOwnMUID":"'+ this.agentMUID+'","publicKey":"' + this.publicKey + '","privateKey":"' + this.privateKey + '",';
        wallet += '"agentCipher":"'+this.agentCipher+'"}';
	fs.writeFile('keys/peerAgentToken.key', wallet, function (err) {
          if (err) throw err;
         //console.log('Wallet Created And Saved!');
        });
      } 
    } 
}; 

class borgAgentCellReceptor{
  constructor(peerTree,recPort=1396){
    this.peer = peerTree;
    this.port = recPort;
    this.allow = ["127.0.0.1"];
    this.readConfigFile();
    console.log('ATTACHING - cellReceptor on port'+recPort);
    console.log('GRANTING cellRecptor access to :',this.allow);
    this.results = ['empty'];
    const options = {
      key: fs.readFileSync('keys/privkey.pem'),
      cert: fs.readFileSync('keys/fullchain.pem')
    };
    this.agentToken = new peerAgentToken();
    this.borgMail = new BorgECMail(this.agentToken.agentCipher);
    this.webConsole = app;
    this.connections = [];
    this.getControlFrameDoc();
 
    this.brain = new BorgAgentBrain(this);

    var bserver = https.createServer(options, (req, res) => {
      if (req.url == '/keyGEN'){
        // Generate a new key pair and convert them to hex-strings
        const key = ec.genKeyPair();
        const publicKey = key.getPublic('hex');
        const privateKey = key.getPrivate('hex');
        console.log('pub key length' + publicKey.length,publicKey);
        console.log('priv key length' + privateKey.length,publicKey);
        res.writeHead(200);
        res.end('{"publicKey":"' + publicKey + '","privateKey":"' + privateKey + '"}');
      }
      else {
        if (req.url.indexOf('/netREQ') == 0){
	  if (req.method == 'POST') {
            var body = '';
            req.on('data', (data)=>{
              body += data;
              // Too much POST data, kill the connection!
              //console.log('body.length',body.length);
              if (body.length > 300000000){
                console.log('max datazize exceeded');
                req.connection.destroy();
              }
            });
            req.on('end', ()=>{
              var j = null;
              try {
                j = JSON.parse(body);
              }
              catch(err){
                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200);
	        res.end('{"result":"json parse error:","data","'+body+'"}');
		console.log('json error : ',body);
                return;
	      }	 
              this.processRequests(j,res);
            });
          }
	}	
        else {
          res.writeHead(200);
          res.end('Wellcome To The PeerTree KeyGEN Server\nUse end point /keyGEN to request key pair');
        }
      }
    });
  
    bserver.on('connection', (sock)=> {
      if (this.allow.indexOf(sock.remoteAddress) < 0){
        //sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      } 
    });
    bserver.listen(this.port);
    console.log('peerTree Agent Receptor running on port:'+this.port);
  }
  processRequests(j,res){
    res.setHeader('Content-Type', 'application/json');
    if (j.msg.req == 'chatHUI'){
      res.writeHead(200);
      this.reqChatFromHUI(j.msg,res);
      return;
    }

    res.writeHead(200);
    res.end('{"netReq":"action '+j.msg.req+' not found"}');
  }
  shareBorgDocHistory(REPO){
    var req = {
      to : 'borgAgents',
      req : 'shareDocHistory',
      REPO : REPO,
      agent : this.brain.borgAID
    }
    this.peer.net.broadcast(req);
  }
  sendBorgChatBCast(j){
    var req = {
      to : 'borgAgents',
      req : 'groupChat',
      msg : j.msg,
      agent : j.agent
    }
    this.peer.net.broadcast(req);
  }
  async reqChatFromHUI(j,res){
    const borgRes = await this.brain.processHUIChat(j);   
    res.end(JSON.stringify(borgRes));
  }
  sendBorgChat(j){
    var req = {
      req : 'chat',
      msg : j.msg,
      agent : j.agentID
    }
    this.peer.net.sendMsg(j.toIp,req);
  }
  sendBorgChatReply(toIp,j){
    var qres = {
      req : 'chatReply',
      msg : j
    }
    this.peer.net.sendReply(toIp,qres);
  }
  readConfigFile(){
     var conf = null;
     try {conf =  fs.readFileSync('keys/borgAgent.conf');}
     catch {console.log('no config file found');}
     if (conf){
       try {
         conf = conf.toString();
         const j = JSON.parse(conf);
         this.port   = j.receptor.port;
         this.allow  = j.receptor.allow;
       }
       catch(err) {
         console.log('conf file not valid', err);
       }
     }
  }
  openAgentKeyFile(j){
    const bitToken = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+this.agentToken.publicKey, 'hex') }); 
    var mToken = {
      publicKey   : this.agentToken.publicKey,
      ownMUID     : bitToken.address,
      privateKey  : '************' // create from public key using bitcoin wallet algorythm.
    };
    return mToken;
  }
  sendOAIPrompt(prompt, mod = 'deepseek-reasoner', temp = 0.0) {
    return new Promise((resolve,reject) => {
      var stream = null;
      var newID  = null;
      console.log('Stream Connections: ',this.connections.length);
      if (this.connections.length > 0){
        newID = this.connections.length;
        console.log('staring new stream:',newID);
        this.connections[0].res.write(`data: ${JSON.stringify({action:"NEW_CONVERSATION::BEGIN!",id:newID})}\n\n`);
        this.connections.push({conId:newID,res:null});
      }

      const data = JSON.stringify({
        action: "getTextStream", // Ensure this matches the server logic
        prompt: prompt,
        useModel: mod,
        maxTokens: 8020,
        temperature: temp
      });

      // Define request options
      const options = {
        hostname: 'antsrv.bitmonky.com', 
        port: MKYC_portDeepSeek,
        path: '/netREQ',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data, 'utf8'),
        },
      };
      var rot      = `\n\nReasoning:\n\n`;
      var finA     = `\n\nFinal Answer:\n\n`;
      var fin      = '';
      var usage    = null
      var startROT = false;
      var startFIN = false;

      // Create the HTTPS request
      const req = https.request(options, (res) => {
        console.log(`Status Code: ${res.statusCode}`);
        console.log('Streaming response:\n');
        // Handle incoming data as a stream
        res.on('data', (chunk) => {
          const data = chunk.toString();
          // Print the streamed data (Reasoning of Thought or Content)
          //process.stdout.write("\x1B[2J\x1B[0f");
          if (newID) stream = this.connections[newID].res;
  	  if (data.startsWith('data: Reasoning of Thought:')) {
             if (startROT === false) {
	       if (stream) {
		 stream.write(`data: Reasoning:\n\n`);
		 this.connections[0].res.write('data: '+JSON.stringify({action:"start",id:newID})+`\n\n`);      
                 console.log(rot);startROT=true;
	       }
             }			 
             if (stream) stream.write(data.replace('data: Reasoning of Thought: ', ''));
	     const bitstr = data.replace('data: Reasoning of Thought: ', '');
             process.stdout.write(bitstr);
             rot += bitstr;
          } else if (data.startsWith('data: Content:')) {
            if (startFIN === false) {if (stream) stream.write(`data: Content:\n\n`);console.log(fin);startFIN = true;}
            if (stream) stream.write(data.replace('data: Content: ', ''));
	    const finstr = data.replace('data: Content: ', '');
            process.stdout.write(finstr); 
            fin += finstr;
          }
          else if (data.startsWith('usage: Content:')){
            usage = JSON.parse(data.replace('usage: Content: ',''));
            console.log(`\n\nUsage:`,usage);
          }
          else if (data.startsWith('{"result":"json parse error"}')){
            console.log('Server Error::',data);
            fin += data;
          } 
        });

        // Handle when the stream ends
        res.on('end', () => {
          console.log('\nStream ended.');
          fin = fin.replace(/```json\n{/, "{")
                .replace(/}\n```/, "}")
                .replace(/} ```/, "}")
                .replace(/}\n```/, "}");
	  if (stream) stream.end();
          resolve(fin);
        });
      });

      // Handle request error
      req.on('error', (error) => {
        console.log('Error:', error.message);
        resolve(error.message);
      });

      // Send the request payload
      req.write(data);
      req.end();
    });
  }
  initWebStreamViewer(appOptions){
    // Define your `/stream/:id` endpoint
    app.get('/stream/:id', (req, res) => {
      const id = req.params.id;
      console.log(`Connection ID:${id} starting!`);
      if(id=='control'){
        res.end(this.controlHTML);
        return;
      }
      // Set headers for SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Keep the connection open
      res.flushHeaders();

      if (id==0){
        this.connections.push({id :0,res:res});
        console.log(`data: Waiting For BorgTalk To Begin!\n\n`);
        res.write(`data: {"info":"Waiting For BorgTalk To Begin!"}\n\n`)
      }
      else {
        console.log('else::',id);
        this.connections[id].res = res;
      }

    });

    // Create an HTTPS server with the certificates
    https.createServer(appOptions, app).listen(appPort, () => {
       console.log(`HTTPS server running at https://16zVq6AMRCxsZ6BCNPRshhdTJCEL3tHiTs.borgIOS.net:${appPort}`);
    });
  }
  getControlFrameDoc() {
    this.controlHTML = `<!DOCTYPE html>
    <html>
    <head>
      <title>Controller Iframe 2.0 </title>
    <script>
    function startup(){
      let previousHeight = document.body.scrollHeight;

      setInterval(() => {
        const currentHeight = document.body.scrollHeight;

        if (currentHeight > previousHeight) {
          window.scrollTo({
            top: currentHeight,
            behavior: 'smooth', 
	    });
          previousHeight = currentHeight; 
        }
      }, 1000); 
    }
    </script>
    </head>
    <body onload='startup()'>
      <div id="watcherInfo" style='color:lightGreen;'>Watcher Connecting: please wait..</div>
      <div id="subframes"></div> <!-- Container for subframes -->

      <script>
      const info = document.getElementById('watcherInfo');
      const eventSource = new EventSource('https://16zVq6AMRCxsZ6BCNPRshhdTJCEL3tHiTs.borgIOS.net:${appPort}/stream/0');

        eventSource.onmessage = async (event) => {
        info.innerHTML = event.data;
	console.log(event);
        try {
            const data = JSON.parse(event.data);
            if (data.action === 'start'){
	      cframe = document.getElementById('conversation-'+data.id);
              if (cframe){
                if (cframe.contentDocument) {
                  const style = cframe.contentDocument.createElement('style');
                  style.innerHTML = 'pre { color: lightblue; }'; 
                  var trys = 1;
		  while(trys < 3){
		    if (cframe.contentDocument.head){
		      cframe.contentDocument.head.appendChild(style);
                      // Add MutationObserver for auto-scroll functionality
                      if (cframe.contentDocument) {
                         const script = cframe.contentDocument.createElement('script');
                         script.type = 'text/javascript';
                         script.innerHTML = ''+ 
                           'let previousHeight = document.body.scrollHeight; '+
                           'setInterval(() => { '+
                           '  const currentHeight = document.body.scrollHeight; '+
                           '  if (currentHeight > previousHeight) { '+
                           '    window.scrollTo({ '+
                           '      top: currentHeight, '+
                           '      behavior: "smooth", '+
                           '    }); '+
                           '    previousHeight = currentHeight; '+
                           '  } '+
                           '}, 500);';
                         cframe.contentDocument.head.appendChild(script);
                      } else {
                         console.warn("Unable to access the iframe's contentDocument.");
                      }             
		      break;
		    }
		    await wait(1400);
		    trys++
		  }  
                } else {
                  console.warn("Unable to access the cframe's contentDocument.");
                }
	      }	
            } 
            // Detect the NEW_CONVERSATION::BEGIN! action
            if (data.action === "NEW_CONVERSATION::BEGIN!") {
              console.log("Detected new conversation:", data);

              // Create a subframe dynamically
              const iframe = document.createElement('iframe');
              iframe.src = 'https://16zVq6AMRCxsZ6BCNPRshhdTJCEL3tHiTs.borgIOS.net:${appPort}/stream/'+data.id;
              iframe.id  = 'conversation-'+data.id;
              iframe.style.width = "100%";
              iframe.style.height = "300px";
              iframe.style.border = "1px solid black";
	      iframe.style.marginTop = '.5em';
              document.getElementById('subframes').appendChild(iframe);

            } else {
              console.log("Other data received:", data);
            }
          } catch (err) {
            console.error("Error parsing incoming chunk:", err);
          }
        };

        // Handle errors in the event source
        eventSource.onerror = () => {
          console.error("Error in controller iframe SSE connection");
          eventSource.close();
        };
      function wait(ms) {
         return new Promise((resolve) => setTimeout(resolve, ms));
      }  
      </script>
    </body>
    </html>`;
  }
  getControlFrameDocB(){
    this.controlHTML = `<!DOCTYPE html>
    <html>
    <head>
    <title>Controller Iframe</title>
    </head>
    <body>
    <script>
    const eventSource = new EventSource('https://16zVq6AMRCxsZ6BCNPRshhdTJCEL3tHiTs.borgIOS.net:${appPort}/stream/0');
    eventSource.onmessage = async (event) => {
      console.log(event);
      try {
        // Parse the streamed chunk
        const data = JSON.parse(event.data);
        // Detect the NEW_CONVERSATION::BEGIN! action
        if (data.action === "NEW_CONVERSATION::BEGIN!") {
          console.log("Detected new conversation:", data);
          // Send a message to the parent window
          window.parent.postMessage({ action: data.action, id: data.id },"*");
        }
        else {
          console.log("Other data received:", data);
        }
      }
      catch (err) {
        console.error("Error parsing incoming chunk:", event.data);
      }
    };
    // Handle errors in the event source
    eventSource.onerror = () => {
    console.error("Error in controller iframe SSE connection");
      eventSource.close();
    };
    </script>
    </body>
    </html> `;
  }
  sendOAIPromptNoStream(prompt, mod = 'deepseek-reasoner', temp = 0.0) {
    return new Promise(async (resolve,reject)=>{
      const msg = {
        action: "getText",
        role: "user",
        prompt: prompt,
        n: 1,
        maxTokens: 8020,
        temperature: temp,
        useModel: mod
      };

      const data = `${encodeURIComponent(JSON.stringify(msg))}`;
      const pUrl = `https://antsrv.bitmonky.com:${MKYC_portDeepSeek}/netREQ`;
      try {
        const response = await axios.post(pUrl, data, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
        let res = response.data.response.trim();

        // Clean up JSON formatting
        res = res.replace(/```json\n{/, "{")
                .replace(/}\n```/, "}")
                .replace(/} ```/, "}")
                .replace(/}\n```/, "}");

        const usage = `: cost - ${response.data.usage.total_tokens}`;
        console.log('usage:', usage);

        resolve(res); // Assuming oaiCleanUp() is implemented elsewhere
        return; 
      } 
      catch (error) {
        console.error("Error:", error.message);
        resolve(null) //throw new Error('hcoStoryGen JSON Response Error');
      }
    });  
  }
  signRequest(j){
    const stoken = j.agent.token.ownMUID + new Date(); 
    const sig = {
      ownMUID : j.agent.token.ownMUID,
      token : stoken,
      pubKey : this.agentToken.publicKey,
      signature : this.agentToken.signToken(stoken)
    }
    return sig;
  }
};
/*----------------------------
End Receptor Code
==============================
*/

function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max));
}
class borgAgentObj {
  constructor(peerTree,reset){
    this.reset        = reset;
    this.isRoot       = null;
    this.status       = 'starting';
    this.net          = peerTree;
    this.receptor     = null;
    this.wcon         = new MkyWebConsole(this.net,null,this,'borgAgentCell');
    this.maxGroupSize = 2;
    this.init();
    this.setNetErrHandle();
    this.sayHelloPeerGroup();
  }
  attachReceptor(inReceptor){
    this.receptor = inReceptor;
  }	  
  setNetErrHandle(){
    this.net.on('mkyRejoin',(j)=>{
      console.log('Network Drop Detected',j);
      this.status = 'starting';
      this.init();
    });
  }
  async init(){
    if (this.reset){
      await this.resetDb(this.resetBlock);
    }
  }
  getGoldRate(){
    return new Promise( (resolve,reject)=>{
      const https = require('https');

      const pmsg = {msg : 'sendGoldRate'}
      const data = JSON.stringify(pmsg);

      const options = {
        hostname : 'www.bitmonky.com',
        port     : 443,
        path     : '/whzon/bitMiner/getGoldRate.php',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        }
      }
      const req = https.request(options, res => {
        var rdata = '';
        res.on('data', d => {
          console.log(d);
          rdata += d;
        });
        res.on('end',()=>{
          var reply = null;
          console.log('getGold Rate returned',rdata);
          try {reply = JSON.parse(rdata);}
          catch(err) {reply = {mkyRate:0.0};}
          resolve(reply.mkyRate);
        });
      });

      req.on('error', error => {
        console.error(error)
        resolve(0.0);
      });

      req.write(data);
      req.end();
    });
  }
  handleXhrError(j){
    if (!j.msg)
      return;    
    const msg = j.msg;
  }
  handleReq(res,j){
    //console.log('root recieved: ',j);
    if (j.req == 'chat'){
      this.respondToChat(j,res);
      return true;
    }
    if (!this.isRoot && this.status != 'Online'){
      this.net.endRes(res,'');
      return true;
    }
    return false;
  }
  handleReply(r){
    if (r.req == 'chatReply'){
      console.log('agentChat response:',r);
      this.receptor.brain.processRemChat(r,r.remIp,'reply');
      return;
    } 
    if (r.req == 'groupChatReply'){
      console.log('agentGroupChat response:',r);
      this.receptor.brain.processRemGroup.Chat(r);
      return;
    }
    if (r.req == 'helloBack'){
      this.receptor.brain.BORGO.push({agentID:r.agentID,IP:r.remIp,specialty:r.specialty});
      return;
    }    
  }
  handleBCast(j){
    //console.log('bcast received: ',j);
    if (j.remIp == this.net.nIp) {
      //console.log('ignoring bcast to self',this.net.nIp);return;
      return;
    } // ignore bcasts to self.
    if (!j.msg.to) {return;}
    if (j.msg.to == 'borgAgents'){
      if (j.msg.token == 'hello'){
        var qres = {req : 'helloBack', agentID : this.net.peerMUID,specialty:this.receptor.brain.agentSpecialty };
        this.net.sendReply(j.remIp,qres);        
      }
      if (j.msg.req){
        if (j.msg.req == 'shareDocHistory'){
          this.receptor.brain.processSharedDocHistory(j.msg);
        }
        if (j.msg.req == 'groupChat')
          this.receptor.brain.processRemGroupChat(j.msg,j.remIp,'newMsgToGroup');
        if (j.msg.req == 'sendNodeList'){
          console.log('DOPOW xxxx',j.remIp);
          this.doPow(j.msg,j.remIp);
        }
        if (j.msg.req == 'stopNodeGenIP'){
          console.log('DOPOW stopNodeGenIP-XX Received:',j.remIp);
          this.doPowStop(j.remIp);
        }
      }
    } 
    return;
  }
  sayHelloPeerGroup(){
    var breq = {
      to : 'borgAgents',
      token : 'hello'
    }
    //console.log('bcast greeting to agentCell group: ',breq);
    if (this.receptor){
      if (this.receptor.brain){
        this.receptor.brain.BORGO = [];
      } else {console.log('receptor.brain Not Ready!',this.receptor);} 
   
    } else {console.log('Receptor Not Ready!',this.receptor);}
    this.net.broadcast(breq);
    const gtime = setTimeout( ()=>{
      this.sayHelloPeerGroup();
    },15*1000);
  }
  isValidSig(sig) {
    if (!sig){console.log('remMessage signature is null',sig);return false;}
    if (sig.hasOwnProperty('pubKey') === false) {console.log('remSig.pubKey is undefined',sig);return false;}
    if (!sig.pubKey) {console.log('remSig.pubKey is empty',sig);return false;}

    if (!sig.signature || sig.signature.length === 0) {
       return false;
    }

    // check public key matches the remotes address
    var mkybc = bitcoin.payments.p2pkh({ pubkey: new Buffer.from(''+sig.pubKey, 'hex') });
    if (sig.ownMUID !== mkybc.address){
      console.log('remote wallet address does not match publickey',sig);
      return false;
    }
    //verify the signature token with the public key
    const publicKey = ec.keyFromPublic(sig.pubKey,'hex');
    return publicKey.verify(calculateHash(sig.token), sig.signature);
  }
  doPowStop(remIp){
    this.net.gpow.doStop(remIp);
  }
  doPow(j,remIp){
    this.net.gpow.doPow(2,j.work,remIp);
  }
  respondToChat(j,remIp){
    var result = false;
    var ermsg  = null;
    const type = 'newMsg';
    this.receptor.brain.processRemChat(j,remIp,type);
  }
  receptorReqStopIPGen(work){
    var req = {
      to : 'borgAgents',
      req : 'stopNodeGenIP',
      work  : work
    }
    this.net.broadcast(req);
  }
  receptorReqNodeList(j){
    return new Promise( (resolve,reject)=>{
      var mkyReply = null;
      const maxIP = j.agent.nCopys;
      var   IPs = [];
      const gtime = setTimeout( ()=>{
        console.log('Send Node List Request Timeout:');
        this.net.removeListener('mkyReply', mkyReply);
        resolve(IPs);
      },7*1000);

      var req = {
        to : 'borgAgents',
        req : 'sendNodeList',
        nodes : maxIP,
        work  : crypto.randomBytes(20).toString('hex') 
      }

      this.net.broadcast(req);
      this.net.on('mkyReply', mkyReply = (r)=>{
        if (r.req == 'pNodeListGenIP'){
          //console.log('mkyReply NodeGen is:',r);
          if (IPs.length < maxIP){
            IPs.push(r.remIp);
          }
          else {
            this.receptorReqStopIPGen(req.work);
            clearTimeout(gtime);
            this.net.removeListener('mkyReply', mkyReply);
            resolve(IPs);
          }
        }
      });
    });
  }
};	  

function sleep(ms){
  return new Promise(resolve=>{
    setTimeout(resolve,ms)
  })
}

module.exports.borgAgentObj = borgAgentObj;
module.exports.borgAgentCellReceptor = borgAgentCellReceptor;
