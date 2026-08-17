# Shell accounting: from replay log to a verifiable invoice

Schema: `mariadb/shellAccounting.sql`.

```
borg_replay_log  --rate-->  tblAccessLedger  --package-->  tblInvoice + tblInvoiceLine
                                                                |
                                              signed package -> client
                                                                |
                                        tblPayment / tblInvoiceDispute <-
```

## Why the ledger is separate from the log

`borg_replay_log` is a security artifact and must stay append-only and untouched.
Rating is a separate pass that writes one `tblAccessLedger` row per access, keyed
`UNIQUE` on `replayKey`. That single constraint gives the whole pipeline its
safety property: the rater can crash, be re-run, or run twice concurrently and
an access can still only ever be billed once. Packaging then stamps `invoiceNo`
onto the open ledger rows, so a line can only belong to one invoice.

Rates live in `tblRateCard` with an effective window and are never edited — a
price change inserts a new row. An invoice from last month can therefore still
be re-verified against the price that was actually in force, and the client can
check that the rate it agreed to is the rate it was charged (`rateHash`).

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
6. `invoiceSig` must verify against `headerHash` under `issuerPubKey`, and
   `issuerPubKey` must hash to `nodeMUID` / `payAddress`.

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

`borg_replay_log` has no column for the node that served the request (`service`
is `process.title`). With one shared MariaDB — the configuration the self-repair
lab uses — every cell's accesses land in one table and cannot be attributed to a
seller. The `ALTER TABLE` at the end of `shellAccounting.sql` adds `nodeMUID`
(plus optional `bytesIn`/`bytesOut`/`msgHash`) and should land before invoices
are generated in a shared-DB deployment.
