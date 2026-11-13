// Whether a rival booker moves a title. Design: docs/design/rival-booking.md#title-changes
import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../../../src/core/rng/registry';
import { findTraceNodes, inputOf, type Traced } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  challengerPool,
  titleChange,
  titleReasonText,
  TITLES_STREAM,
  type ChallengerPool,
  type ChallengerPoolSide,
  type TitleChangeInputs,
  type TitleChangeResult,
} from '../../../../src/systems/aip';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable } from '../../../support/trace';

function side(
  sideNumber: number,
  popularity: number,
  extra: Partial<ChallengerPoolSide> = {},
): ChallengerPoolSide {
  return {
    side: sideNumber,
    label: `Side ${String(sideNumber)}`,
    marketPopularity: inputOf('Market popularity', popularity),
    eligibility: [],
    contractDaysLeft: null,
    ...extra,
  };
}

/** Prestige 80: valid needs 50, strong needs 68. */
function poolOf(
  sides: readonly ChallengerPoolSide[],
  tuned: TunableOverrides = {},
): ChallengerPool {
  return challengerPool(
    { titleName: 'World Title', prestige: 80, sides },
    { tunables: createEngineTunables(tuned) },
  );
}

const STRONG = poolOf([side(1, 70)]);
const VALID = poolOf([side(1, 55)]);
const NONE = poolOf([side(1, 20)]);
const NOBODY = poolOf([side(1, 90, { eligibility: [{ code: 'injured', message: 'Injured' }] })]);

function values(entries: Record<number, number>): Map<number, Traced<number>> {
  return new Map(
    Object.entries(entries).map(([sideNumber, value]) => [
      Number(sideNumber),
      inputOf(`Side ${sideNumber} value`, value),
    ]),
  );
}

function inputs(overrides: Partial<TitleChangeInputs> = {}): TitleChangeInputs {
  return {
    titleName: 'World Title',
    importance: 'regular',
    reignDays: 100,
    championSide: 0,
    championLabel: 'Kai Moreno',
    championContractDaysLeft: null,
    chance: inputOf('Change chance', 50),
    pool: STRONG,
    sideValues: values({ 0: 60, 1: 50, 2: 40 }),
    ...overrides,
  };
}

function run(
  changeInputs: TitleChangeInputs,
  tuned: TunableOverrides = {},
  seed: string | number = 'title-seed',
): TitleChangeResult {
  const result = titleChange(changeInputs, {
    tunables: createEngineTunables(tuned),
    rng: new RngRegistry(String(seed)).stream(TITLES_STREAM),
  });
  expectSerialisable(result.plan);
  return result;
}

function rollLabels(result: TitleChangeResult): string[] {
  return findTraceNodes(result.plan.trace, 'roll').map((node) => node.label);
}

function reasonOf(result: TitleChangeResult): string {
  return result.plan.trace.kind === 'decision' ? result.plan.trace.reason : '';
}

describe('titleChange', () => {
  it('keeps the title on a house show even at chance 90 and an overdue reign', () => {
    const result = run(
      inputs({ importance: 'house', chance: inputOf('Chance', 90), reignDays: 900 }),
    );
    expect(result.plan.value).toBe('retain');
    expect(result.reasonKey).toBe('houseShow');
    expect(rollLabels(result)).toEqual([]);
  });

  it('runs the normal rules on a house show with the setting off', () => {
    const result = run(inputs({ importance: 'house', chance: inputOf('Chance', 100) }), {
      'aip.titles.houseShowsRetain': false,
    });
    expect(result.plan.value).toBe('side:1');
    expect(result.reasonKey).toBe('rolled');
  });

  it("forces a change to the only eligible side when the champion's contract ends", () => {
    const result = run(
      inputs({ championContractDaysLeft: 10, chance: inputOf('Chance', 0), pool: NONE }),
      { 'aip.titles.expiringDays': 28 },
    );
    expect(result.plan.value).toBe('side:1');
    expect(result.reasonKey).toBe('expiring');
    expect(reasonOf(result)).toBe("Kai Moreno's contract ends in 10 days. New champion: Side 1");
    expect(rollLabels(result)).toEqual([]);
  });

  it('retains with the reason when an expiring champion has nobody eligible to face', () => {
    const result = run(inputs({ championContractDaysLeft: 10, pool: NOBODY }));
    expect(result.plan.value).toBe('retain');
    expect(result.reasonKey).toBe('expiringNoChallenger');
    expect(reasonOf(result)).toBe(
      "Kai Moreno's contract ends in 10 days, but nobody in this match can take the title",
    );
  });

  it('with expiringDays 0 only a contract ending today forces a change', () => {
    const tuned = { 'aip.titles.expiringDays': 0 };
    const quiet = { chance: inputOf('Chance', 0), pool: NONE };
    expect(run(inputs({ ...quiet, championContractDaysLeft: 0 }), tuned).reasonKey).toBe(
      'expiring',
    );
    expect(run(inputs({ ...quiet, championContractDaysLeft: 1 }), tuned).reasonKey).toBe(
      'notReady',
    );
  });

  it('changes an overdue reign to a valid side without a chance roll', () => {
    const result = run(inputs({ reignDays: 400, pool: VALID, chance: inputOf('Chance', 1) }));
    expect(result.plan.value).toBe('side:1');
    expect(result.reasonKey).toBe('overdue');
    expect(rollLabels(result)).toEqual([]);
    expect(reasonOf(result)).toContain('Overdue: 400 days is a long reign');
  });

  it('changes at chance 100 with a strong pool', () => {
    const result = run(inputs({ chance: inputOf('Chance', 100) }));
    expect(result.plan.value).toBe('side:1');
    expect(result.reasonKey).toBe('rolled');
    expect(rollLabels(result)).toEqual(['Time for a change?']);
  });

  it('never changes at chance 0 over 10,000 seeds, and draws nothing', () => {
    const tunables = createEngineTunables();
    const zero = inputs({ chance: inputOf('Chance', 0) });
    for (let seed = 0; seed < 10_000; seed += 1) {
      const result = titleChange(zero, {
        tunables,
        rng: new RngRegistry(`z${String(seed)}`).stream(TITLES_STREAM),
      });
      expect(result.plan.value).toBe('retain');
    }
    const one = run(zero);
    expect(rollLabels(one)).toEqual([]);
    expect(findTraceNodes(one.plan.trace, 'note').map((node) => node.label)).toContain(
      'Chance is 0%',
    );
  });

  it('retains with the "needs" text when the roll hits but nobody is popular enough', () => {
    const result = run(inputs({ chance: inputOf('Chance', 100), pool: NONE }));
    expect(result.plan.value).toBe('retain');
    expect(result.reasonKey).toBe('readyNoChallenger');
    expect(reasonOf(result)).toBe(
      'Ready for a change, but no challenger is popular enough (needs 50 in our markets)',
    );
  });

  it('retains on a miss', () => {
    const result = run(inputs({ chance: inputOf('Chance', 0.0001) }));
    expect(result.plan.value).toBe('retain');
    expect(result.reasonKey).toBe('notReady');
  });

  it('favours the higher value in the pick and never picks an ineligible side', () => {
    const pool = poolOf([
      side(1, 80),
      side(2, 80),
      side(3, 99, { eligibility: [{ code: 'tooHeavy', message: 'Too heavy' }] }),
    ]);
    const tunables = createEngineTunables();
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 2_000; seed += 1) {
      const result = titleChange(
        inputs({ pool, chance: inputOf('Chance', 100), sideValues: values({ 1: 90, 2: 30 }) }),
        { tunables, rng: new RngRegistry(`p${String(seed)}`).stream(TITLES_STREAM) },
      );
      counts.set(result.plan.value, (counts.get(result.plan.value) ?? 0) + 1);
    }
    expect(counts.get('side:3')).toBeUndefined();
    expect(counts.get('retain')).toBeUndefined();
    expect(counts.get('side:1') ?? 0).toBeGreaterThan((counts.get('side:2') ?? 0) * 2);
  });

  it('rolls the chance first, then the pick, on the titles stream', () => {
    const pool = poolOf([side(1, 80), side(2, 80)]);
    const result = run(inputs({ pool, chance: inputOf('Chance', 100) }));
    const rolls = findTraceNodes(result.plan.trace, 'roll');
    expect(rolls.map((node) => node.label)).toEqual(['Time for a change?', 'New champion pick']);
    expect(rolls.every((node) => node.roll.stream === TITLES_STREAM)).toBe(true);
    expect(findTraceNodes(result.plan.trace, 'constant').map((node) => node.reason)).toContain(
      'Every fit challenger keeps a chance',
    );
  });

  it('picks a single candidate without a roll', () => {
    const result = run(inputs({ chance: inputOf('Chance', 100) }));
    expect(findTraceNodes(result.plan.trace, 'note').map((node) => node.label)).toContain(
      'Only one challenger fits',
    );
  });

  it('considers retain and each eligible challenger', () => {
    const result = run(inputs({ pool: poolOf([side(1, 80), side(2, 10)]) }));
    const considered =
      result.plan.trace.kind === 'decision'
        ? result.plan.trace.considered.map((entry) => entry.option)
        : [];
    expect(considered).toEqual(['retain', 'side:1', 'side:2']);
  });

  it('gives the same trace for the same seed', () => {
    const pool = poolOf([side(1, 80), side(2, 75)]);
    const first = run(inputs({ pool }), {}, 7);
    const second = run(inputs({ pool }), {}, 7);
    expect(second).toEqual(first);
  });
});

describe('titleReasonText', () => {
  it('words every reason', () => {
    expect(titleReasonText('houseShow')).toBe('House show');
    expect(titleReasonText('expiring')).toBe('Contract ending');
    expect(titleReasonText('expiringNoChallenger')).toBe('No challenger good enough');
    expect(titleReasonText('overdue')).toBe('Overdue reign');
    expect(titleReasonText('rolled', { newChampion: 'Vance Troy' })).toBe(
      'Time for a change: Vance Troy',
    );
    expect(titleReasonText('readyNoChallenger')).toBe('No challenger good enough');
    expect(titleReasonText('notReady')).toBe('Champion retains');
  });
});
