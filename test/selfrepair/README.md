# PeerTree self-repair lab

A disposable multi-cell PeerTree network in Docker, plus a scenario suite that
injects node failures and asserts the network puts itself back together.

Cells are real `cronoTreeCell.js` processes, one per container, each with its own
routable IP on a private `198.51.100.0/24` bridge, sharing one MariaDB for the
whitelist. Containers run with `restart: unless-stopped`, which is the pm2
equivalent used in production: a cell that calls `process.exit(1)` to
re-bootstrap comes straight back. Deliberate hard-down faults use
`docker compose stop`, which keeps the cell down until it is explicitly started.

```
ptdb  198.51.100.5
n1..n7 198.51.100.11 .. .17     cronoTreeCell.js
probe  198.51.100.18            instrumentation cell (measures broadcast reach)
```

## Run

```bash
cd test/selfrepair
node suite.js --fresh     # wipe state, boot 7 cells + probe, run every scenario
node suite.js             # reuse whatever is already running
```

The run writes `report.txt` next to the suite and exits non-zero if any scenario
fails.

## What a scenario asserts

After each fault the suite polls every cell's monitor port until all of the
following hold on three consecutive polls, or the timeout expires:

- every cell that was not deliberately stopped is answering again
- all live cells name the same root
- parent/child links are consistent: no self-parent, no self-child, no link to a
  dead cell, no live non-root cell without a parent
- the left/right node chain walked from the root threads every live cell
- a broadcast from the probe cell is answered by every other live cell

The root's own `r.pCount` is only recomputed by `scanNodesRight()` once a
minute, so the suite walks the chain itself instead of trusting that counter.

## Scenarios

| scenario | fault |
| --- | --- |
| baseline | none, tree must form |
| leaf failure | stop the last node |
| interior failure | stop a cell that holds children |
| root failure | stop whichever cell currently reports `root` |
| rejoin | start every stopped cell at once |
| churn | stop two cells simultaneously |
| recover from churn | start both again |

## Tools

```bash
node chain.js               # left/right chain + parent/child table for every cell
node chain.js --watch 15    # same, on a loop
node topo.js --watch 5      # tree view
./chaos.sh kill n7          # stop a cell (stays down)
./chaos.sh revive n7        # start it again
./chaos.sh outage n7 on     # simulateOutage via the monitor port
```

## Probe cell

`probe/probeCell.js` boots an ordinary `CronoTreeObj` clone that also answers a
`reach` receptor request: it broadcasts `sendNodeList`, collects
`pNodeListGenIP` replies for a few seconds, sends `stopNodeGenIP`, and returns
the responder list. This separates "the cell's HTTP monitor is up" from "the
broadcast fabric actually reaches the cell".
