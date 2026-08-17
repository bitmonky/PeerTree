#!/bin/bash
# Boot a single PeerTree cell inside a container.
#   NODE_NAME       label used in logs
#   CELL            cell boot file (default cronoTreeCell.js)
#   BOOTSTRAP_IPS   comma separated peer IPs seeded into the node list file
#   NET_PORT        peerTree net port (must match the cell file)
#   DB_HOST         host running the shared shellFarmer mariadb
set -u

cd /peerTree

CELL="${CELL:-cronoTreeCell.js}"
NET_PORT="${NET_PORT:-13396}"
NODE_TYPE="${NODE_TYPE:-cronoTreeCell}"
DB_HOST="${DB_HOST:-ptdb}"

mkdir -p keys

# shellFarmerDB.js hardcodes 127.0.0.1:3306 -> forward it to the shared db container
socat TCP-LISTEN:3306,fork,reuseaddr TCP:"${DB_HOST}":3306 &

if [ ! -f keys/privkey.pem ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout keys/privkey.pem -out keys/fullchain.pem -subj "/CN=${NODE_NAME:-peertree}" >/dev/null 2>&1
fi

cat > shellfarmerdbconf <<EOF
{"user":"${DB_USER:-shellfarmer}","pass":"${DB_PASS:-shellfarmer}"}
EOF

NODES_FILE="keys/myNodeList-${NET_PORT}-${NODE_TYPE}.net"
if [ -n "${BOOTSTRAP_IPS:-}" ] && [ ! -f "${NODES_FILE}" ]; then
  node -e '
    const fs=require("fs");
    const ips=process.env.BOOTSTRAP_IPS.split(",").filter(Boolean);
    fs.writeFileSync(process.argv[1], JSON.stringify(ips.map(ip=>({ip})),null,1));
  ' "$NODES_FILE"
fi

echo "[$(date -u +%T)] starting ${NODE_NAME:-cell} ${CELL} ip=$(hostname -i) bootstrap=${BOOTSTRAP_IPS:-none}"
exec node "${CELL}" "${CELL_ARG:-}"
