'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeNitoTemplate, selectTransactions, txidMerkleRootInternal, witnessMerkleRootInternal, computeWitnessCommitment, witnessCommitmentScript, serializeCoinbase, assembleCoinbaseFromParts, formatStratumPrevHash, formatMiningNotifyParams, buildCandidateBlockFromShare, hashMeetsTarget, createSubmitBlockRequest, coinbaseMerkleBranchInternal, applyCoinbaseMerkleBranchInternal, compactSize, prepareStratumTemplate, serializeMiningHeader, miningHeaderHash, serializeCandidateBlock } = require('../nito-template-adapter');

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

test('witness Merkle root uses a null coinbase leaf and GBT witness hashes', () => {
  const wtxid = '66'.repeat(32);
  const zero = '00'.repeat(32);
  assert.equal(witnessMerkleRootInternal([wtxid]).toString('hex'),
    txidMerkleRootInternal([zero, wtxid]).toString('hex'));
});

test('witness commitment hashes root with 32-byte reserved value', () => {
  const wtxids = ['66'.repeat(32), '77'.repeat(32)];
  const reserved = Buffer.alloc(32, 0x88);
  const root = witnessMerkleRootInternal(wtxids);
  const expected = require('node:crypto').createHash('sha256')
    .update(require('node:crypto').createHash('sha256').update(Buffer.concat([root, reserved])).digest()).digest();
  assert.equal(computeWitnessCommitment(wtxids, reserved).toString('hex'), expected.toString('hex'));
  assert.throws(() => computeWitnessCommitment(wtxids, Buffer.alloc(31)), /32 bytes/);
});

test('witness commitment script includes magic and 32-byte payload', () => {
  const commitment = Buffer.alloc(32, 0xab);
  assert.equal(witnessCommitmentScript(commitment).toString('hex'), '6a24aa21a9ed' + 'ab'.repeat(32));
  assert.throws(() => witnessCommitmentScript(Buffer.alloc(31)), /32 bytes/);
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

test('Stratum previous-hash formatter reverses and swaps 32-bit words', () => {
  const display = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('');
  assert.equal(formatStratumPrevHash(display), '1c1d1e1f18191a1b14151617101112130c0d0e0f08090a0b0405060700010203');
});

test('mining.notify formatter returns the nine Stratum V1 parameters', () => {
  const prepared = prepareStratumTemplate(normalizeNitoTemplate(base));
  const params = formatMiningNotifyParams({
    jobId: 'ab',
    preparedTemplate: prepared,
    coinbaseParts: { coinbasePart1: '0102', coinbasePart2: '0304' },
    cleanJobs: true
  });
  assert.equal(params.length, 9);
  assert.equal(params[0], 'ab');
  assert.equal(params[1], formatStratumPrevHash(base.previousblockhash));
  assert.equal(params[2], '0102');
  assert.equal(params[3], '0304');
  assert.deepEqual(params[4], prepared.merkleBranch);
  assert.equal(params[5], '00000004');
  assert.equal(params[6], '1d00ffff');
  assert.equal(params[7], base.curtime.toString(16).padStart(8, '0'));
  assert.equal(params[8], true);
});

test('prepared Stratum template carries raw transactions and Merkle branches', () => {
  const prepared = prepareStratumTemplate(normalizeNitoTemplate(base));
  assert.equal(prepared.height, base.height);
  assert.equal(prepared.timestamp, base.curtime);
  assert.deepEqual(prepared.previousHashInternal, Buffer.from(base.previousblockhash, 'hex').reverse());
  assert.deepEqual(prepared.transactions.map(tx => tx.data), ['deadbeef', 'cafe00']);
  assert.deepEqual(prepared.merkleBranch, coinbaseMerkleBranchInternal(base.transactions.map(tx => tx.txid)));
});

test('prepared Stratum template uses mintime if curtime is earlier', () => {
  const normalized = normalizeNitoTemplate({ ...base, curtime: base.mintime - 5 });
  assert.equal(prepareStratumTemplate(normalized).timestamp, base.mintime);
});

test('coinbase serializer places witness data after outputs and returns stripped txid', () => {
  const cb = serializeCoinbase({ scriptSigHex: '0101', outputs: [{ value: 50, scriptHex: '51' }] });
  assert.equal(cb.rawHex, '02000000000101' + '00'.repeat(32) + 'ffffffff020101ffffffff01' + '32000000000000000151' + '0120' + '00'.repeat(32) + '00000000');
  const stripped = Buffer.from(cb.strippedHex, 'hex');
  const txid = require('node:crypto').createHash('sha256')
    .update(require('node:crypto').createHash('sha256').update(stripped).digest()).digest().reverse().toString('hex');
  assert.equal(cb.txid, txid);
  assert.equal(cb.totalValue, 50);
});

test('coinbase serializer splits extranonce and reassembles raw and stripped transaction', () => {
  const outputs = [{ value: 50, scriptHex: '51' }];
  const base = serializeCoinbase({ scriptSigHex: '0101aabb0202', outputs, extranonceOffsetBytes: 2, extranonceSizeBytes: 2 });
  const assembled = assembleCoinbaseFromParts({
    coinbasePart1: base.coinbasePart1,
    coinbasePart2: base.coinbasePart2,
    coinbaseStrippedPart1: base.coinbaseStrippedPart1,
    coinbaseStrippedPart2: base.coinbaseStrippedPart2,
    extranonceSizeBytes: base.extranonceSizeBytes,
    extranonceHex: 'ccdd'
  });
  const expected = serializeCoinbase({ scriptSigHex: '0101ccdd0202', outputs });
  assert.equal(assembled.rawHex, expected.rawHex);
  assert.equal(assembled.strippedHex, expected.strippedHex);
  assert.equal(assembled.txid, expected.txid);
  assert.throws(() => assembleCoinbaseFromParts({
    coinbasePart1: base.coinbasePart1, coinbasePart2: base.coinbasePart2,
    coinbaseStrippedPart1: base.coinbaseStrippedPart1, coinbaseStrippedPart2: base.coinbaseStrippedPart2,
    extranonceSizeBytes: base.extranonceSizeBytes, extranonceHex: 'cc'
  }), /length does not match/);
});

test('coinbase splitter rejects an out-of-range extranonce placeholder', () => {
  assert.throws(() => serializeCoinbase({ scriptSigHex: '0101', outputs: [{ value: 1, scriptHex: '51' }], extranonceOffsetBytes: 1, extranonceSizeBytes: 2 }), /fit inside/);
});

test('coinbase serializer rejects invalid scriptSig and overpayment', () => {
  assert.throws(() => serializeCoinbase({ scriptSigHex: '00', outputs: [{ value: 1, scriptHex: '51' }] }), /2..100 bytes/);
  assert.throws(() => serializeCoinbase({ scriptSigHex: '0101', outputs: [{ value: 101, scriptHex: '51' }], maxValue: 100 }), /exceeds/);
});

test('coinbase serializer accepts witness commitment as output script', () => {
  const commitment = Buffer.alloc(32, 0x77);
  const scriptHex = witnessCommitmentScript(commitment).toString('hex');
  const cb = serializeCoinbase({ scriptSigHex: '0101', outputs: [{ value: 0, scriptHex }] });
  assert.ok(cb.rawHex.includes(scriptHex));
});

test('header serializer writes fields in standard 80-byte layout', () => {
  const prev = '12'.repeat(32);
  const root = Buffer.from('34'.repeat(32), 'hex');
  const header = serializeMiningHeader({ version: 4, previousblockhash: prev, merkleRootInternal: root, timestamp: 0x01020304, bits: '1d00ffff', nonce: 0x05060708 });
  assert.equal(header.length, 80);
  assert.equal(header.subarray(0, 4).toString('hex'), '04000000');
  assert.equal(header.subarray(4, 36).toString('hex'), Buffer.from(prev, 'hex').reverse().toString('hex'));
  assert.equal(header.subarray(36, 68).toString('hex'), root.toString('hex'));
  assert.equal(header.subarray(68, 72).toString('hex'), '04030201');
  assert.equal(header.subarray(72, 76).toString('hex'), 'ffff001d');
  assert.equal(header.subarray(76, 80).toString('hex'), '08070605');
});

test('header hash is double SHA-256 of the serialized 80 bytes', () => {
  const header = Buffer.alloc(80, 0x5a);
  const h = require('node:crypto').createHash('sha256')
    .update(require('node:crypto').createHash('sha256').update(header).digest()).digest();
  assert.equal(miningHeaderHash(header).toString('hex'), h.toString('hex'));
  assert.throws(() => miningHeaderHash(Buffer.alloc(79)), /80 bytes/);
});

test('header serializer rejects invalid nonce and compact bits', () => {
  const common = { version: 1, previousblockhash: '11'.repeat(32), merkleRootInternal: Buffer.alloc(32), timestamp: 1, bits: '1d00ffff', nonce: 1 };
  assert.throws(() => serializeMiningHeader({ ...common, nonce: -1 }), /uint32/);
  assert.throws(() => serializeMiningHeader({ ...common, bits: 'bad' }), /bits/);
});

test('target comparison interprets header hash in display byte order', () => {
  assert.equal(hashMeetsTarget(Buffer.alloc(32), '00'.repeat(32)), true);
  assert.equal(hashMeetsTarget(Buffer.alloc(32, 0xff), '00'.repeat(32)), false);
  assert.equal(hashMeetsTarget(Buffer.alloc(32, 0xff), 'ff'.repeat(32)), true);
  assert.throws(() => hashMeetsTarget(Buffer.alloc(31), 'ff'.repeat(32)), /32 bytes/);
});

test('submitblock payload helper validates and formats raw block hex', () => {
  assert.deepEqual(createSubmitBlockRequest('deadbeef'), { method: 'submitblock', params: ['deadbeef'] });
  assert.throws(() => createSubmitBlockRequest('xyz'), /non-empty hex/);
});

test('candidate builder assembles header, extranonce coinbase and opaque template txs', () => {
  const prepared = prepareStratumTemplate(normalizeNitoTemplate(base));
  const coinbaseParts = serializeCoinbase({
    scriptSigHex: '0101aabb',
    outputs: [{ value: 1000, scriptHex: '51' }],
    extranonceOffsetBytes: 2,
    extranonceSizeBytes: 2
  });
  const candidate = buildCandidateBlockFromShare({
    preparedTemplate: prepared,
    coinbaseParts,
    extranonceHex: 'ccdd',
    nonce: 7,
    timestamp: base.curtime
  });
  const block = Buffer.from(candidate.blockHex, 'hex');
  assert.equal(block.subarray(0, 80).toString('hex'), candidate.headerHex);
  assert.equal(block.subarray(80, 81).toString('hex'), '03');
  assert.ok(block.toString('hex').includes('0101ccdd'));
  assert.ok(block.toString('hex').endsWith('deadbeefcafe00'));
  assert.equal(candidate.blockHashInternalHex, miningHeaderHash(Buffer.from(candidate.headerHex, 'hex')).toString('hex'));
});

test('candidate builder rejects extranonce mismatch and invalid nonce', () => {
  const prepared = prepareStratumTemplate(normalizeNitoTemplate(base));
  const parts = serializeCoinbase({ scriptSigHex: '0101aabb', outputs: [{ value: 1, scriptHex: '51' }], extranonceOffsetBytes: 2, extranonceSizeBytes: 2 });
  assert.throws(() => buildCandidateBlockFromShare({ preparedTemplate: prepared, coinbaseParts: parts, extranonceHex: 'aa', nonce: 1, timestamp: base.curtime }), /length does not match/);
  assert.throws(() => buildCandidateBlockFromShare({ preparedTemplate: prepared, coinbaseParts: parts, extranonceHex: 'aabb', nonce: -1, timestamp: base.curtime }), /uint32/);
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
