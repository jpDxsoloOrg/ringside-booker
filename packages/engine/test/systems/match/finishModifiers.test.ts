// Finish effects as rating modifiers (MTCH2-02): one line on the work rate and crowd stages of a
// resolved match. Design: docs/design/match-finishes.md#finish-effects
import { afterEach, describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../src/core/content-key';
import {
  findTraceNodes,
  type ArithmeticNode,
  type Traced,
  type TraceNode,
} from '../../../src/core/trace';
import {
  FINISH_CROWD_MODIFIER_ID,
  FINISH_WORK_RATE_MODIFIER_ID,
  MatchResolutionSchema,
  ratingModifiersFor,
  resetMatchRegistriesForTests,
  unknownFinishNote,
  type MatchResolution,
  type SegmentRatingInput,
} from '../../../src/systems/match';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectTraceReplays } from '../../support/trace';
import { addsLabelled, inputOf, rate, tinyRating } from './rating/fixtures';

afterEach(() => {
  resetMatchRegistriesForTests();
});

const PINFALL = parseContentKey('method.pinfall');
const DQ_METHOD = parseContentKey('method.disqualification');

const CLEAN: MatchResolution = {
  outcome: { kind: 'win', winningSide: 0, methodKey: PINFALL },
  finishKey: parseContentKey('finish.clean'),
  methodKey: PINFALL,
};
const DISQUALIFICATION: MatchResolution = {
  outcome: { kind: 'win', winningSide: 0, methodKey: DQ_METHOD },
  finishKey: parseContentKey('finish.disqualification'),
  methodKey: DQ_METHOD,
};
const STALEMATE: MatchResolution = {
  outcome: { kind: 'draw' },
  finishKey: parseContentKey('finish.stalemate'),
  methodKey: null,
};

function required<T>(value: T | null): T {
  if (value === null) {
    throw new Error('expected a value');
  }
  return value;
}

/** The one stage line labelled `label`, as an add node. */
function finishLine(value: Traced<number>, label: string): ArithmeticNode {
  const lines = addsLabelled(value, label);
  expect(lines).toHaveLength(1);
  const line = lines[0];
  if (line?.kind !== 'add') {
    throw new Error(`no ${label} line`);
  }
  return line;
}

function finishNodes(value: Traced<number>): TraceNode[] {
  const found: TraceNode[] = [];
  const visit = (node: TraceNode): void => {
    if (/finish/i.test(node.label) || node.docRef?.startsWith('match-finishes.md') === true) {
      found.push(node);
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(value.trace);
  return found;
}

describe('finish modifiers', () => {
  const { world, mainEvent } = tinyRating();
  const stored = inputOf(world, mainEvent.id);
  const unresolved: SegmentRatingInput = { ...stored, resolution: null };
  const withResolution = (resolution: MatchResolution): SegmentRatingInput => ({
    ...stored,
    resolution,
  });

  it('are registered as built-ins on the work rate and crowd stages', () => {
    expect(ratingModifiersFor('workRate').map((modifier) => modifier.id)).toContain(
      FINISH_WORK_RATE_MODIFIER_ID,
    );
    expect(ratingModifiersFor('crowd').map((modifier) => modifier.id)).toContain(
      FINISH_CROWD_MODIFIER_ID,
    );
  });

  it('take exactly 4 work rate off a disqualification against a clean finish', () => {
    const clean = required(rate(world, withResolution(CLEAN)).workRate);
    const dq = required(rate(world, withResolution(DISQUALIFICATION)).workRate);
    const cleanLine = finishLine(clean, 'Clean finish');
    const dqLine = finishLine(dq, 'Disqualification finish');
    expect(cleanLine.operand).toBe(0);
    expect(dqLine.operand).toBe(-4);
    expect(dqLine.before).toBe(cleanLine.before);
    expect(dqLine.after).toBe(cleanLine.after - 4);
    expect(dq.value).toBeLessThan(clean.value);
    expectTraceReplays(clean);
    expectTraceReplays(dq);
  });

  it('add one crowd line, with the draw penalty on a draw', () => {
    const dqCrowd = rate(world, withResolution(DISQUALIFICATION)).crowd;
    expect(finishLine(dqCrowd, 'Disqualification finish').operand).toBe(-3);
    const drawCrowd = rate(world, withResolution(STALEMATE)).crowd;
    expect(finishLine(drawCrowd, 'Stalemate finish').operand).toBe(-5);
    expectTraceReplays(drawCrowd);
  });

  it('vanish at effect scale 0', () => {
    const tunables = createEngineTunables({ 'match.finish.effectScale': 0 });
    const plain = rate(world, unresolved, { tunables });
    const dq = rate(world, withResolution(DISQUALIFICATION), { tunables });
    expect(finishLine(required(dq.workRate), 'Disqualification finish').operand).toBe(0);
    expect(required(dq.workRate).value).toBe(required(plain.workRate).value);
    expect(dq.crowd.value).toBe(plain.crowd.value);
  });

  it('leave no finish node at all without a resolution', () => {
    const withoutResolution: SegmentRatingInput = {
      kind: stored.kind,
      typeKey: stored.typeKey,
      sides: stored.sides,
      slot: stored.slot,
      event: stored.event,
      promotionId: stored.promotionId,
    };
    for (const input of [unresolved, withoutResolution]) {
      const rated = rate(world, input);
      expect(finishNodes(required(rated.workRate))).toEqual([]);
      expect(finishNodes(rated.crowd)).toEqual([]);
    }
  });

  it('leave a note and no effect for a finish the catalogs do not hold', () => {
    const missing = parseContentKey('finish.missing');
    const rated = rate(world, withResolution({ ...STALEMATE, finishKey: missing }));
    const notes = findTraceNodes(required(rated.workRate).trace, 'note').map((node) => node.label);
    expect(notes).toContain(unknownFinishNote(missing));
  });
});

describe('the stored-segment adapter and the resolution schema', () => {
  it('fills the resolution from a completed match with a finish', () => {
    const { world, mainEvent } = tinyRating();
    const input = inputOf(world, mainEvent.id);
    expect(input.resolution).toEqual({
      outcome: mainEvent.kind === 'match' ? mainEvent.outcome : null,
      finishKey: 'finish.clean',
      methodKey:
        mainEvent.kind === 'match' && mainEvent.outcome?.kind === 'win'
          ? mainEvent.outcome.methodKey
          : null,
    });
    expect(MatchResolutionSchema.safeParse(input.resolution).success).toBe(true);
  });

  it('gives null for a talking segment and a match with no planned finish', () => {
    const { world, promo } = tinyRating();
    expect(inputOf(world, promo.id).resolution).toBeNull();
    const openFinish = world.tables.segments
      .values()
      .find((segment) => segment.kind === 'match' && segment.match.finishKey === null);
    if (openFinish !== undefined) {
      expect(inputOf(world, openFinish.id).resolution).toBeNull();
    }
  });

  it('rejects a method that disagrees with the outcome', () => {
    expect(MatchResolutionSchema.safeParse(CLEAN).success).toBe(true);
    expect(MatchResolutionSchema.safeParse(STALEMATE).success).toBe(true);
    expect(MatchResolutionSchema.safeParse({ ...CLEAN, methodKey: DQ_METHOD }).success).toBe(false);
    expect(MatchResolutionSchema.safeParse({ ...STALEMATE, methodKey: PINFALL }).success).toBe(
      false,
    );
  });
});
