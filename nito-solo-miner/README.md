# Nito Solo Miner + Wallet — development checkpoint

**Status: design/compatibility work; not installable yet.** This folder is intentionally not an Umbrel app manifest until the Stratum implementation and wallet-enabled node have been built, tested, and pinned.

## Goal

Extend the existing Nito Umbrel node into an optional, LAN-facing solo-mining service for SHA-256 ASICs, with a separate wallet-enabled component for receiving/spending NITO. Preserve the existing `saltedlolly-nito` app and its chain data; this is a separate app/prototype.

## Findings (checked against Nito Core v4.0.0)

- Nito Core exposes Bitcoin-style `getblocktemplate` and `submitblock` RPC mining interfaces (the mining RPC implementation is in upstream `src/rpc/mining.cpp`).
- The published `ghcr.io/nito-tools/docker-nito` image is explicitly built with `NO_WALLET=1`. It is node-only; do not assume wallet RPCs exist.
- Nito is SHA-256 proof-of-work. The Stratum layer must be tested against Nito's template/consensus behavior, including coinbase construction, extranonce handling, target/difficulty conversion, version/time/nonce fields, and block submission.
- The existing Nito Umbrel app's RPC credentials are app-scoped. Never publish the RPC port, and never give miners or the web UI unrestricted RPC access.

## Proposed component boundaries

1. **Node:** pinned Nito Core image, persistent chain volume, P2P published only.
2. **Stratum:** a dedicated pool/solo-Stratum service. RPC access only on the private Compose network. Expose a configurable LAN Stratum port; do not expose RPC/API.
3. **Wallet:** separate wallet-enabled build/service and a wallet UI with authentication. Keep wallet RPC private; no wallet credentials or seed in the Stratum container. Backup/recovery must be explicitly documented and tested before enabling wallet operations.
4. **Dashboard:** status, miner/worker connections, accepted/rejected shares, hashrate, candidate-block submissions and payout address. No secret material.

## Acceptance gates before publishing an installable app

- [ ] Build wallet-enabled Nito Core from a pinned, verified source commit for amd64 and arm64; publish immutable image digests.
- [ ] Confirm RPC capabilities on the image: `getblocktemplate`, `submitblock`, address validation, wallet creation/load, backup and restore.
- [ ] Regtest integration tests: create template, connect a Stratum client, submit valid/invalid shares, find a block, submit it, and confirm it on-chain.
- [ ] Test mainnet template parsing at current consensus rules (including v4/Orchard fields) without submitting a block.
- [ ] Test wallet recovery and encrypted backups; document a recovery drill.
- [ ] LAN-only defaults, strong generated secrets, no exposed RPC, rate limiting, input validation, and clear solo-mining economics warning.
- [ ] Multi-arch image build and Umbrel install/upgrade/uninstall test.

## Compatibility probe

Run `tests/rpc_mining_probe.py` against a node with RPC enabled. It checks the basic mining-template contract only; it is not a Stratum implementation or proof that block submission is safe.
