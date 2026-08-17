/*
 * Test-only PeerTree cell used by the self-repair lab.
 *
 * It is an ordinary cronoTreeCell clone (same netName/ports, so it joins the
 * same tree) with one extra receptor endpoint:
 *
 *   POST /netREQ {"msg":{"req":"reach"}}
 *
 * which fires the stock `sendNodeList` broadcast and reports every cell that
 * answered. The answer set is the set of nodes the root-side broadcast fabric
 * can actually reach, which is what we assert on while nodes are being killed.
 */
const { CronoTreeObj, CronoTreeReceptor } = require('./cronoTreeObj.js');

class ProbeObj extends CronoTreeObj {
  async reach(waitMs = 7000) {
    const responders = new Set();
    let onReply;
    const req = {
      to: 'cronoAgents',
      req: 'sendNodeList',
      nodes: 999,
      work: require('crypto').randomBytes(20).toString('hex')
    };
    this.net.on('mkyReply', onReply = r => {
      if (r.req === 'pNodeListGenIP') responders.add(r.remIp);
    });
    this.net.broadcast(req);
    await new Promise(r => setTimeout(r, waitMs));
    this.receptorReqStopIPGen(req.work);
    this.net.removeListener('mkyReply', onReply);
    return {
      probeIp: this.net.rnet.myIp,
      rootIp: this.net.rnet.r.rootNodeIp,
      responders: [...responders].sort()
    };
  }
}

class ProbeReceptor extends CronoTreeReceptor {
  async handleReq(j, res) {
    if (j.msg.req === 'reach') {
      const out = await this.peer.reach(j.msg.waitMs || 7000);
      res.writeHead(200);
      return res.end(JSON.stringify(out) + '\n');
    }
    return super.handleReq(j, res);
  }
}

module.exports.ProbeObj = ProbeObj;
module.exports.ProbeReceptor = ProbeReceptor;
