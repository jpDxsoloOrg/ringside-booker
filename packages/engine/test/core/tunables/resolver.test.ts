import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ALL_TUNABLES,
  createEngineTunables,
  createTunables,
  defineTunables,
  loadEngineTunables,
  loadTunables,
  withOverride,
  withoutOverride,
  type TunableKey,
} from '@ringside/engine';

const testTunables = defineTunables({
  'test.retries': {
    kind: 'integer',
    default: 3,
    min: 0,
    max: 10,
    unit: 'count',
    category: 'Test',
    description: 'How many retries.',
  },
  'test.factor': {
    kind: 'number',
    default: 1.25,
    min: 0,
    max: 2,
    unit: 'multiplier',
    category: 'Test',
    description: 'A multiplier.',
  },
  'test.enabled': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: 'Test',
    description: 'A switch.',
  },
  'test.mode': {
    kind: 'enum',
    default: 'calm',
    options: ['', 'calm', 'wild'],
    unit: 'choice',
    category: 'Test',
    description: 'A choice that allows an empty option.',
  },
});

describe('createTunables', () => {
  it('returns an override of 0 as 0, not the default of 3', () => {
    const reader = createTunables(testTunables, { 'test.retries': 0 });
    expect(reader.get('test.retries')).toBe(0);
  });

  it('returns a multiplier override of 0 as 0', () => {
    const reader = createTunables(testTunables, { 'test.factor': 0 });
    expect(reader.get('test.factor')).toBe(0);
  });

  it('returns an override of false as false on a boolean that defaults to true', () => {
    const reader = createTunables(testTunables, { 'test.enabled': false });
    expect(reader.get('test.enabled')).toBe(false);
  });

  it("returns an override of '' as '' on an enum that allows it", () => {
    const reader = createTunables(testTunables, { 'test.mode': '' });
    expect(reader.get('test.mode')).toBe('');
  });

  it('returns the default when there is no override', () => {
    const reader = createTunables(testTunables, {});
    expect(reader.get('test.retries')).toBe(3);
    expect(reader.get('test.factor')).toBe(1.25);
    expect(reader.get('test.enabled')).toBe(true);
    expect(reader.get('test.mode')).toBe('calm');
  });

  it('reports isOverridden only for keys the overrides contain', () => {
    const reader = createTunables(testTunables, { 'test.retries': 3, 'test.enabled': false });
    expect(reader.isOverridden('test.retries')).toBe(true);
    expect(reader.isOverridden('test.enabled')).toBe(true);
    expect(reader.isOverridden('test.factor')).toBe(false);
    expect(reader.isOverridden('test.mode')).toBe(false);
  });

  it('exposes defaults and definitions regardless of overrides', () => {
    const reader = createTunables(testTunables, { 'test.retries': 7 });
    expect(reader.get('test.retries')).toBe(7);
    expect(reader.defaultOf('test.retries')).toBe(3);
    expect(reader.def('test.retries')).toBe(testTunables['test.retries']);
  });

  it('drops invalid overrides so the default applies', () => {
    const reader = createTunables(testTunables, { 'test.retries': 99, 'gone.key': 1 });
    expect(reader.get('test.retries')).toBe(3);
    expect(reader.overrides).toEqual({});
  });

  it('stores only overridden keys, sorted', () => {
    const reader = createTunables(testTunables, { 'test.retries': 1, 'test.enabled': false });
    expect(Object.keys(reader.overrides)).toEqual(['test.enabled', 'test.retries']);
    expect(JSON.stringify(reader.overrides)).toBe('{"test.enabled":false,"test.retries":1}');
  });

  it('throws on an unknown key reached at runtime', () => {
    const reader = createTunables(testTunables, {});
    const untypedKey: string = 'test.missing';
    expect(() => reader.get(untypedKey as 'test.retries')).toThrow(/Unknown tunable/);
  });
});

describe('typed keys', () => {
  it('types engine tunables by key and rejects unknown keys at compile time', () => {
    const reader = createEngineTunables();
    expectTypeOf(reader.get('sim.eventLogSize')).toEqualTypeOf<number>();
    expectTypeOf<TunableKey>().toEqualTypeOf<keyof typeof ALL_TUNABLES>();
    expectTypeOf<'sim.eventLogSize'>().toExtend<TunableKey>();
    expectTypeOf<'sim.eventLogSzie'>().not.toExtend<TunableKey>();
    // @ts-expect-error a misspelt key is a compile error
    expect(() => reader.get('sim.eventLogSzie')).toThrow(/Unknown tunable/);
  });

  it('types boolean and enum tunables', () => {
    const reader = createTunables(testTunables, {});
    expectTypeOf(reader.get('test.enabled')).toEqualTypeOf<boolean>();
    expectTypeOf(reader.get('test.mode')).toEqualTypeOf<'' | 'calm' | 'wild'>();
    expectTypeOf(reader.defaultOf('test.factor')).toEqualTypeOf<number>();
  });
});

describe('loadTunables (load-time policy)', () => {
  it('never throws, drops bad overrides and reports them', () => {
    const { reader, issues } = loadTunables(testTunables, {
      'test.retries': 0,
      'test.factor': 'fast',
      'removed.tunable': 4,
      'test.enabled': null,
    });
    expect(reader.get('test.retries')).toBe(0);
    expect(reader.get('test.factor')).toBe(1.25);
    expect(reader.get('test.enabled')).toBe(true);
    expect(issues.map((found) => [found.key, found.problem])).toEqual([
      ['removed.tunable', 'unknownKey'],
      ['test.enabled', 'wrongType'],
      ['test.factor', 'wrongType'],
    ]);
  });

  it('loads the engine tunables from an old save with a removed key', () => {
    const { reader, issues } = loadEngineTunables({ 'sim.oldSetting': 12, 'sim.eventLogSize': 0 });
    expect(reader.get('sim.eventLogSize')).toBe(0);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.problem).toBe('unknownKey');
  });
});

describe('withOverride and withoutOverride (live policy)', () => {
  it('returns a new reader and leaves the original unchanged', () => {
    const original = createTunables(testTunables, {});
    const result = withOverride(original, 'test.retries', 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reader.get('test.retries')).toBe(0);
      expect(result.reader.isOverridden('test.retries')).toBe(true);
    }
    expect(original.get('test.retries')).toBe(3);
    expect(original.isOverridden('test.retries')).toBe(false);
    expect(Object.isFrozen(original)).toBe(true);
    expect(Object.isFrozen(original.overrides)).toBe(true);
  });

  it('refuses an invalid value with the issue', () => {
    const original = createTunables(testTunables, {});
    const result = withOverride(original, 'test.retries', 11);
    expect(result).toEqual({
      ok: false,
      issue: {
        key: 'test.retries',
        value: 11,
        problem: 'aboveMax',
        message: 'Tunable "test.retries" must be at most 10, got 11.',
      },
    });
  });

  it('removes an override so the default applies again', () => {
    const overridden = createTunables(testTunables, { 'test.enabled': false, 'test.retries': 1 });
    const cleared = withoutOverride(overridden, 'test.enabled');
    expect(cleared.get('test.enabled')).toBe(true);
    expect(cleared.isOverridden('test.enabled')).toBe(false);
    expect(cleared.overrides).toEqual({ 'test.retries': 1 });
    expect(overridden.get('test.enabled')).toBe(false);
  });
});
