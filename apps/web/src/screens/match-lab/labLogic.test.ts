import { describe, expect, it } from 'vitest';
import { parseContentKey, parseId } from '@ringside/engine';
import type { MatchTypeOption, Stats } from '@ringside/engine';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';
import { labPanelsFor } from './labPanelRegistry';
import type { LabPanelContext, LabPanelDefinition } from './labPanelRegistry';
import { isOutOfDate, previewArgsOf, resizeSides, sameSegment, sideOf } from './labStore';
import type { LabSetup } from './labStore';
import {
  expectationGapText,
  matchLimitsText,
  staminaText,
  statsSummary,
  weightText,
} from './labText';
import { orderedWarnings } from './LabWarnings';

const ADA = parseId('person', 'per_0000000001');
const BO = parseId('person', 'per_0000000002');

const SETUP: LabSetup = {
  kind: 'match',
  typeKey: parseContentKey('match.singles'),
  slotRole: 'midcard',
  importance: 'regular',
  regionId: parseId('region', 'reg_00000000ab'),
  televised: true,
  promotionId: parseId('promotion', 'pro_00000000ab'),
};

function matchType(
  sides: MatchTypeOption['sides'],
  sideSize: MatchTypeOption['sideSize'],
  equalSides: boolean,
): MatchTypeOption {
  return {
    key: parseContentKey('match.test'),
    name: 'Test',
    shortName: 'Test',
    order: 1,
    sides,
    sideSize,
    equalSides,
    durationShift: 0,
    allowsTitles: true,
    hidden: false,
  };
}

describe('the lab store helpers', () => {
  it('resizes sides without dropping anyone already placed', () => {
    expect(resizeSides([[ADA], []], 3)).toEqual([[ADA], [], []]);
    expect(resizeSides([[ADA], [], [], []], 2)).toEqual([[ADA], []]);
    expect(resizeSides([[ADA], [], [BO]], 2)).toEqual([[ADA], [], [BO]]);
  });

  it('finds the side someone stands on', () => {
    expect(sideOf([[ADA], [BO]], BO)).toBe(1);
    expect(sideOf([[ADA], []], BO)).toBeNull();
  });

  it('builds preview arguments only when every side has someone', () => {
    expect(previewArgsOf({ setup: SETUP, sides: [[ADA], []], previewSeed: 1 })).toBeNull();
    const args = previewArgsOf({ setup: SETUP, sides: [[ADA], [BO]], previewSeed: 4 });
    expect(args).toMatchObject({ sides: [[ADA], [BO]], previewSeed: 4, slotRole: 'midcard' });
  });

  it('calls a result out of date when the segment changed, not when only the seed did', () => {
    const state = { setup: SETUP, sides: [[ADA], [BO]], previewSeed: 1 };
    const shown = previewArgsOf(state);
    if (shown === null) throw new Error('The lab built no arguments.');
    expect(isOutOfDate({ ...state, previewSeed: 9 }, shown)).toBe(false);
    expect(sameSegment(shown, { ...shown, previewSeed: 2 })).toBe(true);
    expect(isOutOfDate({ ...state, sides: [[BO], [ADA]] }, shown)).toBe(true);
    expect(isOutOfDate({ ...state, setup: { ...SETUP, televised: false } }, shown)).toBe(true);
    expect(isOutOfDate(state, null)).toBe(false);
  });
});

describe('the lab wording', () => {
  const stats: Stats = { mean: 63.4, sd: 5.1, min: 49, p10: 57, p50: 63, p90: 70, max: 77 };

  it('summarises a batch as the ticket words it', () => {
    expect(statsSummary(stats)).toBe('Mean 63.4 · spread ±5.1 · range 49–77 · middle 80% 57–70');
  });

  it('words the expectation gap, weights and stamina', () => {
    expect(expectationGapText(58, 64)).toBe('6 below expectation');
    expect(expectationGapText(70, 64)).toBe('6 above expectation');
    expect(expectationGapText(64, 64)).toBe('right on expectation');
    expect(weightText(1)).toBe('×1.00');
    expect(weightText(1.75)).toBe('×1.75');
    expect(staminaText(0)).toBe('Passed');
    expect(staminaText(-6)).toBe('Failed −6');
  });

  it('states a match type’s limits without any running time', () => {
    const texts = [
      matchType({ min: 2, max: 2 }, { min: 1, max: 1 }, true),
      matchType({ min: 2, max: 30 }, { min: 1, max: 1 }, false),
      matchType({ min: 2, max: 2 }, { min: 1, max: 3 }, false),
    ].map(matchLimitsText);
    expect(texts).toEqual(['2 sides, 1 each', '2 to 30 sides, 1 each', '2 sides, 1 to 3 each']);
    for (const text of texts) expect(text).not.toMatch(RUNNING_TIME_WORDS);
  });

  it('puts errors before warnings', () => {
    const ordered = orderedWarnings([
      { code: 'injured', severity: 'warning', message: 'a' },
      { code: 'sideCount', severity: 'error', message: 'b' },
    ]);
    expect(ordered.map((warning) => warning.message)).toEqual(['b', 'a']);
  });
});

describe('labPanelsFor', () => {
  const context: LabPanelContext = { setup: SETUP, sides: [], result: null, batch: null };
  const panel = (
    id: string,
    order: number,
    extra: Partial<LabPanelDefinition> = {},
  ): LabPanelDefinition => ({ id, order, title: id, render: () => null, ...extra });

  it('keeps each placement apart, in order then id, and drops hidden panels', () => {
    const panels = [
      panel('mtch4.physical', 30),
      panel('mtch8.crew', 20, { placement: 'setup' }),
      panel('b.tie', 20),
      panel('a.tie', 20),
      panel('mtch7.options', 10, { placement: 'setup' }),
      panel('hidden', 5, { visible: () => false }),
    ];
    expect(labPanelsFor(panels, 'result', context).map((entry) => entry.id)).toEqual([
      'a.tie',
      'b.tie',
      'mtch4.physical',
    ]);
    expect(labPanelsFor(panels, 'setup', context).map((entry) => entry.id)).toEqual([
      'mtch7.options',
      'mtch8.crew',
    ]);
  });
});
