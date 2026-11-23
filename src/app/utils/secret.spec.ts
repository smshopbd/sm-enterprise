import { hashSecret, isStoredSecret, needsStretch, sha256Hex, verifySecret } from './secret';

const salt = '0123456789abcdef';
const password = 'test-password';
const legacy = { alg: 'sha256+salt', salt, hash: sha256Hex(`${salt}:${password}`) };

describe('stored secret boundary', () => {
  it('verifies current hashes and rejects incorrect passwords', () => {
    const stored = hashSecret(password);
    expect(isStoredSecret(stored)).toBe(true);
    expect(verifySecret(stored, password)).toBe(true);
    expect(verifySecret(stored, 'wrong-password')).toBe(false);
    expect(needsStretch(stored)).toBe(false);
  });

  it('accepts the known legacy format for upgrade, not arbitrary algorithms', () => {
    expect(verifySecret(legacy, password)).toBe(true);
    expect(needsStretch(legacy)).toBe(true);
    expect(verifySecret({ ...legacy, alg: 'unknown' }, password)).toBe(false);
    expect(needsStretch({ ...legacy, alg: 'unknown' })).toBe(false);
    expect(verifySecret({ ...legacy, iterations: 1 }, password)).toBe(false);
  });

  it('accepts bounded older iteration counts and marks them for upgrade', () => {
    const oneRound = { ...legacy, alg: 'sha256+salt+iter', iterations: 1 };
    const twoRounds = { ...oneRound, iterations: 2, hash: sha256Hex(legacy.hash + salt) };
    expect(verifySecret(oneRound, password)).toBe(true);
    expect(verifySecret(twoRounds, password)).toBe(true);
    expect(needsStretch(twoRounds)).toBe(true);
  });

  for (const iterations of [undefined, null, '12000', 0, -1, 1.5, NaN, Infinity, 12001, Number.MAX_SAFE_INTEGER]) {
    it(`rejects invalid iteration metadata (${String(iterations)}) before hashing`, () => {
      // A throwing password coercion proves malformed records never reach SHA.
      const poison = { toString: () => { throw new Error('hashing was attempted'); } } as unknown as string;
      const stored = { ...legacy, alg: 'sha256+salt+iter', iterations };
      expect(isStoredSecret(stored)).toBe(false);
      expect(verifySecret(stored, poison)).toBe(false);
      expect(verifySecret(stored, password)).toBe(false);
    });
  }

  for (const stored of [
    undefined, null, [], 'secret', 1, {},
    { ...legacy, salt: '' }, { ...legacy, salt: 'g'.repeat(16) },
    { ...legacy, salt: 'a'.repeat(100000) }, { ...legacy, salt: 123 },
    { ...legacy, hash: 'a'.repeat(63) }, { ...legacy, hash: 'A'.repeat(64) },
    { ...legacy, hash: 'a'.repeat(65) }, { ...legacy, hash: null }
  ]) {
    it('rejects malformed secret records without throwing', () => {
      expect(isStoredSecret(stored)).toBe(false);
      expect(verifySecret(stored, password)).toBe(false);
      expect(needsStretch(stored)).toBe(false);
    });
  }
});
