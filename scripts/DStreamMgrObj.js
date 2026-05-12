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
  prepareTempFile(streamId, fileSize) {
    let dir = this.net.tmpDir || process.cwd();
    if (!dir.endsWith("/")) dir += "/";

    const file = `${dir}stream_${streamId}.bin`;

    // Remove old file if it exists
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      console.error("Failed to remove old temp file:", err);
    }

    // Pre-allocate the file to full size
    const fd = fs.openSync(file, 'w');
    fs.ftruncateSync(fd, fileSize);
    fs.closeSync(fd);

    return file;
  }
  sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
  }

  async writeShardToFile(stream,shard) {
    const filePath  = stream.tempFilePath;
    const shardSize = stream.shardSize;
    const fileSize  = stream.totalSize;
    const index     = shard.shardIdx;
    const offset    = index * shardSize;
    const expectedShardId = shard.shardId;

    const remaining = fileSize - offset;
    const isFinal   = (index === stream.count - 1)

    // 1. Size validation
    if (!isFinal) {
      // Non-final shard must match shardSize exactly
      if (shard.shard.length !== shardSize) {
        return { ok: false, reason: "BAD_SIZE", index };
      }
    } else {
      // Final shard must be <= remaining bytes
      if (shard.shard.length > remaining) {
        return { ok: false, reason: "BAD_SIZE_FINAL", index };
      }
    }
    // 2. Validate shard hash
    const actualHash = this.sha256(shard.shard);
    if (actualHash !== expectedShardId) {
      return { ok: false, reason: "BAD_HASH", index };
    }

    // 3. Random-access write
    const fh = await fs.promises.open(filePath, 'r+');
    try {
      await fh.write(shard.shard, 0, shard.length, offset);
    } finally {
      await fh.close();
    }

    return { ok: true, index };
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
      shardHashes : fmap.shardHashes,
      count       : fmap.count,
      totalSize   : fmap.totalSize,
      type        : "file",
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
  gatherShards(stream) {
    const handler = async (data) => {
      // Only handle shards for this stream
      if (data.streamId !== stream.streamId) return;

      // Forward to the shard handler
      await this.onShardReceived({
        streamId: stream.streamId,
        shard: {
          shardId:  data.shardId,
          shardIdx: data.index,
          shard:    data.shard
        }
      });
    };

    // Attach listener
    this.net.on('binShard', handler);

    // Store handler so we can remove it later in closeIncomingStream()
    stream._shardHandler = handler;
  }
  closeIncomingStream(stream) {
    // Remove shard event listener
    if (stream._shardHandler) {
      this.net.removeListener('binShard', stream._shardHandler);
      stream._shardHandler = null;
    }

    // Mark stream as completed
    stream.inProgress = false;
    stream.completed  = true;
    stream.status     = "completed";

    // Diagnostics
    stream.timeElapsed = Date.now() - stream.startAt;

    // Remove from active streams
    this.net.isStreaming.delete(stream.streamId);

    console.log(`Stream ${stream.streamId} completed in ${stream.timeElapsed}ms`);
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
  async doOpenStream(j) {
    console.log('fig',j);
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
      totalSize   : j.stream.totalSize,
      type        : "file",

      // State machine
      status      : "readyForShards",
      acked       : true,
      completed   : false,

      // Progress
      shardsReceived : 0,
      pendingShards  : new Set([...Array(j.stream.count).keys()]),
      inFlight: new Set(),     // shardIdx values currently requested but not yet received
      windowSize     : 111 ,     // or 8, or dynamic later
      inProgress     : true,

      // Diagnostics
      startAt       : Date.now(),
      timeElapsed   : 0,

      // Storage
      tempFilePath  : await this.prepareTempFile(j.stream.streamId, j.stream.totalSize)
    };

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

    // Kick off the first batch of shard requests
    this.requestShardBatch(fmap.streamId);
  }
  requestShardBatch(streamId) {
    const stream = this.net.isStreaming.get(streamId);
    if (!stream) return;

    // If nothing left, close stream
    if (stream.pendingShards.size === 0 && stream.inFlight.size === 0) {
      return;
    }

    // Fill the window
    while (
      stream.inFlight.size < stream.windowSize &&
      stream.pendingShards.size > 0
    ) {
      const shardIdx = stream.pendingShards.values().next().value;

      // Move shard from pending → inFlight
      stream.pendingShards.delete(shardIdx);
      stream.inFlight.add(shardIdx);

      const msg = {
        req       : "sendShard",
        streamId  : streamId,
        shardIdx  : shardIdx,
        shardId   : stream.shardHashes[shardIdx],
        shardSize : stream.shardSize
      };

      this.net.sendMsgCX(stream.remIp, msg);
    }
  }
  async onShardReceived(j) {
    const { streamId, shard } = j;
    const stream = this.net.isStreaming.get(streamId);
    if (!stream) return;

    const idx = shard.shardIdx;

    // 0. Ensure this shard was expected
    if (!stream.inFlight.has(idx)) {
      // Unexpected shard — ignore or log
      console.warn(`Shard ${idx} for stream ${streamId} not in flight`);
      return;
    }

    // Remove from inFlight
    stream.inFlight.delete(idx);

    // 1. Validate + write shard
    const result = await this.writeShardToFile(stream,shard);
    if (!result.ok) {
      console.warn(
        `Shard ${idx} rejected for stream ${streamId}: ${result.reason}`
      );

      // Re-request this shard
      stream.pendingShards.add(idx);

      // Continue filling the window
      this.requestShardBatch(streamId);
      return;
    }

    // 2. Mark shard as completed
    stream.shardsReceived++;

    // 3. If all shards done, close stream
    if (
      stream.shardsReceived === stream.count &&
      stream.inFlight.size === 0 &&
      stream.pendingShards.size === 0
    ) {
      console.log(`onShardReceived():: closeIncomingStream`);
      return this.closeIncomingStream(stream);
    }

    // 4. Otherwise request more shards
    this.requestShardBatch(streamId);
  }
};
module.exports.DStreamMgrObj = DStreamMgrObj;
