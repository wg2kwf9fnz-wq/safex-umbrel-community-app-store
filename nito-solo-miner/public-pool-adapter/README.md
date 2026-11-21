# Nito template adapter prototype

This is an isolated, dependency-free prototype of the Nito v4 template boundary for the Public Pool fork. It is **not yet wired into upstream Public Pool** and does not create coinbase transactions or insert the computed witness commitment into coinbase, validate shares, validate consensus, or submit blocks.

Run tests with Node.js 22+:

```sh
node --test test/nito-template-adapter.test.js
```

Scope implemented:
- Validate a minimal GBT envelope and transaction metadata, including rules and duplicate dependency rejection.
- Keep transaction `data` opaque and byte-for-byte represented as the original hex string.
- Validate 1-based dependency indexes and require dependencies precede dependents; selection enforces dependency closure.
- Provide txid Merkle-root helper, Stratum coinbase branch generation, witness-root/commitment digest and OP_RETURN-script helpers using GBT hashes and a null coinbase leaf.
- Prepare Stratum template inputs (time floor, previous-hash internal order, raw transactions and coinbase Merkle branches).
- Serialize standard 80-byte mining headers and double-SHA256 header hashes.
- Encode CompactSize counts and serialize a header + coinbase + untouched raw template transaction bytes as a candidate block envelope.

Before integration, compare field/rule requirements against the exact Nito v4 daemon and add fixtures from regtest. The current test fixtures are synthetic, not captured GBTs. The earlier 11-test version passed a Node 22 scratch-copy run. GitHub Actions passed 17 tests at commit `7367220`; the latest 22-test suite is awaiting CI. The repository could not be cloned here due to network DNS restrictions, so this remains scratch-copy verification rather than a checkout-based run. GitHub Actions passed the 17-test suite at commit `7367220`; the latest 22-test suite is awaiting CI.
