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

## Deeper code-path inspection (upstream pinned commit)

### Template/job generation
`src/services/stratum-v1-jobs.service.ts` currently parses every template transaction using `bitcoinjs.Transaction.fromHex(t.data)`, then derives txid leaves from parsed transactions and computes the witness root from the parsed transaction set. This is a blocker for Nito's requirement to keep Orchard-bearing transaction bytes opaque. Replace this path with a chain adapter that retains raw transaction hex and uses template `txid` / witness-hash metadata for commitments; never serialize template transactions back from a parser.

### Coinbase / job assembly
`src/models/MiningJob.ts` constructs a Bitcoin-style coinbase, inserts the extranonce into its input script, and builds the candidate Merkle root from the coinbase txid plus precomputed branches. The candidate block reconstruction currently copies parsed transaction objects, replaces the coinbase, and updates the Merkle root. For Nito, retain this general Stratum mechanism only if its coinbase format and commitment logic are verified; full candidate serialization must concatenate the serialized coinbase and original template transaction bytes.

### Share validation / submission
`src/models/StratumV1Client.ts` computes a header double-SHA256 hash for share difficulty, and for a network-difficulty candidate calls `copyAndUpdateBlock`, serializes via `bitcoinjs.Block.toHex(false)`, then calls RPC `submitblock`. Nito docs say SHA-256 mining/header compatibility remains unchanged, but block serialization must be adapted to preserve opaque transaction bytes. This is a likely minimal seam for block-candidate submission.

These findings narrow the first integration patch to template parsing/job construction and candidate-block serialization, but coinbase and witness commitment remain consensus-critical and must be tested before connecting miners.


## Prototype test expansion

The committed adapter test file includes explicit txid Merkle byte-order/odd-leaf tests, coinbase branch cases (empty, one tx, odd tx count), standard 80-byte header field-layout/hash tests, and malformed candidate-envelope rejection cases. The earlier 11-test version passed in a scratch-copy run with Node.js 22; the suite now has 17 committed tests, but the six added tests have not yet been independently run outside CI; due to GitHub clone DNS restrictions in this environment, this is not a checkout-based run. GitHub Actions status for the latest commit has not been independently confirmed. These remain synthetic fixtures and do not establish Nito consensus compatibility.


## Nito Core source cross-check (v3.0.0)

Inspected NitoNetwork/Nito-core v3.0.0 `src/primitives/block.h`, `src/primitives/block.cpp`, `src/consensus/merkle.cpp`, `src/primitives/transaction.cpp`, and `src/rpc/mining.cpp`. That pinned source uses the standard 80-byte header field serialization (version, previous hash, txid Merkle root, time, bits, nonce), `CBlockHeader::GetHash()` via HashWriter, txid-based `BlockMerkleRoot`, witness Merkle root with a null coinbase leaf, and standard GBT `data`/`txid`/`hash`/`depends` fields. This validates only the inspected v3.0.0 code; current Nito v4 behavior and actual regtest acceptance remain to be verified. Adapter now includes coinbase Merkle branch generation, standard header serialization, and header double-SHA256 helper, with synthetic tests.
