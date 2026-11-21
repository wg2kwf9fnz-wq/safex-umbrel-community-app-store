'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeNitoTemplate, selectTransactions, txidMerkleRootInternal, coinbaseMerkleBranchInternal, applyCoinbaseMerkleBranchInternal, compactSize, serializeCandidateBlock } = require('../nito-template-adapter');

const base = {
  previousblockhash: '11'.repeat(32), height: 123, version: 4, bits: '1d00ffff',
  curtime: 1700000000, mintime: 1699999900, coinbasevalue: 5000000000,
  rules: [], transactions: [
    { data: 'deadbeef', txid: '22'.repeat(32), hash: '33'.repeat(32), depends: [] },
    { data: 'cafe00', txid: '44'.repeat(32), hash: '55'.repeat(32), depends: [1] }
  ]
};

test('normalizer retains raw transaction bytes and metadata without decoding', () => {
  const normalized = normalizeNitoTemplate(base);
  assert.equal(normalized.transactions[0].data, 'deadbeef');
  assert.equal(normalized.transactions[1].data, 'cafe00');
  assert.deepEqual(normalized.transactions[1].depends, [1]);
});

test('rejects malformed template and malformed transaction bytes', () => {
  assert.throws(() => normalizeNitoTemplate({ ...base, height: -1 }), /height/);
  assert.throws(() => normalizeNitoTemplate({ ...base, transactions: [{ ...base.transactions[0], data: 'abc' }] }), /raw hex/);
});

test('rejects dependency indexes pointing forward', () => {
  assert.throws(() => normalizeNitoTemplate({
    ...base,
    transactions: [{ ...base.transactions[0], depends: [2] }, base.transactions[1]]
  }), /later transaction/);
});


test('rejects malformed rules and duplicate dependency indexes', () => {
  assert.throws(() => normalizeNitoTemplate({ ...base, rules: 'segwit' }), /rules must be an array/);
  assert.throws(() => normalizeNitoTemplate({
    ...base,
    transactions: [base.transactions[0], { ...base.transactions[1], depends: [1, 1] }]
  }), /duplicate indexes/);
});

test('selection requires dependency closure and preserves original order', () => {
  const template = normalizeNitoTemplate(base);
  assert.throws(() => selectTransactions(template, [1]), /missing dependency/);
  const selected = selectTransactions(template, [1, 0]);
  assert.deepEqual(selected.map(tx => tx.data), ['deadbeef', 'cafe00']);
});

test('single txid leaf returns its internal byte order', () => {
  const id = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('');
  const reversed = Array.from({ length: 32 }, (_, i) => (31 - i).toString(16).padStart(2, '0')).join('');
  assert.equal(txidMerkleRootInternal([id]).toString('hex'), reversed);
});

test('coinbase Merkle branch includes sibling path for one template tx', () => {
  const txid = '22'.repeat(32);
  const branch = coinbaseMerkleBranchInternal([txid]);
  assert.deepEqual(branch, [Buffer.from(txid, 'hex').reverse().toString('hex')]);
  const coinbaseId = '11'.repeat(32);
  const root = applyCoinbaseMerkleBranchInternal(coinbaseId, branch);
  assert.equal(root.toString('hex'), txidMerkleRootInternal([coinbaseId, txid]).toString('hex'));
});

test('coinbase Merkle branch handles odd transaction counts', () => {
  const txids = ['22'.repeat(32), '33'.repeat(32), '44'.repeat(32)];
  const branch = coinbaseMerkleBranchInternal(txids);
  const coinbaseId = '11'.repeat(32);
  assert.equal(applyCoinbaseMerkleBranchInternal(coinbaseId, branch).toString('hex'),
    txidMerkleRootInternal([coinbaseId, ...txids]).toString('hex'));
});

test('empty transaction template returns an empty coinbase branch', () => {
  assert.deepEqual(coinbaseMerkleBranchInternal([]), []);
  const coinbaseId = '11'.repeat(32);
  assert.equal(applyCoinbaseMerkleBranchInternal(coinbaseId, []).toString('hex'),
    Buffer.from(coinbaseId, 'hex').reverse().toString('hex'));
});

test('CompactSize encodes the transaction count boundary', () => {
  assert.equal(compactSize(252).toString('hex'), 'fc');
  assert.equal(compactSize(253).toString('hex'), 'fdfd00');
});

test('candidate block envelope preserves opaque transaction bytes', () => {
  const header = '00'.repeat(80);
  const coinbase = '0102';
  const txs = [{ data: 'deadbeef' }, { data: 'cafe00' }];
  const block = serializeCandidateBlock(header, coinbase, txs);
  assert.equal(block.subarray(0, 80).toString('hex'), header);
  assert.equal(block.subarray(80, 81).toString('hex'), '03');
  assert.equal(block.subarray(81, 83).toString('hex'), coinbase);
  assert.equal(block.subarray(83).toString('hex'), 'deadbeefcafe00');
});

test('two-leaf txid Merkle root hashes internal-order leaves', () => {
  const a = '01'.repeat(32);
  const b = '02'.repeat(32);
  const expected = require('node:crypto').createHash('sha256')
    .update(require('node:crypto').createHash('sha256')
      .update(Buffer.concat([Buffer.from(a, 'hex').reverse(), Buffer.from(b, 'hex').reverse()])).digest())
    .digest().toString('hex');
  assert.equal(txidMerkleRootInternal([a, b]).toString('hex'), expected);
});

test('odd txid Merkle leaf is duplicated at its level', () => {
  const a = '01'.repeat(32), b = '02'.repeat(32), c = '03'.repeat(32);
  const h = bytes => require('node:crypto').createHash('sha256')
    .update(require('node:crypto').createHash('sha256').update(bytes).digest()).digest();
  const A = Buffer.from(a, 'hex').reverse(), B = Buffer.from(b, 'hex').reverse(), C = Buffer.from(c, 'hex').reverse();
  const AB = h(Buffer.concat([A, B])), CC = h(Buffer.concat([C, C]));
  const expected = h(Buffer.concat([AB, CC]));
  assert.equal(txidMerkleRootInternal([a, b, c]).toString('hex'), expected.toString('hex'));
});

test('candidate block rejects malformed final header and transaction payload', () => {
  assert.throws(() => serializeCandidateBlock('00', '0102', []), /80 bytes/);
  assert.throws(() => serializeCandidateBlock('00'.repeat(80), 'zz', []), /coinbase/);
  assert.throws(() => serializeCandidateBlock('00'.repeat(80), '0102', [{ data: 'xyz' }]), /raw hex/);
});
