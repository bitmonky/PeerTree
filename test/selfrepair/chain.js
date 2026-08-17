#!/usr/bin/env node
/* Dump the left/right node chain plus tree links for every live cell.
 * usage: node chain.js [--watch seconds] */
const https = require('https');
const BASE = '198.51.100.';
const CELLS = { n1: 11, n2: 12, n3: 13, n4: 14, n5: 15, n6: 16, n7: 17, probe: 18 };
const agent = new https.Agent({ rejectUnauthorized: false });
const short = s => (s ? s.replace(BASE, '.') : '-');

function get(url, timeout = 5000) {
  return new Promise(res => {
    const req = https.get(url, { agent, timeout }, r => {
      let b = ''; r.on('data', d => (b += d)); r.on('end', () => res(b));
    });
    req.on('timeout', () => { req.destroy(); res(null); });
    req.on('error', () => res(null));
  });
}

async function state(name) {
  const msg = encodeURIComponent(JSON.stringify({ req: 'getNode', what: 'getNode' }));
  const raw = await get(`https://${BASE + CELLS[name]}:13398/netREQ/msg=${msg}`);
  if (!raw) return { name, ip: BASE + CELLS[name], up: false };
  try { return { name, ip: BASE + CELLS[name], up: true, n: JSON.parse(raw) }; }
  catch { return { name, ip: BASE + CELLS[name], up: false }; }
}

async function dump() {
  const all = await Promise.all(Object.keys(CELLS).map(state));
  const live = all.filter(s => s.up);
  console.log(new Date().toISOString().slice(11, 19) + '  live=' + live.length);
  console.log('cell   ip    status         nbr  left  right  parent  lnode lnStatus root   children');
  for (const s of all) {
    if (!s.up) { console.log(`${s.name.padEnd(6)} ${short(s.ip).padEnd(5)} DOWN`); continue; }
    const r = s.n.r;
    console.log(
      `${s.name.padEnd(6)} ${short(s.ip).padEnd(5)} ${String(s.n.status).padEnd(14)} ` +
      `${String(r.nodeNbr).padEnd(4)} ${short(r.leftNode).padEnd(5)} ${short(r.rightNode).padEnd(6)} ` +
      `${short(r.myParent).padEnd(7)} ${String(r.lnode).padEnd(5)} ${String(r.lnStatus).padEnd(8)} ` +
      `${short(r.rootNodeIp).padEnd(6)} [${(r.myNodes || []).map(k => short(k.ip)).join(',')}]`);
  }
  const byIp = new Map(live.map(s => [s.ip, s]));
  const root = live.find(s => s.n.status === 'root');
  if (root) {
    const chain = [];
    let cur = root;
    while (cur && !chain.includes(cur.ip)) {
      chain.push(cur.ip);
      cur = byIp.get(cur.n.r.rightNode);
    }
    console.log(`right chain from root: ${chain.map(short).join(' -> ')}  (${chain.length}/${live.length})`);
    const unreached = live.filter(s => !chain.includes(s.ip)).map(s => short(s.ip));
    if (unreached.length) console.log(`off chain: ${unreached.join(',')}`);
  }
  console.log('');
}

(async () => {
  const w = process.argv.indexOf('--watch');
  if (w === -1) return dump();
  const secs = Number(process.argv[w + 1] || 10);
  for (;;) { await dump(); await new Promise(r => setTimeout(r, secs * 1000)); }
})();
