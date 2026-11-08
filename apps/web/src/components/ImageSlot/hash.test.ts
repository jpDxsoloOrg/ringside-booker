import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_SALT, hashString, pick } from './hash';

describe('hashString', () => {
  it('matches the published FNV-1a 32-bit vectors', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });

  it('returns the same value for the same input', () => {
    expect(hashString('per_000123')).toBe(hashString('per_000123'));
    expect(hashString('per_000123')).not.toBe(hashString('per_000124'));
  });

  it('hashes non-ASCII text by its UTF-8 bytes', () => {
    expect(hashString('Zé')).toBe(hashString('Zé'));
    expect(hashString('Zé')).toBeGreaterThanOrEqual(0);
    expect(hashString('Zé')).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('pick', () => {
  const slots = [0, 1, 2, 3, 4, 5, 6, 7] as const;
  const ids = Array.from({ length: 2000 }, (_, index) => `per_${String(index).padStart(6, '0')}`);

  it('picks the same item for the same seed and salt', () => {
    const seed = hashString('pro_000042');
    expect(pick(slots, seed, 1)).toBe(pick(slots, seed, 1));
  });

  it('throws on an empty list', () => {
    expect(() => pick([], 1, 1)).toThrow(/at least one item/);
  });

  it.each([0, PLACEHOLDER_SALT.background, PLACEHOLDER_SALT.logoShape])(
    'spreads 2,000 sequential ids evenly across 8 slots with salt %i',
    (salt) => {
      const counts = new Array<number>(slots.length).fill(0);
      for (const id of ids) {
        const slot = pick(slots, hashString(id), salt);
        counts[slot] = (counts[slot] ?? 0) + 1;
      }
      for (const count of counts) {
        expect(count / ids.length).toBeGreaterThanOrEqual(0.09);
        expect(count / ids.length).toBeLessThanOrEqual(0.16);
      }
    },
  );

  it('makes salted choices independent of each other', () => {
    let sameChoice = 0;
    for (const id of ids) {
      const seed = hashString(id);
      if (
        pick(slots, seed, PLACEHOLDER_SALT.background) ===
        pick(slots, seed, PLACEHOLDER_SALT.logoShape)
      ) {
        sameChoice += 1;
      }
    }
    // Independent choices agree about 1 time in 8; a shared salt would agree every time.
    expect(sameChoice / ids.length).toBeLessThan(0.2);
  });
});
