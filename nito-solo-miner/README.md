# Nito Solo Mining with Public Pool — compatibility prototype

**Development checkpoint only. Not installable or production-ready.**

## Target architecture

`Nito Core node (Umbrel)` → `adapted Public Pool server` → `ASIC miners over Stratum V1`

Retain/adapt Public Pool's dashboard and statistics. Node RPC stays private between the node and pool server; never expose RPC to miners or WAN.

## Integration roadmap

Exact pinned Public Pool source seams and release gates are documented in [PUBLIC-POOL-INTEGRATION-PLAN.md](PUBLIC-POOL-INTEGRATION-PLAN.md). This is a plan, not an applied upstream patch.

## Upstream assessment

Public Pool upstream: https://github.com/benjamin-wilson/public-pool  
UI: https://github.com/benjamin-wilson/public-pool-ui  
Umbrel packaging reference: https://github.com/getumbrel/umbrel-apps/tree/master/public-pool

Public Pool is Bitcoin-specific, not a drop-in Nito server. It parses/rebuilds transactions and blocks using Bitcoin-oriented models. Merely changing the RPC endpoint is insufficient.

## Work completed

- Reviewed Public Pool's RPC, template, Stratum job, MiningJob and share-submission paths at pinned upstream commit `96a9202c11de2c6fc8d41155e2e779912a476dc7`.
- Inspected Nito Core v4.0 source: 80-byte header HashWriter hashing; txid Merkle root; witness Merkle root uses null coinbase leaf and wtxids; GBT emits raw data/txid/hash/depends and optional default witness commitment; mainnet genesis bits are `1d00ffff`. Source-level verification is documented in `PUBLIC-POOL-INTEGRATION-PLAN.md`; daemon fixtures/regtest are still unverified.
- Prototype adapter validates the GBT envelope/rules/transaction metadata, preserves raw transaction hex, dependency indexes/order and dependency closure.
- Implements txid Merkle roots, coinbase Merkle branches, witness Merkle root/commitment digest, commitment OP_RETURN script encoding.
- Implements basic coinbase serialization with BIP34 height script helper and witness reserved value, stripped txid calculation, extranonce split/reassembly.
- Implements normalized Stratum template preparation and nine-field `mining.notify` formatting, including previous-hash word order.
- Implements 80-byte header serialization/hash and candidate-block assembly from share nonce/time/extranonce while preserving opaque GBT transaction bytes; full block serialization occurs only for network-target candidate, even if the pool share target is stricters.
- Added a GitHub Actions workflow with syntax checks and Node tests.
- Added guarded network-candidate submission through the injected RPC seam; ordinary shares never trigger `submitblock`.
- Enforced the coinbase output reward cap at job creation.
- Added an injectable Nito RPC adapter seam for GBT retrieval and `submitblock`, plus a Stratum job/share bridge that builds `mining.notify` and assembles candidate blocks.
- Added pure RPC payload helpers and an injectable RPC-call seam tested with fake calls, plus a private HTTP JSON-RPC client factory with username/password or cookie-file authentication; no real Nito daemon RPC has been made.

## Capturing real Nito templates

The read-only RPC probe checks that compact bits decode to the advertised full target and that transaction raw-envelope fields are present. It can optionally save a raw GBT fixture for later compatibility tests: set `NITO_GBT_FIXTURE_PATH` and authenticate with either `NITO_RPC_COOKIE_FILE` or `NITO_RPC_USER`/`NITO_RPC_PASSWORD`. It creates the file with mode `0600`; the fixture includes raw transaction data, so keep it private. This capture has not been run against a node from this environment.

## Verification status

- GitHub Actions run #64 passed 21 tests at commit `64d68db`.
- GitHub Actions run #582 passed **59 tests** at commit `1e112ac6`, including bridge-boundary normalization. Two additional tests now cover optional transaction numeric metadata and GBT `mintime` enforcement; latest CI is pending. The workflow supports manual dispatch. Earlier CI caught and corrected noncerange, extranonce-offset, and fixture assumptions.
- No Nito v4 captured GBT fixture, Nito regtest `submitblock`, live mining, pool-calculated share-difficulty integration (the isolated helper accepts a supplied share target and evaluates it), or consensus validation has been performed.
- The adapter is still not integrated into Public Pool's actual server.

## Next engineering steps

1. Latest known GitHub Actions run #402 passed **52 tests**; 2 new tests are pending CI.
2. Build captured Nito v4/regtest GBT fixtures, including Orchard transactions.
3. Validate coinbase height/script rules, payout script/address, reward limits, witness commitment and txid/wtxid semantics against the exact Nito daemon.
4. Integrate the raw-transaction path into a pinned Public Pool fork: job creation, Stratum submission/share validation, candidate block serialization and RPC `submitblock`.
5. Test candidate blocks on Nito regtest, then package/publish multi-arch Umbrel images.

## Release gates

- [ ] Public Pool source pinned and GPL-3.0 notices preserved.
- [ ] RPC credentials remain server-side and RPC is private.
- [ ] Nito v4 fixture/consensus tests pass.
- [ ] Regtest candidate submission and block confirmation pass.
- [ ] Stratum share validation, UI/API auth and Umbrel proxy reviewed.
- [ ] amd64/arm64 images built and tested.

No wallet creation, live mining, block submission, or main-branch changes have been performed.
