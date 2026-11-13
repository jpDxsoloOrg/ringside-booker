// Momentum drift formula (MTCH3-07). Design: docs/design/match-aftermath.md#momentum-drift
import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../../../../src/core/errors';
import { inputOf } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  AT_REST_NOTE,
  DRIFT_OFF_NOTE,
  MOMENTUM_DRIFT_DOC_REF,
  SETTLE_WITHIN,
  momentumDrift,
  momentumDriftLabel,
  type MomentumDriftInputs,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

function drift(inputs: MomentumDriftInputs, overrides: TunableOverrides = {}) {
  const result = momentumDrift(inputs, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

/** Applies `weeks` weekly drift steps from `start` and returns the momentum after each. */
function weekByWeek(start: number, weeks: number, overrides: TunableOverrides = {}): number[] {
  const path: number[] = [];
  let momentum = start;
  for (let week = 0; week < weeks; week += 1) {
    momentum += drift({ before: momentum }, overrides).value;
    path.push(momentum);
  }
  return path;
}

describe('momentumDrift', () => {
  it('takes 12% of the way back to 0 by default, with a plain-words label', () => {
    const result = drift({ before: 100 });
    expect(result.value).toBeCloseTo(-12, 10);
    expect(result.trace.label).toBe('Cooling off: 12% of the way back to 0');
    expect(result.trace).toMatchObject({ docRef: MOMENTUM_DRIFT_DOC_REF });
    expect(
      expectTraceContains(result, { kind: 'tunable', label: 'Weekly cooling off' }),
    ).toMatchObject({
      key: 'match.momentum.weeklyDrift',
    });
    expect(expectTraceContains(result, { kind: 'tunable', label: 'Resting point' })).toMatchObject({
      key: 'match.momentum.driftTarget',
    });
  });

  it('pulls a cold worker up toward the target too', () => {
    const result = drift({ before: -50 });
    expect(result.value).toBeCloseTo(6, 10);
    expect(result.trace.label).toBe('Warming back up: 12% of the way back to 0');
  });

  it('keeps a traced momentum as the start of its trace', () => {
    const result = drift({ before: inputOf('Momentum with Test Promotion A', 40) });
    expect(result.value).toBeCloseTo(-4.8, 10);
    expectTraceContains(result, { kind: 'input', label: 'Momentum with Test Promotion A' });
  });

  it('halves the distance to the target in six weeks', () => {
    // 0.88^5 ≈ 0.53 and 0.88^6 ≈ 0.46.
    const path = weekByWeek(80, 6);
    expect(path[4]).toBeGreaterThan(40);
    expect(path[5]).toBeLessThan(40);
  });

  it('takes an idle +100 under +20 in about three months', () => {
    const path = weekByWeek(100, 13);
    expect(path[11]).toBeGreaterThan(20);
    expect(path[12]).toBeLessThan(20);
  });

  it('gives the same change for several weeks at once as for the weeks one by one', () => {
    const path = weekByWeek(90, 4);
    const atOnce = drift({ before: 90, weeksIdle: 4 });
    expect(90 + atOnce.value).toBeCloseTo(path[3] ?? Number.NaN, 10);
    expect(atOnce.trace.label).toBe('Cooling off: 40% of the way back to 0');
  });

  it('changes nothing when drift is turned off', () => {
    const result = drift({ before: 100 }, { 'match.momentum.weeklyDrift': 0 });
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: DRIFT_OFF_NOTE });
  });

  it('changes nothing at the target', () => {
    const result = drift({ before: 25 }, { 'match.momentum.driftTarget': 25 });
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: AT_REST_NOTE });
  });

  it('drifts toward a target other than 0', () => {
    const overrides = { 'match.momentum.driftTarget': 20 };
    expect(drift({ before: 80 }, overrides).value).toBeCloseTo(-7.2, 10);
    expect(drift({ before: -30 }, overrides).value).toBeCloseTo(6, 10);
    expect(drift({ before: 80 }, overrides).trace.label).toBe(
      'Cooling off: 12% of the way back to 20',
    );
    const path = weekByWeek(-100, 200, overrides);
    expect(path.at(-1)).toBe(20);
  });

  it('never carries momentum past the target', () => {
    for (const weekly of [0.01, 0.12, 0.5, 0.99, 1]) {
      for (const target of [-100, -40, 0, 35, 100]) {
        for (const before of [-100, -60, -0.3, 0, 0.3, 17, 100]) {
          const overrides = {
            'match.momentum.weeklyDrift': weekly,
            'match.momentum.driftTarget': target,
          };
          const after = before + drift({ before }, overrides).value;
          const distanceBefore = target - before;
          const distanceAfter = target - after;
          expect(Math.abs(distanceAfter)).toBeLessThanOrEqual(Math.abs(distanceBefore));
          // Never past the target: the remaining distance keeps its sign or is 0.
          expect(distanceAfter * distanceBefore).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('settles on the target instead of creeping toward it forever', () => {
    const result = drift({ before: SETTLE_WITHIN / 2 });
    expect(result.value).toBeCloseTo(-SETTLE_WITHIN / 2, 10);
    expectTraceContains(result, { kind: 'constant', label: 'Close enough to settle' });
    // From +100, an idle worker is back at exactly 0 within a year.
    expect(weekByWeek(100, 52).at(-1)).toBe(0);
  });

  it('refuses a number of weeks that is not a whole number of 1 or more', () => {
    for (const weeksIdle of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        momentumDrift({ before: 50, weeksIdle }, { tunables: createEngineTunables() }),
      ).toThrow(InvalidArgumentError);
    }
  });

  it('is deterministic', () => {
    expect(drift({ before: 73.25 })).toEqual(drift({ before: 73.25 }));
  });

  it('labels each direction', () => {
    expect(momentumDriftLabel(60, 0, 0.12)).toBe('Cooling off: 12% of the way back to 0');
    expect(momentumDriftLabel(-60, 0, 0.12)).toBe('Warming back up: 12% of the way back to 0');
  });
});
