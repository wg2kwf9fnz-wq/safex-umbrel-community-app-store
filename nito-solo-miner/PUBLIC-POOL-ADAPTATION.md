# Public Pool → Nito adaptation source map and checkpoint

Public Pool upstream reviewed at pinned commit `96a9202c11de2c6fc8d41155e2e779912a476dc7` (do not build against floating master).

## Bitcoin-specific integration seams

| Upstream path | Required Nito review/adaptation |
|---|---|
| `src/services/bitcoin-rpc.service.ts` | RPC configuration, GBT rules, template cache, polling and `submitblock` |
| `src/models/bitcoin-rpc/IBlockTemplate.ts` | GBT schema and transaction metadata |
| `src/services/stratum-v1-jobs.service.ts` | Raw template model, job updates, txid/witness trees, coinbase branch |
| `src/models/MiningJob.ts` | Coinbase script/outputs, extranonce split, header/root assembly |
| `src/models/StratumV1Client.ts` | Submitted share parsing, share target, candidate block and submission |
| `src/controllers/external-share/external-share.controller.ts` | External share parsing and header validation |
| `src/models/bitcoin-rpc/IBlockTemplateTx` | Preserve transaction bytes, txid/wtxid distinction, dependencies |

Keep Stratum transport, statistics, API/UI where chain-neutral. These paths are investigation targets, not necessarily full rewrites.

## Prototype adapter currently implemented

Dependency-free JavaScript helpers in `public-pool-adapter/nito-template-adapter.js`:

- GBT envelope/rules and transaction metadata validation; raw transaction hex retained untouched.
- Dependency index validation, ordering, closure-aware selection.
- Txid Merkle root and coinbase Merkle branches in internal byte order.
- Witness Merkle root using a null coinbase leaf, GBT witness hashes, commitment digest, and witness commitment OP_RETURN script encoding.
- Coinbase transaction serialization with one 32-byte witness-reserved-value item, stripped serialization/txid, output-value limit, and extranonce split/reassembly.
- Stratum template preparation and nine-field `mining.notify` formatting including previous-hash word order.
- Standard 80-byte header serialization and double-SHA256 header hash.
- Candidate block assembly from share nonce/time/extranonce, preserving raw template transaction bytes.

This is a compatibility prototype, not integrated into Public Pool. It compares hashes against a supplied share target and submits only network-target candidates through an injected RPC seam; pool difficulty derivation, time policy, version rolling, payout address/script validation, Nito consensus, and real `submitblock` RPC remain unintegrated.

## Source cross-check

Inspected NitoNetwork/Nito-core v3.0.0:
- `src/primitives/block.h` and `block.cpp`: standard 80-byte header serialization and HashWriter header hash.
- `src/consensus/merkle.cpp`: txid-based block Merkle root; witness root uses a null coinbase leaf.
- `src/primitives/transaction.cpp`: txid excludes witness; witness hash includes witness.
- `src/rpc/mining.cpp`: GBT exposes `data`, `txid`, `hash`, `depends`, and standard witness rules.

This confirms the inspected v3.0.0 behavior only. The user's target Nito v4 must be verified against its exact daemon/source and captured GBT fixtures; do not treat this cross-check as consensus proof.

## Test and CI checkpoint

GitHub Actions run #343 passed **50 tests** at commit `10b46604`, including optional GBT metadata validation, coinbase-height script helper, payout/witness-commitment output builder, reusable bridge lifecycle, share-target checks, and guarded submission. Fixtures are synthetic; no live/regtest mining or block submission has been performed.

## Integration roadmap

See [PUBLIC-POOL-INTEGRATION-PLAN.md](PUBLIC-POOL-INTEGRATION-PLAN.md) for exact pinned upstream file seams and replacement requirements. It is a design note only; no upstream patch has been applied.

## Required integration/release validation

1. Capture Nito v4 regtest GBT fixtures, including Orchard transactions; verify raw bytes and metadata.
2. Validate coinbase height/script rules, payout script/address and reward/fees against Nito.
3. Compare txid/wtxid, witness commitment and header hashes against daemon-produced templates and known-good fixtures.
4. Integrate the adapter into the pinned Public Pool fork's job/share path.
5. Validate share targets, timestamp/version mutation policy, block serialization and RPC `submitblock` on regtest; confirm a block.
6. Package server + UI for Umbrel, pin images, test amd64/arm64, and review RPC isolation/auth/proxy rules.

## Umbrel packaging

Use the official Public Pool Umbrel app as a packaging reference (server + UI + proxy + persistent database). Do not copy Bitcoin RPC wiring/dependencies unchanged. RPC credentials remain server-side; only intended Stratum listener and authenticated Umbrel-proxied UI/API should be exposed.
