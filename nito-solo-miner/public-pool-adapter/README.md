# Nito template / Stratum adapter prototype

This isolated, dependency-free prototype is **not yet wired into Public Pool's server**. It does not validate shares, consensus, or Nito v4 acceptance.

Run under Node.js 22+:

```sh
node --test test/nito-template-adapter.test.js
```

## Implemented helpers

- GBT envelope/rules, required network target, and optional transaction fee/sigops/weight metadata validation, and strict GBT witness-commitment script validation.
- Opaque raw transaction byte preservation; dependency index/order and closure checks.
- Txid Merkle root, coinbase Merkle branch generation.
- Witness Merkle root (null coinbase leaf), commitment digest and commitment OP_RETURN script helper.
- Coinbase serialization with one 32-byte witness reserved value, stripped txid, output/reward bounds, extranonce split and reassembly.
- Stratum template preparation and nine-field `mining.notify` formatter (previous-hash word order, time floor, branch).
- Standard 80-byte header serializer and double-SHA256 hash.
- Candidate block assembly from a share nonce/time/extranonce while concatenating untouched template transaction bytes.

These are serialization and fixture-level helpers, not a complete chain adapter. GBT fixtures are synthetic. The inspected Nito Core v3.0.0 source supports standard header/txid/witness semantics, but current v4 must be checked against captured GBT and regtest.

## Verification

GitHub Actions run #317 passed **49 tests** at commit `6b78acf9`, including GBT optional metadata validation, coinbase height script helper, reusable bridge lifecycle, share-target checks, and guarded submission.

No coinbase-height rules, payout-address validation, share difficulty/target validation, version rolling, timestamp policy, block consensus, `submitblock`, or live mining is implemented/verified.
