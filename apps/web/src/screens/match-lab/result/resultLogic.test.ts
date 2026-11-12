import { describe, expect, it } from 'vitest';
import { parseContentKey, parseId } from '@ringside/engine';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';
import { AUTO_RESULT_PLAN, isOutOfDate, previewArgsOf, simulateArgsOf } from '../labStore';
import type { LabResultPlan, LabSetup } from '../labStore';
import { finishesArgsOf, outcomeKindOf } from './FinishSelect';
import {
  finishOptionLabel,
  methodLineText,
  noTitleChangeText,
  outcomeHeadline,
  sideOptionLabel,
  winnerFromValue,
  winnerValue,
} from './resultText';
import {
  disqualificationSimulation,
  drawSimulation,
  noContestSimulation,
  winSimulation,
} from './simulationFixtures';

const ADA = parseId('person', 'per_0000000001');
const BO = parseId('person', 'per_0000000002');
const SINGLES = parseContentKey('match.singles');
const DQ = parseContentKey('finish.disqualification');

const SETUP: LabSetup = {
  kind: 'match',
  typeKey: SINGLES,
  slotRole: 'midcard',
  importance: 'regular',
  regionId: parseId('region', 'reg_00000000ab'),
  televised: true,
  promotionId: parseId('promotion', 'pro_00000000ab'),
};

function state(result: LabResultPlan = AUTO_RESULT_PLAN, setup: LabSetup = SETUP) {
  return { setup, sides: [[ADA], [BO]], result };
}

/** The Run on screen for `plan`, rolled with seed 3. */
function shownRun(plan: LabResultPlan) {
  const args = previewArgsOf(state(plan), 3);
  if (args === null) throw new Error('The lab built no arguments.');
  return { args, plan };
}

describe('simulateArgsOf', () => {
  it('adds the plan to the preview arguments', () => {
    const args = previewArgsOf(state(), 3);
    if (args === null) throw new Error('The lab built no arguments.');
    expect(simulateArgsOf(args, { winner: { side: 1 }, finishKey: DQ })).toEqual({
      ...args,
      winner: { side: 1 },
      finishKey: DQ,
      methodKey: null,
    });
  });

  it('is out of date when the plan or the segment changes, not for the same plan', () => {
    const plan: LabResultPlan = { winner: { side: 1 }, finishKey: null };
    const shown = shownRun(plan);
    expect(isOutOfDate(state(plan), shown)).toBe(false);
    expect(isOutOfDate(state({ winner: { side: 0 }, finishKey: null }), shown)).toBe(true);
    expect(isOutOfDate(state({ winner: { side: 1 }, finishKey: DQ }), shown)).toBe(true);
    expect(isOutOfDate(state(plan, { ...SETUP, televised: false }), shown)).toBe(true);
    // A rating with no plan (a talking segment) ignores the Winner and finish group.
    expect(isOutOfDate(state({ winner: 'draw', finishKey: null }), { ...shown, plan: null })).toBe(
      false,
    );
  });
});

describe('the result wording', () => {
  it('round-trips the winner choice through a radio value, sides shown from 1', () => {
    for (const winner of ['auto', 'draw', { side: 0 }, { side: 4 }] as const) {
      expect(winnerFromValue(winnerValue(winner))).toEqual(winner);
    }
    expect(winnerFromValue('side-x')).toBeNull();
    expect(sideOptionLabel(1, ['Ada', 'Bo'])).toBe('Side 2: Ada & Bo');
    expect(sideOptionLabel(0, [])).toBe('Side 1');
  });

  it('narrows the finishes by the winner choice, leaving Auto open to every kind', () => {
    expect(outcomeKindOf('auto')).toBeUndefined();
    expect(outcomeKindOf('draw')).toBe('draw');
    expect(outcomeKindOf({ side: 0 })).toBe('win');
    expect(finishesArgsOf(SINGLES, 2, 'auto')).toEqual({ matchTypeKey: SINGLES, sideCount: 2 });
  });

  it('heads each outcome and names the method and finish, with no minutes', () => {
    const lines = [
      outcomeHeadline(winSimulation(['Ada'])),
      outcomeHeadline(drawSimulation()),
      outcomeHeadline(noContestSimulation()),
      methodLineText(winSimulation()),
      methodLineText(drawSimulation()),
      methodLineText(disqualificationSimulation()),
      methodLineText({
        method: { key: parseContentKey('method.count-out'), name: 'Count-Out' },
        finish: { ...disqualificationSimulation().finish, name: 'Count-out' },
      }),
      noTitleChangeText('Disqualification'),
      finishOptionLabel({ name: 'Count-out', allowsTitleChange: false }),
    ];
    expect(lines).toEqual([
      'Side 1 wins: Ada',
      'Draw',
      'No contest',
      'Pinfall · Clean finish',
      'Stalemate finish',
      'Disqualification finish',
      'Count-out finish',
      "Titles can't change hands on a Disqualification finish",
      'Count-out (no title change)',
    ]);
    for (const line of lines) expect(line).not.toMatch(RUNNING_TIME_WORDS);
  });
});
