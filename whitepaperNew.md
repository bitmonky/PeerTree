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

If any check fails:

