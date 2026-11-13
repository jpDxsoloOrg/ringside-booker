/**
 * Off-screen injury chance: how likely a wrestler is to get hurt today away from the shows
 * (training, travel, a house-show bump nobody books).
 *
 * Design: docs/design/health.md#off-screen-injuries. The chance is the yearly rate spread over the
 * days of a year, scaled by the durable or injury-prone trait, by fatigue, by the worst body part
 * and, for rival wrestlers while the rival rule skips their in-match injuries (D-01), by
 * `health.offscreen.computerMultiplier`. Kept between 0 and 1.
 *
 * {@link offscreenInjuryChanceValue} works the same number out without a trace, step for step in
 * the same order, so the daily phase can roll everyone cheaply and build the Why? only for the
 * people who get hurt. `test/systems/health/offscreenInjuryChance.test.ts` checks the two agree.
 */

import { startCalc } from '../../../core/trace/calc';
import { constantOf, inputOf, traced } from '../../../core/trace/helpers';
import { tunableNode } from '../../../core/trace/tunable-node';
import type { Traced } from '../../../core/trace/types';
import type { BodyPart, TraitKey } from '../../../model/entities/person';
import type { EngineTunables } from '../../tunables';
import { BODY_PART_LABELS, formatNumber } from '../../world/people/labels';
import { HEALTH_DOC, tunableStart } from './shared';

export interface OffscreenInjuryChanceInputs {
  /** Fatigue today, 0 to 100. */
  fatigue: number;
  /** The condition of their worst body part, 0 to 100. */
  worstCondition: number;
  /** Which part that is, for the Why? */
  worstPart: BodyPart;
  traits: readonly TraitKey[];
  /**
   * Whether the rival rule "no in-match injuries" applies to their employer (`offscreenShortcutOf`),
   * or null when no rival rule can apply (a free agent, or a game without the rule).
   */
  computerShortcut: Traced<boolean> | null;
  /** Their employer's name, for the rival-rule line; null for a free agent. */
  promotionName: string | null;
}

export const OFFSCREEN_INJURY_DOC_REF = `${HEALTH_DOC}#off-screen-injuries`;

/** Days in a year, leap years included, to turn the yearly rate into a daily chance. */
export const DAYS_IN_A_YEAR = 365.25;

/** The 0–100 scale fatigue and condition are measured on. */
const SCALE = 100;

export const OFFSCREEN_NEITHER_TRAIT_BRANCH = 'Neither durable nor injury prone';
export const RIVAL_RULE_BRANCH = 'Rival rule: no in-match injuries, so more off-screen ones';
export const NO_RIVAL_RULE_NOTE = 'No rival rule in this game';
export const RIVAL_RULE_OFF_BRANCH = 'Rival rule does not apply';

/** "Worst body part: Legs 42", as the in-match injury chance writes it. */
export function worstPartLabel(part: BodyPart, value: number): string {
  return `Worst body part: ${BODY_PART_LABELS[part]} ${formatNumber(value)}`;
}

function traitKeyOf(
  traits: readonly TraitKey[],
): 'health.offscreen.durableMultiplier' | 'health.offscreen.injuryProneMultiplier' | null {
  if (traits.includes('durable')) {
    return 'health.offscreen.durableMultiplier';
  }
  return traits.includes('injuryProne') ? 'health.offscreen.injuryProneMultiplier' : null;
}

function rivalRuleOn(shortcut: Traced<boolean> | null): boolean {
  return shortcut?.value === true;
}

/** `1 + amount / 100 × weight`, the shape of both the fatigue and the body-part factor. */
function scaledFactor(
  label: string,
  amount: Traced<number>,
  weightKey: 'health.offscreen.fatigueWeight' | 'health.offscreen.conditionWeight',
  weightLabel: string,
  tunables: EngineTunables,
): Traced<number> {
  const calc = startCalc(label, amount, { unit: 'multiplier' });
  return calc
    .divide('Out of 100', SCALE)
    .multiply(weightLabel, calc.tunable(tunables, weightKey, weightLabel))
    .add('Plain chance', 1)
    .done();
}

/**
 * Today's chance of an off-screen injury, with its Why?. Draws nothing: the phase rolls it.
 */
export function computeOffscreenInjuryChance(
  inputs: OffscreenInjuryChanceInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(
    'Off-screen injury chance today',
    tunableStart(tunables, 'health.offscreen.injuriesPerYear', 'Off-screen injuries per year'),
    { unit: 'probability', docRef: OFFSCREEN_INJURY_DOC_REF },
  );
  calc.divide(
    'Days in a year',
    constantOf('Days in a year', DAYS_IN_A_YEAR, 'A year has 365.25 days on average'),
  );

  const traitKey = traitKeyOf(inputs.traits);
  if (traitKey === null) {
    calc.branch(OFFSCREEN_NEITHER_TRAIT_BRANCH, true);
  } else {
    const label = traitKey === 'health.offscreen.durableMultiplier' ? 'Durable' : 'Injury prone';
    calc.branch(label, true).multiply(label, calc.tunable(tunables, traitKey, label));
  }

  calc.multiply(
    'Fatigue',
    scaledFactor(
      'Fatigue',
      inputOf('Fatigue', inputs.fatigue, undefined, 'points'),
      'health.offscreen.fatigueWeight',
      'Fatigue weight',
      tunables,
    ),
  );
  const partLabel = worstPartLabel(inputs.worstPart, inputs.worstCondition);
  const wear = startCalc(
    'Wear on the worst body part',
    inputOf(partLabel, inputs.worstCondition, undefined, 'points'),
    { unit: 'points' },
  );
  wear.multiply('Turned around', -1).add('Out of 100', SCALE);
  calc.multiply(
    partLabel,
    scaledFactor(
      partLabel,
      wear.done(),
      'health.offscreen.conditionWeight',
      'Body weight',
      tunables,
    ),
  );

  const shortcut = inputs.computerShortcut;
  if (shortcut === null) {
    calc.note(NO_RIVAL_RULE_NOTE);
  } else if (shortcut.value) {
    const multiplier = tunables.get('health.offscreen.computerMultiplier');
    calc.branch(RIVAL_RULE_BRANCH, true).multiply(
      RIVAL_RULE_BRANCH,
      traced(multiplier, {
        kind: 'input',
        label: inputs.promotionName === null ? 'Rival rule' : `Rival rule: ${inputs.promotionName}`,
        value: multiplier,
        unit: 'multiplier',
        children: [
          shortcut.trace,
          tunableNode(
            tunables,
            'health.offscreen.computerMultiplier',
            'More off-screen injuries for rivals',
          ),
        ],
      }),
    );
  } else {
    calc.branch(RIVAL_RULE_OFF_BRANCH, true);
  }
  return calc.clamp(0, 1).done();
}

/**
 * The same number as {@link computeOffscreenInjuryChance} without the trace: the same steps in the
 * same order, so the floating-point result is identical.
 */
export function offscreenInjuryChanceValue(
  inputs: OffscreenInjuryChanceInputs,
  deps: { tunables: EngineTunables },
): number {
  const { tunables } = deps;
  let chance = tunables.get('health.offscreen.injuriesPerYear') / DAYS_IN_A_YEAR;
  const traitKey = traitKeyOf(inputs.traits);
  if (traitKey !== null) {
    chance *= tunables.get(traitKey);
  }
  chance *= (inputs.fatigue / SCALE) * tunables.get('health.offscreen.fatigueWeight') + 1;
  const wear = inputs.worstCondition * -1 + SCALE;
  chance *= (wear / SCALE) * tunables.get('health.offscreen.conditionWeight') + 1;
  if (rivalRuleOn(inputs.computerShortcut)) {
    chance *= tunables.get('health.offscreen.computerMultiplier');
  }
  return Math.min(1, Math.max(0, chance));
}
