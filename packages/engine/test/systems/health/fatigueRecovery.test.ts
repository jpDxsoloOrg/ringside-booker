// Fatigue recovery. Design: docs/design/calculation-traces.md#worked-example
import { describe, expect, it } from 'vitest';
import { RngRegistry, type RngStream } from '../../../src/core/rng/registry';
import { intBetween } from '../../../src/core/rng/odds';
import type { Traced } from '../../../src/core/trace/types';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { computeFatigueRecovery } from '../../../src/systems/health';
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

/** Runs the formula with the given overrides and a stream whose one draw is `rollDraw`. */
function recover(fatigue: number, overrides: TunableOverrides = {}, rollDraw = 1): Traced<number> {
  return computeFatigueRecovery(
    { fatigue },
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
      docRef: 'docs/design/calculation-traces.md#worked-example',
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
        { fatigue: 60 },
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
        const result = computeFatigueRecovery({ fatigue }, { tunables, rng: used });
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
      { fatigue: 63 },
      { tunables, rng: new RngRegistry(SEED).stream(RECOVERY_STREAM) },
    );
    const second = computeFatigueRecovery(
      { fatigue: 63 },
      { tunables, rng: new RngRegistry(SEED).stream(RECOVERY_STREAM) },
    );
    expect(second).toEqual(first);
    expectSerialisable(first);
  });
});
