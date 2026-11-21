# Nito Solo Miner + Wallet — prototype

**Not installable or production-ready yet.** This is a development branch with a wallet-enabled build recipe and compatibility probe. No app manifest or published image is present.

## Compatibility findings (Nito Core v4.0.0 docs/source)

- Mining uses SHA-256 and keeps the established ASIC/header hashing compatibility.
- Nito's pool compatibility contract requires v4 daemon templates, preserving complete transaction bytes, respecting `depends`, using txids for the transaction Merkle tree, and preserving witness commitment semantics.
- Orchard transactions must be treated as opaque bytes; pools must not strip, normalize, or reconstruct them.
- Pools submit the complete block via `submitblock`.
- Upstream's `docker-nito` build uses `NO_WALLET=1`; this branch adds a separate wallet-enabled headless Dockerfile using the documented `NO_QT=1`, SQLite and Berkeley DB build profile.

Official compatibility and wallet documentation:
- [Mining and pool compatibility](https://github.com/NitoNetwork/Nito-core/blob/v4.0.0/doc/nito/mining-pool-compatibility.md)
- [Source build profiles](https://github.com/NitoNetwork/Nito-core/blob/v4.0.0/doc/nito/source-builds.md)
- [Wallet backup/restore](https://github.com/NitoNetwork/Nito-core/blob/v4.0.0/doc/nito/wallet-backup-restore.md)
- [Testing and validation](https://github.com/NitoNetwork/Nito-core/blob/v4.0.0/doc/nito/testing-validation.md)

## Files

- `Dockerfile.wallet`: adapted from the upstream docker-nito multi-arch source build; removes `NO_WALLET=1` and explicitly enables headless SQLite/Berkeley DB wallet profile. It has **not been built/tested** here.
- `tests/rpc_mining_probe.py`: requires mining RPC and wallet RPC help/capability checks. It does not create wallets or alter chain state.

## Planned architecture

1. Node/wallet: pinned Nito Core, private RPC, persistent data. P2P only exposed.
2. Stratum: LAN-facing SHA-256 Stratum V1 solo server, private RPC to daemon only.
3. UI: authenticated local dashboard and wallet view. Never pass wallet secrets to the Stratum process.
4. Solo payout: configured wallet address or payout address. Avoid generating payout secrets in pool code.

## Release gates

- [ ] Build this wallet Dockerfile for amd64 and arm64, inspect binaries and verify RPC help capabilities.
- [ ] Regtest wallet create/load, receive, send, backup and restore, with recovery drill.
- [ ] Stratum integration test on regtest: job conversion, valid/invalid shares, extranonce, coinbase/witness commitments, full block submit and confirmation.
- [ ] Mainnet v4 template fixture tests including Orchard transactions (preserve complete raw `data`).
- [ ] Secure auth, CSRF protections, no secret logs, rate limits, LAN-only defaults.
- [ ] Umbrel app lifecycle and multi-arch image validation.

Never expose RPC to miners, WAN, or unauthenticated web clients. Solo mining has extremely low expected payout frequency for small hashrates; dashboard must show probability/expected time transparently.

## Stratum implementation candidate

CKPool is a strong candidate to adapt rather than write a Stratum server from scratch: it supports solo mode, Bitcoin-style RPC `getblocktemplate`, full-block submission, and Stratum V1. It is GPL-3.0, so a fork/adaptation must retain its license and notices and comply with source-distribution requirements.

**Not yet approved for Nito:** CKPool's own solo guide currently targets Bitcoin Core 32.x. Its coinbase, transaction handling, witness commitment and block assembly must be audited and tested against Nito v4's documented pool contract, including Orchard-containing templates. Do not ship it merely because it can connect to Nito RPC.

Candidate source: [ckolivas/ckpool](https://github.com/ckolivas/ckpool). The next prototype should pin a commit and build CKPool in a separate container, then use regtest fixture tests to demonstrate valid block assembly and submission before exposing Stratum port 3333.
