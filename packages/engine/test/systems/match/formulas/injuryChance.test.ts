// Injury chance (MTCH4-02). Design: docs/design/physical-toll.md#injury-chance
import { describe, expect, it } from 'vitest';
import { findTraceNodes, untraced } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import type { BodyCondition, RingStyle } from '../../../../src/model/entities/person';
import {
  INJURIES_OFF_LABEL,
  RIVAL_NO_INJURIES_LABEL,
  computeInjuryChance,
  conditionAfterWear,
  worstBodyPart,
  type InjuryChanceInputs,
  type PhysicalOpponent,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { testId } from '../../../support/ids';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const FULL: BodyCondition = { head: 100, neck: 100, back: 100, arms: 100, torso: 100, legs: 100 };

function opponent(serial: number, style: RingStyle = 'allRounder', safety = 50): PhysicalOpponent {
  return { personId: testId('person', serial), name: `Worker ${String(serial)}`, safety, style };
}

/** A fresh all-rounder in a standard singles match against an ordinary opponent: 0.003. */
function inputs(overrides: Partial<InjuryChanceInputs> = {}): InjuryChanceInputs {
  return {
    name: 'Kai Moreno',
    durationClass: 'standard',
    fatigueGoingIn: 0,
    fatigueGain: 0,
    conditionAfterWear: FULL,
    style: 'allRounder',
    traits: [],
    opponents: [opponent(2)],
    contributions: [],
    keepItSafe: false,
    matchesEarlierTonight: 0,
    skipInMatchInjuries: false,
    ...overrides,
  };
}

function chance(overrides: Partial<InjuryChanceInputs> = {}, tunables: TunableOverrides = {}) {
  const result = computeInjuryChance(inputs(overrides), {
    tunables: createEngineTunables(tunables),
  });
  expectTraceReplays(result);
  return result;
}

function labels(result: ReturnType<typeof chance>): string[] {
  return (result.trace.children ?? []).map((node) => node.label);
}

describe('computeInjuryChance', () => {
  it('lands near 0.3% for a fresh worker in a standard match', () => {
    const result = chance();
    expect(result.value).toBeCloseTo(0.003, 10);
    expect(result.trace.unit).toBe('probability');
  });

  it('lists fatigue, worst body part, duration class and the least safe opponent', () => {
    const lines = labels(chance());
    expect(lines).toContain('Fatigue by the end of the match');
    expect(lines).toContain('Worst body part: Head 100');
    expect(lines).toContain('Standard duration class');
    expect(lines).toContain('Least safe opponent: Worker 2, safety 50');
    expect(lines).toContain('Riskiest opponent: Worker 2 (All-rounder)');
  });

  it('adds perFatiguePoint × 100 at fatigue 100, counting this match’s gain', () => {
    expect(chance({ fatigueGoingIn: 100 }).value).toBeCloseTo(0.003 + 0.0001 * 100, 10);
    // 90 going in + 10 gained is 100 by the end of the match.
    const ending = chance({ fatigueGoingIn: 90, fatigueGain: untraced(10, 'Gain') });
    expect(ending.value).toBeCloseTo(0.013, 10);
    // It never counts more than 100.
    expect(chance({ fatigueGoingIn: 95, fatigueGain: 30 }).value).toBeCloseTo(0.013, 10);
  });

  it('reads the worst body part after this match’s wear', () => {
    const after = conditionAfterWear(
      { ...FULL, back: 81 },
      { head: 0, neck: 0, back: 1, arms: 0, torso: 0, legs: 0 },
    );
    expect(worstBodyPart(after)).toEqual({ part: 'back', value: 80 });
    const result = chance({ conditionAfterWear: after });
    expect(result.value).toBeCloseTo(0.003 + 20 * 0.0001, 10);
    expect(labels(result)).toContain('Worst body part: Back 80');
  });

  it('breaks ties in BODY_PARTS order and never goes below 0 after wear', () => {
    expect(worstBodyPart({ ...FULL, arms: 70, legs: 70 }).part).toBe('arms');
    expect(conditionAfterWear({ ...FULL, legs: 0.5 }, { ...FULL, legs: 2 }).legs).toBe(0);
  });

  it('scales by duration class', () => {
    expect(chance({ durationClass: 'short' }).value).toBeCloseTo(0.003 * 0.7, 10);
    const long = chance({ durationClass: 'long' });
    expect(long.value).toBeCloseTo(0.003 * 1.3, 10);
    expect(labels(long)).toContain('Long duration class');
  });

  it('clamps the least safe opponent factor at both ends', () => {
    // Safety 0: 1 + 50 × 0.012 = 1.6, the most.
    expect(chance({ opponents: [opponent(2, 'allRounder', 0)] }).value).toBeCloseTo(0.0048, 10);
    // A heavier weight would go past 1.6, but the factor stops there.
    expect(
      chance(
        { opponents: [opponent(2, 'allRounder', 0)] },
        { 'match.injury.opponentSafetyWeight': 0.03 },
      ).value,
    ).toBeCloseTo(0.003 * 1.6, 10);
    // Safety 100: 1 − 0.6 = 0.4, floored at 0.5.
    expect(chance({ opponents: [opponent(2, 'allRounder', 100)] }).value).toBeCloseTo(0.0015, 10);
  });

  it('uses the least safe opponent and the riskiest opponent style, ties by id', () => {
    const result = chance({
      opponents: [opponent(3, 'hardcore', 60), opponent(2, 'striker', 40), opponent(4, 'brawler')],
    });
    const lines = labels(result);
    expect(lines).toContain('Least safe opponent: Worker 2, safety 40');
    expect(lines).toContain('Riskiest opponent: Worker 3 (Hardcore)');
    expect(result.value).toBeCloseTo(0.003 * 1.12 * 1.3, 10);
    const tie = labels(chance({ opponents: [opponent(5, 'brawler'), opponent(4, 'striker')] }));
    expect(tie).toContain('Riskiest opponent: Worker 4 (Striker)');
  });

  it('notes a match with no opponents', () => {
    const result = chance({ opponents: [] });
    expect(result.value).toBeCloseTo(0.003, 10);
    expect(labels(result)).toContain('No opponents');
  });

  it('applies the worker’s own style', () => {
    const result = chance({ style: 'highFlyer' });
    expect(result.value).toBeCloseTo(0.003 * 1.4, 10);
    expect(labels(result)).toContain('High flyer style');
  });

  it('halves for a durable worker and raises it for an injury-prone one', () => {
    expect(chance({ traits: ['durable'] }).value).toBeCloseTo(0.0015, 10);
    expect(labels(chance({ traits: ['durable'] }))).toContain('Durable');
    expect(chance({ traits: ['injuryProne'] }).value).toBeCloseTo(0.003 * 1.8, 10);
  });

  it('adds injuryAdd and multiplies injuryMultiplier, each labelled by its source', () => {
    const result = chance({
      contributions: [
        { source: 'Stipulation: Ladder', personIds: null, injuryAdd: 0.01, injuryMultiplier: 2 },
        { source: 'Major spot: Dive', personIds: null, injuryMultiplier: 1.5 },
      ],
    });
    expect(result.value).toBeCloseTo((0.003 + 0.01) * 2 * 1.5, 10);
    expect(labels(result).filter((label) => label === 'Stipulation: Ladder')).toHaveLength(2);
    expect(labels(result)).toContain('Major spot: Dive');
  });

  it('lowers it when told to keep it safe, by the booker or a contribution', () => {
    expect(chance({ keepItSafe: true }).value).toBeCloseTo(0.0015, 10);
    const fromNote = chance({
      contributions: [{ source: 'Note: Careful', personIds: null, keepItSafe: true }],
    });
    expect(fromNote.value).toBeCloseTo(0.0015, 10);
    expect(labels(fromNote)).toContain('Keep it safe (Note: Careful)');
  });

  it('compounds match.injury.repeatMatch for each earlier match on the card', () => {
    const second = chance({ matchesEarlierTonight: 1 });
    expect(second.value).toBeCloseTo(0.003 * 1.4, 10);
    expect(labels(second)).toContain('Second match tonight ×1.4');
    const third = chance({ matchesEarlierTonight: 2 });
    expect(third.value).toBeCloseTo(0.003 * 1.96, 10);
    expect(labels(third)).toContain('Third match tonight ×1.96');
    expect(labels(chance()).some((label) => label.includes('tonight'))).toBe(false);
  });

  it('gives exactly 0 when the base and every added term are 0', () => {
    const result = chance(
      {
        fatigueGoingIn: 60,
        conditionAfterWear: { ...FULL, neck: 40 },
        style: 'hardcore',
        traits: ['injuryProne'],
        matchesEarlierTonight: 2,
      },
      {
        'match.injury.baseChance': 0,
        'match.injury.perFatiguePoint': 0,
        'match.injury.perConditionPointLost': 0,
      },
    );
    expect(result.value).toBe(0);
  });

  it('clamps at maxChance', () => {
    const result = chance({
      contributions: [{ source: 'Stipulation: Hell', personIds: null, injuryMultiplier: 1000 }],
    });
    expect(result.value).toBe(0.2);
    expect(findTraceNodes(result.trace, 'clamp')[0]?.applied).toBe(true);
  });

  it('is 0 with its own line when in-match injuries are switched off', () => {
    const result = chance({ fatigueGoingIn: 100 }, { 'match.injury.enabled': false });
    expect(result.value).toBe(0);
    expect(findTraceNodes(result.trace, 'branch').map((node) => node.label)).toContain(
      INJURIES_OFF_LABEL,
    );
    expect(labels(chance())).not.toContain(INJURIES_OFF_LABEL);
  });

  it('is 0 with the rival-rules line under skipInMatchInjuries, carrying the policy trace', () => {
    const policyTrace = untraced(true, 'Rival shortcut: No in-match injuries').trace;
    const result = chance({ fatigueGoingIn: 100, skipInMatchInjuries: true, policyTrace });
    expect(result.value).toBe(0);
    const step = (result.trace.children ?? []).find(
      (node) => node.kind === 'multiply' && node.label === RIVAL_NO_INJURIES_LABEL,
    );
    expect(step).toBeDefined();
    expect(JSON.stringify(step)).toContain('Rival shortcut: No in-match injuries');
    expect(labels(chance())).not.toContain(RIVAL_NO_INJURIES_LABEL);
    // Without a policy trace the line is still there.
    expect(labels(chance({ skipInMatchInjuries: true }))).toContain(RIVAL_NO_INJURIES_LABEL);
  });

  it('replays and serialises in every shape', () => {
    const result = chance({
      fatigueGoingIn: 70,
      fatigueGain: untraced(12, 'Gain'),
      conditionAfterWear: { ...FULL, legs: 55 },
      durationClass: 'long',
      style: 'hardcore',
      traits: ['injuryProne', 'durable'],
      opponents: [opponent(2, 'hardcore', 20), opponent(3, 'brawler', 30)],
      contributions: [{ source: 'Stipulation: Ladder', personIds: null, injuryAdd: 0.01 }],
      keepItSafe: true,
      matchesEarlierTonight: 1,
    });
    expectSerialisable(result);
    expect(result.value).toBeGreaterThan(0);
    expect(result.value).toBeLessThanOrEqual(0.2);
  });

  it('puts two exhausted workers with careless opponents in a long main event near 2–3%', () => {
    const result = chance({
      durationClass: 'long',
      fatigueGoingIn: 85,
      fatigueGain: 20,
      conditionAfterWear: { ...FULL, back: 92 },
      opponents: [opponent(2, 'allRounder', 15)],
    });
    expect(result.value).toBeGreaterThan(0.02);
    expect(result.value).toBeLessThan(0.035);
  });

  it('refuses a negative or fractional matchesEarlierTonight', () => {
    expect(() => chance({ matchesEarlierTonight: -1 })).toThrow();
    expect(() => chance({ matchesEarlierTonight: 0.5 })).toThrow();
  });
});
