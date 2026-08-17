FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl socat curl ca-certificates procps iproute2 iputils-ping iptables \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /peerTree

RUN npm install --no-audit --no-fund \
      elliptic@6.5.7 \
      bitcoinjs-lib@5.2.0 \
      mysql2@3.11.5 \
      axios@1.7.9 \
      portscanner@2.2.0 \
      bs58@5.0.0 \
      node-schedule@2.1.1

# build context is the repository root
COPY scripts/ /peerTree/
COPY test/selfrepair/probe/ /peerTree/
COPY test/selfrepair/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
