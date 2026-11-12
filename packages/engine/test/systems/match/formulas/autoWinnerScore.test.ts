// Auto-winner score (MTCH2-03). Design: docs/design/match-finishes.md#auto-winner
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import type { Push } from '../../../../src/model/entities/employment';
import {
  AUTO_WINNER_ALIGNMENT_LABEL,
  AUTO_WINNER_MOMENTUM_LABEL,
  AUTO_WINNER_PUSH_LABEL,
  NOT_EMPLOYED_HERE_NOTE,
  NO_MOMENTUM_COUNTS_ZERO_NOTE,
  autoWinnerPopularityLabel,
  autoWinnerScore,
  type AutoWinnerCompetitor,
} from '../../../../src/systems/match';
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
    ...overrides,
  };
}

function score(competitors: readonly AutoWinnerCompetitor[], overrides: TunableOverrides = {}) {
  const result = autoWinnerScore(
    { sideLabel: 'Side 1', regionName: REGION, competitors },
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
    // 0.6 × 50 + 14 + 0.15 × 10 + 2 = 47.5
    const result = score([competitor(1)]);
    expect(result.value).toBeCloseTo(47.5, 9);
    expect(result.trace.label).toBe('Side 1 score');
    for (const label of [
      autoWinnerPopularityLabel(REGION),
      AUTO_WINNER_PUSH_LABEL,
      AUTO_WINNER_MOMENTUM_LABEL,
      AUTO_WINNER_ALIGNMENT_LABEL,
    ]) {
      expect(step(result, label)?.kind).toBe('add');
    }
    expect(step(result, 'Popularity in Great Lakes')?.value).toBeCloseTo(30, 9);
    // Region names keep their capitals and pushes are said in words, not codes.
    const labels = JSON.stringify(result.trace);
    expect(labels).toContain('"Mean popularity in Great Lakes"');
    expect(labels).toContain('"Worker 1 (mid card)"');
  });

  it.each<[Push, number]>([
    ['mainEvent', 30],
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
    // popularity 0.6 × 60 = 36; push (30 + 7 + 0) / 3; momentum 0.15 × 8 = 1.2; alignment 1
    const expected = 36 + 37 / 3 + 1.2 + 1;
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
