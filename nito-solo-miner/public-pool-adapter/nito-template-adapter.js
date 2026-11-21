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

module.exports = { normalizeNitoTemplate, selectTransactions, txidMerkleRootInternal, witnessMerkleRootInternal, computeWitnessCommitment, witnessCommitmentScript, coinbaseMerkleBranchInternal, applyCoinbaseMerkleBranchInternal, compactSize, prepareStratumTemplate, serializeMiningHeader, miningHeaderHash, serializeCandidateBlock };
