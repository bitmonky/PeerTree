// DStreamMgrObj.js

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

class DStreamMgrObj {
  constructor(net) {
    this.net = net;

    // Map<streamId, streamState>
    if (!this.net.isStreaming) {
      this.net.isStreaming = new Map();
    }
  }

  // ---------- Low-level helpers ----------

  makeTempFilePath(streamId) {
    const dir = this.net.tmpDir || process.cwd();
    return path.join(dir, `stream_${streamId}.bin`);
  }

  appendShardToFile(filePath, shard) {
    return fs.promises.appendFile(filePath, shard);
  }

  getHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  getShardMap(filePath, shardSize = 256 * 1024) {
    return new Promise((resolve, reject) => {
      const shardHashes = [];
      let shardBuffer = Buffer.alloc(0);
      let totalSize = 0;

      const stream = fs.createReadStream(filePath);

      stream.on('data', chunk => {
        totalSize += chunk.length;
        shardBuffer = Buffer.concat([shardBuffer, chunk]);

        while (shardBuffer.length >= shardSize) {
          const shard = shardBuffer.slice(0, shardSize);
          const hash = crypto.createHash('sha256')
                             .update(shard)
                             .digest('hex');
          shardHashes.push(hash);
          shardBuffer = shardBuffer.slice(shardSize);
        }
      });

      stream.on('end', () => {
        if (shardBuffer.length > 0) {
          const hash = crypto.createHash('sha256')
                             .update(shardBuffer)
                             .digest('hex');
          shardHashes.push(hash);
        }

        resolve({
          shardSize,
          shardHashes,
          count: shardHashes.length,
          totalSize
        });
      });

      stream.on('error', reject);
    });
  }

  getShardData(filePath, shardSize, shardIdx) {
    return new Promise((resolve, reject) => {
      const start = shardIdx * shardSize;
      const end = start + shardSize - 1;

      const chunks = [];
      const stream = fs.createReadStream(filePath, { start, end });

      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  // ---------- Outgoing stream (sender) ----------

  async beginOutgoingStream(remIp, filename, req, response) {
    const shards = await this.getShardMap(filename);
    const streamId = crypto.randomBytes(16).toString('hex');

    const fmap = {
      remIp,
      streamId,
      filename,
      reqId       : crypto.randomBytes(8).toString('hex'),
      response,
      request     : req,
      shardSize   : shards.shardSize,
      shardHashes : shards.shardHashes,
      count       : shards.count,
      totalSize   : shards.totalSize,
      type        : 'file',

      status      : 'metaDataSent',
      acked       : false,
      completed   : false,

      shardsSent    : 0,
      inProgress    : true,
      startAt       : Date.now(),
      timeElapsed   : 0
    };

    this.net.isStreaming.set(streamId, fmap);

    const metaMsg = {
      req       : 'openStream',
      remIp,
      streamId,
      filename,
      reqId     : fmap.reqId,
      response,
      req,
      shards
    };

    this.net.sendMsg(remIp, metaMsg);
  }

  async sendShard(remIp, streamId, shardIdx) {
    const stream = this.net.isStreaming.get(streamId);
    if (!stream) return;

    const shard = await this.getShardData(stream.filename, stream.shardSize, shardIdx);
    const shardId = crypto.createHash('sha256').update(shard).digest('hex');

    // POST /binShard?streamId=...&index=...
    // Your HTTP layer should emit 'binShard' on the receiver.
    this.net.sendBinaryShard(remIp, {
      streamId,
      index   : shardIdx,
      shardId,
      shard
    });

    stream.shardsSent++;
  }

  // ---------- Incoming stream (receiver) ----------

  doOpenStream(j) {
    const fmap = {
      remIp       : j.remIp,
      streamId    : j.streamId,
      filename    : j.filename,
      reqId       : j.reqId,
      response    : j.response,
      request     : j.req,
      shardSize   : j.shards.shardSize,
      shardHashes : j.shards.shardHashes,
      count       : j.shards.count,
      totalSize   : j.shards.totalSize,
      type        : 'file',

      status        : 'readyForShards',
      acked         : true,
      completed     : false,
      shardsReceived: 0,
      pendingShards : new Set([...Array(j.shards.count).keys()]),
      inProgress    : true,

      startAt      : Date.now(),
      timeElapsed  : 0,
      tempFilePath : this.makeTempFilePath(j.streamId)
    };

    this.net.isStreaming.set(fmap.streamId, fmap);

    const reply = {
      reqId    : j.reqId,
      response : j.response,
      result   : 'STREAM_META_ACK',
      status   : fmap.status
    };

    this.net.sendReply(j.remIp, reply);

    this.gatherShards(fmap);
    this.requestNextShard(fmap.streamId);
  }

  requestNextShard(streamId) {
    const stream = this.net.isStreaming.get(streamId);
    if (!stream) return;
    if (stream.pendingShards.size === 0) return;

    const shardIdx = stream.pendingShards.values().next().value;

    const msg = {
      req      : 'sendShard',
      streamId,
      shardIdx
    };

    this.net.sendMsg(stream.remIp, msg);
  }

  gatherShards(stream) {
    const handler = async (data) => {
      if (data.streamId !== stream.streamId) return;

      const expected = stream.shardHashes[data.index];
      if (data.shardId !== expected) {
        // hash mismatch – drop shard
        return;
      }

      await this.appendShardToFile(stream.tempFilePath, data.shard);

      stream.pendingShards.delete(data.index);
      stream.shardsReceived++;

      if (stream.pendingShards.size === 0) {
        this.net.removeListener('binShard', handler);
        this.closeIncomingStream(stream);
        return;
      }

      this.requestNextShard(stream.streamId);
    };

    this.net.on('binShard', handler);
  }

  closeIncomingStream(stream) {
    stream.completed = true;
    stream.status = 'completed';
    stream.timeElapsed = Date.now() - stream.startAt;

    this.net.sendMsg(stream.remIp, {
      req      : 'TRANSFER_OK',
      streamId : stream.streamId
    });

    this.net.isStreaming.delete(stream.streamId);

    const buildLocalReq = {
      req      : stream.request,
      reqId    : stream.reqId,
      remIp    : stream.remIp,
      response : stream.response,
      file     : stream.tempFilePath
    };

    this.net.handleRequest(buildLocalReq.remIp, buildLocalReq);
  }
}

module.exports = DStreamMgrObj;

