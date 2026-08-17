#!/usr/bin/env node
/*
 * PeerTree self-repair suite.
 *
 * Boots a 7 cell tree plus one probe cell, then injects faults and waits for
 * the network to converge again. A scenario passes when, within the timeout:
 *   - every cell that was not deliberately stopped is answering again
 *   - every live cell agrees on exactly one root
 *   - the parent/child links are consistent (no orphans, no self parenting)
 *   - the left/right node chain from the root still threads every live cell
 *   - a broadcast from the probe reaches every other live cell
 *
 * The root's own r.pCount is only recomputed by scanNodesRight() once a minute,
 * so it is reported but never asserted on; the chain is walked live here instead.
 */
const { execFile } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const LAB = __dirname;
const BASE = '198.51.100.';
const CELLS = { n1: 11, n2: 12, n3: 13, n4: 14, n5: 15, n6: 16, n7: 17, probe: 18 };
const MON = 13398, RECP = 13397;
const agent = new https.Agent({ rejectUnauthorized: false });
const log = [];

const ip = n => BASE + CELLS[n];
const short = s => (s || '').replace(BASE, '.');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function say(line) { console.log(line); log.push(line); }

function sh(cmd, args, timeout = 120000) {
  return new Promise((res, rej) =>
    execFile(cmd, args, { cwd: LAB, timeout }, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))));
}
const compose = (...args) => sh('docker', ['compose', ...args]);

function get(url, timeout = 5000) {
  return new Promise(resolve => {
    const req = https.get(url, { agent, timeout }, res => {
      let b = ''; res.on('data', d => (b += d)); res.on('end', () => resolve(b));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function post(url, body, timeout = 30000) {
  return new Promise(resolve => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', agent, timeout,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, res => { let b = ''; res.on('data', d => (b += d)); res.on('end', () => resolve(b)); });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end(data);
  });
}

async function nodeState(name) {
  const msg = encodeURIComponent(JSON.stringify({ req: 'getNode', what: 'getNode' }));
  const raw = await get(`https://${ip(name)}:${MON}/netREQ/msg=${msg}`);
  if (!raw) return { name, ip: ip(name), up: false };
  try { return { name, ip: ip(name), up: true, node: JSON.parse(raw) }; }
  catch { return { name, ip: ip(name), up: false }; }
}

const snapshot = () => Promise.all(Object.keys(CELLS).map(nodeState));

function checkTree(states, expectedUp) {
  const live = states.filter(s => s.up);
  const problems = [];
  for (const s of states)
    if (!s.up && expectedUp.has(s.name)) problems.push(`${short(s.ip)} (${s.name}) is not answering`);
  if (!live.length) return { live, problems, rootIp: null };

  const roots = new Set(live.map(s => s.node.r.rootNodeIp));
  if (roots.size !== 1) problems.push(`root disagreement: ${[...roots].map(short)}`);

  const liveIps = new Set(live.map(s => s.ip));
  for (const s of live) {
    const r = s.node.r;
    const kids = (r.myNodes || []).map(k => k.ip);
    if (kids.includes(s.ip)) problems.push(`${short(s.ip)} lists itself as its own child`);
    if (r.myParent === s.ip) problems.push(`${short(s.ip)} is its own parent`);
    if (r.myParent && !liveIps.has(r.myParent)) problems.push(`${short(s.ip)} parented to dead ${short(r.myParent)}`);
    for (const k of kids) if (!liveIps.has(k)) problems.push(`${short(s.ip)} still holds dead child ${short(k)}`);
    if (s.node.status !== 'root' && !r.myParent) problems.push(`${short(s.ip)} has no parent`);
  }
  const rootState = live.find(s => s.node.status === 'root');
  if (!rootState) problems.push('no cell claims root');
  else {
    if (rootState.node.r.leftNode) problems.push(`root ${short(rootState.ip)} still has a left node`);
    // walk the right hand chain the way scanNodesRight() does, but against live state
    const byIp = new Map(live.map(s => [s.ip, s]));
    const chain = [];
    let cur = rootState, guard = 0;
    while (cur && guard++ <= live.length) {
      chain.push(cur.ip);
      const next = cur.node.r.rightNode;
      if (!next) break;
      if (chain.includes(next)) { problems.push(`right chain loops at ${short(next)}`); break; }
      cur = byIp.get(next);
      if (!cur) { problems.push(`right chain hits dead/unknown ${short(next)}`); break; }
    }
    if (chain.length !== live.length) {
      const off = live.map(s => s.ip).filter(ip => !chain.includes(ip));
      problems.push(`right chain threads ${chain.length} of ${live.length} live cells ` +
        `[${chain.map(short).join('->')}] off chain: ${off.map(short).join(',')}`);
    }
  }
  return { live, problems, rootIp: rootState && rootState.ip };
}

function render(states) {
  const live = states.filter(s => s.up);
  const byIp = new Map(live.map(s => [s.ip, s]));
  const kids = new Map();
  for (const s of live) {
    const p = s.node.r.myParent;
    if (p && p !== s.ip) kids.set(p, [...(kids.get(p) || []), s.ip]);
  }
  const out = [];
  const seen = new Set();
  const walk = (i, d) => {
    if (seen.has(i)) return;
    seen.add(i);
    const s = byIp.get(i);
    out.push(`${'   '.repeat(d)}${d ? '\\_ ' : ''}${short(i)} ${s.name.padEnd(5)} ${s.node.status.padEnd(6)} ` +
      `nbr=${s.node.r.nodeNbr} children=[${(s.node.r.myNodes || []).map(k => short(k.ip)).join(',')}]`);
    (kids.get(i) || []).sort().forEach(c => walk(c, d + 1));
  };
  live.filter(s => s.node.status === 'root').forEach(s => walk(s.ip, 0));
  live.forEach(s => walk(s.ip, 0));
  states.filter(s => !s.up).forEach(s => out.push(`${short(s.ip)} ${s.name} DOWN`));
  return out.join('\n');
}

async function reach(expectedIps) {
  const raw = await post(`https://${ip('probe')}:${RECP}/netREQ`, { msg: { req: 'reach', waitMs: 6000 } }, 30000);
  if (!raw) return { ok: false, responders: [], missing: expectedIps };
  let j; try { j = JSON.parse(raw); } catch { return { ok: false, responders: [], missing: expectedIps }; }
  const got = new Set(j.responders);
  const missing = expectedIps.filter(x => !got.has(x));
  return { ok: missing.length === 0, responders: j.responders, missing };
}

// A single good poll is not enough: right after a fault the cells can look
// consistent for a moment while joins are still in flight, so the invariants
// have to hold on HOLD consecutive polls before a scenario counts as repaired.
const HOLD = 3;

async function converge(expectedUp, timeoutMs = 90000) {
  const t0 = Date.now();
  let last = null, streak = 0, firstOk = null;
  while (Date.now() - t0 < timeoutMs) {
    const states = await snapshot();
    const res = checkTree(states, expectedUp);
    last = { states, res };
    if (!res.problems.length) {
      const live = res.live.filter(s => s.name !== 'probe').map(s => s.ip);
      const r = await reach(live);
      if (r.ok) {
        if (firstOk === null) firstOk = Date.now();
        if (++streak >= HOLD) {
          const secs = ((firstOk - t0) / 1000).toFixed(1);
          say(`  repaired in ~${secs}s, stable for ${HOLD} polls ` +
              `(structure + right chain + broadcast reach over ${r.responders.length} cells)`);
          say(render(states));
          return { ok: true, seconds: Number(secs), states };
        }
        await sleep(3000);
        continue;
      }
      last.reachMissing = r.missing;
    }
    if (streak) say(`  regressed after ${streak} good poll(s): ${res.problems.join('; ') || 'broadcast reach lost'}`);
    streak = 0; firstOk = null;
    await sleep(3000);
  }
  say(`  DID NOT CONVERGE within ${timeoutMs / 1000}s`);
  say('  problems: ' + (last.res.problems.join('; ') || 'none'));
  if (last.reachMissing) say('  broadcast never reached: ' + last.reachMissing.map(short).join(','));
  say(render(last.states));
  return { ok: false, states: last.states };
}

async function scenario(name, action, timeoutMs) {
  say(`\n=== ${name}`);
  await action();
  const r = await converge(expectedUp, timeoutMs);
  say(`  RESULT: ${r.ok ? 'PASS' : 'FAIL'}`);
  return { name, ...r };
}

const ALL = Object.keys(CELLS);
const expectedUp = new Set(ALL);
const down = async (...n) => { n.forEach(x => expectedUp.delete(x)); await compose('stop', '-t', '1', ...n); };
const up = async (...n) => { n.forEach(x => expectedUp.add(x)); await compose('start', ...n); };

(async () => {
  const fresh = process.argv.includes('--fresh');
  const results = [];

  if (fresh) {
    say('== fresh boot');
    await compose('down', '-v', '--remove-orphans', '-t', '2');
    // state dirs are written by root inside the containers
    await sh('docker', ['run', '--rm', '-v', `${path.join(LAB, 'state')}:/s`, 'alpine', 'sh', '-c', 'rm -rf /s/* /s/.[!.]* 2>/dev/null; true']);
    await compose('up', '-d', 'ptdb');
    await sleep(30000);
    for (const n of ALL) {
      await compose('up', '-d', n);
      await sleep(7000);
    }
  } else {
    await compose('up', '-d');
    await sleep(15000);
  }

  results.push(await scenario('baseline: 7 cells + probe form one tree', async () => {}, 180000));
  results.push(await scenario('leaf failure: kill last node n7', () => down('n7'), 180000));
  results.push(await scenario('interior failure: kill n2 (holds children)', () => down('n2'), 240000));
  results.push(await scenario('root failure: kill the current root', async () => {
    const states = await snapshot();
    const root = states.find(s => s.up && s.node.status === 'root');
    say(`  killing root ${short(root.ip)} (${root.name})`);
    await down(root.name);
  }, 240000));
  results.push(await scenario('rejoin: restart every stopped cell', () => up(...ALL), 300000));
  results.push(await scenario('churn: kill two cells at once', () => down('n3', 'n6'), 240000));
  results.push(await scenario('recover from churn', () => up('n3', 'n6'), 300000));

  say('\n===== SUMMARY');
  for (const r of results) say(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.seconds ? `  (${r.seconds}s)` : ''}`);
  fs.writeFileSync(path.join(LAB, 'report.txt'), log.join('\n') + '\n');
  process.exit(results.every(r => r.ok) ? 0 : 1);
})();
