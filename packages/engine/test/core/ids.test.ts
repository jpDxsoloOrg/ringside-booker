import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createIdFactory,
  ENTITY_KIND_LIST,
  ENTITY_KINDS,
  ID_BODY_ALPHABET,
  ID_MAX_ATTEMPTS,
  ID_PATTERN,
  isId,
  kindOfId,
  parseId,
  type IdEntropy,
  type IdOf,
  type PersonId,
  type PromotionId,
} from '../../src/core/ids';
import { IdCollisionError, InvalidArgumentError, InvalidIdError } from '../../src/core/errors';
import { scriptedIdEntropy, sequentialIdEntropy } from '../support/ids';

/** A small deterministic generator (32-bit LCG) so tests see varied, repeatable draws. */
function linearCongruentialEntropy(seed: number): IdEntropy {
  let state = seed >>> 0;
  return {
    nextUint32(): number {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    },
  };
}

const neverExists = (): boolean => false;

describe('ENTITY_KINDS', () => {
  it('has 26 kinds', () => {
    expect(ENTITY_KIND_LIST).toHaveLength(26);
  });

  it('gives every kind a unique three letter prefix', () => {
    const prefixes = ENTITY_KIND_LIST.map((kind) => ENTITY_KINDS[kind]);
    for (const prefix of prefixes) {
      expect(prefix).toMatch(/^[a-z]{3}$/);
    }
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('has a pattern for every kind', () => {
    for (const kind of ENTITY_KIND_LIST) {
      expect(ID_PATTERN[kind].test(`${ENTITY_KINDS[kind]}_0000000001`)).toBe(true);
    }
  });
});

describe('ID types', () => {
  it('does not let one kind of ID stand in for another', () => {
    expectTypeOf<PersonId>().not.toExtend<PromotionId>();
    expectTypeOf<PromotionId>().not.toExtend<PersonId>();
    expectTypeOf<string>().not.toExtend<PersonId>();
    expectTypeOf<PersonId>().toExtend<string>();
    expectTypeOf<IdOf<'person'>>().toEqualTypeOf<PersonId>();

    const promotionId = parseId('promotion', 'pro_0000000001');
    // @ts-expect-error a PromotionId is not a PersonId
    const personId: PersonId = promotionId;
    expect(personId).toBe('pro_0000000001');
  });
});

describe('isId / parseId / kindOfId', () => {
  it('accepts a well-formed ID of the right kind', () => {
    expect(isId('person', 'per_0123456789')).toBe(true);
    expect(isId('person', 'per_abcdefghjk')).toBe(true);
    expect(parseId('person', 'per_mnpqrstvwx')).toBe('per_mnpqrstvwx');
  });

  it('rejects an ID of another kind', () => {
    expect(() => parseId('person', 'pro_0000000001')).toThrow(InvalidIdError);
  });

  it('rejects letters outside lowercase Crockford base32', () => {
    expect(() => parseId('person', 'per_00000000i1')).toThrow(InvalidIdError);
    for (const excluded of ['i', 'l', 'o', 'u', 'A']) {
      expect(isId('person', `per_000000000${excluded}`)).toBe(false);
    }
  });

  it('rejects wrong lengths and non-strings', () => {
    expect(isId('person', 'per_000000001')).toBe(false);
    expect(isId('person', 'per_00000000001')).toBe(false);
    expect(isId('person', 'per0000000001')).toBe(false);
    expect(isId('person', 42)).toBe(false);
    expect(isId('person', null)).toBe(false);
  });

  it('names the offending value in the error', () => {
    try {
      parseId('person', 'pro_0000000001');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidIdError);
      if (error instanceof InvalidIdError) {
        expect(error.code).toBe('INVALID_ID');
        expect(error.message).toContain('pro_0000000001');
        expect(error.details?.['value']).toBe('"pro_0000000001"');
      }
    }
  });

  it('finds the kind of an ID from its prefix', () => {
    expect(kindOfId('tit_0000000001')).toBe('title');
    expect(kindOfId('trn_0000000001')).toBe('titleReign');
    expect(kindOfId('xyz_0000000001')).toBeNull();
    expect(kindOfId('tit_00000000i1')).toBeNull();
    expect(kindOfId(7)).toBeNull();
  });
});

describe('createIdFactory', () => {
  it('mints well-formed IDs of the requested kind', () => {
    const factory = createIdFactory(linearCongruentialEntropy(99));
    for (const kind of ENTITY_KIND_LIST) {
      const id = factory.next(kind, neverExists);
      expect(kindOfId(id)).toBe(kind);
    }
  });

  it('mints identical IDs from two factories over the same entropy sequence', () => {
    const first = createIdFactory(linearCongruentialEntropy(12_345));
    const second = createIdFactory(linearCongruentialEntropy(12_345));
    const firstIds = Array.from({ length: 50 }, () => first.next('person', neverExists));
    const secondIds = Array.from({ length: 50 }, () => second.next('person', neverExists));
    expect(firstIds).toEqual(secondIds);
    expect(new Set(firstIds).size).toBe(50);
  });

  it('uses the top 25 bits of two draws for the body', () => {
    const allOnes = 0xffff_ffff;
    const factory = createIdFactory(scriptedIdEntropy([allOnes, 0x7f]));
    expect(factory.next('person', neverExists)).toBe('per_zzzzz00000');
  });

  it('gives readable IDs with the sequential test entropy', () => {
    const factory = createIdFactory(sequentialIdEntropy());
    expect(factory.next('person', neverExists)).toBe('per_0000000001');
    expect(factory.next('person', neverExists)).toBe('per_0000000002');
    expect(factory.next('promotion', neverExists)).toBe('pro_0000000003');

    const largeStart = createIdFactory(sequentialIdEntropy(2 ** 25 + 31));
    expect(largeStart.next('person', neverExists)).toBe('per_000010000z');
  });

  it('draws again when the candidate already exists', () => {
    const entropy = sequentialIdEntropy();
    const factory = createIdFactory(entropy);
    const taken = new Set<string>(['per_0000000001']);
    const id = factory.next('person', (candidate) => taken.has(candidate));
    expect(id).toBe('per_0000000002');
  });

  it('throws IdCollisionError after 8 colliding candidates', () => {
    const entropy = scriptedIdEntropy(Array.from({ length: 32 }, (_, drawIndex) => drawIndex));
    const factory = createIdFactory(entropy);
    let checks = 0;
    expect(() =>
      factory.next('person', () => {
        checks += 1;
        return true;
      }),
    ).toThrow(IdCollisionError);
    expect(ID_MAX_ATTEMPTS).toBe(8);
    expect(checks).toBe(8);
    expect(entropy.used).toBe(16);
  });

  it('succeeds on the eighth attempt', () => {
    const factory = createIdFactory(sequentialIdEntropy());
    let checks = 0;
    const id = factory.next('person', () => {
      checks += 1;
      return checks < 8;
    });
    expect(id).toBe('per_0000000008');
  });

  it('rejects entropy that is not a uint32', () => {
    for (const badDraw of [-1, 2 ** 32, 1.5, Number.NaN]) {
      const factory = createIdFactory(scriptedIdEntropy([badDraw, 0]));
      expect(() => factory.next('person', neverExists)).toThrow(InvalidArgumentError);
    }
  });

  it('only uses letters from the ID alphabet', () => {
    expect(ID_BODY_ALPHABET).toHaveLength(32);
    expect(new Set(ID_BODY_ALPHABET).size).toBe(32);
    expect(ID_BODY_ALPHABET).toMatch(/^[0-9a-hjkmnp-tv-z]+$/);
  });
});
