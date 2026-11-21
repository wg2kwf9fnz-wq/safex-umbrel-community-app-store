# Nito Solo Mining with Public Pool — compatibility prototype

**Development checkpoint only. Not installable or production-ready.** The goal is to run a self-hosted Stratum server against the user's own Nito node, using Ben Wilson's Public Pool project and its UI where possible.

## Target architecture

`Nito Core node (Umbrel)` → `Public Pool server (adapted)` → `ASIC miners over Stratum V1`

The Public Pool UI should be retained/adapted for dashboard, worker and share stats. The Umbrel app will connect to the local node over private RPC; RPC must never be exposed to miners or the WAN.

## Public Pool assessment

Upstream project: [benjamin-wilson/public-pool](https://github.com/benjamin-wilson/public-pool)  
Upstream UI: [public-pool-ui](https://github.com/benjamin-wilson/public-pool-ui)  
Umbrel packaging reference: [official Public Pool Umbrel app](https://github.com/getumbrel/umbrel-apps/tree/master/public-pool)

Public Pool is **not a drop-in Nito Stratum server**. Its server is Bitcoin-specific and depends on Bitcoin-oriented data models and `bitcoinjs-lib` block/transaction primitives. Merely changing the RPC URL and port is not sufficient.

Upstream code inspection confirms:
- RPC requests are hard-coded around `BITCOIN_RPC_*` settings and Bitcoin RPC methods.
- `getblocktemplate` is requested with `rules: ['segwit']`.
- Its template model expects Bitcoin-style fields including version bits, coinbase auxiliary data, target/bits, nonce range, mutable fields, sigop/size/weight limits and witness commitment.
- Each transaction is represented with `data`, `txid`, `hash`, `depends`, `fee`, `sigops`, and `weight`.
- Its Stratum job/block assembly uses Bitcoin block/transaction primitives, computes a Bitcoin-style header hash, and submits a serialized full block via RPC.

Nito v4's pool-compatibility contract is stricter than a superficial RPC compatibility check: preserve raw transaction bytes and dependencies, txid Merkle semantics, witness commitment semantics, and opaque Orchard transaction bytes. The adapted server must not parse/rebuild or strip Nito-specific transaction payloads incorrectly.

## Work done

- Existing read-only Nito RPC probe checks node info and the basic mining template fields.
- Reviewed Public Pool's upstream RPC service, template interface, package dependencies and Docker deployment model.
- Identified likely adaptation boundary: isolate chain-specific RPC/template parsing, transaction/block serialization, coinbase construction, merkle calculation, header hashing and block submission behind a Nito adapter. Keep Stratum protocol, web/API/statistics and UI wherever those components remain chain-neutral.
- Confirmed the official Umbrel packaging model separates UI, Stratum/API server, proxy and persistent database; we can adapt this structure rather than inventing a dashboard.

## Next engineering steps

1. Pin a specific Public Pool upstream commit and license notices for the fork.
2. Create a Nito chain adapter and make the server build against it; remove Bitcoin-specific address validation/coinbase/block construction where required.
3. Create deterministic Nito v4 GBT fixtures, including templates with Orchard transactions, and unit-test byte preservation, dependencies, Merkle roots, witness commitments and coinbase outputs.
4. Add Nito regtest integration tests for template retrieval, share validation, block serialization, `submitblock`, and block confirmation.
5. Only after the compatibility tests pass, package the adapted server + upstream UI for Umbrel and publish pinned multi-arch images.

## Safety / release gates

- [ ] Public Pool fork pinned to a commit; GPL-3.0 obligations preserved.
- [ ] No RPC credentials in UI or Stratum configuration; RPC stays private to the node/server network.
- [ ] Mainnet template fixture tests and Nito regtest submission tests pass.
- [ ] UI/API auth and Umbrel proxy rules reviewed; Stratum exposed only on intended LAN port.
- [ ] amd64 and arm64 images built and tested.

No mining, block submission, wallet creation, or live node changes have been performed.

## Prototype code checkpoint

An isolated, dependency-free JavaScript adapter prototype now lives in `public-pool-adapter/`. It validates the GBT envelope, retains transaction `data` as opaque hex, checks dependency ordering/closure, and includes a txid Merkle helper. Node built-in tests are authored but have not been run in this environment. It is **not wired into Public Pool** and does not yet implement coinbase, witness commitment, header/share validation, block serialization or submission.
