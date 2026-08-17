# Shell accounting: from replay log to a verifiable invoice

Schema: `mariadb/shellAccounting.sql`.

```
borg_replay_log  --rate-->  tblAccessLedger  --package-->  tblInvoice + tblInvoiceLine
                                                                |
                                              signed package -> client
                                                                |
                                        tblPayment / tblInvoiceDispute <-
```

## Who the seller is

Two identities, deliberately separate:

| identity | table | role |
| --- | --- | --- |
| `farmerMUID` | `tblFarmer` | payout identity, supplied by the owner when the node is registered and provisioned |
| `peerMUID` | cell wallet | signing identity of the cell that actually served the request |

An invoice is *sold by* the farmer and *signed by* the cell, so `tblInvoice` carries
both (`farmerMUID`, `signerMUID`) and `payAddress` defaults to `farmerMUID`. A
signature from the cell alone would let a compromised cell name any payout
address it likes, so the invoice also carries the provisioning-time binding
(`tblFarmerCell`: `bindHash` + owner/network signatures, copied into
`bindProof`). The client's authority check is therefore: `invoiceSig` verifies
under the cell's key, the binding covers that cell and is not revoked, and
`payAddress` matches the bound farmer. One farmer can own many cells, and
invoice sequence numbers run per `(farmerMUID, borgHUID)` so a client sees one
chained billing relationship per owner rather than one per cell.

## Why the ledger is separate from the log

`borg_replay_log` is a security artifact and must stay append-only and untouched.
Rating is a separate pass that writes one `tblAccessLedger` row per access, keyed
`UNIQUE` on `replayKey`. That single constraint gives the whole pipeline its
safety property: the rater can crash, be re-run, or run twice concurrently and
an access can still only ever be billed once. Packaging then stamps `invoiceNo`
onto the open ledger rows, so a line can only belong to one invoice.

## Pricing comes from the network, priced at time of access

Pricing is published per service type by a network pricing service. The node
fetches the current card at the start of an invoicing run and caches it verbatim
in `tblRateCard` — publisher identity, `cardVersion`, effective window and
`rateSig` included. Cards are never edited; a price change is a new
`cardVersion`.

The rater then resolves the card whose effective window contains each access's
`tokTime`, **not** the card current at invoicing time. Billing a period at
today's price would charge last month's accesses at a rate the client never
agreed to and could not check. Every card cited by a line is copied into the
invoice's `rateProof`, so the client verifies the price under the publisher's
signature without having to call the pricing service — and an invoice re-verifies
years later even if the card is long superseded.

One consequence worth stating: the pricing service is a trusted third party for
price, and if it is unreachable a node cannot start an invoicing run. Cached
cards make that survivable (invoice an old period from cache), but a node that
has never fetched a card cannot bill.

## When an invoice is cut

Daily cycle **or** accrual threshold, whichever fires first (`tblBillingPolicy`):

```
every cycle tick (cycleMs, anchored on cycleAnchor):
  for each active account: if accrued >= minInvoice -> issue
on rating an access:
  if account.accrued >= policy.threshold           -> issue that account now
```

Periods are defined by a watermark, not by the clock: `periodStart` is always the
account's `billedThrough` and `periodEnd` is `now - graceMs`, so periods are
contiguous and gap-free no matter which trigger fires or how late a run is. That
is what keeps a threshold invoice in the middle of a day from splitting or
double-billing the day's accesses. `graceMs` holds back the most recent few
minutes so an access still being written cannot land after the boundary of an
invoice that already closed.

`minInvoice` suppresses dust: below it the daily run issues nothing and the
accesses roll into the next cycle. `threshold` bounds the seller's exposure to a
client that never pays, which the daily cycle alone does not.

`tblInvoiceRun` is taken before any invoice is written and is unique on
`(farmerMUID, runKey)`, where `runKey` is `daily:<cycleIndex>` or
`thresh:<borgHUID>:<cycleIndex>`. That row is the mutex: a retried cron tick, or
two cells of the same farmer sharing a DB, cannot both issue for the same cycle.

## What the client can verify, item by item

Each `tblInvoiceLine` is self-contained. Verification of a line:

1. `signedPayload` must equal `` `${myMUID}-${reqTime}-${reqId}` `` — it names the
   client's own MUID, so a seller cannot fabricate a line for a client that
   never called.
2. `borgTokenSig` must verify against `sha256(signedPayload)` under
   `clientPubKey`, and `clientPubKey` must hash to the client's P2PKH address.
   Only the client's private key could have produced that signature, so the line
   is proof the client authored that request.
3. `replayKey` = `${Address}:${reqId}`, and `reqId` is unique per request, so
   duplicate billing of one access is detectable by the client on its own.
4. `leafHash` = `sha256` of the canonical line JSON
   (`replayKey, tokTime, service, request, quantity, unit, unitPrice, amount,
   rateHash, borgTokenSig` — keys sorted, no whitespace).
5. `merklePath` folded from `leafHash` must reproduce `tblInvoice.merkleRoot`.
6. `invoiceSig` must verify against `headerHash` under `issuerPubKey`;
   `issuerPubKey` must hash to `signerMUID`; and `bindProof` must show that
   `signerMUID` was bound to `farmerMUID` (unrevoked) and that `payAddress`
   belongs to that farmer.

So the invoice is a signed commitment by the seller to a set of client-signed
requests. The client pays by sending to `payAddress` (the seller's own MUID
address) and records acceptance by signing `headerHash` (`tblPayment.payerSig`);
anything it will not accept goes into `tblInvoiceDispute` with the offending
`lineNo`.

`seq` + `prevMerkleRoot` chain a client's invoices from one seller, so a seller
cannot silently withdraw or re-issue a past period: any gap or fork in the chain
is visible to the client.

## Honest limits of the current proof

The borgToken proves *the client authored a request at time T*. It does not
prove:

- **what** was requested — `service`/`request` are node-asserted. `sesTok` is
  only `MUID-reqTime-reqId`; the message-hash binding that would fix this is
  written but commented out in `verifyLogin()` (`scripts/peerTree.js`, the
  `PROPOSED MSG TAMPERING TEST` block). Enabling it and logging `msgHash` makes
  the requested operation part of what the client signed.
- **how much** work it was — bytes and duration are not signed by anyone, so
  `kbyte`/`second` billing is only as trustworthy as the seller. That is why
  `tblAccessLedger.quantitySrc` records provenance: `token`/`receipt` lines are
  client-provable, `node` lines are not.
- **that the node delivered anything**. A per-request client-signed receipt
  (client signs `reqId` + byte count on completion) would close both gaps and is
  the one protocol addition worth making before metered billing is trusted.

Billing on `unit='access'` with the msgHash binding enabled is fully provable
today; metered units need the receipt.

## Also required

`borg_replay_log` has no column for the cell that served the request (`service`
is `process.title`). With one shared MariaDB — the configuration the self-repair
lab uses — every cell's accesses land in one table and cannot be attributed to a
seller. The `ALTER TABLE` at the end of `shellAccounting.sql` adds `peerMUID`
(plus optional `bytesIn`/`bytesOut`/`msgHash`) and should land before invoices
are generated in a shared-DB deployment; the farmer is then resolved through
`tblFarmerCell`.

`tblFarmer` is currently written and read by nothing in `scripts/` — only the
cell's own `peerMUID` is used — so registration needs to populate `tblFarmer`
and `tblFarmerCell` for any of this to resolve.
