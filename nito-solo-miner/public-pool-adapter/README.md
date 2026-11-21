# Nito template adapter prototype

This is an isolated, dependency-free prototype of the Nito v4 template boundary for the Public Pool fork. It is **not yet wired into upstream Public Pool** and does not create coinbase transactions, validate shares, build witness commitments, validate consensus, or submit blocks.

Run tests with Node.js 22+:

```sh
node --test test/nito-template-adapter.test.js
```

Scope implemented:
- Validate a minimal GBT envelope and transaction metadata.
- Keep transaction `data` opaque and byte-for-byte represented as the original hex string.
- Validate 1-based dependency indexes and require dependencies precede dependents.
- Select transactions only when dependency closure is satisfied.
- Provide txid Merkle-root helper in header/internal byte order (not witness root).
- Encode CompactSize counts and serialize an 80-byte header + coinbase + untouched raw template transaction bytes as a candidate block envelope.

Before integration, compare field/rule requirements against the exact Nito v4 daemon and add fixtures from regtest. The current test fixtures are synthetic, not captured GBTs. Ten Node built-in tests passed against a scratch copy of the prototype, including Merkle-root byte-order and odd-leaf tests. The repository could not be cloned here due to network DNS restrictions, so this remains scratch-copy verification rather than a checkout-based run. The latest GitHub Actions result has not yet been independently confirmed.
