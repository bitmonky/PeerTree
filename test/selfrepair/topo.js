#!/usr/bin/env node
// Dump the live PeerTree topology by polling every node's web-console (monPort).
// usage: node topo.js [--json] [--watch seconds]
const https = require('https');

const BASE = '198.51.100.';
const IDS = (process.env.PT_NODES || '11,12,13,14,15,16,17').split(',');
const MON_PORT = process.env.PT_MON_PORT || 13398;
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false });

function getNode(ip) {
  const msg = encodeURIComponent(JSON.stringify({ req: 'getNode', what: 'getNode' }));
  const url = `https://${ip}:${MON_PORT}/netREQ/msg=${msg}`;
  return new Promise(resolve => {
    const req = https.get(url, { agent, timeout: 4000 }, res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => {
        try { resolve({ ip, ok: true, node: JSON.parse(body) }); }
        catch { resolve({ ip, ok: false, err: 'badjson' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ip, ok: false, err: 'timeout' }); });
    req.on('error', e => resolve({ ip, ok: false, err: e.code || e.message }));
  });
}

async function snapshot() {
  return Promise.all(IDS.map(i => getNode(BASE + i)));
}

function render(results) {
  const live = results.filter(r => r.ok);
  const down = results.filter(r => !r.ok);
  const byIp = new Map(live.map(r => [r.ip, r.node]));

  const roots = live.filter(r => r.node.r.rootNodeIp === r.ip).map(r => r.ip);
  const rootSet = new Set(live.map(r => r.node.r.rootNodeIp));

  const lines = [];
  lines.push(`time ${new Date().toISOString().slice(11, 19)}  live=${live.length} down=${down.length}` +
    `  roots=[${[...rootSet].join(' ')}]${rootSet.size > 1 ? '  <-- SPLIT' : ''}`);

  const children = new Map();
  for (const r of live) {
    const p = r.node.r.myParent;
    if (p) {
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(r.ip);
    }
  }

  const seen = new Set();
  const walk = (ip, depth) => {
    if (seen.has(ip)) return;
    seen.add(ip);
    const n = byIp.get(ip);
    const tag = n
      ? `${n.status.padEnd(8)} nbr=${String(n.r.nodeNbr).padEnd(3)} layer=${n.r.mylayer} ` +
        `children=[${(n.r.myNodes || []).map(x => x.ip.replace(BASE, '.')).join(',')}] last=${(n.r.lastNode || '').replace(BASE, '.')}`
      : 'unreachable';
    lines.push(`${'   '.repeat(depth)}${depth ? '└─ ' : ''}${ip.replace(BASE, '.')}  ${tag}`);
    for (const c of (children.get(ip) || []).sort()) walk(c, depth + 1);
  };

  for (const root of roots.length ? roots : live.map(r => r.ip)) walk(root, 0);
  for (const r of live) if (!seen.has(r.ip)) walk(r.ip, 0);
  for (const d of down) lines.push(`${d.ip.replace(BASE, '.')}  DOWN (${d.err})`);
  return lines.join('\n');
}

(async () => {
  const watchIdx = process.argv.indexOf('--watch');
  const asJson = process.argv.includes('--json');
  do {
    const results = await snapshot();
    console.log(asJson ? JSON.stringify(results) : render(results) + '\n');
    if (watchIdx === -1) break;
    await new Promise(r => setTimeout(r, Number(process.argv[watchIdx + 1] || 5) * 1000));
  } while (true);
})();
