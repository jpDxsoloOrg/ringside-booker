import { describe, expect, it } from 'vitest';
import {
  hashString128,
  hashString32,
  NotSerialisableError,
  stableStringify,
} from '@ringside/engine';

// Regression lock. Saves re-derive RNG streams from these hashes, so these values must never
// change. If this test fails, the hash changed: revert it, or ship a save migration that re-seeds.
const GOLDEN_HASHES: readonly (readonly [string, readonly [number, number, number, number]])[] = [
  ['', [0x027ae52e, 0xcfc79621, 0x5593990d, 0x4b41437c]],
  ['a', [0x5eb8e4e4, 0x08dee167, 0x8f5f05b9, 0x58089485]],
  ['ringside', [0x86d5c611, 0x33c42178, 0x4d30b065, 0xcfd38eee]],
];

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

describe('hashString128', () => {
  it.each(GOLDEN_HASHES)('hashes %j to its frozen golden value', (input, expectedWords) => {
    expect(hashString128(input)).toEqual(expectedWords);
  });

  it('returns four unsigned 32-bit words', () => {
    const words = hashString128('any input at all \u{1F600}');
    expect(words).toHaveLength(4);
    expect(words.every(isUint32)).toBe(true);
  });

  it('changes all four words when one character changes', () => {
    const baseWords = hashString128('ringside');
    const variants = ['ringsidf', 'Ringside', 'ringsxde', 'ringsidE'];
    for (const variant of variants) {
      const variantWords = hashString128(variant);
      for (let wordIndex = 0; wordIndex < 4; wordIndex++) {
        expect(variantWords[wordIndex]).not.toBe(baseWords[wordIndex]);
      }
    }
  });

  it('is a pure function of its input', () => {
    expect(hashString128('rb-test\u0000test.alpha')).toEqual(
      hashString128('rb-test\u0000test.alpha'),
    );
  });
});

describe('hashString32', () => {
  it('is the first word of hashString128', () => {
    for (const [input, expectedWords] of GOLDEN_HASHES) {
      expect(hashString32(input)).toBe(expectedWords[0]);
    }
  });
});

describe('stableStringify', () => {
  it('gives the same text whatever order the keys were added in', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts keys at every depth and keeps array order', () => {
    const value = { z: [3, { y: true, x: null }, 1], a: { d: 'text', c: -0 } };
    expect(stableStringify(value)).toBe('{"a":{"c":0,"d":"text"},"z":[3,{"x":null,"y":true},1]}');
  });

  it('round-trips through JSON.parse', () => {
    const value = { name: 'Ringside \u2603', list: [1.5, 'two', false], nested: { key: null } };
    expect(JSON.parse(stableStringify(value))).toEqual(value);
  });

  it('throws NotSerialisableError for a Map', () => {
    expect(() => stableStringify({ table: new Map([['a', 1]]) })).toThrow(NotSerialisableError);
  });

  it.each([[undefined], [Number.NaN], [new Set([1])], [{ list: [1, undefined] }]])(
    'throws for the non-JSON value %j',
    (value) => {
      expect(() => stableStringify(value)).toThrow(NotSerialisableError);
    },
  );
});
