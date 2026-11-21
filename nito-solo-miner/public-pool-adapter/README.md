# Nito template adapter prototype

This is an isolated, dependency-free prototype of the Nito v4 template boundary for the Public Pool fork. It is **not yet wired into upstream Public Pool** and does not create coinbase transactions, validate shares, build witness commitments, serialize full blocks, or submit blocks.

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

Before integration, compare field/rule requirements against the exact Nito v4 daemon and add fixtures from regtest. The current test fixtures are synthetic, not captured GBTs.
