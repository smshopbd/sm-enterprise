// Synchronous SHA-256 so login, PIN checks and the users panel can hash a
// secret in the same tick they are called (Web Crypto only exposes a Promise).

export interface StoredSecret {
  alg: 'sha256+salt' | 'sha256+salt+iter';
  salt: string;
  hash: string;
  /** Rounds used for 'sha256+salt+iter'; absent on the legacy single-round hash. */
  iterations?: number;
}

/**
 * A single SHA-256 is fast enough to brute-force a 6-digit PIN offline, so new
 * secrets stretch the digest. The loop stays synchronous (login must decide in
 * the same tick) and is tuned to finish well under a second on a phone.
 */
const ITERATIONS = 12000;

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

export function sha256Hex(message: string): string {
  const bytes = utf8Bytes(message);
  const bitLength = bytes.length * 8;
  const padded = [...bytes, 0x80];
  while (padded.length % 64 !== 56) padded.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (const word of [high, low]) {
    padded.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (padded[block + i * 4] << 24) | (padded[block + i * 4 + 1] << 16) | (padded[block + i * 4 + 2] << 8) | padded[block + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map(word => word.toString(16).padStart(8, '0')).join('');
}

export function hashSecret(secret: string): StoredSecret {
  const salt = randomSalt();
  return {
    alg: 'sha256+salt+iter',
    salt,
    hash: stretch(`${salt}:${secret}`, salt),
    iterations: ITERATIONS
  };
}

/** Stored metadata is untrusted. Reject it before any hashing or stretching. */
export function isStoredSecret(value: unknown): value is StoredSecret {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const stored = value as Partial<StoredSecret>;
  if (typeof stored.salt !== 'string' || !/^[a-f0-9]{16}$/.test(stored.salt)) return false;
  if (typeof stored.hash !== 'string' || !/^[a-f0-9]{64}$/.test(stored.hash)) return false;
  if (stored.alg === 'sha256+salt') return stored.iterations === undefined;
  // Accept older positive round counts for upgrade, but never let a stored
  // record demand more synchronous work than the current writer generates.
  return stored.alg === 'sha256+salt+iter'
    && typeof stored.iterations === 'number'
    && Number.isInteger(stored.iterations)
    && stored.iterations >= 1
    && stored.iterations <= ITERATIONS;
}

export function verifySecret(stored: unknown, secret: string): boolean {
  if (!isStoredSecret(stored) || typeof secret !== 'string') return false;
  if (stored.alg === 'sha256+salt+iter') {
    return stretch(`${stored.salt}:${secret}`, stored.salt, stored.iterations) === stored.hash;
  }
  return sha256Hex(`${stored.salt}:${secret}`) === stored.hash;
}

/** Valid older records keep working at login, then get re-hashed. */
export function needsStretch(stored: unknown): boolean {
  return isStoredSecret(stored)
    && (stored.alg === 'sha256+salt' || stored.iterations! < ITERATIONS);
}

/**
 * The cloud gate key is derived from the password, not stored in clear.
 * It is deterministic so any device can rebuild it at login, and the hash of
 * this value (never the value) is what the database policy compares.
 */
export function deriveCloudKey(secret: string): string {
  return stretch(`sm-cloud-key:${(secret || '').trim()}`, 'sm-cloud-key', ITERATIONS);
}

export function cloudKeyHash(key: string): string {
  return sha256Hex(key);
}

function stretch(input: string, salt: string, rounds = ITERATIONS): string {
  let digest = sha256Hex(input);
  for (let i = 1; i < rounds; i++) digest = sha256Hex(digest + salt);
  return digest;
}

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return out;
}

function randomSalt(): string {
  const bytes = new Uint8Array(8);
  const crypto$ = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  if (crypto$?.getRandomValues) crypto$.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
