// Finish effect formula (MTCH2-02). Design: docs/design/match-finishes.md#finish-effects
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import {
  DRAW_CROWD_PENALTY_LABEL,
  FINISH_EFFECTS_DOC_REF,
  finishEffect,
  finishEffectLabel,
  type FinishEffectInputs,
} from '../../../src/systems/match';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';

function effect(inputs: FinishEffectInputs, overrides: TunableOverrides = {}) {
  const result = finishEffect(inputs, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

const DQ_WORK_RATE: FinishEffectInputs = {
  target: 'workRate',
  finishName: 'Disqualification',
  catalogPoints: -4,
  outcomeKind: 'win',
};

const STALEMATE_CROWD: FinishEffectInputs = {
  target: 'crowd',
  finishName: 'Stalemate',
  catalogPoints: -3,
  outcomeKind: 'draw',
};

function drawPenaltySteps(result: ReturnType<typeof effect>) {
  return (result.trace.children ?? []).filter((node) => node.label === DRAW_CROWD_PENALTY_LABEL);
}

describe('finishEffect', () => {
  it('gives 0 for a clean finish with no catalog points', () => {
    const result = effect({
      target: 'workRate',
      finishName: 'Clean finish',
      catalogPoints: 0,
      outcomeKind: 'win',
    });
    expect(result.value).toBe(0);
    expect(result.trace.label).toBe('Clean finish');
  });

  it('gives −4 work rate for a disqualification at scale 1', () => {
    const result = effect(DQ_WORK_RATE);
    expect(result.value).toBe(-4);
    expect(result.trace.label).toBe('Disqualification finish');
    expect(result.trace.docRef).toBe(FINISH_EFFECTS_DOC_REF);
    const start = result.trace.children?.[0];
    expect(start?.kind).toBe('input');
    expect(start?.label).toBe('Disqualification finish');
    expect(start?.docRef).toBe(FINISH_EFFECTS_DOC_REF);
    expectTraceContains(result, { kind: 'multiply', label: 'Finish effect scale' });
    expectTraceContains(result, { kind: 'tunable' });
  });

  it('gives 0 at scale 0 (0 means 0) and −12 at scale 3', () => {
    expect(effect(DQ_WORK_RATE, { 'match.finish.effectScale': 0 }).value).toBe(0);
    expect(effect(DQ_WORK_RATE, { 'match.finish.effectScale': 3 }).value).toBe(-12);
  });

  it('takes the draw penalty off the crowd of a draw only', () => {
    const crowdDraw = effect(STALEMATE_CROWD);
    expect(crowdDraw.value).toBe(-5);
    expect(drawPenaltySteps(crowdDraw)).toHaveLength(1);

    const workRateDraw = effect({ ...STALEMATE_CROWD, target: 'workRate' });
    expect(workRateDraw.value).toBe(-3);
    expect(drawPenaltySteps(workRateDraw)).toHaveLength(0);

    const crowdWin = effect({ ...STALEMATE_CROWD, outcomeKind: 'win' });
    expect(crowdWin.value).toBe(-3);
    expect(drawPenaltySteps(crowdWin)).toHaveLength(0);

    const crowdNoContest = effect({ ...STALEMATE_CROWD, outcomeKind: 'noContest' });
    expect(crowdNoContest.value).toBe(-3);
    expect(drawPenaltySteps(crowdNoContest)).toHaveLength(0);
  });

  it('keeps the draw line but removes its effect at penalty 0', () => {
    const result = effect(STALEMATE_CROWD, { 'match.finish.drawCrowdPenalty': 0 });
    expect(result.value).toBe(-3);
    expect(drawPenaltySteps(result)).toHaveLength(1);
  });

  it('scales the draw penalty only through its own tunable', () => {
    const result = effect(STALEMATE_CROWD, {
      'match.finish.effectScale': 0,
      'match.finish.drawCrowdPenalty': 4,
    });
    expect(result.value).toBe(-4);
  });

  it('does not double "finish" in a name that already has it', () => {
    expect(finishEffectLabel('Clean finish')).toBe('Clean finish');
    expect(finishEffectLabel('Count-out')).toBe('Count-out finish');
  });
});
