FROM node:20-bookworm-slim

WORKDIR /peerTree

RUN npm install --no-audit --no-fund \
      elliptic@6.5.7 \
      bitcoinjs-lib@5.2.0 \
      mysql2@3.11.5

# build context is the repository root
COPY scripts/ /peerTree/scripts/
COPY test/accounting/ /peerTree/test/accounting/

ENV NODE_PATH=/peerTree/node_modules
