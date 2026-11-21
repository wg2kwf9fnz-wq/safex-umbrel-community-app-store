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

module.exports = { normalizeNitoTemplate, selectTransactions, txidMerkleRootInternal };
