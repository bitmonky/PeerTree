# PeerTree.js — A Self‑Organizing Distributed Application Framework

PeerTree.js is a deterministic, self‑healing, bounded‑degree tree network designed for building **true distributed applications**.  
Nodes automatically join, leave, reorganize, and recover without centralized coordination.

PeerTree.js handles:

- topology  
- membership  
- routing  
- broadcast  
- fault recovery  
- structural correctness  
- cryptographic identity & message verification  
- DNS‑free HTTPS transport  

Developers focus only on **application logic**.

---

## ✨ Features

- **Self‑organizing topology**  
- **Deterministic join & drop logic**  
- **Self‑healing behavior**  
- **Efficient broadcast**  
- **Cross‑tree isolation (523)**  
- **Elliptic‑curve digital signatures**  
- **DNS‑free HTTPS using self‑signed certificates**  
- **Minimal API surface**  
- **Scales to millions of nodes**

---

# 🔐 Security Architecture

PeerTree.js includes a built‑in security layer that ensures message authenticity, peer identity validation, and encrypted transport — without DNS, certificate authorities, or external trust systems.

---

## 1. Digital Signatures (Elliptic Curve)

Every PeerTree node generates an **elliptic‑curve keypair** (secp256k1).  
All messages are:

- signed by the sender  
- verified by the receiver  
- rejected if signatures fail  

Each message includes:

- `remPublicKey` — sender’s public key  
- `signature` — ECDSA signature  
- `remMUID` — derived address (Bitcoin‑style P2PKH)  
- `msgTime` — timestamp  
- `remIp` — sender’s IP  

### Signature Verification Rules

A message is accepted only if:

1. `remPublicKey` exists  
2. `remMUID` matches the public key’s P2PKH address  
3. `borgIOSkey` matches the local node’s key  
4. `signature` is valid for `hash(remIp + msgTime)`  
5. `treeId` matches (unless it’s a join request)  

If any check fails: the msg is rejected.
This prevents spoofing, impersonation, replay attacks, and unauthorized commands.

---

## 2. DNS‑Free HTTPS Transport

PeerTree.js uses **HTTPS with self‑signed certificates** for all communication.

### Benefits

- No DNS required  
- No certificate authority required  
- No external trust dependencies  
- Works in isolated networks  
- Works with dynamic IPs  
- Works in peer‑to‑peer environments  

Each node:

- generates its own self‑signed certificate  
- exposes an HTTPS endpoint  
- validates peers using cryptographic signatures, not DNS  

This creates a **fully encrypted, trustless, peer‑to‑peer transport layer**.

---

## 3. Cross‑Tree Isolation (523)

Each tree has a unique `treeId`.

Nodes reject all foreign‑tree messages except join negotiation:


This prevents:

- routing contamination  
- accidental merging  
- cross‑organism interference  

---

# 🌳 Topology Overview

PeerTree.js maintains a **bounded‑degree tree**:

- each node has at most `maxPeers` children  
- routing tables propagate deterministically  
- the `lastNode` pointer tracks the growth tip  
- join and drop events update structure automatically  

If a structural rule fails, nodes **regroup and form a new tree**.

---

# 📣 Broadcast & Routing

## Broadcast

Broadcasts propagate downward in parallel:
root → children → grandchildren → ...


Broadcast time:
O(depth)

With `maxPeers = 100`, a million‑node tree is only ~3–4 layers deep.

## Directed Requests

Routing uses deterministic tables:

- no global lookup  
- no DHT  
- no gossip  
- no loops  

Replies follow the reverse path.

---

# 🛠 Fault Tolerance

PeerTree.js handles three drop cases:

- **Case 1:** only child  
- **Case 2:** last child  
- **Case 3:** middle child  

Each case has deterministic rules for:

- reassigning lastNode  
- updating routing tables  
- maintaining structure  

If a drop transition fails, nodes automatically **re‑discover** and **re‑form** a valid tree.

---

# 📏 Scalability

For 1,000,000 nodes:

| maxPeers | Depth | Broadcast Time (10ms hop) |
|----------|--------|---------------------------|
| 3        | ~13    | ~130ms                    |
| 10       | ~5     | ~50ms                     |
| 25       | ~4     | ~40ms                     |
| 100      | ~3     | ~30ms                     |

Flat trees = fast broadcasts + strong verification.

---

# 🧪 Verification Model

PeerTree.js supports efficient broadcast verification:

- one bottom node per parent acts as a sentinel  
- it queries its siblings  
- replies with an aggregated count  

Verification overhead:
O(N / maxPeers²)

This becomes extremely small for large `maxPeers`.

---

# 📚 Building Distributed Apps

PeerTree.js is ideal for:

- distributed storage  
- decentralized messaging  
- multi‑agent systems  
- swarm intelligence  
- real‑time collaboration  
- distributed compute  
- simulation environments  

Anything requiring **large‑scale, low‑latency, self‑organizing behavior** fits naturally.

📄 License
MIT 

🤝 Contributing
Pull requests welcome.
Please open issues for bugs, questions, or feature requests.

---






