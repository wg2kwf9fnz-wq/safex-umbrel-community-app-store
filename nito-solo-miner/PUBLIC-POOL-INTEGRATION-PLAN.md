# Pinned Public Pool integration work plan

This is an integration design note, not a patch or a ready-to-run server.

## Upstream pin

Public Pool: `benjamin-wilson/public-pool`  
Reviewed source commit: `96a9202c11de2c6fc8d41155e2e779912a476dc7`

Do not patch floating upstream branches. Keep GPL-3.0 notices and provide source for the adapted fork.

## Nito v4.0 source verification (2026-11-21)

Inspected the repository's `v4.0` source, rather than relying only on v3:
- `src/primitives/block.cpp`: `CBlockHeader::GetHash()` uses `HashWriter{} << *this`.
- `src/consensus/merkle.cpp`: txid block Merkle root uses `GetHash()`; witness root sets coinbase leaf null and uses `GetWitnessHash()` for remaining transactions.
- `src/rpc/mining.cpp`: GBT emits raw `data`, `txid`, `hash` (witness hash), and `depends`; it also advertises optional `default_witness_commitment`.
- `src/primitives/transaction.cpp`: txid excludes witness; witness hash includes witness-like data.
- `src/kernel/chainparams.cpp`: mainnet genesis `nBits=0x1d00ffff`, powLimit, and 60-second target spacing.

This is source-level verification only. No Nito v4 daemon fixture, regtest mining, or block submission has been performed.

## Concrete upstream seams

### 1. `src/services/stratum-v1-jobs.service.ts`

Current upstream creates `bitcoinjs.Block`, parses every GBT transaction with `bitcoinjs.Transaction.fromHex(tx.data)`, builds a BitcoinJS txid Merkle tree, and stores a parsed block in `IJobTemplate`.

Required replacement:
- Make a chain-neutral template/job record (80-byte header fields, raw transaction hex, txid/wtxid metadata, dependency list, target, GBT metadata).
- Normalize through `nito-template-adapter.js` without parsing transaction bytes.
- Use the adapter's txid Merkle branch and witness-commitment functions, cross-checked against Nito v4 fixtures.
- Keep template refresh/clear-job semantics and template expiry, but key work-signature fields using Nito's actual GBT fields.

### 2. `src/models/MiningJob.ts`

Current upstream constructs a BitcoinJS coinbase transaction, computes a witness commitment, splits coinbase parts, and mutates a BitcoinJS block in `buildHeaderBuffer` / `copyAndUpdateBlock`.

Current method hotspots: `createCoinbaseTransaction`, `getPaymentScript`, `buildHeaderBuffer`, `copyAndUpdateBlock`, and `response`.

Required replacement:
- Build payout outputs with a Nito-aware address/script decoder and explicit reward/fee cap.
- Include BIP34 height encoding and the GBT `coinbaseaux.flags` bytes if required by Nito.
- Use the helper for coinbase serialization, stripped txid, witness reserved value, extranonce splitting and reassembly.
- Build the txid Merkle root from the coinbase txid + branch and serialize the 80-byte header.
- Avoid `bitcoinjs.Transaction` and `bitcoinjs.Block` for Nito candidate handling.

### 3. `src/models/StratumV1Client.ts`

Current upstream parses submissions into Bitcoin-oriented version/nonce/time fields and delegates block mutation to `MiningJob`.

Current submission seam: `handleMiningSubmission` obtains the job/template, checks duplicate hashes, parses version/nonce/time, calls `buildHeaderBuffer`, calculates submission difficulty, then calls `copyAndUpdateBlock` and RPC `SUBMIT_BLOCK` for network candidates.

Required replacement:
- Derive a per-connection share target from the configured pool difficulty; do not substitute the network target.
- Validate extranonce length, nonce uint32, timestamp policy, version-mask policy, and job expiry.
- Reject low-difficulty shares; only network-target shares proceed to block serialization.
- Serialize the final block with original GBT transaction bytes and call Nito `submitblock`.
- Handle duplicate shares and node rejection results; never count a rejected/invalid share as accepted.

### 4. `src/services/bitcoin-rpc.service.ts`

Upstream currently calls `getblocktemplate` with BIP145 parameters and has no `submitblock` method in the reviewed source.

Current RPC seam: `getBlockTemplate` → `loadBlockTemplate` calls `getblocktemplate` with `rules: ['segwit']`; the reviewed service has no `submitblock` method.

Required replacement:
- Keep existing RPC credential/cookie handling private to the server.
- Normalize GBT responses with the Nito adapter.
- Add a typed `submitblock(rawBlockHex)` method and expose it only internally.
- Preserve block-cache/long-poll/ZMQ refresh semantics only after their assumptions are verified for Nito.

## Release gates

1. Build the pinned fork after each seam change.
2. Capture Nito v4 regtest GBT fixture(s) containing ordinary and Orchard-bearing transactions; do not synthesize opaque bytes as consensus evidence.
3. Compare Nito daemon's template txids/wtxids, coinbase commitment, txid Merkle root, header bytes and hash.
4. Mine a known regtest candidate, submit through the adapter, and observe acceptance and confirmation.
5. Test rejected block/share paths, duplicate shares, stale jobs, malformed extranonce, timestamps, nonce, and version rolling.
6. Only then build/publish multi-architecture Umbrel images and test install, upgrade, persistence, proxy/auth, RPC isolation, and ASIC Stratum connection.

## Current status

The standalone adapter and reusable bridge are unit-tested, but none of the upstream seams above is patched or compiled. No Nito v4 regtest, candidate submission, block confirmation, ASIC test, or Umbrel installation has been performed.
