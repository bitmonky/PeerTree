const crypto = require("crypto");
const fs = require("fs");

class DStreamMgrObj {
  constructor(net) {
    this.net = net;
    this.streams = new Map(); // streamId → streamMeta / conversation
  }

  // ---------------------------------------------------------
  // Create a stream descriptor for outgoing messages
  // ---------------------------------------------------------
  createStreamMsg(msg, toIp) {
    const filename = msg.filename;
    const streamId = this.getHash(filename + Date.now());

    const shards = this.getShardMap(filename); // { shardSize, shardHashes[], count }

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
    const reqId = msg.reqId = crypto.randomUUID();

    // Create stream descriptor
    const stream = this.createStreamMsg(msg, toIp);
    msg.stream = stream;

    let timer;
    let failListener, replyListener, sendOKListener;

    return new Promise((resolve) => {

      // DELIVERED PATH
      this.net.on('xhrPostOK', sendOKListener = (j) => {
        if (j.reqId === reqId) {
          this.net.removeListener('xhrPostOK', sendOKListener);

          timer = setTimeout(() => {
            this.net.removeListener('xhrFail', failListener);
            this.net.removeListener(this.listener, replyListener);
            resolve({ result: 'timeout' });
          }, 5000);
        }
      });

      // FAILURE PATH
      this.net.on('xhrFail', failListener = (j) => {
        if (j.toHost === toIp && j.req === msg.req) {
          clearTimeout(timer);

          this.net.removeListener('xhrFail', failListener);
          this.net.removeListener(this.listener, replyListener);
          this.net.removeListener('xhrPostOK', sendOKListener);

          this.removeStream(stream.streamId);
          resolve({ result: 'xhrFail' });
        }
      });

      // SUCCESS PATH
      this.net.on(this.listener, replyListener = (j) => {
        if (j.response === msg.response && j.reqId === reqId) {
          clearTimeout(timer);

          this.net.removeListener('xhrFail', failListener);
          this.net.removeListener(this.listener, replyListener);
          this.net.removeListener('xhrPostOK', sendOKListener);

          this.setStatus(stream.streamId,'metaDataACK');
          resolve(j);
        }
      });

      this.net.sendMsgCX(toIp, msg);
    });
  }

  // ---------------------------------------------------------
  // Send a shard to a remote host
  // ---------------------------------------------------------
  sendStreamShard(remIp, streamId, shardId) {
    const shard = getShardData(streamId, shardId);

    const reply = {
      req: 'acceptStreamShard',
      streamId,
      shardId
    };

    // Send metadata first
    this.net.sendReplyCX(remIp, reply);

    // Then send raw binary shard
    this.net.sendBinaryCX(remIp, shard);
    this.setStatus(streamId,'tranfering',shardId),
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
  getShardData(filePath, shardSize, shardId) {
    return new Promise((resolve, reject) => {
      const start = shardId * shardSize;
      const end   = start + shardSize - 1;

      const chunks = [];
      const stream = fs.createReadStream(filePath, { start, end });

      stream.on("data", chunk => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }
}
module.exports = DStreamMgrObj;
