# Nito template / Stratum adapter prototype

This isolated, dependency-free prototype is **not yet wired into Public Pool's server**. It does not validate shares, consensus, or Nito v4 acceptance.

Run under Node.js 22+:

```sh
node --test test/nito-template-adapter.test.js
```

## Implemented helpers

- GBT envelope/rules, mandatory target, optional mining metadata, and coinbaseaux hex validation.
- Opaque raw transaction byte preservation; dependency index/order and closure checks.
- Txid Merkle root, coinbase Merkle branch generation.
- Witness Merkle root (null coinbase leaf), commitment digest/script, and payout-output builder with reward cap.
- Coinbase serialization with witness reserved value, stripped txid, extranonce split/reassembly, and BIP34-style height script (minimal OP_1..OP_16 encodings).
- Stratum template preparation and nine-field `mining.notify` formatter (previous-hash word order, time floor, branch).
- Compact `nBits` target decoding and difficulty-derived share target using Nito v4 mainnet genesis `1d00ffff` as diff-1 baseline.
- Standard 80-byte header serializer and double-SHA256 hash.
- Candidate block assembly from share nonce/time/extranonce while concatenating untouched template transaction bytes.
- Injectable JSON-RPC adapter, private HTTP JSON-RPC client factory, and reusable bridge with bounded/TTL job cache and template-work invalidation.

These are serialization and helper-level components, not a complete chain adapter. GBT fixtures are synthetic; source-level Nito v4.0 checks have been performed, but no captured daemon template or regtest acceptance has been verified.

## Verification

GitHub Actions run #538 passed **59 tests** at commit `39133a3f`. The suite includes regression tests for optional GBT metadata, coinbase-height encoding, witness commitment cross-checks, share-target/difficulty conversion, JSON-RPC transport, bridge job lifecycle, and guarded submission.

Pool-configured session difficulty integration, timestamp policy, version rolling, payout-address/script validation, Nito consensus, real `submitblock`, live mining, and Umbrel packaging remain unimplemented/unverified. The HTTP JSON-RPC client and adapter have only been tested with injected fake transports.
