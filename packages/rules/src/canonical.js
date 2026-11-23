// Canonical wire bytes for AwayLeg v1.
// Course and replay payloads are UTF-8 JSON.stringify output of validated
// arrays only: ASCII decimal integer literals, no whitespace, no BOM, no
// trailing LF. Decoding requires byte-for-byte re-encoding round trip.

import { createHash } from 'node:crypto';

export class CanonicalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CanonicalError';
  }
}

export function isSafeInt(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    !Object.is(value, -0) &&
    Number.isSafeInteger(value)
  );
}

function validateTree(node, path) {
  if (isSafeInt(node)) return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) validateTree(node[i], `${path}[${i}]`);
    return;
  }
  throw new CanonicalError(
    `non-integer member at ${path}: ${typeof node === 'object' ? JSON.stringify(node) : String(node)}`,
  );
}

// Reject floats, negative zero, objects, strings, booleans, null anywhere.
export function validateIntArrays(value, label = 'payload') {
  if (!Array.isArray(value)) {
    throw new CanonicalError(`${label}: top level must be an array`);
  }
  validateTree(value, label);
  return value;
}

// Validated arrays -> canonical UTF-8 bytes (Buffer).
export function encodeCanonical(value, label = 'payload') {
  validateIntArrays(value, label);
  const text = JSON.stringify(value);
  return Buffer.from(text, 'utf8');
}

export function canonicalText(value, label = 'payload') {
  validateIntArrays(value, label);
  return JSON.stringify(value);
}

// Decode wire bytes; enforces the exact canonical form (no whitespace,
// no BOM, arrays of nonneg safe ints, ASCII decimal literals only).
export function decodeCanonical(bytes, label = 'payload', maxBytes = 64 * 1024) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length === 0) throw new CanonicalError(`${label}: empty input`);
  if (buf.length > maxBytes) {
    throw new CanonicalError(`${label}: exceeds ${maxBytes} bytes (${buf.length})`);
  }
  const text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    throw new CanonicalError(`${label}: BOM not allowed`);
  }
  if (/[^\x20-\x7e]/.test(text)) {
    throw new CanonicalError(`${label}: non-ASCII bytes not allowed`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CanonicalError(`${label}: invalid JSON`);
  }
  validateIntArrays(parsed, label);
  // Byte-for-byte canonical form: re-encoding must reproduce the source.
  if (JSON.stringify(parsed) !== text) {
    throw new CanonicalError(`${label}: noncanonical encoding`);
  }
  return parsed;
}

export function sha256Hex(bytes) {
  return `0x${createHash('sha256').update(bytes).digest('hex')}`;
}
