# Public Pool → Nito chain adapter: source map

Reviewed upstream source at commit `96a9202c11de2c6fc8d41155e2e779912a476dc7` (do not use floating master for reproducible builds).

## High-risk Bitcoin-specific areas

| Upstream path | Required Nito review/adaptation |
|---|---|
| `src/services/bitcoin-rpc.service.ts` | RPC naming/config, GBT request rules, template cache, `submitblock`, block polling |
| `src/models/bitcoin-rpc/IBlockTemplate.ts` | GBT fields and transaction metadata; compare Nito v4 schema |
| `src/services/stratum-v1-jobs.service.ts` | Block template → Stratum job; coinbase splitting; merkle branch generation; witness commitment |
| `src/models/MiningJob.ts` | Coinbase outputs/script, tx assembly, block reconstruction and serialization |
| `src/models/StratumV1Client.ts` | Header hash / share validation / block-candidate path |
| `src/controllers/external-share/external-share.controller.ts` | External share parsing and Bitcoin header validation |
| `src/models/bitcoin-rpc/IBlockTemplateTx` | Ensure transaction bytes, txid/hash distinction and dependencies preserved |

These are **inspection targets**, not a claim that each file must be rewritten. Keep chain-neutral Stratum transport, statistics, API and UI whenever possible.

## Proposed adapter interface (design only)

A narrow chain abstraction should own:
- RPC method wrappers and template retrieval
- Template normalization without losing Nito fields/raw bytes
- Transaction identifier and Merkle-tree rules
- Coinbase construction and payout script/address validation
- Witness/consensus commitment construction
- Header serialization/hash and target/difficulty conversion
- Candidate block serialization and submission

The adapter must pass fixture tests before Public Pool's Stratum server can be exposed.

## Required fixture tests

- GBT schema and rule negotiation for Nito v4
- Template transactions with and without dependencies
- Raw transaction byte preservation, including Orchard-bearing transactions
- Correct txid Merkle root (not witness-hash substitution)
- Coinbase script/output/payout and fee total
- Nito witness commitment semantics
- Header field byte order, version, time, bits, nonce and hash
- Candidate block accepted by Nito regtest `submitblock`, then confirmed

## Umbrel packaging notes

Use the official Public Pool Umbrel app as a packaging reference (server + UI + proxy + persistent database). Do not copy its Bitcoin app dependencies or Bitcoin RPC wiring unchanged. Keep RPC credentials server-side and expose only the Stratum listener and authenticated Umbrel-proxied UI/API.
