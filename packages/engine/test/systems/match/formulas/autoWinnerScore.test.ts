// Auto-winner score (MTCH2-03). Design: docs/design/match-finishes.md#auto-winner
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import type { Push } from '../../../../src/model/entities/employment';
import {
  AUTO_WINNER_ALIGNMENT_LABEL,
  AUTO_WINNER_CONDITION_LABEL,
  AUTO_WINNER_FATIGUE_LABEL,
  AUTO_WINNER_HEAT_LABEL,
  AUTO_WINNER_MOMENTUM_LABEL,
  AUTO_WINNER_PUSH_LABEL,
  AUTO_WINNER_SKILL_LABEL,
  AUTO_WINNER_STAMINA_LABEL,
  NOT_EMPLOYED_HERE_NOTE,
  NO_MOMENTUM_COUNTS_ZERO_NOTE,
  NO_STORYLINE_HEAT_NOTE,
  autoWinnerPopularityLabel,
  autoWinnerScore,
  type AutoWinnerCompetitor,
  type AutoWinnerStorylineHeat,
  type DurationClass,
} from '../../../../src/systems/match';
import { findTraceNodes } from '../../../../src/core/trace';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { personId } from '../../../support/show-world';
import { expectTraceContains, expectTraceReplays } from '../../../support/trace';

const REGION = 'Great Lakes';

const ALL_ZERO: TunableOverrides = {
  'match.autoWinner.popularityWeight': 0,
  'match.autoWinner.momentumWeight': 0,
  'match.autoWinner.push.mainEvent': 0,
  'match.autoWinner.push.upperCard': 0,
  'match.autoWinner.push.midCard': 0,
  'match.autoWinner.push.lowerCard': 0,
  'match.autoWinner.push.enhancement': 0,
  'match.autoWinner.push.none': 0,
  'match.autoWinner.alignment.face': 0,
  'match.autoWinner.alignment.heel': 0,
  'match.autoWinner.alignment.tweener': 0,
  'match.autoWinner.skillWeight': 0,
  'match.autoWinner.staminaWeight': 0,
  'match.autoWinner.fatigueWeight': 0,
  'match.autoWinner.conditionWeight': 0,
  'match.autoWinner.heatWeight': 0,
};

function competitor(
  serial: number,
  overrides: Partial<AutoWinnerCompetitor> = {},
): AutoWinnerCompetitor {
  return {
    personId: personId(serial),
    name: `Worker ${String(serial)}`,
    popularityInRegion: 50,
    push: 'midCard',
    momentum: 10,
    alignment: 'face',
    ringwork: 60,
    psychology: 50,
    athleticism: 70,
    stamina: 60,
    fatigue: 10,
    bodyCondition: 90,
    ...overrides,
  };
}

interface MatchContext {
  readonly durationClass?: DurationClass;
  readonly storylineHeat?: AutoWinnerStorylineHeat | null;
}

function score(
  competitors: readonly AutoWinnerCompetitor[],
  overrides: TunableOverrides = {},
  match: MatchContext = {},
) {
  const result = autoWinnerScore(
    {
      sideLabel: 'Side 1',
      regionName: REGION,
      competitors,
      durationClass: match.durationClass ?? 'standard',
      storylineHeat: match.storylineHeat ?? null,
    },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  return result;
}

/** A step of the score itself (a direct child of the root) by label. */
function step(result: ReturnType<typeof score>, label: string) {
  return (result.trace.children ?? []).find((node) => node.label === label);
}

describe('autoWinnerScore', () => {
  it('is 0 when every weight and every point table is 0', () => {
    expect(score([competitor(1), competitor(2, { alignment: 'heel' })], ALL_ZERO).value).toBe(0);
  });

  it('writes the formula out at the defaults', () => {
    // 0.45 × 50 + 14 + 0.15 × 10 + 2 + 0.5 × 60 + 0.5 × 1 × 60 − 0.2 × 10 − 0.2 × (100 − 90) + 0
    const result = score([competitor(1)]);
    expect(result.value).toBeCloseTo(96, 9);
    expect(result.trace.label).toBe('Side 1 score');
    for (const label of [
      autoWinnerPopularityLabel(REGION),
      AUTO_WINNER_PUSH_LABEL,
      AUTO_WINNER_MOMENTUM_LABEL,
      AUTO_WINNER_ALIGNMENT_LABEL,
      AUTO_WINNER_SKILL_LABEL,
      AUTO_WINNER_STAMINA_LABEL,
      AUTO_WINNER_HEAT_LABEL,
    ]) {
      expect(step(result, label)?.kind).toBe('add');
    }
    for (const label of [AUTO_WINNER_FATIGUE_LABEL, AUTO_WINNER_CONDITION_LABEL]) {
      expect(step(result, label)?.kind).toBe('subtract');
    }
    // The Why? lists every factor in order, then the score.
    expect((result.trace.children ?? []).slice(1).map((node) => node.label)).toEqual([
      autoWinnerPopularityLabel(REGION),
      AUTO_WINNER_PUSH_LABEL,
      AUTO_WINNER_MOMENTUM_LABEL,
      AUTO_WINNER_ALIGNMENT_LABEL,
      AUTO_WINNER_SKILL_LABEL,
      AUTO_WINNER_STAMINA_LABEL,
      AUTO_WINNER_FATIGUE_LABEL,
      AUTO_WINNER_CONDITION_LABEL,
      AUTO_WINNER_HEAT_LABEL,
    ]);
    expect(step(result, 'Popularity in Great Lakes')?.value).toBeCloseTo(22.5, 9);
    // Region names keep their capitals and pushes are said in words, not codes.
    const labels = JSON.stringify(result.trace);
    expect(labels).toContain('"Mean popularity in Great Lakes"');
    expect(labels).toContain('"Worker 1 (mid card)"');
  });

  it.each<[Push, number]>([
    ['mainEvent', 24],
    ['upperCard', 22],
    ['midCard', 14],
    ['lowerCard', 7],
    ['enhancement', 0],
    ['none', 0],
  ])('gives %s push %s points', (push, points) => {
    const result = score([competitor(1, { push })], {
      ...ALL_ZERO,
      [`match.autoWinner.push.${push}`]: points,
    });
    expect(result.value).toBe(points);
    expect(expectTraceContains(result, { kind: 'tunable', label: /pushed/ }).key).toBe(
      `match.autoWinner.push.${push}`,
    );
  });

  it('reads each push level from its own tunable', () => {
    const overrides: TunableOverrides = { ...ALL_ZERO, 'match.autoWinner.push.upperCard': 9 };
    expect(score([competitor(1, { push: 'upperCard' })], overrides).value).toBe(9);
    expect(score([competitor(1, { push: 'midCard' })], overrides).value).toBe(0);
  });

  it('counts a null momentum as 0, with a note', () => {
    const withNull = score([competitor(1, { momentum: null })]);
    const withZero = score([competitor(1, { momentum: 0 })]);
    expect(withNull.value).toBe(withZero.value);
    expectTraceContains(withNull, {
      kind: 'note',
      label: `Worker 1: ${NO_MOMENTUM_COUNTS_ZERO_NOTE}`,
    });
  });

  it('counts a null alignment as 0, with a note', () => {
    const result = score([competitor(1, { alignment: null })], {
      ...ALL_ZERO,
      'match.autoWinner.alignment.face': 5,
      'match.autoWinner.alignment.heel': 5,
      'match.autoWinner.alignment.tweener': 5,
    });
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: `Worker 1: ${NOT_EMPLOYED_HERE_NOTE}` });
  });

  it('uses means over a three-competitor side', () => {
    const side = [
      competitor(1, { popularityInRegion: 30, push: 'mainEvent', momentum: 30, alignment: 'face' }),
      competitor(2, {
        popularityInRegion: 60,
        push: 'lowerCard',
        momentum: null,
        alignment: 'heel',
      }),
      competitor(3, { popularityInRegion: 90, push: 'none', momentum: -6, alignment: 'tweener' }),
    ];
    // popularity 0.45 × 60 = 27; push (24 + 7 + 0) / 3; momentum 0.15 × 8 = 1.2; alignment 1;
    // the same attributes as one worker: skill 30 + stamina 30 − fatigue 2 − wear 2 = 56
    const expected = 27 + 31 / 3 + 1.2 + 1 + 56;
    expect(score(side).value).toBeCloseTo(expected, 9);
    expectTraceContains(score(side), { kind: 'divide', label: 'Mean over 3 competitors' });
  });

  it('is not clamped', () => {
    const result = score([competitor(1, { popularityInRegion: 100, push: 'mainEvent' })], {
      'match.autoWinner.popularityWeight': 3,
      'match.autoWinner.push.mainEvent': 100,
    });
    expect(result.value).toBeGreaterThan(100);
  });
});

// MTCH2-09: how the match would actually go.
describe('autoWinnerScore match terms', () => {
  it('adds skillWeight × mean ring skill, each competitor the mean of three attributes', () => {
    const side = [
      competitor(1, { ringwork: 60, psychology: 50, athleticism: 70 }),
      competitor(2, { ringwork: 90, psychology: 90, athleticism: 90 }),
    ];
    const result = score(side, { ...ALL_ZERO, 'match.autoWinner.skillWeight': 2 });
    // (60 + 90) / 2 = 75; × 2
    expect(result.value).toBeCloseTo(150, 9);
    expect(expectTraceContains(result, { kind: 'tunable', label: 'Ring skill weight' }).key).toBe(
      'match.autoWinner.skillWeight',
    );
    expect(JSON.stringify(result.trace)).toContain(
      '"Worker 1 (ringwork 60, psychology 50, athleticism 70)"',
    );
  });

  it.each<[DurationClass, number, string]>([
    ['short', 0.5, 'Short match'],
    ['standard', 1, 'Standard match'],
    ['long', 1.5, 'Long match'],
  ])('scales stamina by the %s match factor', (durationClass, factor, label) => {
    const result = score(
      [competitor(1, { stamina: 80 })],
      { ...ALL_ZERO, 'match.autoWinner.staminaWeight': 0.5 },
      { durationClass },
    );
    expect(result.value).toBeCloseTo(0.5 * factor * 80, 9);
    expect(expectTraceContains(result, { kind: 'tunable', label }).key).toBe(
      `match.autoWinner.staminaFactor.${durationClass}`,
    );
  });

  it('favours the side with more stamina more in a Long match', () => {
    const fresh = [competitor(1, { stamina: 90 })];
    const gassed = [competitor(2, { stamina: 40 })];
    const gap = (durationClass: DurationClass) =>
      score(fresh, {}, { durationClass }).value - score(gassed, {}, { durationClass }).value;
    expect(gap('long')).toBeGreaterThan(gap('standard'));
    expect(gap('standard')).toBeGreaterThan(gap('short'));
  });

  it('subtracts fatigueWeight × mean fatigue', () => {
    const result = score([competitor(1, { fatigue: 40 }), competitor(2, { fatigue: 20 })], {
      ...ALL_ZERO,
      'match.autoWinner.fatigueWeight': 0.5,
    });
    expect(result.value).toBeCloseTo(-15, 9);
    expect(step(result, AUTO_WINNER_FATIGUE_LABEL)?.kind).toBe('subtract');
  });

  it('subtracts conditionWeight × mean wear, wear being 100 minus body condition', () => {
    const result = score([competitor(1, { bodyCondition: 70 })], {
      ...ALL_ZERO,
      'match.autoWinner.conditionWeight': 0.5,
    });
    expect(result.value).toBeCloseTo(-15, 9);
    expect(JSON.stringify(result.trace)).toContain('"Worker 1 (condition 70)"');
  });

  it("adds heatWeight × the side's storyline heat", () => {
    const result = score(
      [competitor(1)],
      { ...ALL_ZERO, 'match.autoWinner.heatWeight': 0.2 },
      { storylineHeat: { storylineName: 'The Long Feud', heat: 80 } },
    );
    expect(result.value).toBeCloseTo(16, 9);
    expect(JSON.stringify(result.trace)).toContain('"Heat of The Long Feud"');
  });

  it('counts no storyline heat as 0, with a note', () => {
    const result = score([competitor(1)], { ...ALL_ZERO, 'match.autoWinner.heatWeight': 1 });
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: NO_STORYLINE_HEAT_NOTE });
  });

  it.each([
    'match.autoWinner.skillWeight',
    'match.autoWinner.staminaWeight',
    'match.autoWinner.fatigueWeight',
    'match.autoWinner.conditionWeight',
    'match.autoWinner.heatWeight',
  ] as const)('a %s of 0 removes the factor but keeps its line', (key) => {
    const strong = competitor(1, {
      ringwork: 95,
      psychology: 95,
      athleticism: 95,
      stamina: 95,
      fatigue: 90,
      bodyCondition: 20,
    });
    const weak = competitor(2, {
      ringwork: 20,
      psychology: 20,
      athleticism: 20,
      stamina: 20,
      fatigue: 0,
      bodyCondition: 100,
    });
    const heat = { storylineName: 'Feud', heat: 90 };
    // With only this weight on, the two sides differ; with it at 0 too, they score the same.
    const on = { ...ALL_ZERO, [key]: 1 };
    expect(score([strong], on, { storylineHeat: heat }).value - score([weak], on).value).not.toBe(
      0,
    );
    const off = { ...ALL_ZERO, [key]: 0 };
    const zeroed = score([strong], off, { storylineHeat: heat });
    expect(zeroed.value - score([weak], off).value).toBe(0);
    const read = findTraceNodes(zeroed.trace, 'tunable').find((node) => node.key === key);
    expect(read?.value).toBe(0);
  });
});
