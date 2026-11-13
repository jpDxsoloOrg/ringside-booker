// The show report's numbers. Design: docs/design/show-night.md#show-report
import { describe, expect, it } from 'vitest';
import { parseId, type SegmentId } from '../../../src/core/ids';
import { untraced, type TraceNode } from '../../../src/core/trace';
import {
  DEFAULT_POLICY_LABEL,
  SLOT_ROLE_LABELS,
  segmentScore,
  slotRoleOf,
  slotWeightOf,
} from '../../../src/systems/match';
import {
  segmentReasons,
  showScore,
  showScoreBreakdown,
  type BreakdownSegment,
  type ShowScoreBreakdownView,
  type ShowScoreModifier,
  type ShowScoreResult,
  type ShowSlotInput,
} from '../../../src/systems/shows';
import { createEngineTunables } from '../../../src/systems/tunables';

const tunables = createEngineTunables();

function segmentId(number: number): SegmentId {
  return parseId('segment', `seg_${String(number).padStart(10, '0')}`);
}

function slotInput(
  slot: number,
  slots: number,
  preShow: boolean,
  score: number | null,
): ShowSlotInput {
  const role = slotRoleOf({ slot: slot + 1, slots, preShow }, { tunables }).value;
  return {
    slot,
    preShow,
    roleLabel: SLOT_ROLE_LABELS[role],
    weight: slotWeightOf({ role }, { tunables }),
    filled: score !== null,
    segmentId: null,
    kind: score === null ? null : 'match',
    matchTypeKey: null,
    score,
    participantIds: [],
    storylineIds: [],
  };
}

interface Card {
  readonly result: ShowScoreResult;
  /** The rated segments in card order, as `shows.results` hands them to the breakdown. */
  readonly segments: BreakdownSegment[];
}

/** Scores a card of main-card scores (null = empty) and filled pre-show scores. */
function scoreCard(
  main: readonly (number | null)[],
  preShow: readonly number[] = [],
  modifiers: readonly ShowScoreModifier[] = [],
): Card {
  const slots = [
    ...main.map((score, index) => slotInput(index, main.length, false, score)),
    ...preShow.map((score, index) => slotInput(index, main.length, true, score)),
  ];
  const result = showScore(
    {
      showName: 'Test Weekly',
      importance: 'regular',
      format: { slots: main.length, preShowSlots: preShow.length },
      slots,
      extras: {},
    },
    { tunables, modifiers },
  );
  let next = 1;
  const segments = [...slots]
    .sort((left, right) =>
      left.preShow !== right.preShow ? (left.preShow ? -1 : 1) : left.slot - right.slot,
    )
    .filter((slot) => slot.filled)
    .map((slot) => ({
      segmentId: segmentId(next++),
      roleLabel: slot.roleLabel,
      preShow: slot.preShow,
    }));
  return { result, segments };
}

function breakdownOf(card: Card): ShowScoreBreakdownView {
  const breakdown = showScoreBreakdown(card.result.score.trace, card.segments);
  if (breakdown === null) throw new Error('No breakdown');
  return breakdown;
}

function total(breakdown: ShowScoreBreakdownView): number {
  return breakdown.rows.reduce((sum, row) => sum + row.points, 0);
}

describe('showScoreBreakdown', () => {
  it('gives one row per slot whose shares add up to the score', () => {
    const card = scoreCard([55, 61, 48, 70, 72], [50]);
    const breakdown = breakdownOf(card);
    expect(total(breakdown)).toBeCloseTo(card.result.score.value, 9);
    const segments = breakdown.rows.filter((row) => row.kind === 'segment');
    expect(segments.map((row) => row.label)).toEqual([
      'Pre-show',
      'Opener',
      'Midcard',
      'Midcard',
      'Semi-main',
      'Main event',
    ]);
    expect(segments.map((row) => row.segmentId)).toEqual(
      card.segments.map((entry) => entry.segmentId),
    );
    for (const row of segments) {
      expect(row.points).toBeCloseTo(
        ((row.score ?? 0) * (row.weight ?? 0)) / breakdown.totalWeight,
        9,
      );
    }
  });

  it('shows the pre-show factor and the pre-show slot weight before it', () => {
    const breakdown = breakdownOf(scoreCard([60, 60, 60], [80]));
    const preShow = breakdown.rows[0];
    expect(preShow).toMatchObject({ kind: 'segment', preShow: true, score: 80, weight: 0 });
    expect(preShow?.slotWeight).toBeGreaterThan(0);
    expect(preShow?.points).toBe(0);
    expect(breakdown.preShowFactor).toBe(0);
    expect(breakdownOf(scoreCard([60, 60, 60])).preShowFactor).toBeNull();
  });

  it('gives each empty main-card slot its own penalty row', () => {
    const card = scoreCard([null, 60, null, 60, 70]);
    const breakdown = breakdownOf(card);
    const empty = breakdown.rows.filter((row) => row.kind === 'emptySlot');
    expect(empty.map((row) => row.label)).toEqual([
      'Slot 1 (Opener) is empty',
      'Slot 3 (Midcard) is empty',
    ]);
    expect(empty.every((row) => row.points < 0)).toBe(true);
    expect(total(breakdown)).toBeCloseTo(card.result.score.value, 9);
  });

  it('lists modifiers, the cap and rounding as adjustments', () => {
    const flow: ShowScoreModifier = {
      id: 'test.cardFlow',
      stage: 'adjust',
      order: 1,
      apply: (calc) => {
        calc.subtract('Repeated matchup', 4);
      },
    };
    const cap: ShowScoreModifier = {
      id: 'test.ceiling',
      stage: 'cap',
      order: 1,
      apply: (calc) => {
        calc.min('Production ceiling', 50);
      },
    };
    const card = scoreCard([61, 66, 73], [], [flow, cap]);
    const breakdown = breakdownOf(card);
    expect(
      breakdown.rows.filter((row) => row.kind === 'adjustment').map((row) => row.label),
    ).toEqual(expect.arrayContaining(['Repeated matchup', 'Production ceiling']));
    expect(total(breakdown)).toBeCloseTo(card.result.score.value, 9);
  });

  it('leaves the segment out when the card does not match the trace', () => {
    const card = scoreCard([60, 70]);
    const breakdown = showScoreBreakdown(card.result.score.trace, card.segments.slice(1));
    expect(breakdown?.rows.every((row) => row.segmentId === null)).toBe(true);
  });

  it('reads a card where nothing counted, kept at 0 by its own row', () => {
    const breakdown = breakdownOf(scoreCard([null, null]));
    expect(breakdown.totalWeight).toBe(0);
    expect(breakdown.rows.map((row) => row.kind)).toEqual(['emptySlot', 'emptySlot', 'adjustment']);
    expect(total(breakdown)).toBeCloseTo(0, 9);
  });

  it('returns null for a trace cut by the size limits or one it does not know', () => {
    const { trace } = scoreCard([60, 70]).result.score;
    const cut: TraceNode = {
      ...trace,
      kind: 'formula',
      value: 0,
      children: [
        ...(trace.children ?? []).slice(0, 2),
        { kind: 'note', label: '12 more steps', value: 0, hiddenSteps: 12 },
      ],
    };
    expect(showScoreBreakdown(cut, [])).toBeNull();
    expect(showScoreBreakdown(untraced(5, 'Something else').trace, [])).toBeNull();
  });
});

function segmentTrace(kind: 'match' | 'angle', performance: number, crowd: number, bonus = 0) {
  return segmentScore(
    {
      kind,
      performance: untraced(performance, kind === 'match' ? 'Work rate' : 'Talk'),
      crowd: untraced(crowd, 'Crowd'),
      promotionStyle: 'mainstream',
      policyBonus: untraced(bonus, 'Policy bonus'),
      policyLabel: bonus === 0 ? DEFAULT_POLICY_LABEL : 'Hard-hitting house style',
    },
    { tunables },
  ).trace;
}

describe('segmentReasons', () => {
  it('names the two parts that pulled the score furthest from the middle, largest first', () => {
    // Mainstream: work rate counts 0.45, the crowd 0.55.
    const reasons = segmentReasons(segmentTrace('match', 70, 40, 3));
    expect(reasons.map((reason) => reason.label)).toEqual(['Strong work rate', 'Quiet crowd']);
    expect(reasons[0]?.effect).toBeCloseTo(9, 9);
    expect(reasons[1]?.effect).toBeCloseTo(-5.5, 9);
  });

  it('counts a flat bonus by itself, without its signed number', () => {
    const reasons = segmentReasons(segmentTrace('match', 52, 50, 4));
    expect(reasons[0]).toEqual({ label: 'Hard-hitting house style', effect: 4 });
  });

  it('words talking segments and hot crowds', () => {
    const reasons = segmentReasons(segmentTrace('angle', 30, 80));
    expect(reasons.map((reason) => reason.label).sort()).toEqual(['Hot crowd', 'Weak talking']);
  });

  it('leaves out reasons too small to matter, and traces it does not know', () => {
    expect(segmentReasons(segmentTrace('match', 50, 50))).toEqual([]);
    expect(segmentReasons(untraced(5, 'Something else').trace)).toEqual([]);
  });
});
