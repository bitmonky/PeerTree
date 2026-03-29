const PtreeReceptor = require('./ptreeReceptorObj');
const {MkyWebConsole}  = require('./networkWebConsole.js');
const fs = require('fs');
const path = require('path');

class FstreamTreeReceptor extends PtreeReceptor {
  constructor(peerTree, port) {
    super(peerTree, port);

    // Canonical workspace directory for all fstream operations
    this.fstreamDir = "/peerTree/fstream/";

    // Active streams
    this.activeStreams = new Map();

    // Ensure directory exists at startup
    this.ensureDir(this.fstreamDir);

    // Active streaming sessions (keyed by sessionId or fileName)
    this.sessions = new Map();

    this.nodeMaxClients  = 20;   // or whatever you choose
    this.nodeClientCount = 0;


    this.startProcessingLoop();

    // Metrics for monitoring and debugging
    this.metrics = {
      activeStreams: 0,
      totalBytesServed: 0,
      totalRequests: 0,
      errors: 0,
      startedAt: Date.now()
    };
  }
  ensureDir(dir) {
    const fs = require('fs');

    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
      } catch (err) {
        console.error(`Failed to create directory ${dir}:`, err);
      }
    }
  }
  startProcessingLoop() {
    const LOOP_INTERVAL = 500; // ms — adjust as needed

    const process = async () => {
      try {
        await this.processStreamQueue();
        await this.processActiveStreams();
      } catch (err) {
        console.error("Fstream processing loop error:", err);
      }

      // Schedule next heartbeat
      setTimeout(process, LOOP_INTERVAL);
    };

    process();
  }
  cleanupStream(checksum, stream){
    try {
      if (stream.fhandle) {
        fs.closeSync(stream.fhandle);
      }
    } catch (err) {
      console.error("Error closing file handle:", err);
    }

    // Decrement node-level client count
    this.nodeClientCount -= stream.clients.size;
    if (this.nodeClientCount < 0) this.nodeClientCount = 0;

    // Remove the stream
    this.activeStreams.delete(checksum);

    console.log(`Cleaned up stream ${checksum}`);

  }
  setContentHeaders(stream, res) {
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "max-age=2592000, public");
    res.setHeader("Expires", new Date(Date.now() + 2592000 * 1000).toUTCString());

    try {
      const mtime = fs.statSync(stream.tmpname).mtime;
      res.setHeader("Last-Modified", mtime.toUTCString());
    }
    catch (err) {
      // optional: ignore
    }
  }  
  setRangeHeaders(stream, req, res) {
    const fileSize = stream.FILE.size;
    const range = req.headers.range;

    res.setHeader("Accept-Ranges", `bytes`);

    if (!range) {
      // Full file
      this.setContentHeaders(stream, res);
      res.setHeader("Content-Length", fileSize);
      return { start: 0, end: fileSize - 1, status: 200 };
    }

    // Parse range: "bytes=start-end"
    const bytes = range.replace(/bytes=/, "").split("-");
    let start = parseInt(bytes[0], 10);
    let end = bytes[1] ? parseInt(bytes[1], 10) : fileSize - 1;

    // Validate
    if (start > end || start >= fileSize || end >= fileSize) {
      res.writeHead(416, {
        "Content-Range": `bytes */${fileSize}`
      });
      res.end();
      return null;
    }

    this.setContentHeaders(stream, res);

    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Length": chunkSize,
      "Content-Range": `bytes ${start}-${end}/${fileSize}`
    });

    return { start, end, status: 206 };

  }
  async serveRangeRequest(req, res, stream) {
    const rangeInfo = this.setRangeHeaders(stream, req, res);
    if (!rangeInfo) return;

    const { start, end } = rangeInfo;

    // Read from sparse file
    const length = end - start + 1;
    const buffer = Buffer.alloc(length);

    fs.readSync(stream.fhandle, buffer, 0, length, start);

    res.end(buffer);
  }

  async processActiveStreams() {
    const now = Date.now();

    for (const [checksum, stream] of this.activeStreams) {

      // STREAM TIMEOUT CHECK
      if (now - stream.lastAccess > this.streamTimeoutMs) {
        console.log(`Stream ${checksum} timed out`);
        this.cleanupStream(checksum, stream);
      }


      switch (stream.status) {

        case "queued":
          // Move to initializing
          this.initializeStream(stream);
          break;

        case "initializing":
          // Start shard fetching
          this.startShardFetch(stream);
          break;

        case "fetching":
          // Continue shard fetching (if incremental)
          this.advanceShardFetch(stream);
          break;

        case "warm":
          // Stream is ready to serve clients
          // Optional: prefetch more shards
          break;

        case "complete":
          // Nothing to do
          break;

        case "error":
          // Retry logic or cleanup
          break;
      }
    }
  }

  handleReq(j, res,req) {
    switch (j.msg.req) {
      case 'openFstreamMap':
        return this.handleOpenFstreamMap(j.msg, res, req);
      
      case 'sendFstreamData':
        return this.handleSendStreamData(j.msg, res, req);

      default:
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Unknown request: ${j}` }));
    }
  }
  async findNodesCurrentlyStreaming(msg) {
    try {
      const reply = await this.peer.findStreamingNodes(msg);
      return reply || null;
    } catch (err) {
      console.error("findNodesCurrentlyStreaming() failed:", err);
      return null;
    }
  }
  async initializeStream(stream) {
    const maxConcurrentRequests = 3;
    const chunkSize = 256 * 1024;

    // Reset per-stream tracker
    stream.sTracker = new Set();

    // Copy shard list
    let tempShards = [...stream.shards];

    let tries = 1;
    const maxTries = 25;

    console.log(`Initializing stream ${stream.streamReq.checksum}`);

    while (tempShards.length > 0 && tries <= maxTries) {
      console.log(`Shard fetch attempt ${tries} for ${stream.streamReq.checksum}`);

      // Call your existing fastReadFromTree()
      const result = await this.fastReadFromTree(
        stream.streamReq.muid,
        tempShards,
        stream.tmpname,
        chunkSize,
        maxConcurrentRequests,
        stream
      );

      // Remove shards that were successfully fetched
      tempShards = tempShards.filter(s => !stream.sTracker.has(s.shardID));

      tries++;
    }

    // If all shards fetched → mark complete
    if (tempShards.length === 0) {
      stream.status = "complete";
      console.log(`Stream ${stream.streamReq.checksum} initialized COMPLETELY`);
    } else {
      // Otherwise, move to fetching phase
      stream.status = "fetching";
      console.log(`Stream ${stream.streamReq.checksum} initialized, continuing fetch`);
    }
  }
  sendFirstClientResponse(stream, shardBase64) {
    if (!stream.clients || stream.clients.size === 0) {
      console.warn("No waiting clients for warm stream");
      return;
    }

    // Get the first client
    const [client] = stream.clients;
    const { msg, res } = client;

    // Remove from waiting list
    stream.clients.delete(client);

    // Build response payload
    const payload = {
      result: 1,
      warm: true,
      checksum: stream.streamReq.checksum,
      fmap: stream.fmap.map(s => ({
        shardID: s.shardID,
        shardHID: s.shardHID,
        startPos: s.startPos,
        index: s.index
      })),
      firstShard: shardBase64
    };

    try {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      console.log("Sent warm-node response + first shard to client");
    } catch (err) {
      console.error("Failed sending first client response:", err);
    }
  }

  async openFstreamMap(msg, res) {
    try {
      // 1. Check if any node is already streaming this file
      const cstream = await this.findNodesCurrentlyStreaming(msg);

      if (cstream) {
        // 2. Redirect client to warm node
        return this.redirectClient(cstream.IP, res);
      }

      // 3. No warm node found → start a new stream locally
      return this.startNewStream(msg, res);

    }
    catch (err) {
      console.log('FstreamTreeReceptor.openFstreamMap():: could not open stream:',err,msg);

      const reply = {
        result: false,
        errMsg: "failed to find or open available stream"
      };

      res.writeHead(200);
      res.end(JSON.stringify(reply));
    }
  }
  sendError(res, errMsg){
    const reply = {
      result: false,
      errMsg: errMsg
    };

    res.writeHead(200);
    res.end(JSON.stringify(reply));
  }
  async startNewStream(msg,res){
    const streamReq = msg.stream;
    const checksum  = streamReq.checksum;

    // If stream already exists, just attach client
    if (this.activeStreams.has(checksum)) {
      const stream = this.activeStreams.get(checksum);

      // Capacity check
      if (stream.clients.size >= stream.maxClients) {
        return this.redirectClientToAnotherWarmNode(stream, msg, res);
      }

      stream.clients.add({ msg, res });
      this.nodeClientCount++;
      stream.lastAccess = Date.now();
      return; // processor loop will handle it
    }

    try{
      const fd = await this.getRepoFileData(msg);
  
      // Parse JSON payload
      const f = fd.json;
      if (!f || !f.result) {
        return this.sendError(res, `FILE_NOT_FOUND: ${streamReq.file}`);
      }

      // 2. Extract metadata
      const fileInfo  = f.file.fileInfo;
      const shards    = f.file.shards;
      const checksum  = fileInfo.checkSum;
      const fileType  = fileInfo.fileType;

      // 3. Handle browser ETag caching
      const ifMatch = req.headers["if-none-match"] || "";

      if (checksum && ifMatch.includes(checksum)) {
        res.writeHead(304, { "ETag": checksum });
        return res.end();
      }

      // 4. Build FILE object
      const FILE = {
        owner:    streamReq.muid,
        filename: streamReq.file,
        ftype:    fileType,
        encrypt:  streamReq.encrypt || false,
        shards,
        checksum
      };

      const fs = require('fs');
      const path = require('path');

      // 5. Build temp/cache filenames
      const targetDir = this.fstreamDir;
      const tmpname   = path.join(targetDir, `${checksum}.tmp`);
      const cacheName = path.join(targetDir, `${checksum}.cache`);


      // 6. Push into activeStreams map
      const clientID = msg.clientID || crypto.randomUUID();
      msg.clientID = clientID;

      // 6.2. Create the stream object
      const stream = {
        FILE,
        tmpname,
        cacheName,
        shards,
        fmap: null,
        fhandle: null,

        createdAt: Date.now(),
        lastAccess: Date.now(),

        clients: new Map(),          // will fill below
        lastClientActivity: Date.now(),
        timeoutMs: 30000,

        status: "queued",
        firstShardReady: false,
        nShardsFetched: 0,
        totalShards: shards.length,

        streamReq
      };

      // 6.3. Attach the first client
      stream.clients.set(clientID, { msg, req, res });
      this.nodeClientCount++;

      // 6.4. Insert into activeStreams
      this.activeStreams.set(checksum, stream);

      console.log(`Active stream created for checksum ${checksum}`);

      // 7. Respond to client with the file map
      // return this.sendFileMapResponse(FILE, res);

    } catch (err) {
      console.error("processRepoFileRequest() failed:", err);
      return this.sendError(res, "Internal error processing repo file");
    }
  }
  async getRepoFileData(msg) {

    try {
      // Normalize path (remove leading slash)
      if (path && path !== '/' && path.startsWith('/')) {
        path = path.slice(1);
      }

      const repo = {
        from : msg.stream.muid,
        name : msg.stream.name,
        file : msg.stream.file,
        path : msg.stream.path,
        folderID : msg.stream.folderID
      };

      const payload = {
        msg: {
          req: "getRepoFileData",
          repo
        }
      };

      const url = `${this.peer.ftreeReceptorURL}/netREQ`;

      const response = await this.peer.xhrPostJSON(url, payload);

      return response || null;

    } 
    catch (err) {
      console.error("getRepoFileData() failed:", err);
      return null;
    }
  }
  openFileForWritingShards(fname, shards, chunkSize) {
    try {
      // Ensure directory exists
      const dir = path.dirname(fname);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
      }

      // Open sparse file for writing
      const handle = fs.openSync(fname, 'w');

      let shardIndex = 0;
      const fmap = [];

      for (const shard of shards) {
        console.log("SHARD::", JSON.stringify(shard));

        const smap = {
          Result   : false,
          shardID  : shard.shardID,
          shardHID : shard.shardHID,
          startPos : shardIndex * chunkSize,
          nStored  : 0,
          index    : shardIndex,
          shard    : null
        };

        fmap.push(smap);
        shardIndex++;
      }

      return {
        result: true,
        fmap,
        fhandle: handle
      };

    } catch (err) {
      console.error("openFileForWritingShards() failed:", err);
      return { result: false, errMsg: "Failed to open file for writing shards" };
    }
  }
  async fastReadFromTree(muid, shards, fname, chunkSize = 256 * 1024, maxConnections = 25,stream) {
    const res = this.openFileForWritingShards(fname, shards, chunkSize);

    if (!res.result) {
      console.error("fastReadFromTree: openFileForWritingShards failed");
      return { result: false, errMsg: "Failed to open file" };
    }

    console.log("BEGIN::fastReadFromTree");

    let results = 0;

    try {
      results = await this.fastReadFileShardsNew(
        muid,
        res.fmap,
        res.fhandle,
        chunkSize,
        maxConnections,
        stream
      );
    } catch (err) {
      console.error("fastReadFileShardsNew() failed:", err);
    }

    fs.closeSync(res.fhandle);

    return {
      result: true,
      nShards: results,
      smap: res
    };
  }
  async fastReadFileShardsNew( muid,fmap,fhandle,chunkSize,maxConcurrentRequests = 20, nCopys = 3, encrypt = 0, expires = null,stream ) {
    const receptors = this.selectShardReceptors(muid, 5);
    const defaultEndpoint = this.net.shardReceptorURL;

    if (encrypt === 0) encrypt = null;

    let results = 0;
    const retryQueue = [];

    // Convert fmap into a list of jobs
    const jobs = fmap.map((map) => {
      return async () => {
        // Pick endpoint
        const endpoint =
          receptors.length > 0
            ? receptors[Math.floor(Math.random() * receptors.length)]
            : defaultEndpoint;

        // Build request body
        const req = {
          ownerID   : muid,
          hash      : map.shardID,
          hashID    : map.shardHID,
          encrypted : encrypt
        };

        const postData = {
          msg: {
            req: "requestShard",
            sIndex: map.index,
            shard: req
          }
        };

        // Fire request
        const url = `${endpoint}/netREQ`;
        const reply = await this.xhrPostJSON(url, postData);

        if (reply.error || !reply.data) {
          console.error("Shard fetch failed:", reply.error);
          retryQueue.push(postData);
          return;
        }

        // Validate content length (PHP equivalent)
        if (!reply.data || reply.data.length === 0) {
          console.error("Shard fetch returned empty data");
          retryQueue.push(postData);
          return;
        }

        // Process shard
        try {
          await this.procRemoteReads(reply.data, fmap, fhandle,stream);
          results++;
        } catch (err) {
          console.error("procRemoteReads() failed:", err);
          retryQueue.push(postData);
        }
      };
    });

    // Run jobs with concurrency limit
    await this.runConcurrent(jobs, maxConcurrentRequests);

    // Retry failed shards (1 pass, like PHP)
    if (retryQueue.length > 0) {
      console.log(`Retrying ${retryQueue.length} shards...`);

      const retryJobs = retryQueue.map((postData) => {
        return async () => {
          const endpoint =
            receptors.length > 0
              ? receptors[Math.floor(Math.random() * receptors.length)]
              : defaultEndpoint;

          const url = `${endpoint}/netREQ`;
          const reply = await this.xhrPostJSON(url, postData);

          if (reply.error || !reply.data) {
            console.error("Retry failed:", reply.error);
            return;
          }

          try {
            await this.procRemoteReads(reply.data, fmap, fhandle,stream);
            results++;
          } catch (err) {
            console.error("Retry procRemoteReads() failed:", err);
          }
        };
      });

      await this.runConcurrent(retryJobs, maxConcurrentRequests);
    }

    return results;
  }
  async procRemoteReads(resData, fmap, fhandle,stream) {
    let r;

    try {
      r = JSON.parse(resData);
    } catch (err) {
      console.error("procRemoteReads: invalid JSON:", err);
      return;
    }

    if (!r || r.result !== 1) return;

    // Global tracker equivalent (per-file)
    if (!stream.sTracker) stream.sTracker = new Set();

    const shardID = r.data.qry.shard.hash;

    // Skip duplicates
    if (stream.sTracker.has(shardID)) return;
    stream.sTracker.add(shardID);

    const encrypted = r.data.qry.shard.encrypted;
    const shardBase64 = r.data.data;

    // Find file pointer
    const startPos = this.getShardFptr(shardID, fmap);
    if (startPos === null) {
      console.error("procRemoteReads: shardID not found in fmap:", shardID);
      return;
    }

    // Write shard into sparse file
    try {
      this.writeShardDataFile(fhandle, startPos, shardBase64);
    } catch (err) {
      console.error("procRemoteReads: writeShardDataFile failed:", err);
    }
    // Update shard counters
    stream.nShardsFetched++;

    // 🌟 FIRST SHARD READY → NODE BECOMES WARM
    if (!stream.firstShardReady) {
      stream.firstShardReady = true;
      stream.status = "warm";
      console.log(`Stream ${stream.FILE.checksum} is now WARM`);

      // 🌟 SEND RESPONSE TO FIRST CLIENT IMMEDIATELY
      this.sendFirstClientResponse(stream, shardBase64);
    }

    // 🌟 ALL SHARDS FETCHED → COMPLETE
    if (stream.nShardsFetched >= stream.totalShards) {
      stream.status = "complete";
      console.log(`Stream ${stream.FILE.checksum} is COMPLETE`);
    }

  }
  getShardFptr(shardID, fmap) {
    for (const shard of fmap) {
      if (shard.shardID === shardID) {
        return shard.startPos;
      }
    }
    return null;
  }
  writeShardDataFile(handle, startPosition, shardBase64, chunkSize = 8192) {
    const decoded = Buffer.from(shardBase64, "base64");
    if (!decoded) return;

    let written = 0;
    const total = decoded.length;

    while (written < total) {
      const end = Math.min(written + chunkSize, total);
      const chunk = decoded.subarray(written, end);

      fs.writeSync(handle, chunk, 0, chunk.length, startPosition + written);
      written += chunk.length;
    }

    fs.fsyncSync(handle);
  }

};

class FstreamTreeObj {
  constructor(peerTree,reset){
    this.reset        = reset;
    this.isRoot       = null;
    this.status       = 'starting';
    this.net          = peerTree;
    this.receptor     = null;
    this.wcon         = new MkyWebConsole(this.net,null,this,'borgAgentCell');
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
    if (!this.isRoot && this.status != 'Online'){
      return true;
    }
    return false;
  }
  handleReply(r){
    if (r.req == 'doSomthingExample'){
      //do somestuff an pass result back to receptor
      //this.receptor.processResponse(r);
      return;
    } 
  }
  handleBCast(j){
    if (j.remIp == this.net.nIp) {
      //console.log('ignoring bcast to self',this.net.nIp);return;
      return;
    } 
    if (!j.msg.to) {return;}
    if (j.msg.to == 'fstreamAgents'){
      if (j.msg.req == 'someBCastRequest'){
        var qres = {req : 'someBCastRequestReply', someData : 'bla...'};
        this.receptor.someBCastREsult(j.remIp,qres);        
      }
      if (j.msg.req){
        // Sample goPOW (proof work random node selection.
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
      to : 'fstreamAgents',
      token : 'hello'
    }

    this.net.broadcast(breq);
    const gtime = setTimeout( ()=>{
      this.sayHelloPeerGroup();
    },15*1000);
  }
  doPowStop(remIp){
    this.net.gpow.doStop(remIp);
  }
  doPow(j,remIp){
    this.net.gpow.doPow(2,j.work,remIp);
  }
  receptorReqStopIPGen(work){
    var req = {
      to : 'fstreamAgents',
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
        to : 'fstreamAgents',
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

module.exports.FstreamTreeObj = FstreamTreeObj;
module.exports.FstreamTreeReceptor = FstreamTreeReceptor;

