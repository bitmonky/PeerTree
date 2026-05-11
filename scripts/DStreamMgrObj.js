const crypto = require("crypto");
const fs = require("fs");

class DStreamMgrObj {
  constructor(net) {
    this.net = net;
    this.cell = null;
    this.streams = new Map(); // streamId → streamMeta / conversation
  }
  attachCell(cell){
   this.cell = cell;
   console.log('hello');
  }
  makeTempFilePath(streamId) {
    const dir = this.net.tmpDir || process.cwd();
    if (!dir.endsWith("/")) dir += "/";

    const file = `${dir}stream_${streamId}.bin`;

    // Remove any previous failed-attempt file
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      console.error("Failed to remove old temp file:", err);
    }
    return file;
  }
  appendShardToFile(filePath, shard) {
    return fs.promises.appendFile(filePath, shard);
  }
  // ---------------------------------------------------------
  // Create a stream descriptor for outgoing messages
  // ---------------------------------------------------------
  async createStreamMsg(msg, toIp) {
    const filename = msg.filename;
    const streamId = await this.getHash(filename);

    const shards = await this.getShardMap(filename); // { shardSize, shardHashes[], count }

    const fmap = {
      toIp,
      streamId,
      filename,
      reqId       : msg.reqId,
      shardSize   : shards.shardSize,
      shardHashes : shards.shardHashes,
      count       : shards.count,
      totalSize   : shards.totalSize,
      type        : "file",

      // State machine
      status      : "metaDataSent",   // metaDataSent → metaDataACK → transferring → completed
      acked       : false,
      completed   : false,

      // Progress
      shardsSent  : 0,
      pendingShards : new Set([...Array(shards.count).keys()]),
      inProgress  : false,

      // Diagnostics
      sentAt      : Date.now()
    };
    console.log(`createStreamMsg():: `,fmap);
    this.streams.set(streamId, fmap);

    return {
      streamId,
      shardSize: fmap.shardSize,
      shardHashes: fmap.shardHashes,
      count: fmap.count,
      type: "file",
      filename
    };
  }

  // ---------------------------------------------------------
  // Send a normal PeerTree message that includes a stream descriptor
  // ---------------------------------------------------------
  sendMsg(msg, toIp) {
    return new Promise(async (resolve) => {
      const reqId = msg.reqId = crypto.randomUUID();
    
      // Create stream descriptor
      const stream = await this.createStreamMsg(msg, toIp);
      msg.stream = stream;

      let timer;
      let failListener, replyListener, sendOKListener;

      console.log(`sendMsg():: `,msg,toIp);
      // DELIVERED PATH
      this.net.on('xhrPostOK', sendOKListener = (j) => {
        if (j.reqId === reqId) {
          this.net.removeListener('xhrPostOK', sendOKListener);

          timer = setTimeout(() => {
            this.net.removeListener('xhrFail', failListener);
            this.net.removeListener('peerTReply', replyListener);
            resolve({ result: 'timeout' });
          }, 5000);
        }
      });

      // FAILURE PATH
      this.net.on('xhrFail', failListener = (j) => {
        if (j.toHost === toIp && j.req === msg.req) {
          clearTimeout(timer);

          this.net.removeListener('xhrFail', failListener);
          this.net.removeListener('peerTReply', replyListener);
          this.net.removeListener('xhrPostOK', sendOKListener);

          this.removeStream(stream.streamId);
          resolve({ result: 'xhrFail' });
        }
      });

      // SUCCESS PATH
      this.net.on('peerTReply', replyListener = (j) => {
        console.log(`heard `,j);
        if (j.response === msg.response && j.reqId === reqId) {
          clearTimeout(timer);

          this.net.removeListener('xhrFail', failListener);
          this.net.removeListener('peerTReply', replyListener);
          this.net.removeListener('xhrPostOK', sendOKListener);
          if (j.result === 'STREAM_META_ACK'){
            console.log(`DStreamMgrObj.sendMsg():: open remote stream setting status to`,j.status);
            this.setStatus(stream.streamId, j.status);
          }
          else {
            console.error(`DStreamMgrObj.sendMsg():: failed to open remote stream`,j);
            this.removeStream(stream.streamId);
          } 
          resolve(j);
        }
      });

      this.net.sendMsgCX(toIp, msg);
    });
  }
  setStatus(sId,status){
     console.log(`setStatus():: start`,sId,status);
     const stream = this.streams.get(sId);
     stream.status = status;
     return;

  }
  // ---------------------------------------------------------
  // Send a shard to a remote host
  // ---------------------------------------------------------
  async sendStreamShard(remIp, streamId, shardIdx,shardId) {
    const shard = await this.getShardData(streamId, shardIdx);
    const msg = {
      streamId : streamId,
      shardId  : shardId,
      shardIdx : shardIdx,
      shard    : shard
    } 
     
    // Then send raw binary shard
    this.net.sendBinaryShardCX(remIp, msg);
    console.log(`Bin Sent`);
    this.setStatus(streamId,'transfering:'+shardId);
  }

  // ---------------------------------------------------------
  // Remove stream metadata
  // ---------------------------------------------------------
  removeStream(streamId) {
    this.streams.delete(streamId);
  }
  getHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);

      stream.on("data", chunk => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }
  getShardMap(filePath, shardSize = 256 * 1024) {
    return new Promise((resolve, reject) => {
      const shardHashes = [];
      let shardBuffer = Buffer.alloc(0);
      let totalSize = 0;

      const stream = fs.createReadStream(filePath);

      stream.on("data", chunk => {
        totalSize += chunk.length;

        // Append chunk to current shard buffer
        shardBuffer = Buffer.concat([shardBuffer, chunk]);

        // Process full shards
        while (shardBuffer.length >= shardSize) {
          const shard = shardBuffer.slice(0, shardSize);

          const hash = crypto.createHash("sha256")
                           .update(shard)
                           .digest("hex");

          shardHashes.push(hash);

          shardBuffer = shardBuffer.slice(shardSize);
        }
      });

      stream.on("end", () => {
        // Process final partial shard
        if (shardBuffer.length > 0) {
          const hash = crypto.createHash("sha256")
                           .update(shardBuffer)
                           .digest("hex");
          shardHashes.push(hash);
        }

        resolve({
          shardSize,
          shardHashes,
          count: shardHashes.length,
          totalSize
        });
      });

      stream.on("error", reject);
    });
  }
  getShardData(streamId, shardIdx) {
    return new Promise((resolve, reject) => {
      const stream = this.streams.get(streamId);
      if (!stream) return reject(new Error("Unknown streamId"));

      const start = shardIdx * stream.shardSize;

      // IMPORTANT: last shard may be smaller
      const end = Math.min(start + stream.shardSize - 1, stream.totalSize - 1);

      const chunks = [];
      const fstream = fs.createReadStream(stream.filename, { start, end });

      fstream.on("data", chunk => chunks.push(chunk));
      fstream.on("end", () => resolve(Buffer.concat(chunks)));
      fstream.on("error", reject);
    });
  } 
  beginStreaming(streamId) {
    const stream = this.net.isStreaming.get(streamId);
    stream.shards.forEach((shard,index) => {
      const request = {
        req      : sendShard,
        streamId : streamId,
        shardId  : shard,
        shardIdx : index,
      }
      this.net.sendMsgCX(stream.remIp,msg);
      this.gatherShards(stream);
    }); 
  }
  gatherShards(stream) {
    const handler = async (data) => {
      console.log(`gatherShards():: `,data);
      if (data.streamId !== stream.streamId){
        return;
      }
      // verify hash
      const expected = stream.shardHashes[data.index];
      if (data.shardId !== expected) {
        console.error("Shard hash mismatch");
        return;
      }

      // write shard to file
      await this.appendShardToFile(stream.tempFilePath, data.shard);

      // update progress
      stream.pendingShards.delete(data.index);
      stream.shardsReceived++;

      // check completion
      if (stream.pendingShards.size === 0) {
        this.net.removeListener('binShard', handler);
        this.closeIncomingStream(stream);
        return;
      }

      // request next shard (serialized or batched)
      this.requestNextShard(stream.streamId);
    };

    this.net.on('binShard', handler);
  }
  closeIncomingStream(stream) {
    stream.completed = true;
    stream.status = "completed";

    // Tell sender we are done
    this.net.sendMsg(stream.remIp, {
      req      : "TRANSFER_OK",
      streamId : stream.streamId
    });

    this.net.isStreaming.delete(stream.streamId);

    // Build local request for app layer
    const buildLocalReq = {
      req      : stream.request,
      reqId    : stream.reqId,
      remIp    : stream.remIp,
      response : stream.response,
      file     : stream.tempFilePath
    };

    // Deliver file to application handler
    // Send File and Initial request to the req action handler
    if (this.cell === null) {
      console.error('closeInCommingStream():: cell is NOT attached can not call stream handler!');
      return;
    }
    this.cell.handleReq(buildLocalReq.remIp, buildLocalReq);
  }
  doOpenStream(j) {
    console.log('fig');
    const fmap = {
      remIp       : j.remIp,
      streamId    : j.stream.streamId,
      filename    : j.filename,
      reqId       : j.reqId,
      response    : j.response,
      request     : j.req,
      shardSize   : j.stream.shardSize,
      shardHashes : j.stream.shardHashes,
      count       : j.stream.count,
      totalSize   : 0,
      type        : "file",

      // State machine
      status      : "readyForShards",
      acked       : true,
      completed   : false,

      // Progress
      shardsReceived : 0,
      pendingShards  : new Set([...Array(j.stream.count).keys()]),
      inProgress     : true,

      // Diagnostics
      startAt       : Date.now(),
      timeElapsed   : 0,

      // Storage
      tempFilePath  : this.makeTempFilePath(j.stream.streamId)
    };
    console.log(fmap);

    this.net.isStreaming.set(fmap.streamId, fmap);

    // ACK metadata
    const reply = {
      reqId    : j.reqId,
      response : j.response,
      result   : 'STREAM_META_ACK',
      status   : fmap.status
    };

    this.net.sendReplyCX(j.remIp, reply);

    // Start requesting shards
    this.gatherShards(fmap);
    this.requestNextShard(fmap.streamId);
  }
  requestNextShard(streamId) {
    const stream = this.net.isStreaming.get(streamId);
    if (!stream) return;

    if (stream.pendingShards.size === 0) {
      return this.closeIncomingStream(stream);
    }

    const shardIdx = stream.pendingShards.values().next().value;

    const msg = {
      req       : "sendShard",
      streamId  : streamId,
      shardIdx  : shardIdx,
      shardId   : stream.shardHashes[shardIdx],
      shardSize : stream.shardSize
    };
    console.log(`requestNextShard():: `,msg);
    this.net.sendMsgCX(stream.remIp, msg);
  }
};
module.exports.DStreamMgrObj = DStreamMgrObj;
