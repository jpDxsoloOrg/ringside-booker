// The daily off-screen injury chance. Design: docs/design/health.md#off-screen-injuries
import { describe, expect, it } from 'vitest';
import { startDecision, type Traced } from '../../../src/core/trace';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { TraitKey } from '../../../src/model/entities/person';
import {
  computeOffscreenInjuryChance,
  DAYS_IN_A_YEAR,
  NO_RIVAL_RULE_NOTE,
  OFFSCREEN_NEITHER_TRAIT_BRANCH,
  offscreenInjuryChanceValue,
  RIVAL_RULE_BRANCH,
  RIVAL_RULE_OFF_BRANCH,
  type OffscreenInjuryChanceInputs,
} from '../../../src/systems/health';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';

const BASE = 0.3 / DAYS_IN_A_YEAR;

function shortcut(on: boolean): Traced<boolean> {
  return startDecision<boolean>('Rival shortcut: test').choose(on, on ? 'applies' : 'does not');
}

function inputs(overrides: Partial<OffscreenInjuryChanceInputs> = {}): OffscreenInjuryChanceInputs {
  return {
    fatigue: 0,
    worstCondition: 100,
    worstPart: 'legs',
    traits: [],
    computerShortcut: null,
    promotionName: null,
    ...overrides,
  };
}

/** The traced chance, checked to replay, serialise and agree with the untraced value. */
function chanceOf(
  given: Partial<OffscreenInjuryChanceInputs> = {},
  overrides: TunableOverrides = {},
): Traced<number> {
  const tunables = createEngineTunables(overrides);
  const result = computeOffscreenInjuryChance(inputs(given), { tunables });
  expectTraceReplays(result);
  expectSerialisable(result);
  expect(offscreenInjuryChanceValue(inputs(given), { tunables })).toBe(result.value);
  return result;
}

describe('computeOffscreenInjuryChance', () => {
  it('spreads the yearly rate over the days of a year for a fresh wrestler', () => {
    const result = chanceOf();
    expect(result.value).toBeCloseTo(BASE, 12);
    expect(result.trace).toMatchObject({
      label: 'Off-screen injury chance today',
      docRef: 'docs/design/health.md#off-screen-injuries',
      unit: 'probability',
    });
    expectTraceContains(result, { kind: 'constant', label: 'Days in a year' });
    expectTraceContains(result, { kind: 'branch', label: OFFSCREEN_NEITHER_TRAIT_BRANCH });
    expectTraceContains(result, { kind: 'note', label: NO_RIVAL_RULE_NOTE });
    expect(
      expectTraceContains(result, { kind: 'tunable', label: 'Off-screen injuries per year' }).key,
    ).toBe('health.offscreen.injuriesPerYear');
  });

  it('gives 0 when the rate is 0, whatever else is true', () => {
    expect(
      chanceOf(
        {
          fatigue: 100,
          worstCondition: 0,
          traits: ['injuryProne'],
          computerShortcut: shortcut(true),
        },
        { 'health.offscreen.injuriesPerYear': 0 },
      ).value,
    ).toBe(0);
  });

  it.each<[TraitKey, string, number]>([
    ['durable', 'Durable', 0.6],
    ['injuryProne', 'Injury prone', 1.6],
  ])('scales a %s wrestler', (trait, label, factor) => {
    const result = chanceOf({ traits: [trait] });
    expect(result.value).toBeCloseTo(BASE * factor, 12);
    expectTraceContains(result, { kind: 'branch', label });
  });

  it('adds half again for a fully tired wrestler and for a worn-out body part', () => {
    expect(chanceOf({ fatigue: 100 }).value).toBeCloseTo(BASE * 1.5, 12);
    const worn = chanceOf({ worstCondition: 0, worstPart: 'back' });
    expect(worn.value).toBeCloseTo(BASE * 1.5, 12);
    expectTraceContains(worn, { kind: 'multiply', label: 'Worst body part: Back 0' });
    expect(chanceOf({ fatigue: 100, worstCondition: 0 }).value).toBeCloseTo(BASE * 2.25, 12);
  });

  it('applies the rival multiplier only while the rival rule applies', () => {
    const on = chanceOf({ computerShortcut: shortcut(true), promotionName: 'Apex Wrestling' });
    expect(on.value).toBeCloseTo(BASE * 2, 12);
    expectTraceContains(on, { kind: 'branch', label: RIVAL_RULE_BRANCH });
    expectTraceContains(on, { kind: 'input', label: 'Rival rule: Apex Wrestling' });
    const off = chanceOf({ computerShortcut: shortcut(false) });
    expect(off.value).toBeCloseTo(BASE, 12);
    expectTraceContains(off, { kind: 'branch', label: RIVAL_RULE_OFF_BRANCH });
    expect(chanceOf({ computerShortcut: null }).value).toBeCloseTo(BASE, 12);
  });

  it('never goes above 1', () => {
    const result = chanceOf(
      {
        fatigue: 100,
        worstCondition: 0,
        traits: ['injuryProne'],
        computerShortcut: shortcut(true),
      },
      {
        'health.offscreen.injuriesPerYear': 5,
        'health.offscreen.injuryProneMultiplier': 3,
        'health.offscreen.fatigueWeight': 2,
        'health.offscreen.conditionWeight': 2,
        'health.offscreen.computerMultiplier': 10,
      },
    );
    expect(result.value).toBe(1);
    expect(expectTraceContains(result, { kind: 'clamp' }).applied).toBe(true);
  });

  it('follows the tunables at their ends', () => {
    expect(
      chanceOf(
        { fatigue: 100, worstCondition: 0 },
        {
          'health.offscreen.fatigueWeight': 0,
          'health.offscreen.conditionWeight': 0,
        },
      ).value,
    ).toBeCloseTo(BASE, 12);
    expect(
      chanceOf({ traits: ['durable'] }, { 'health.offscreen.durableMultiplier': 0 }).value,
    ).toBe(0);
    expect(
      chanceOf({ computerShortcut: shortcut(true) }, { 'health.offscreen.computerMultiplier': 0 })
        .value,
    ).toBe(0);
    expect(chanceOf({}, { 'health.offscreen.injuriesPerYear': 5 }).value).toBeCloseTo(
      5 / DAYS_IN_A_YEAR,
      12,
    );
  });

  it('agrees with the untraced value across many inputs', () => {
    const tunables = createEngineTunables();
    const traitSets: TraitKey[][] = [[], ['durable'], ['injuryProne']];
    for (let fatigue = 0; fatigue <= 100; fatigue += 7) {
      for (let condition = 0; condition <= 100; condition += 9) {
        for (const traits of traitSets) {
          for (const rule of [null, shortcut(true), shortcut(false)]) {
            const given = inputs({
              fatigue,
              worstCondition: condition,
              traits,
              computerShortcut: rule,
            });
            expect(offscreenInjuryChanceValue(given, { tunables })).toBe(
              computeOffscreenInjuryChance(given, { tunables }).value,
            );
          }
        }
      }
    }
  });
});
