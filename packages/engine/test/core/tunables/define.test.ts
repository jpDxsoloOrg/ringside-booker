import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ALL_TUNABLES,
  TunableDefinitionError,
  defineTunables,
  mergeTunables,
  simTunables,
  tunableDefinitionProblems,
  type TunableDef,
  type TunableValue,
  type TunableValues,
} from '@ringside/engine';

function validCount(
  overrides: Partial<Record<'default' | 'min' | 'max', number>> = {},
): TunableDef {
  return {
    kind: 'integer',
    default: 3,
    min: 0,
    max: 10,
    unit: 'count',
    category: 'Test',
    description: 'A test count.',
    ...overrides,
  };
}

function problemsOf(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof TunableDefinitionError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

describe('defineTunables', () => {
  it('accepts valid definitions and keeps them unchanged', () => {
    const defs = defineTunables({
      'test.count': validCount(),
      'test.factor': {
        kind: 'number',
        default: 1.5,
        min: 0,
        max: 3,
        step: 0.1,
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
        options: ['calm', 'wild'],
        unit: 'choice',
        category: 'Test',
        description: 'A choice.',
      },
      'test.wage': {
        kind: 'integer',
        default: 150_000,
        min: 0,
        max: 10_000_000,
        unit: 'money/month',
        category: 'Test',
        description: 'A monthly wage in cents.',
      },
    });
    expect(defs['test.count'].default).toBe(3);
    expect(Object.isFrozen(defs)).toBe(true);
  });

  it('throws when the default is outside the range', () => {
    expect(() => defineTunables({ 'test.count': validCount({ default: 11 }) })).toThrow(
      TunableDefinitionError,
    );
    expect(() => defineTunables({ 'test.count': validCount({ default: -1 }) })).toThrow(
      /outside the range/,
    );
  });

  it('throws when min is above max', () => {
    expect(() =>
      defineTunables({ 'test.count': validCount({ min: 5, max: 4, default: 4 }) }),
    ).toThrow(/greater than max/);
  });

  it('throws on a non-integer default for an integer tunable', () => {
    expect(() => defineTunables({ 'test.count': validCount({ default: 2.5 }) })).toThrow(
      /whole number/,
    );
  });

  it('throws on non-finite numbers', () => {
    expect(() =>
      defineTunables({ 'test.count': validCount({ max: Number.POSITIVE_INFINITY }) }),
    ).toThrow(/finite/);
    expect(() =>
      defineTunables({
        'test.factor': {
          kind: 'number',
          default: Number.NaN,
          min: 0,
          max: 1,
          unit: 'ratio',
          category: 'Test',
          description: 'A ratio.',
        },
      }),
    ).toThrow(/finite/);
  });

  it('throws on a money unit on a number kind', () => {
    expect(() =>
      defineTunables({
        'test.price': {
          kind: 'number',
          default: 10,
          min: 0,
          max: 100,
          unit: 'money',
          category: 'Test',
          description: 'A price.',
        },
      }),
    ).toThrow(/whole cents/);
  });

  it('throws when an enum default is not one of its options', () => {
    expect(() =>
      defineTunables({
        'test.mode': {
          kind: 'enum',
          default: 'loud',
          options: ['calm', 'wild'],
          unit: 'choice',
          category: 'Test',
          description: 'A choice.',
        },
      }),
    ).toThrow(/not one of the options/);
  });

  it.each([
    'eventLogSize',
    'Sim.eventLogSize',
    'sim.EventLogSize',
    'sim..size',
    'sim.event_log',
    '1sim.size',
    'sim.',
  ])('throws on the bad key format %s', (badKey) => {
    expect(() => defineTunables({ [badKey]: validCount() })).toThrow(/dot-separated camelCase/);
  });

  it('accepts keys with more than two segments', () => {
    expect(() => defineTunables({ 'matches.rating.topCompression': validCount() })).not.toThrow();
  });

  it('throws on an empty description', () => {
    expect(() => defineTunables({ 'test.count': { ...validCount(), description: '   ' } })).toThrow(
      /description must not be empty/,
    );
  });

  it('throws when flag or choice units are used by the wrong kind', () => {
    expect(() => defineTunables({ 'test.count': { ...validCount(), unit: 'flag' } })).toThrow(
      /"flag" unit/,
    );
    expect(() =>
      defineTunables({
        'test.enabled': {
          kind: 'boolean',
          default: false,
          unit: 'count',
          category: 'Test',
          description: 'A switch.',
        },
      }),
    ).toThrow(/"flag" unit/);
  });

  it('throws when a probability range leaves 0 to 1', () => {
    expect(() =>
      defineTunables({
        'test.odds': {
          kind: 'number',
          default: 0.5,
          min: 0,
          max: 100,
          unit: 'probability',
          category: 'Test',
          description: 'Odds.',
        },
      }),
    ).toThrow(/0 to 1/);
  });

  it('reports every problem at once', () => {
    const problems = problemsOf(() =>
      defineTunables({
        'Bad.key': validCount({ default: 50 }),
        'test.other': { ...validCount(), description: '' },
      }),
    );
    expect(problems).toHaveLength(3);
  });

  it('validates the engine sim tunables at module load', () => {
    expect(Object.keys(simTunables).sort()).toEqual([
      'sim.commandLogSize',
      'sim.eventLogSize',
      'sim.maxEventCascadeDepth',
      'sim.stopSkipAfterConsecutiveFailures',
      'sim.traceRetentionPerKind',
      'sim.traceSummaryLimit',
    ]);
    for (const [key, def] of Object.entries(ALL_TUNABLES)) {
      expect(tunableDefinitionProblems(key, def)).toEqual([]);
    }
  });
});

describe('mergeTunables', () => {
  const first = defineTunables({ 'alpha.count': validCount() });
  const second = defineTunables({ 'beta.count': validCount() });

  it('merges distinct definition sets', () => {
    const merged = mergeTunables(first, second);
    expect(Object.keys(merged).sort()).toEqual(['alpha.count', 'beta.count']);
  });

  it('throws on a duplicate key across two definition sets', () => {
    const clash = defineTunables({ 'alpha.count': validCount({ default: 5 }) });
    expect(() => mergeTunables(first, clash)).toThrow(TunableDefinitionError);
    expect(problemsOf(() => mergeTunables(first, second, clash))).toEqual([
      'alpha.count: defined in more than one tunable set',
    ]);
  });
});

describe('value types', () => {
  const defs = defineTunables({
    'test.factor': {
      kind: 'number',
      default: 1,
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
      options: ['calm', 'wild'],
      unit: 'choice',
      category: 'Test',
      description: 'A choice.',
    },
  });

  it('maps each kind to its value type', () => {
    expectTypeOf<TunableValue<(typeof defs)['test.factor']>>().toEqualTypeOf<number>();
    expectTypeOf<TunableValue<(typeof defs)['test.enabled']>>().toEqualTypeOf<boolean>();
    expectTypeOf<TunableValue<(typeof defs)['test.mode']>>().toEqualTypeOf<'calm' | 'wild'>();
    expectTypeOf<TunableValues<typeof defs>>().toEqualTypeOf<{
      readonly 'test.factor': number;
      readonly 'test.enabled': boolean;
      readonly 'test.mode': 'calm' | 'wild';
    }>();
  });
});
