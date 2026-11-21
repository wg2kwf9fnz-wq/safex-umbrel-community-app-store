'use strict';

const crypto = require('node:crypto');

const HEX_32 = /^[0-9a-fA-F]{64}$/;
const HEX_BYTES = /^(?:[0-9a-fA-F]{2})+$/;

/**
 * Normalize only the pool-facing envelope of a Nito v4 getblocktemplate.
 * Transaction payloads are deliberately opaque: no parse/serialize cycle.
 * Throws on malformed or unsafe-to-filter templates rather than silently
 * dropping transactions or commitments.
 */
function normalizeNitoTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('GBT response must be an object');
  }

  const required = ['previousblockhash', 'height', 'version', 'bits', 'curtime', 'mintime', 'coinbasevalue', 'transactions'];
  for (const key of required) {
    if (!(key in raw)) throw new Error(`GBT missing required field: ${key}`);
  }
  if (!HEX_32.test(raw.previousblockhash)) throw new Error('previousblockhash must be 32-byte hex');
  if (!Number.isSafeInteger(raw.height) || raw.height < 0) throw new Error('height must be a non-negative integer');
  if (!Number.isSafeInteger(raw.version)) throw new Error('version must be an integer');
  if (typeof raw.bits !== 'string' || !/^[0-9a-fA-F]{8}$/.test(raw.bits)) throw new Error('bits must be 4-byte hex');
  for (const key of ['curtime', 'mintime', 'coinbasevalue']) {
    if (!Number.isSafeInteger(raw[key]) || raw[key] < 0) throw new Error(`${key} must be a non-negative integer`);
  }
  if (!Array.isArray(raw.transactions)) throw new Error('transactions must be an array');
  if (raw.rules !== undefined && (!Array.isArray(raw.rules) || raw.rules.some(rule => typeof rule !== 'string'))) {
    throw new Error('rules must be an array of strings');
  }

  const transactions = raw.transactions.map((tx, i) => {
    if (!tx || typeof tx !== 'object') throw new Error(`transactions[${i}] must be an object`);
    if (typeof tx.data !== 'string' || !HEX_BYTES.test(tx.data)) {
      throw new Error(`transactions[${i}].data must be non-empty raw hex bytes`);
    }
    if (!HEX_32.test(tx.txid)) throw new Error(`transactions[${i}].txid must be 32-byte hex`);
    if (tx.hash !== undefined && !HEX_32.test(tx.hash)) throw new Error(`transactions[${i}].hash must be 32-byte hex`);
    if (tx.depends !== undefined && (!Array.isArray(tx.depends) || tx.depends.some(d => !Number.isInteger(d) || d < 1 || d > raw.transactions.length || d === i + 1))) {
      throw new Error(`transactions[${i}].depends contains invalid 1-based indexes`);
    }
    if (tx.depends !== undefined && new Set(tx.depends).size !== tx.depends.length) {
      throw new Error(`transactions[${i}].depends contains duplicate indexes`);
    }
    // Keep the exact original fields and data string; do not decode or rewrite tx bytes.
    return Object.freeze({ ...tx, data: tx.data, depends: Object.freeze([...(tx.depends || [])]) });
  });

  // GBT dependencies are 1-based template indexes and must point to earlier entries.
  transactions.forEach((tx, i) => {
    for (const dep of tx.depends) {
      if (dep > i) throw new Error(`transactions[${i}] depends on a later transaction (${dep})`);
    }
  });

  return Object.freeze({
    previousblockhash: raw.previousblockhash.toLowerCase(),
    height: raw.height,
    version: raw.version,
    bits: raw.bits.toLowerCase(),
    curtime: raw.curtime,
    mintime: raw.mintime,
    coinbasevalue: raw.coinbasevalue,
    target: raw.target,
    rules: Object.freeze([...(raw.rules || [])]),
    transactions: Object.freeze(transactions)
  });
}

/**
 * Select transactions by template index (0-based), preserving source order.
 * Dependency closure is mandatory: a selected transaction cannot be included
 * unless all its dependencies are selected. This intentionally does not sort.
 */
function selectTransactions(template, selectedIndexes) {
  const selected = new Set(selectedIndexes);
  if (selected.size !== selectedIndexes.length) throw new Error('duplicate selected transaction indexes');
  for (const index of selected) {
    if (!Number.isInteger(index) || index < 0 || index >= template.transactions.length) {
      throw new RangeError(`invalid transaction index: ${index}`);
    }
  }
  for (const index of selected) {
    for (const depOneBased of template.transactions[index].depends) {
      const depIndex = depOneBased - 1;
      if (!selected.has(depIndex)) throw new Error(`transaction ${index} missing dependency ${depIndex}`);
    }
  }
  return template.transactions.filter((_, index) => selected.has(index));
}

/** Bitcoin-compatible double-SHA256 helper used for txid Merkle calculations. */
function hash256(bytes) {
  return crypto.createHash('sha256').update(crypto.createHash('sha256').update(bytes).digest()).digest();
}

/**
 * Calculate a txid Merkle root in internal (header) byte order.
 * Inputs are RPC/display-order txid hex. This function is for transparent
 * txid Merkle semantics only; it is NOT the witness commitment tree.
 */
function txidMerkleRootInternal(txids) {
  if (!Array.isArray(txids) || txids.length === 0) throw new Error('txid Merkle tree requires at least one leaf');
  let level = txids.map(txid => {
    if (!HEX_32.test(txid)) throw new Error('invalid txid leaf');
    return Buffer.from(txid, 'hex').reverse();
  });
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(Buffer.from(level[level.length - 1]));
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(hash256(Buffer.concat([level[i], level[i + 1]])));
    level = next;
  }
  return level[0];
}


/**
 * Witness Merkle root with the coinbase witness leaf fixed to 32 zero bytes,
 * as in the BIP141/Nito v3.0.0 source inspected. GBT hash values are display
 * order; template transaction bytes are never parsed.
 */
function witnessMerkleRootInternal(templateWtxids) {
  if (!Array.isArray(templateWtxids)) throw new TypeError('template wtxids must be an array');
  const leaves = [Buffer.alloc(32), ...templateWtxids.map(wtxid => {
    if (!HEX_32.test(wtxid)) throw new Error('invalid template witness hash');
    return Buffer.from(wtxid, 'hex').reverse();
  })];
  return txidMerkleRootInternalFromInternalLeaves(leaves);
}

function txidMerkleRootInternalFromInternalLeaves(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) throw new Error('Merkle tree requires at least one leaf');
  let level = leaves.map(leaf => {
    if (!Buffer.isBuffer(leaf) || leaf.length !== 32) throw new Error('Merkle leaves must be 32-byte Buffers');
    return Buffer.from(leaf);
  });
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(Buffer.from(level[level.length - 1]));
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(hash256(Buffer.concat([level[i], level[i + 1]])));
    level = next;
  }
  return level[0];
}

/** Witness commitment digest: SHA256d(witness root internal bytes || reserved value). */
function computeWitnessCommitment(templateWtxids, reservedValue = Buffer.alloc(32)) {
  if (!Buffer.isBuffer(reservedValue) || reservedValue.length !== 32) throw new Error('witness reserved value must be 32 bytes');
  return hash256(Buffer.concat([witnessMerkleRootInternal(templateWtxids), reservedValue]));
}

/** Encode the standard witness commitment OP_RETURN script (commitment is raw hash bytes). */
function witnessCommitmentScript(commitment) {
  if (!Buffer.isBuffer(commitment) || commitment.length !== 32) throw new Error('witness commitment must be 32 bytes');
  return Buffer.concat([Buffer.from('6a24aa21a9ed', 'hex'), commitment]);
}

/**
 * Coinbase Merkle branch for a template transaction list.
 * Input txids are display-order hex. The coinbase is index 0; branches are
 * returned as internal-order hex, matching the Stratum V1 merkle-branch field.
 * This computes the txid tree only (never the witness tree).
 */
function coinbaseMerkleBranchInternal(templateTxids) {
  if (!Array.isArray(templateTxids)) throw new TypeError('template txids must be an array');
  let level = [Buffer.alloc(32), ...templateTxids.map(txid => {
    if (!HEX_32.test(txid)) throw new Error('invalid template txid');
    return Buffer.from(txid, 'hex').reverse();
  })];
  let index = 0;
  const branch = [];
  while (level.length > 1) {
    const siblingIndex = index ^ 1;
    const sibling = level[siblingIndex] || level[index];
    branch.push(Buffer.from(sibling));
    if (level.length % 2 === 1) level.push(Buffer.from(level[level.length - 1]));
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(hash256(Buffer.concat([level[i], level[i + 1]])));
    }
    level = next;
    index = Math.floor(index / 2);
  }
  return branch.map(b => b.toString('hex'));
}

/** Apply a Stratum coinbase txid (display-order hex) to a coinbase branch. */
function applyCoinbaseMerkleBranchInternal(coinbaseTxid, branchHex) {
  if (!HEX_32.test(coinbaseTxid)) throw new Error('invalid coinbase txid');
  if (!Array.isArray(branchHex) || branchHex.some(h => !HEX_32.test(h))) throw new Error('invalid merkle branch');
  let root = Buffer.from(coinbaseTxid, 'hex').reverse();
  for (const siblingHex of branchHex) {
    root = hash256(Buffer.concat([root, Buffer.from(siblingHex, 'hex')]));
  }
  return root;
}

/** Bitcoin/Nito-compatible CompactSize encoding for a non-negative count. */
function compactSize(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('CompactSize value must be a non-negative safe integer');
  if (value < 0xfd) return Buffer.from([value]);
  if (value <= 0xffff) {
    const out = Buffer.alloc(3); out[0] = 0xfd; out.writeUInt16LE(value, 1); return out;
  }
  if (value <= 0xffffffff) {
    const out = Buffer.alloc(5); out[0] = 0xfe; out.writeUInt32LE(value, 1); return out;
  }
  const out = Buffer.alloc(9); out[0] = 0xff; out.writeBigUInt64LE(BigInt(value), 1); return out;
}

/**
 * Build chain-neutral Stratum job inputs from a normalized GBT.
 * This deliberately stops before coinbase creation and notify wire-format
 * endianness; those are separate integration seams to test against miners.
 */
function prepareStratumTemplate(template) {
  if (!template || !Array.isArray(template.transactions)) throw new TypeError('normalized template required');
  const txids = template.transactions.map(tx => tx.txid);
  return Object.freeze({
    height: template.height,
    version: template.version,
    bits: template.bits,
    previousblockhash: template.previousblockhash,
    previousHashInternal: Buffer.from(template.previousblockhash, 'hex').reverse(),
    timestamp: Math.max(template.curtime, template.mintime),
    coinbasevalue: template.coinbasevalue,
    target: template.target,
    merkleBranch: Object.freeze(coinbaseMerkleBranchInternal(txids)),
    transactions: template.transactions
  });
}

/**
 * Serialize a coinbase transaction with one witness-reserved-value item.
 * ScriptSig bytes are supplied by the caller (including height/extranonce).
 * This is serialization only; it does not validate consensus or script rules.
 */
function serializeCoinbase({ scriptSigHex, outputs, witnessReservedValue = Buffer.alloc(32), version = 2, lockTime = 0, maxValue, extranonceOffsetBytes, extranonceSizeBytes }) {
  if (typeof scriptSigHex !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(scriptSigHex)) throw new Error('coinbase scriptSig must be non-empty hex');
  const scriptSig = Buffer.from(scriptSigHex, 'hex');
  if (scriptSig.length < 2 || scriptSig.length > 100) throw new Error('coinbase scriptSig must be 2..100 bytes');
  if (!Array.isArray(outputs) || outputs.length === 0) throw new Error('coinbase outputs must be a non-empty array');
  if (!Buffer.isBuffer(witnessReservedValue) || witnessReservedValue.length !== 32) throw new Error('witness reserved value must be 32 bytes');
  if (!Number.isInteger(version) || version < -0x80000000 || version > 0x7fffffff) throw new Error('coinbase version must be int32');
  if (!Number.isSafeInteger(lockTime) || lockTime < 0 || lockTime > 0xffffffff) throw new Error('coinbase lockTime must be uint32');
  if (maxValue !== undefined && (!Number.isSafeInteger(maxValue) || maxValue < 0)) throw new Error('maxValue must be a non-negative safe integer');
  if ((extranonceOffsetBytes === undefined) !== (extranonceSizeBytes === undefined)) throw new Error('extranonce offset and size must be provided together');
  if (extranonceOffsetBytes !== undefined && (!Number.isSafeInteger(extranonceOffsetBytes) || extranonceOffsetBytes < 0 || !Number.isSafeInteger(extranonceSizeBytes) || extranonceSizeBytes <= 0 || extranonceOffsetBytes + extranonceSizeBytes > scriptSig.length)) throw new Error('extranonce placeholder must fit inside scriptSig');
  let total = 0n;
  const serializedOutputs = outputs.map((output, i) => {
    if (!output || !Number.isSafeInteger(output.value) || output.value < 0) throw new Error(`coinbase output ${i} value must be non-negative safe integer`);
    if (typeof output.scriptHex !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(output.scriptHex)) throw new Error(`coinbase output ${i} script must be non-empty hex`);
    total += BigInt(output.value);
    const value = Buffer.alloc(8); value.writeBigUInt64LE(BigInt(output.value));
    const script = Buffer.from(output.scriptHex, 'hex');
    return Buffer.concat([value, compactSize(script.length), script]);
  });
  if (maxValue !== undefined && total > BigInt(maxValue)) throw new Error('coinbase output total exceeds template coinbasevalue');
  const input = Buffer.concat([
    Buffer.alloc(32), Buffer.from('ffffffff', 'hex'),
    compactSize(scriptSig.length), scriptSig,
    Buffer.from('ffffffff', 'hex')
  ]);
  const outputBytes = Buffer.concat([compactSize(outputs.length), ...serializedOutputs]);
  const versionBytes = Buffer.alloc(4); versionBytes.writeInt32LE(version);
  const lockBytes = Buffer.alloc(4); lockBytes.writeUInt32LE(lockTime);
  const stripped = Buffer.concat([versionBytes, compactSize(1), input, outputBytes, lockBytes]);
  const witnessMarkerFlag = Buffer.from('0001', 'hex');
  const witnessStack = Buffer.concat([compactSize(1), compactSize(32), witnessReservedValue]);
  const full = Buffer.concat([versionBytes, witnessMarkerFlag, compactSize(1), input, outputBytes, witnessStack, lockBytes]);
  const result = {
    rawHex: full.toString('hex'),
    strippedHex: stripped.toString('hex'),
    txid: Buffer.from(hash256(stripped)).reverse().toString('hex'),
    totalValue: Number(total)
  };
  if (extranonceOffsetBytes !== undefined) {
    const rawScriptOffset = 4 + 2 + compactSize(1).length + 32 + 4 + compactSize(scriptSig.length).length;
    const strippedScriptOffset = 4 + compactSize(1).length + 32 + 4 + compactSize(scriptSig.length).length;
    const rawSplit = rawScriptOffset + extranonceOffsetBytes;
    const strippedSplit = strippedScriptOffset + extranonceOffsetBytes;
    result.coinbasePart1 = full.subarray(0, rawSplit).toString('hex');
    result.coinbasePart2 = full.subarray(rawSplit + extranonceSizeBytes).toString('hex');
    result.coinbaseStrippedPart1 = stripped.subarray(0, strippedSplit).toString('hex');
    result.coinbaseStrippedPart2 = stripped.subarray(strippedSplit + extranonceSizeBytes).toString('hex');
    result.extranonceSizeBytes = extranonceSizeBytes;
  }
  return Object.freeze(result);
}

/** Stratum V1 previous-hash formatting: reverse bytes, then reverse each 4-byte word. */
function formatStratumPrevHash(previousblockhash) {
  if (!HEX_32.test(previousblockhash)) throw new Error('previous block hash must be 32-byte hex');
  const internal = Buffer.from(previousblockhash, 'hex').reverse();
  for (let i = 0; i < internal.length; i += 4) {
    const a = internal[i], b = internal[i + 1];
    internal[i] = internal[i + 3]; internal[i + 1] = internal[i + 2];
    internal[i + 2] = b; internal[i + 3] = a;
  }
  return internal.toString('hex');
}

/** Format a mining.notify params array using the Public Pool/Stratum V1 field layout. */
function formatMiningNotifyParams({ jobId, preparedTemplate, coinbaseParts, cleanJobs = false }) {
  if (typeof jobId !== 'string' || jobId.length === 0) throw new Error('jobId must be a non-empty string');
  if (!preparedTemplate || !Array.isArray(preparedTemplate.merkleBranch)) throw new Error('prepared template required');
  if (!coinbaseParts || typeof coinbaseParts.coinbasePart1 !== 'string' || typeof coinbaseParts.coinbasePart2 !== 'string') throw new Error('coinbase parts required');
  return [
    jobId,
    formatStratumPrevHash(preparedTemplate.previousblockhash),
    coinbaseParts.coinbasePart1,
    coinbaseParts.coinbasePart2,
    preparedTemplate.merkleBranch,
    (preparedTemplate.version >>> 0).toString(16).padStart(8, '0'),
    preparedTemplate.bits.toLowerCase().padStart(8, '0'),
    preparedTemplate.timestamp.toString(16).padStart(8, '0'),
    Boolean(cleanJobs)
  ];
}

/** Reassemble split coinbase parts with a miner extranonce and calculate its txid. */
function assembleCoinbaseFromParts({ coinbasePart1, coinbasePart2, coinbaseStrippedPart1, coinbaseStrippedPart2, extranonceSizeBytes, extranonceHex }) {
  if (![coinbasePart1, coinbasePart2, coinbaseStrippedPart1, coinbaseStrippedPart2].every(s => typeof s === 'string' && /^[0-9a-fA-F]*$/.test(s))) {
    throw new Error('coinbase parts must be hex strings');
  }
  if (typeof extranonceHex !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(extranonceHex)) throw new Error('extranonce must be non-empty hex');
  if (!Number.isSafeInteger(extranonceSizeBytes) || extranonceSizeBytes <= 0 || Buffer.from(extranonceHex, 'hex').length !== extranonceSizeBytes) throw new Error('extranonce length does not match placeholder size');
  const full = Buffer.concat([Buffer.from(coinbasePart1, 'hex'), Buffer.from(extranonceHex, 'hex'), Buffer.from(coinbasePart2, 'hex')]);
  const stripped = Buffer.concat([Buffer.from(coinbaseStrippedPart1, 'hex'), Buffer.from(extranonceHex, 'hex'), Buffer.from(coinbaseStrippedPart2, 'hex')]);
  return Object.freeze({ rawHex: full.toString('hex'), strippedHex: stripped.toString('hex'), txid: Buffer.from(hash256(stripped)).reverse().toString('hex') });
}

/** Serialize the standard 80-byte Nito/Bitcoin-style proof-of-work header. */
function serializeMiningHeader({ version, previousblockhash, merkleRootInternal, timestamp, bits, nonce }) {
  if (!Number.isSafeInteger(version)) throw new Error('header version must be an integer');
  if (!HEX_32.test(previousblockhash)) throw new Error('previous block hash must be 32-byte hex');
  if (!Buffer.isBuffer(merkleRootInternal) || merkleRootInternal.length !== 32) throw new Error('merkle root must be a 32-byte internal-order Buffer');
  for (const [name, value] of Object.entries({ timestamp, nonce })) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`header ${name} must be uint32`);
  }
  if (typeof bits !== 'string' || !/^[0-9a-fA-F]{8}$/.test(bits)) throw new Error('bits must be 4-byte hex');
  const header = Buffer.alloc(80);
  header.writeInt32LE(version, 0);
  Buffer.from(previousblockhash, 'hex').reverse().copy(header, 4);
  merkleRootInternal.copy(header, 36);
  header.writeUInt32LE(timestamp, 68);
  header.writeUInt32LE(parseInt(bits, 16), 72);
  header.writeUInt32LE(nonce, 76);
  return header;
}

/** Build a stored Stratum job record and mining.notify payload from a normalized template. */
function createNitoStratumJob({ template, jobId, coinbaseParts, cleanJobs = false }) {
  if (!template || typeof template.target !== 'string' || !HEX_32.test(template.target)) throw new Error('template target required for block-candidate comparison');
  const preparedTemplate = prepareStratumTemplate(template);
  const notifyParams = formatMiningNotifyParams({ jobId, preparedTemplate, coinbaseParts, cleanJobs });
  return Object.freeze({ jobId, preparedTemplate, coinbaseParts, notifyParams, networkTarget: template.target.toLowerCase() });
}

/** Process a share into a candidate block and indicate whether it meets network target. */
function processNitoShare(job, share) {
  if (!job || !job.preparedTemplate) throw new Error('Nito Stratum job required');
  const headerCandidate = buildCandidateHeaderFromShare({
    preparedTemplate: job.preparedTemplate,
    coinbaseParts: job.coinbaseParts,
    extranonceHex: share.extraNonce2,
    nonce: share.nonce,
    timestamp: share.timestamp,
    version: share.version
  });
  const meetsNetworkTarget = hashMeetsTarget(Buffer.from(headerCandidate.blockHashInternalHex, 'hex'), job.networkTarget);
  if (!meetsNetworkTarget) return Object.freeze({ headerCandidate, candidate: null, meetsNetworkTarget: false });
  const block = serializeCandidateBlock(headerCandidate.headerHex, headerCandidate.coinbaseRawHex, job.preparedTemplate.transactions);
  const candidate = Object.freeze({ ...headerCandidate, blockHex: block.toString('hex') });
  return Object.freeze({ headerCandidate, candidate, meetsNetworkTarget: true });
}
/** Compare an internal-order proof-of-work hash against a display-order 256-bit target. */
function hashMeetsTarget(hashInternal, targetHex) {
  if (!Buffer.isBuffer(hashInternal) || hashInternal.length !== 32) throw new Error('hash must be 32 bytes');
  if (!HEX_32.test(targetHex)) throw new Error('target must be 32-byte hex');
  const hashDisplay = Buffer.from(hashInternal).reverse().toString('hex');
  return BigInt('0x' + hashDisplay) <= BigInt('0x' + targetHex);
}

/** Build the standard Nito/BIP145 GBT request used by the prototype (no RPC call). */
function createGetBlockTemplateRequest() {
  return Object.freeze({
    method: 'getblocktemplate',
    params: [Object.freeze({ rules: Object.freeze(['segwit']), mode: 'template', capabilities: Object.freeze(['serverlist', 'proposal']) })]
  });
}

/** Produce the JSON-RPC submitblock request payload (no RPC side effects). */
function createSubmitBlockRequest(blockHex) {
  if (typeof blockHex !== 'string' || !HEX_BYTES.test(blockHex)) throw new Error('candidate block must be non-empty hex');
  return Object.freeze({ method: 'submitblock', params: [blockHex] });
}

/**
 * Assemble a candidate block from a Stratum share's nonce/time/extranonce.
 * Does not verify share difficulty, time policy, version masks, or consensus.
 */
function buildCandidateHeaderFromShare({ preparedTemplate, coinbaseParts, extranonceHex, nonce, timestamp, version }) {
  if (!preparedTemplate || !Array.isArray(preparedTemplate.transactions) || !Array.isArray(preparedTemplate.merkleBranch)) throw new Error('prepared template required');
  const assembledCoinbase = assembleCoinbaseFromParts({ ...coinbaseParts, extranonceHex });
  const merkleRoot = applyCoinbaseMerkleBranchInternal(assembledCoinbase.txid, preparedTemplate.merkleBranch);
  const header = serializeMiningHeader({
    version: version === undefined ? preparedTemplate.version : version,
    previousblockhash: preparedTemplate.previousblockhash,
    merkleRootInternal: merkleRoot,
    timestamp,
    bits: preparedTemplate.bits,
    nonce
  });
  return Object.freeze({
    headerHex: header.toString('hex'),
    merkleRootInternalHex: merkleRoot.toString('hex'),
    coinbaseTxid: assembledCoinbase.txid,
    coinbaseRawHex: assembledCoinbase.rawHex,
    blockHashInternalHex: miningHeaderHash(header).toString('hex')
  });
}

function buildCandidateBlockFromShare(args) {
  const headerCandidate = buildCandidateHeaderFromShare(args);
  const block = serializeCandidateBlock(headerCandidate.headerHex, headerCandidate.coinbaseRawHex, args.preparedTemplate.transactions);
  return Object.freeze({ ...headerCandidate, blockHex: block.toString('hex') });
}
/** Return the proof-of-work header hash as internal byte order. */
function miningHeaderHash(header) {
  if (!Buffer.isBuffer(header) || header.length !== 80) throw new Error('header must be exactly 80 bytes');
  return hash256(header);
}

/**
 * Serialize a candidate block envelope without parsing/re-serializing template
 * transactions. headerHex must be the final 80-byte header; coinbaseHex must
 * be the fully assembled coinbase. This does not validate consensus.
 */
function serializeCandidateBlock(headerHex, coinbaseHex, templateTransactions) {
  if (typeof headerHex !== 'string' || !/^[0-9a-fA-F]{160}$/.test(headerHex)) throw new Error('header must be exactly 80 bytes of hex');
  if (typeof coinbaseHex !== 'string' || !HEX_BYTES.test(coinbaseHex)) throw new Error('coinbase must be non-empty transaction hex');
  if (!Array.isArray(templateTransactions)) throw new TypeError('template transactions must be an array');
  const rawTxs = templateTransactions.map((tx, i) => {
    if (!tx || typeof tx.data !== 'string' || !HEX_BYTES.test(tx.data)) throw new Error(`template transaction ${i} has invalid raw hex`);
    return Buffer.from(tx.data, 'hex');
  });
  return Buffer.concat([
    Buffer.from(headerHex, 'hex'),
    compactSize(rawTxs.length + 1),
    Buffer.from(coinbaseHex, 'hex'),
    ...rawTxs
  ]);
}

module.exports = { normalizeNitoTemplate, selectTransactions, txidMerkleRootInternal, witnessMerkleRootInternal, computeWitnessCommitment, witnessCommitmentScript, coinbaseMerkleBranchInternal, applyCoinbaseMerkleBranchInternal, compactSize, serializeCoinbase, assembleCoinbaseFromParts, formatStratumPrevHash, formatMiningNotifyParams, prepareStratumTemplate, serializeMiningHeader, miningHeaderHash, serializeCandidateBlock, buildCandidateBlockFromShare, createNitoStratumJob, processNitoShare, hashMeetsTarget, createGetBlockTemplateRequest, createSubmitBlockRequest };
