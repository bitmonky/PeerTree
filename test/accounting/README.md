# SFarmAccountant test suite

Runs `scripts/sFarmAccountant.js` against a throwaway MariaDB 11 carrying the
real schema (`test/selfrepair/sql/01-schema.sql` + `mariadb/shellAccounting.sql`).
The cell and the network pricing service are stubs; everything else is the
production code path.

```bash
test/accounting/run.sh          # boots the DB, loads the schema, runs the suite
```

Exits non-zero on any failure and leaves the transcript in `report/report.txt`.
To run against a DB you already have: `DB_HOST=... node test/accounting/suite.js`.

Accesses are minted the way `peerTree.verifyLogin()` records them -- a
client-signed `sesTok` of `<Address>-<reqTime>-<reqId>` written to
`borg_replay_log` -- so what the rater reads is what a live cell would write.
The suite adds the `peerMUID` column the accountant looks for (still commented
out in `shellAccounting.sql` because the cell does not write it yet), which is
what lets a shared DB attribute an access to the cell that served it.

## What it asserts

Two properties carry the design:

**Idempotency** -- rating and invoicing can be retried or raced without
double-billing or skipping an access.

| check | why it matters |
| --- | --- |
| rating twice yields one ledger row per `replayKey` | a crashed or overlapping run must not re-bill |
| accrual counts every rated line | the threshold test reads it |
| a second daily run in the same cycle issues nothing | `tblInvoiceRun` is the mutex against two cells sharing a DB |
| threshold invoice continues the sequence and `periodStart == previous periodEnd` | a mid-day invoice must not split or double-bill the day |
| `minInvoice` leaves dust accesses open | they roll into the next run rather than becoming an unpayable invoice |
| an access written behind `billedThrough` stays uninvoiced | the documented cost of a watermark, and the reason `graceMs` exists |
| a cell only bills accesses carrying its own `peerMUID` | shared DB, one farmer, many cells |
| metered (`kbyte`/`second`) accesses are left unrated | quantity is node-asserted until the client signs a completion receipt |

**Verifiability** -- a client holding only the JSON package can prove every line,
and any tampering is caught. The suite verifies a real package, then bends it
fourteen ways and requires each to be rejected:

line amount, quantity, unit price, subtotal, total, payout address, a dropped
line, a duplicated line, the merkle root, a forged client signature, stripped
rate proofs, a rewritten rate price, a rewritten rate window, a forged binding,
and a whole invoice re-signed by an unbound cell of the same farmer (header
rebuilt, re-hashed and re-signed -- only the provisioning-time binding exposes
it).

Also covered: signed payment acceptance (partial then full, with a wrong-header
signature refused), dispute + credit applied exactly once to the next invoice,
a cell with no binding refusing to bill at all, and delivery over the peer
request/reply path.
