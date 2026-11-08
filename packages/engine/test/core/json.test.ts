import { describe, expect, it } from 'vitest';
import {
  EngineError,
  NotSerialisableError,
  assertJsonValue,
  cloneJson,
  findJsonProblem,
  isJsonArray,
  isJsonObject,
  isJsonValue,
  zJsonValue,
  type JsonValue,
} from '@ringside/engine';

class Wrestler {
  readonly name = 'Test Worker';
}

/** Runs assertJsonValue and returns the error it threw, failing the test if it did not throw. */
function captureError(value: unknown, path?: string): NotSerialisableError {
  try {
    assertJsonValue(value, path);
  } catch (error: unknown) {
    if (error instanceof NotSerialisableError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected assertJsonValue to throw');
}

describe('assertJsonValue: accepted values', () => {
  it('accepts plain nested objects and arrays', () => {
    const value = {
      name: 'Main event',
      rating: 4.25,
      finished: true,
      winner: null,
      segments: [1, 2, { kind: 'promo', tags: ['hot', 'cold'] }],
      nested: { deeper: { deepest: [[], {}] } },
    };
    expect(() => {
      assertJsonValue(value);
    }).not.toThrow();
    expect(isJsonValue(value)).toBe(true);
  });

  it('accepts -0, empty objects and empty arrays', () => {
    for (const value of [-0, {}, [], { empty: {} }, '']) {
      expect(findJsonProblem(value)).toBeNull();
    }
  });

  it('accepts objects without a prototype', () => {
    const bare: Record<string, unknown> = { key: 1 };
    Reflect.setPrototypeOf(bare, null);
    expect(Object.getPrototypeOf(bare)).toBeNull();
    expect(isJsonValue(bare)).toBe(true);
  });
});

// The engine never reads the wall clock; this fixed Date only exists to prove Dates are rejected.
// eslint-disable-next-line no-restricted-syntax
const EPOCH_DATE = new Date(0);

describe('assertJsonValue: rejected values', () => {
  const cases: readonly { label: string; value: unknown; path: string; reason: RegExp }[] = [
    { label: 'a function', value: { a: () => 1 }, path: '$.a', reason: /function/ },
    { label: 'a Map', value: { a: [0, 1, { b: new Map() }] }, path: '$.a[2].b', reason: /Map/ },
    { label: 'a Set', value: [new Set([1])], path: '$[0]', reason: /Set/ },
    { label: 'a Date', value: { when: EPOCH_DATE }, path: '$.when', reason: /Date/ },
    {
      label: 'a class instance',
      value: { worker: new Wrestler() },
      path: '$.worker',
      reason: /class Wrestler/,
    },
    { label: 'undefined in an array', value: [1, undefined], path: '$[1]', reason: /undefined/ },
    {
      label: 'undefined as an object value',
      value: { a: { b: undefined } },
      path: '$.a.b',
      reason: /undefined/,
    },
    { label: 'NaN', value: { score: Number.NaN }, path: '$.score', reason: /NaN/ },
    { label: 'Infinity', value: [Number.POSITIVE_INFINITY], path: '$[0]', reason: /infinite/ },
    {
      label: '-Infinity',
      value: { low: Number.NEGATIVE_INFINITY },
      path: '$.low',
      reason: /infinite/,
    },
    { label: 'a bigint', value: { big: 10n }, path: '$.big', reason: /bigint/ },
    { label: 'a symbol', value: { tag: Symbol('tag') }, path: '$.tag', reason: /symbol/ },
    { label: 'a top-level undefined', value: undefined, path: '$', reason: /undefined/ },
  ];

  for (const { label, value, path, reason } of cases) {
    it(`rejects ${label} at ${path}`, () => {
      const error = captureError(value);
      expect(error.path).toBe(path);
      expect(error.message).toMatch(reason);
      expect(error.message.startsWith(`${path} is not serialisable`)).toBe(true);
      expect(isJsonValue(value)).toBe(false);
    });
  }

  it('throws an EngineError with a stable code and flat details', () => {
    const error = captureError({ a: new Map() });
    expect(error).toBeInstanceOf(EngineError);
    expect(error.code).toBe('NOT_SERIALISABLE');
    expect(error.details).toEqual({ path: '$.a', reason: 'a Map' });
  });

  it('rejects an object with a class prototype even when its fields are plain', () => {
    const withPrototype: unknown = Object.create({ inherited: true });
    expect(captureError({ entity: withPrototype }).path).toBe('$.entity');
  });

  it('rejects array holes', () => {
    // A sparse array literal: JSON.stringify would quietly write null for the hole.
    // eslint-disable-next-line no-sparse-arrays
    expect(captureError([1, , 3]).path).toBe('$[1]');
  });

  it('rejects symbol keys and circular references', () => {
    expect(captureError({ [Symbol('hidden')]: 1 }).message).toMatch(/symbol keys/);
    const loop: Record<string, unknown> = { name: 'loop' };
    loop['self'] = loop;
    expect(captureError({ root: loop }).path).toBe('$.root.self');
  });

  it('accepts the same object twice when it is not a cycle', () => {
    const shared = { id: 'per_0000000001' };
    expect(isJsonValue({ first: shared, second: shared })).toBe(true);
  });

  it('quotes keys that are not identifiers and uses the given root path', () => {
    expect(captureError({ 'title.changed': { 'holder id': Number.NaN } }).path).toBe(
      '$["title.changed"]["holder id"]',
    );
    expect(captureError({ a: undefined }, 'events.day.started').path).toBe('events.day.started.a');
  });
});

describe('zJsonValue', () => {
  it('parses plain JSON and reports the bad path otherwise', () => {
    expect(zJsonValue.parse({ a: [1, 'two', null] })).toEqual({ a: [1, 'two', null] });
    const result = zJsonValue.safeParse({ a: [1, new Set()] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('$.a[1] is a Set');
  });
});

describe('isJsonObject and isJsonArray', () => {
  it('tell objects, arrays and leaves apart', () => {
    const values: JsonValue[] = [{ a: 1 }, [1], 'text', 3, true, null];
    expect(values.map((value) => isJsonObject(value))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(values.map((value) => isJsonArray(value))).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(isJsonObject(undefined)).toBe(false);
  });
});

describe('cloneJson', () => {
  it('returns an equal value that shares no objects with the original', () => {
    const original: JsonValue = { list: [1, { deep: 'x' }], nested: { flag: true, empty: null } };
    const copy = cloneJson(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    if (!isJsonObject(copy) || !isJsonObject(original)) {
      throw new Error('expected objects');
    }
    expect(copy['list']).not.toBe(original['list']);
    expect(copy['nested']).not.toBe(original['nested']);
  });

  it('returns leaves as they are', () => {
    expect(cloneJson('text')).toBe('text');
    expect(cloneJson(null)).toBeNull();
    expect(cloneJson(-0)).toBe(-0);
  });
});

describe('cloneJson and __proto__ keys', () => {
  it('keeps a __proto__ key read from a file as an ordinary key', () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"polluted":true},"kept":1}');
    if (!isJsonValue(parsed)) {
      throw new Error('expected JSON');
    }
    const copy = cloneJson(parsed);
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.keys(copy ?? {})).toEqual(['__proto__', 'kept']);
    expect(JSON.stringify(copy)).toBe('{"__proto__":{"polluted":true},"kept":1}');
  });
});
