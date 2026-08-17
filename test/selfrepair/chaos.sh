#!/bin/bash
# Chaos driver for the PeerTree self-repair lab.
#   ./chaos.sh kill n5          hard stop a cell (stays down)
#   ./chaos.sh revive n5        bring it back
#   ./chaos.sh outage n5 on|off soft outage via the node web console (simulateOutage)
#   ./chaos.sh watch [secs]     print topology every N seconds
#   ./chaos.sh snap             single topology snapshot
set -eu
cd "$(dirname "$0")"

ip_of() { echo "198.51.100.$(( 10 + ${1#n} ))"; }

case "${1:-snap}" in
  kill)   echo "== kill $2 ($(ip_of "$2"))"; docker compose stop -t 1 "$2" >/dev/null; date -u +%T ;;
  revive) echo "== revive $2 ($(ip_of "$2"))"; docker compose start "$2" >/dev/null; date -u +%T ;;
  outage)
    mode=$([ "${3:-on}" = on ] && echo startSim || echo stopSim)
    msg=$(node -e 'console.log(encodeURIComponent(JSON.stringify({req:"outage",what:"simulateOutage",smode:process.argv[1]})))' "$mode")
    curl -sk --max-time 5 "https://$(ip_of "$2"):13398/netREQ/msg=$msg"; echo ;;
  watch)  node topo.js --watch "${2:-5}" ;;
  snap)   node topo.js ;;
  *) echo "unknown: $1"; exit 1 ;;
esac
