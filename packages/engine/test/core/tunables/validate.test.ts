import { describe, expect, it } from 'vitest';
import {
  createTunables,
  defineTunables,
  describeTunables,
  tunableOverridesSchema,
  validateOverride,
  validateOverrides,
  type TunableProblem,
} from '@ringside/engine';

const testTunables = defineTunables({
  'test.count': {
    kind: 'integer',
    default: 3,
    min: 0,
    max: 10,
    unit: 'count',
    category: 'Beta',
    description: 'A count.',
  },
  'test.factor': {
    kind: 'number',
    default: 1,
    min: 0.5,
    max: 2,
    step: 0.05,
    unit: 'multiplier',
    category: 'Alpha',
    description: 'A multiplier.',
    docRef: 'tunables.md#test',
  },
  'test.enabled': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: 'Beta',
    description: 'A switch.',
  },
  'test.size': {
    kind: 'enum',
    default: 'small',
    options: ['small', 'medium', 'large'],
    unit: 'choice',
    category: 'Alpha',
    description: 'A size.',
  },
});

describe('validateOverride', () => {
  const cases: readonly (readonly [string, unknown, TunableProblem])[] = [
    ['test.factor', Number.NaN, 'notFinite'],
    ['test.factor', Number.POSITIVE_INFINITY, 'notFinite'],
    ['test.count', 2.5, 'notInteger'],
    ['test.count', -1, 'belowMin'],
    ['test.count', 11, 'aboveMax'],
    ['test.factor', 'x', 'wrongType'],
    ['test.enabled', 1, 'wrongType'],
    ['test.size', 3, 'wrongType'],
    ['test.size', 'huge', 'notAnOption'],
    ['nope.key', 1, 'unknownKey'],
  ];

  it.each(cases)('%s = %s gives %s', (key, value, problem) => {
    const found = validateOverride(testTunables, key, value);
    expect(found).not.toBeNull();
    expect(found?.problem).toBe(problem);
    expect(found?.key).toBe(key);
    expect(found?.value).toBe(value);
    expect(found?.message).toContain(`"${key}"`);
  });

  it('writes readable messages', () => {
    expect(validateOverride(testTunables, 'test.count', -1)?.message).toBe(
      'Tunable "test.count" must be at least 0, got -1.',
    );
    expect(validateOverride(testTunables, 'test.size', 'huge')?.message).toBe(
      'Tunable "test.size" must be one of "small", "medium", "large", got "huge".',
    );
  });

  it('accepts values on the range edges, including 0 and false', () => {
    expect(validateOverride(testTunables, 'test.count', 0)).toBeNull();
    expect(validateOverride(testTunables, 'test.count', 10)).toBeNull();
    expect(validateOverride(testTunables, 'test.factor', 0.5)).toBeNull();
    expect(validateOverride(testTunables, 'test.enabled', false)).toBeNull();
    expect(validateOverride(testTunables, 'test.size', 'large')).toBeNull();
  });

  it('does not treat inherited object properties as tunables', () => {
    expect(validateOverride(testTunables, 'toString', 1)?.problem).toBe('unknownKey');
    expect(validateOverride(testTunables, '__proto__', 1)?.problem).toBe('unknownKey');
  });
});

describe('validateOverrides', () => {
  it('passes valid overrides through unchanged', () => {
    const overrides = {
      'test.count': 0,
      'test.enabled': false,
      'test.factor': 1.75,
      'test.size': 'large',
    };
    const result = validateOverrides(testTunables, overrides);
    expect(result.issues).toEqual([]);
    expect(result.accepted).toEqual(overrides);
  });

  it('drops invalid overrides and reports each one in key order', () => {
    const result = validateOverrides(testTunables, {
      'test.size': 'huge',
      'test.count': 4,
      'nope.key': true,
      'test.factor': Number.NaN,
    });
    expect(result.accepted).toEqual({ 'test.count': 4 });
    expect(result.issues.map((found) => found.problem)).toEqual([
      'unknownKey',
      'notFinite',
      'notAnOption',
    ]);
  });

  it('returns accepted keys sorted', () => {
    const result = validateOverrides(testTunables, { 'test.size': 'medium', 'test.count': 1 });
    expect(Object.keys(result.accepted)).toEqual(['test.count', 'test.size']);
  });
});

describe('tunableOverridesSchema', () => {
  it('round-trips overrides through JSON', () => {
    const overrides = createTunables(testTunables, {
      'test.size': 'medium',
      'test.count': 0,
      'test.enabled': false,
    }).overrides;
    const restored = tunableOverridesSchema.parse(JSON.parse(JSON.stringify(overrides)));
    expect(restored).toEqual(overrides);
    expect(Object.keys(restored)).toEqual(Object.keys(overrides));
  });

  it('rejects values that are not numbers, booleans or strings', () => {
    expect(tunableOverridesSchema.safeParse({ 'test.count': null }).success).toBe(false);
    expect(tunableOverridesSchema.safeParse({ 'test.count': [1] }).success).toBe(false);
  });
});

describe('describeTunables', () => {
  const reader = createTunables(testTunables, { 'test.count': 0, 'test.size': 'large' });

  it('returns JSON-safe rows', () => {
    const rows = describeTunables(reader);
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
  });

  it('sorts by category then key, the same way every time', () => {
    const keys = describeTunables(reader).map((row) => row.key);
    expect(keys).toEqual(['test.factor', 'test.size', 'test.count', 'test.enabled']);
    expect(describeTunables(reader)).toEqual(describeTunables(reader));
  });

  it('describes each field, leaving out the ones that do not apply', () => {
    const rows = describeTunables(reader);
    expect(rows).toEqual([
      {
        key: 'test.factor',
        category: 'Alpha',
        kind: 'number',
        unit: 'multiplier',
        description: 'A multiplier.',
        default: 1,
        value: 1,
        overridden: false,
        min: 0.5,
        max: 2,
        step: 0.05,
        docRef: 'tunables.md#test',
      },
      {
        key: 'test.size',
        category: 'Alpha',
        kind: 'enum',
        unit: 'choice',
        description: 'A size.',
        default: 'small',
        value: 'large',
        overridden: true,
        options: ['small', 'medium', 'large'],
      },
      {
        key: 'test.count',
        category: 'Beta',
        kind: 'integer',
        unit: 'count',
        description: 'A count.',
        default: 3,
        value: 0,
        overridden: true,
        min: 0,
        max: 10,
      },
      {
        key: 'test.enabled',
        category: 'Beta',
        kind: 'boolean',
        unit: 'flag',
        description: 'A switch.',
        default: true,
        value: true,
        overridden: false,
      },
    ]);
  });

  it('filters by category, key prefix and overridden state', () => {
    expect(describeTunables(reader, { category: 'Beta' }).map((row) => row.key)).toEqual([
      'test.count',
      'test.enabled',
    ]);
    expect(describeTunables(reader, { keyPrefix: 'test.s' }).map((row) => row.key)).toEqual([
      'test.size',
    ]);
    expect(describeTunables(reader, { overriddenOnly: true }).map((row) => row.key)).toEqual([
      'test.size',
      'test.count',
    ]);
  });

  it('returns copies that cannot change the definitions', () => {
    const sizeRow = describeTunables(reader).find((row) => row.key === 'test.size');
    sizeRow?.options?.push('tiny');
    expect(testTunables['test.size'].options).toEqual(['small', 'medium', 'large']);
  });
});
