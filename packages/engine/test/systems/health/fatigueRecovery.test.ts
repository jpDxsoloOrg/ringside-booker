// Fatigue recovery. Design: docs/design/health.md#fatigue-recovery
import { describe, expect, it } from 'vitest';
import { RngRegistry, type RngStream } from '../../../src/core/rng/registry';
import { intBetween } from '../../../src/core/rng/odds';
import type { Traced } from '../../../src/core/trace/types';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { computeFatigueRecovery, type FatigueRecoveryInputs } from '../../../src/systems/health';
import { RECOVERY_STREAM } from '../../../src/systems/health/streams';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  expectRollRecorded,
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../support/trace';

const SEED = 'health-recovery-test';

/**
 * A stream that hands out the given 32-bit draws in order, so a test can choose what the extra
 * rest roll comes up as. `intBetween(stream, 0, max)` returns `draw % (max + 1)` for small draws.
 */
function scriptedStream(draws: readonly number[]): RngStream & { readonly drawsTaken: number } {
  let next = 0;
  return {
    name: RECOVERY_STREAM,
    get drawsTaken() {
      return next;
    },
    nextUint32: () => {
      const draw = draws[next];
      if (draw === undefined) {
        throw new Error(`scriptedStream ran out after ${String(next)} draws`);
      }
      next += 1;
      return draw;
    },
    nextFloat: () => {
      throw new Error('the fatigue recovery formula only rolls whole numbers');
    },
  };
}

/** An average worker: stamina 50, aged 28, no traits, in a world that ages, rested last night. */
const AVERAGE: FatigueRecoveryInputs = {
  fatigue: 50,
  stamina: 50,
  age: 28,
  traits: [],
  agingEnabled: true,
  workedPromo: false,
};

/** The average worker with `fatigue`. */
function averageAt(fatigue: number): FatigueRecoveryInputs {
  return { ...AVERAGE, fatigue };
}

/** Runs the formula with the given overrides and a stream whose one draw is `rollDraw`. */
function recover(
  fatigue: number,
  overrides: TunableOverrides = {},
  rollDraw = 1,
  person: Partial<FatigueRecoveryInputs> = {},
): Traced<number> {
  return computeFatigueRecovery(
    { ...averageAt(fatigue), ...person },
    { tunables: createEngineTunables(overrides), rng: scriptedStream([rollDraw]) },
  );
}

describe('computeFatigueRecovery', () => {
  it('takes 50 down to 45 with the default recovery of 4 and an extra rest roll of 1', () => {
    const result = recover(50);
    expect(result.value).toBe(45);
    expectTraceReplays(result);
    expect(result.trace).toMatchObject({
      kind: 'formula',
      label: 'Fatigue after a day of rest',
      value: 45,
      unit: 'points',
      docRef: 'docs/design/health.md#fatigue-recovery',
    });
    expect(expectTraceContains(result, { kind: 'input', label: 'Fatigue before rest' }).value).toBe(
      50,
    );
    expect(
      expectTraceContains(result, { kind: 'subtract', label: 'Daily recovery' }),
    ).toMatchObject({ operand: 4, before: 50, after: 46 });
    expect(expectTraceContains(result, { kind: 'subtract', label: 'Extra rest' })).toMatchObject({
      operand: 1,
      before: 46,
      after: 45,
    });
    expect(expectTraceContains(result, { kind: 'clamp' })).toMatchObject({
      min: 0,
      max: 100,
      before: 45,
      after: 45,
      applied: false,
    });
  });

  it('takes nothing extra when the roll comes up 0', () => {
    const result = recover(50, {}, 0);
    expect(result.value).toBe(46);
    expectTraceReplays(result);
  });

  it('records each step in order: start, daily recovery, roll, extra rest, clamp', () => {
    const result = recover(50);
    expect(result.trace.children?.map((node) => node.kind)).toEqual([
      'input',
      'subtract',
      'roll',
      'subtract',
      'clamp',
    ]);
  });

  it('clamps 2 minus 4 to 0 and marks the clamp as applied', () => {
    const result = recover(2);
    expect(result.value).toBe(0);
    expectTraceReplays(result);
    expect(expectTraceContains(result, { kind: 'clamp' })).toMatchObject({
      before: -3,
      after: 0,
      applied: true,
    });
  });

  it('lands exactly on 0 without the clamp applying', () => {
    const result = recover(5);
    expect(result.value).toBe(0);
    expectTraceReplays(result);
    expect(expectTraceContains(result, { kind: 'clamp' }).applied).toBe(false);
  });

  it('applies the clamp when one more point of rest would go below 0', () => {
    const result = recover(4);
    expect(result.value).toBe(0);
    expect(expectTraceContains(result, { kind: 'clamp' })).toMatchObject({
      before: -1,
      applied: true,
    });
  });

  it('keeps 0 at 0', () => {
    const result = recover(0);
    expect(result.value).toBe(0);
    expectTraceReplays(result);
  });

  it('leaves fatigue unchanged when both tunables are overridden to 0, and says so', () => {
    const result = recover(
      37,
      { 'health.fatigue.recoveryPerDay': 0, 'health.fatigue.recoveryBonusMax': 0 },
      // Any draw: the roll can only come up 0.
      7,
    );
    expect(result.value).toBe(37);
    expectTraceReplays(result);
    expect(expectTraceContains(result, { kind: 'tunable', label: 'Daily recovery' })).toMatchObject(
      {
        key: 'health.fatigue.recoveryPerDay',
        value: 0,
        defaultValue: 4,
        overridden: true,
      },
    );
    expect(
      expectTraceContains(result, { kind: 'tunable', label: 'Most extra rest' }),
    ).toMatchObject({
      key: 'health.fatigue.recoveryBonusMax',
      value: 0,
      defaultValue: 1,
      overridden: true,
    });
    expect(expectTraceContains(result, { kind: 'clamp' }).applied).toBe(false);
  });

  it('shows the tunables as not overridden when they are at their defaults', () => {
    const result = recover(50);
    expect(
      expectTraceContains(result, { kind: 'tunable', label: 'Daily recovery' }).overridden,
    ).toBe(false);
    expect(
      expectTraceContains(result, { kind: 'tunable', label: 'Most extra rest' }).overridden,
    ).toBe(false);
  });

  it('takes 100 to 0 with the daily recovery at its maximum of 100', () => {
    const result = recover(100, { 'health.fatigue.recoveryPerDay': 100 });
    expect(result.value).toBe(0);
    expectTraceReplays(result);
    expect(expectTraceContains(result, { kind: 'clamp' })).toMatchObject({
      before: -1,
      applied: true,
    });
  });

  it('keeps 100 at 100 with no recovery, the clamp checked but not applied', () => {
    const result = recover(
      100,
      { 'health.fatigue.recoveryPerDay': 0, 'health.fatigue.recoveryBonusMax': 0 },
      0,
    );
    expect(result.value).toBe(100);
    expectTraceReplays(result);
    expect(expectTraceContains(result, { kind: 'clamp' })).toMatchObject({
      before: 100,
      applied: false,
    });
  });

  it('handles a fractional daily recovery', () => {
    const result = recover(10, { 'health.fatigue.recoveryPerDay': 2.5 }, 0);
    expect(result.value).toBe(7.5);
    expectTraceReplays(result);
  });

  it('rolls up to the largest extra rest of 10', () => {
    const result = recover(50, { 'health.fatigue.recoveryBonusMax': 10 }, 10);
    expect(result.value).toBe(36);
    expectTraceReplays(result);
    expect(expectRollRecorded(result, RECOVERY_STREAM)).toMatchObject({ min: 0, max: 10 });
  });

  it('records the roll from health.recovery over 0..bonusMax, with the tunable that set it', () => {
    for (const bonusMax of [0, 1, 3, 10]) {
      const result = recover(50, { 'health.fatigue.recoveryBonusMax': bonusMax }, 0);
      const roll = expectRollRecorded(result, RECOVERY_STREAM);
      expect(roll).toEqual({
        stream: 'health.recovery',
        kind: 'int',
        label: 'Extra rest',
        odds: 1 / (bonusMax + 1),
        min: 0,
        max: bonusMax,
        result: 0,
      });
      const rollNode = expectTraceContains(result, { kind: 'roll', label: 'Extra rest' });
      expect(rollNode.children?.[0]).toMatchObject({
        kind: 'tunable',
        key: 'health.fatigue.recoveryBonusMax',
        value: bonusMax,
      });
    }
  });

  it('draws exactly once per call, even when the extra rest is off', () => {
    for (const bonusMax of [0, 1, 10]) {
      const stream = scriptedStream([3, 3, 3]);
      computeFatigueRecovery(
        averageAt(60),
        {
          tunables: createEngineTunables({ 'health.fatigue.recoveryBonusMax': bonusMax }),
          rng: stream,
        },
      );
      expect(stream.drawsTaken).toBe(1);
    }
  });

  it('moves a real stream exactly as far as one intBetween call', () => {
    for (const bonusMax of [0, 1, 10]) {
      const tunables = createEngineTunables({ 'health.fatigue.recoveryBonusMax': bonusMax });
      const used = new RngRegistry(SEED).stream(RECOVERY_STREAM);
      const twin = new RngRegistry(SEED).stream(RECOVERY_STREAM);
      for (const fatigue of [1, 40, 100]) {
        const result = computeFatigueRecovery(averageAt(fatigue), { tunables, rng: used });
        expect(expectRollRecorded(result, RECOVERY_STREAM).result).toBe(
          intBetween(twin, 0, bonusMax),
        );
      }
      expect(used.nextUint32()).toBe(twin.nextUint32());
    }
  });

  it('gives the same result for the same stream state', () => {
    const tunables = createEngineTunables();
    const first = computeFatigueRecovery(
      averageAt(63),
      { tunables, rng: new RngRegistry(SEED).stream(RECOVERY_STREAM) },
    );
    const second = computeFatigueRecovery(
      averageAt(63),
      { tunables, rng: new RngRegistry(SEED).stream(RECOVERY_STREAM) },
    );
    expect(second).toEqual(first);
    expectSerialisable(first);
  });
});

describe('computeFatigueRecovery: stamina, age, traits and promos', () => {
  /** The daily recovery the formula took off, before the extra rest (roll fixed at 0). */
  function dailyRecoveryOf(
    person: Partial<FatigueRecoveryInputs>,
    overrides: TunableOverrides = {},
  ): number {
    const result = recover(50, overrides, 0, person);
    expectTraceReplays(result);
    return expectTraceContains(result, { kind: 'subtract', label: 'Daily recovery' }).operand;
  }

  it('recovers the plain daily rate for an average worker: stamina 50, aged 28, no traits', () => {
    expect(dailyRecoveryOf({})).toBe(4);
  });

  it('recovers faster with high stamina and slower with low stamina', () => {
    expect(dailyRecoveryOf({ stamina: 100 })).toBeCloseTo(5.6, 10);
    expect(dailyRecoveryOf({ stamina: 0 })).toBeCloseTo(2.4, 10);
    expect(dailyRecoveryOf({ stamina: 75 })).toBeCloseTo(4.8, 10);
  });

  it('ignores stamina when its weight is 0, and doubles or zeroes recovery at a weight of 1', () => {
    expect(dailyRecoveryOf({ stamina: 100 }, { 'health.fatigue.staminaWeight': 0 })).toBe(4);
    expect(dailyRecoveryOf({ stamina: 100 }, { 'health.fatigue.staminaWeight': 1 })).toBe(8);
    expect(dailyRecoveryOf({ stamina: 0 }, { 'health.fatigue.staminaWeight': 1 })).toBe(0);
  });

  it('slows from age 33 by 2% a year, never below half', () => {
    expect(dailyRecoveryOf({ age: 33 })).toBe(4);
    expect(dailyRecoveryOf({ age: 43 })).toBeCloseTo(3.2, 10);
    expect(dailyRecoveryOf({ age: 58 })).toBeCloseTo(2, 10);
    expect(dailyRecoveryOf({ age: 70 })).toBeCloseTo(2, 10);
    expect(dailyRecoveryOf({ age: 18 })).toBe(4);
  });

  it('turns the age effect off with a penalty of 0, and floors at 0 with a minimum of 0', () => {
    expect(dailyRecoveryOf({ age: 70 }, { 'health.fatigue.agePenaltyPerYear': 0 })).toBe(4);
    expect(
      dailyRecoveryOf(
        { age: 60 },
        { 'health.fatigue.agePenaltyPerYear': 0.2, 'health.fatigue.ageFactorMin': 0 },
      ),
    ).toBe(0);
  });

  it('takes the "Aging is off in this world" branch when the world does not age', () => {
    const result = recover(50, {}, 0, { age: 70, agingEnabled: false });
    expect(result.value).toBe(46);
    expectTraceReplays(result);
    expect(
      expectTraceContains(result, { kind: 'branch', label: 'Aging is off in this world' }).taken,
    ).toBe(true);
    const ageStep = expectTraceContains(result, { kind: 'multiply', label: 'Age' });
    expect(ageStep.operand).toBe(1);
  });

  it('names the workhorse and coaster traits on their own line with their tunables', () => {
    expect(dailyRecoveryOf({ traits: ['workhorse'] })).toBeCloseTo(4.8, 10);
    expect(dailyRecoveryOf({ traits: ['coaster'] })).toBeCloseTo(3.6, 10);
    expect(dailyRecoveryOf({ traits: ['durable'] })).toBe(4);

    const workhorse = recover(50, {}, 0, { traits: ['workhorse'] });
    expect(expectTraceContains(workhorse, { kind: 'branch', label: 'Workhorse' }).taken).toBe(true);
    expect(
      expectTraceContains(workhorse, { kind: 'tunable', label: 'Workhorse' }).key,
    ).toBe('health.fatigue.workhorseMultiplier');
    const coaster = recover(50, {}, 0, { traits: ['coaster'] });
    expect(expectTraceContains(coaster, { kind: 'tunable', label: 'Coaster' }).key).toBe(
      'health.fatigue.coasterMultiplier',
    );
  });

  it('halves the daily recovery after a talking-only show day, and not the extra rest', () => {
    const result = recover(50, {}, 1, { workedPromo: true });
    expect(result.value).toBe(47);
    expectTraceReplays(result);
    expect(
      expectTraceContains(result, { kind: 'multiply', label: 'Worked a promo today' }),
    ).toMatchObject({ operand: 0.5, before: 4, after: 2 });
    expect(
      expectTraceContains(result, { kind: 'tunable', label: 'Worked a promo today' }).key,
    ).toBe('health.fatigue.workedPromoRecovery');
    expect(dailyRecoveryOf({ workedPromo: true }, { 'health.fatigue.workedPromoRecovery': 1 })).toBe(
      4,
    );
    expect(dailyRecoveryOf({ workedPromo: true }, { 'health.fatigue.workedPromoRecovery': 0 })).toBe(
      0,
    );
  });

  it('recovers only the roll when the daily recovery is 0, whatever the stamina, age and traits', () => {
    const result = recover(50, { 'health.fatigue.recoveryPerDay': 0 }, 1, {
      stamina: 100,
      age: 20,
      traits: ['workhorse'],
    });
    expect(result.value).toBe(49);
    expectTraceReplays(result);
  });

  it('multiplies every factor together and replays', () => {
    // 4 × 1.4 (stamina 100) × 0.8 (age 43) × 1.2 (workhorse) × 0.5 (promo) = 2.688
    const result = recover(30, {}, 1, {
      stamina: 100,
      age: 43,
      traits: ['workhorse'],
      workedPromo: true,
    });
    expect(result.value).toBeCloseTo(30 - 2.688 - 1, 10);
    expectTraceReplays(result);
    expectSerialisable(result);
  });

  it('reads stamina, age, the trait and the roll by name, with every tunable key visible', () => {
    const result = recover(50, {}, 1, { stamina: 80, age: 40, traits: ['coaster'] });
    for (const label of ['Stamina', 'Age', 'Coaster']) {
      expect(expectTraceContains(result, { kind: 'multiply', label }).label).toBe(label);
    }
    for (const label of ['Daily recovery', 'Extra rest']) {
      expect(expectTraceContains(result, { kind: 'subtract', label }).label).toBe(label);
    }
    expect(expectTraceContains(result, { kind: 'roll', label: 'Extra rest' }).label).toBe(
      'Extra rest',
    );
    const keys = new Set<string>();
    const visit = (node: Traced<number>['trace']): void => {
      if (node.kind === 'tunable') {
        keys.add(node.key);
      }
      for (const child of node.children ?? []) {
        visit(child);
      }
    };
    visit(result.trace);
    expect([...keys].sort()).toEqual([
      'health.fatigue.ageFactorMin',
      'health.fatigue.ageFrom',
      'health.fatigue.agePenaltyPerYear',
      'health.fatigue.coasterMultiplier',
      'health.fatigue.recoveryBonusMax',
      'health.fatigue.recoveryPerDay',
      'health.fatigue.staminaWeight',
    ]);
  });
});
