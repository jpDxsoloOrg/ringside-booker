// Show score. Design: docs/design/show-night.md#show-score
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../src/core/trace';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { SLOT_ROLE_LABELS, slotRoleOf, slotWeightOf } from '../../../src/systems/match';
import {
  showScore,
  type ShowScoreInputs,
  type ShowScoreModifier,
  type ShowScoreResult,
  type ShowSlotInput,
} from '../../../src/systems/shows';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';

/**
 * One slot as EVT3-03 builds it: 0-based `slot`, role and weight from MTCH1 (1-based there).
 * `score` null makes an empty slot.
 */
function slotInput(
  slot: number,
  slots: number,
  preShow: boolean,
  score: number | null,
  overrides: TunableOverrides = {},
): ShowSlotInput {
  const deps = { tunables: createEngineTunables(overrides) };
  const role = slotRoleOf({ slot: slot + 1, slots, preShow }, deps).value;
  return {
    slot,
    preShow,
    roleLabel: SLOT_ROLE_LABELS[role],
    weight: slotWeightOf({ role }, deps),
    filled: score !== null,
    segmentId: null,
    kind: score === null ? null : 'match',
    matchTypeKey: null,
    score,
    participantIds: [],
    storylineIds: [],
  };
}

/** A card of main-card scores (null = empty) and filled pre-show scores. */
function card(
  main: readonly (number | null)[],
  preShow: readonly number[] = [],
  overrides: TunableOverrides = {},
): ShowScoreInputs {
  const slots = [
    ...main.map((score, index) => slotInput(index, main.length, false, score, overrides)),
    ...preShow.map((score, index) => slotInput(index, main.length, true, score, overrides)),
  ];
  return {
    showName: 'Friday Night Fury',
    importance: 'regular',
    format: { slots: main.length, preShowSlots: preShow.length },
    slots,
    extras: {},
  };
}

function score(
  inputs: ShowScoreInputs,
  overrides: TunableOverrides = {},
  modifiers: readonly ShowScoreModifier[] = [],
): ShowScoreResult {
  const result = showScore(inputs, { tunables: createEngineTunables(overrides), modifiers });
  expectTraceReplays(result.score);
  expectSerialisable(result);
  return result;
}

function topLevelLabels(result: ShowScoreResult): string[] {
  return (result.score.trace.children ?? []).map((node) => node.label);
}

const WEIGHT_OVERRIDES: TunableOverrides = {
  'match.slot.weight.opener': 0.2,
  'match.slot.weight.midcard': 3,
  'match.slot.weight.semiMain': 0.5,
  'match.slot.weight.mainEvent': 4,
};

describe('showScore', () => {
  it('scores a 6-slot card of 60s as 60 whatever the weights', () => {
    const flat = [60, 60, 60, 60, 60, 60];
    for (const overrides of [{}, WEIGHT_OVERRIDES]) {
      const result = score(card(flat, [], overrides), overrides);
      expect(result.score.value).toBe(60);
      expect(result.rawScore).toBe(60);
    }
  });

  it('labels the root and lists every slot in card order, pre-show first', () => {
    const result = score(card([50, 60, 70], [40]));
    expect(result.score.trace).toMatchObject({
      kind: 'formula',
      label: 'Show score',
      unit: 'points',
      docRef: 'docs/design/show-night.md#show-score',
    });
    expect(topLevelLabels(result).filter((label) => label.includes(' × '))).toEqual([
      'Pre-show: 40 × 0',
      'Opener: 50 × 0.9',
      'Midcard: 60 × 1',
      'Main event: 70 × 1.75',
    ]);
  });

  it('makes the main event the heaviest line at default tunables', () => {
    const result = score(card([60, 60, 60, 60, 60, 60], [60]));
    const lines = findTraceNodes(result.score.trace, 'add').filter((node) =>
      node.label.includes(' × '),
    );
    const heaviest = [...lines].sort((left, right) => right.operand - left.operand)[0];
    expect(heaviest?.label).toBe('Main event: 60 × 1.75');
  });

  it('moves more for a strong main event than for a strong opener (D-10)', () => {
    const strongMain = score(card([50, 50, 50, 50, 50, 90])).rawScore;
    const strongOpener = score(card([90, 50, 50, 50, 50, 50])).rawScore;
    expect(strongMain).toBeGreaterThan(strongOpener);
  });

  it('ignores a pre-show segment at factor 0 and counts it at factor 1', () => {
    const without = score(card([60, 60, 60])).rawScore;
    expect(score(card([60, 60, 60], [0])).rawScore).toBe(without);
    const counted = score(card([60, 60, 60], [0]), { 'shows.score.preShowFactor': 1 });
    // (60 × 0.9 + 60 × 1 + 60 × 1.75) / (0.4 + 0.9 + 1 + 1.75) = 219 / 4.05 = 54.07
    expect(counted.rawScore).toBe(54);
    expectTraceContains(counted.score, { kind: 'multiply', label: 'Pre-show factor' });
  });

  it('takes exactly the penalty for one empty main-card slot, and nothing at penalty 0', () => {
    const empty = card([60, null, 60, 60]);
    const result = score(empty);
    expect(result.rawScore).toBe(55);
    const line = expectTraceContains(result.score, {
      kind: 'subtract',
      label: 'Empty main-card slots (1)',
    });
    expect(line.operand).toBe(5);
    expect(
      expectTraceContains(result.score, { kind: 'add', label: 'Slot 2 (Midcard) is empty' }),
    ).toBeDefined();

    const free = score(empty, { 'shows.emptySlotPenalty': 0 });
    expect(free.rawScore).toBe(60);
    expect(
      expectTraceContains(free.score, { kind: 'subtract', label: 'Empty main-card slots (1)' })
        .operand,
    ).toBe(0);
  });

  it('adds one penalty line per show with every empty slot under it', () => {
    const result = score(card([60, null, null, 60]));
    expect(result.rawScore).toBe(50);
    const penaltyLines = findTraceNodes(result.score.trace, 'subtract').filter((node) =>
      node.label.startsWith('Empty main-card slots'),
    );
    expect(penaltyLines.map((node) => node.label)).toEqual(['Empty main-card slots (2)']);
  });

  it('has no penalty line when every main-card slot is filled', () => {
    const result = score(card([60, 60, 60]));
    expect(topLevelLabels(result).some((label) => label.startsWith('Empty'))).toBe(false);
  });

  it('scores 0 with a note when no slot counts', () => {
    // The main event never weighs less than any other slot, the pre-show included.
    const zeroWeights: TunableOverrides = {
      'match.slot.weight.preShow': 0,
      'match.slot.weight.opener': 0,
      'match.slot.weight.midcard': 0,
      'match.slot.weight.semiMain': 0,
      'match.slot.weight.mainEvent': 0,
    };
    const result = score(card([80, 80, 80], [], zeroWeights), zeroWeights);
    expect(result.rawScore).toBe(0);
    expectTraceContains(result.score, { kind: 'note', label: 'No slot counts toward the score' });

    const nothingFilled = score(card([null, null], [70]));
    expect(nothingFilled.score.value).toBe(0);
    expectTraceContains(nothingFilled.score, {
      kind: 'note',
      label: 'No slot counts toward the score',
    });
  });

  it('clamps at 0 and at 100', () => {
    const low = score(card([2, null, null, 2]));
    expect(low.rawScore).toBe(0);
    expect(expectTraceContains(low.score, { kind: 'clamp' }).applied).toBe(true);

    const boost: ShowScoreModifier = {
      id: 'test.boost',
      stage: 'adjust',
      order: 1,
      apply: (calc) => {
        calc.add('Boost', 30);
      },
    };
    const high = score(card([90, 90]), {}, [boost]);
    expect(high.rawScore).toBe(100);
    expect(high.score.value).toBe(100);
  });

  it('lets an adjust modifier change both scores and a cap modifier only the final one', () => {
    const adjust: ShowScoreModifier = {
      id: 'test.cardFlow',
      stage: 'adjust',
      order: 1,
      apply: (calc) => {
        calc.subtract('Repeated matchup', 10);
      },
    };
    const cap: ShowScoreModifier = {
      id: 'test.ceiling',
      stage: 'cap',
      order: 1,
      apply: (calc) => {
        calc.min('Production ceiling', 40);
      },
    };
    const base = score(card([60, 60, 60]));
    expect(base.score.value).toBe(60);
    expect(base.rawScore).toBe(60);

    const adjusted = score(card([60, 60, 60]), {}, [adjust]);
    expect(adjusted.rawScore).toBe(50);
    expect(adjusted.score.value).toBe(50);

    const capped = score(card([60, 60, 60]), {}, [cap]);
    expect(capped.rawScore).toBe(60);
    expect(capped.score.value).toBe(40);
    expectTraceContains(capped.score, { kind: 'note', label: 'Score before any cap: 60' });
  });

  it('runs modifiers by stage, then order, then id', () => {
    const ran: string[] = [];
    const modifier = (id: string, stage: 'adjust' | 'cap', order: number): ShowScoreModifier => ({
      id,
      stage,
      order,
      apply: (calc) => {
        ran.push(id);
        calc.note(id);
      },
    });
    const modifiers = [
      modifier('test.capA', 'cap', 0),
      modifier('test.adjustLate', 'adjust', 5),
      modifier('test.adjustB', 'adjust', 1),
      modifier('test.adjustA', 'adjust', 1),
    ];
    score(card([60]), {}, modifiers);
    expect(ran).toEqual(['test.adjustA', 'test.adjustB', 'test.adjustLate', 'test.capA']);
  });

  it('hands each modifier its gathered extra', () => {
    const seen: unknown[] = [];
    const inputs = { ...card([60]), extras: { 'test.flow': { repeats: 2 } } };
    score(inputs, {}, [
      {
        id: 'test.flow',
        stage: 'adjust',
        order: 1,
        apply: (_calc, _inputs, extra) => {
          seen.push(extra);
        },
      },
      {
        id: 'test.other',
        stage: 'adjust',
        order: 2,
        apply: (_calc, _inputs, extra) => {
          seen.push(extra);
        },
      },
    ]);
    expect(seen).toEqual([{ repeats: 2 }, undefined]);
  });

  it('refuses a filled slot without a score', () => {
    const inputs = card([60]);
    const [only] = inputs.slots;
    if (only === undefined) {
      throw new Error('card() built no slots');
    }
    const broken = { ...inputs, slots: [{ ...only, score: null }] };
    expect(() => showScore(broken, { tunables: createEngineTunables(), modifiers: [] })).toThrow(
      RangeError,
    );
  });
});
