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

## Prototype adapter implemented

Dependency-free JavaScript helpers in `public-pool-adapter/nito-template-adapter.js`:

- GBT envelope/rules, mandatory target, optional mining metadata, and coinbaseaux hex validation; raw transaction hex is retained untouched.
- Dependency index validation, ordering, closure-aware selection.
- Txid Merkle root and coinbase Merkle branches in internal byte order.
- Witness Merkle root using a null coinbase leaf, GBT witness hashes, commitment digest, witness commitment OP_RETURN script, and payout-output builder with reward cap.
- Coinbase serialization with witness-reserved-value item, stripped serialization/txid, extranonce split/reassembly, and BIP34-style height script helper with minimal small-height opcodes.
- Stratum template preparation and nine-field `mining.notify` formatting including previous-hash word order.
- Compact `nBits` target decoder; difficulty-derived share target uses Nito v4 mainnet genesis `1d00ffff` as diff-1 baseline.
- Standard 80-byte header serialization and double-SHA256 header hash.
- Candidate block assembly from share nonce/time/extranonce, preserving raw template transaction bytes.
- Private HTTP JSON-RPC client factory and injected RPC adapter seam.
- Reusable server-side bridge: template refresh, bounded job cache with TTL/work-change invalidation, job creation with supplied or difficulty-derived share target, share processing, and guarded block submission.

This is a compatibility prototype, not integrated into Public Pool. It does not validate pool-configured session difficulty, timestamp policy, version rolling, payout address/script, Nito consensus, or real RPC/block submission.

## Nito v4.0 source verification

Inspected `NitoNetwork/Nito-core` tag/ref `v4.0`:
- `src/primitives/block.cpp`: `CBlockHeader::GetHash()` uses `HashWriter{} << *this`.
- `src/consensus/merkle.cpp`: txid block Merkle root uses `GetHash()`; witness root sets coinbase leaf null and uses `GetWitnessHash()` for other transactions.
- `src/rpc/mining.cpp`: GBT emits raw `data`, `txid`, `hash` (witness hash), `depends`, and optional `default_witness_commitment`.
- `src/primitives/transaction.cpp`: txid excludes witness; witness hash includes witness-like data.
- `src/kernel/chainparams.cpp`: mainnet genesis bits `0x1d00ffff`, powLimit and 60-second target spacing.

This is source-level verification only. No captured Nito v4 GBT fixture, regtest mining, candidate submission, or block confirmation has been performed.

## Test and CI checkpoint

GitHub Actions run #608 passed **61 tests** at commit `08649a28`, including optional GBT metadata validation, minimal coinbase height opcode encodings, GBT default witness-commitment cross-check, TTL expiry, duplicate-share rejection and RPC retry handling, work-change job invalidation, bridge-boundary normalization, private JSON-RPC transport, difficulty-derived share targets, and compact nBits decoding. Fixtures are synthetic; no live/regtest mining or real block submission has been done.

## Integration roadmap

See [PUBLIC-POOL-INTEGRATION-PLAN.md](PUBLIC-POOL-INTEGRATION-PLAN.md) for exact pinned upstream file seams and replacement requirements. It is a design note only; no upstream patch has been applied.

## Required integration/release validation

1. Capture Nito v4 regtest GBT fixtures, including Orchard transactions; verify raw bytes and metadata.
2. Validate coinbase height/script rules, payout script/address and reward/fees against Nito.
3. Compare txid/wtxid, witness commitment and header hashes against daemon-produced templates and known-good fixtures.
4. Integrate the adapter into the pinned Public Pool fork's job/share path.
5. Validate pool-configured share targets, timestamp/version mutation policy, block serialization and RPC `submitblock` on regtest; confirm a block.
6. Package server + UI for Umbrel, pin images, test amd64/arm64, and review RPC isolation/auth/proxy rules.

## Umbrel packaging

Use the official Public Pool Umbrel app as a packaging reference (server + UI + proxy + persistent database). Do not copy Bitcoin RPC wiring/dependencies unchanged. RPC credentials remain server-side; only intended Stratum listener and authenticated Umbrel-proxied UI/API should be exposed.
