/**
 * Small helpers the ECO5-02 asking formulas share: traced factors built from one tunable, rounding
 * money to a step, and the labels the Why? panel reads.
 *
 * Design: docs/design/negotiation.md#market-value and #asking-terms.
 */

import { startCalc } from '../../../core/trace/calc';
import { constantOf } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';
import type { EmploymentRole } from '../../../model/entities/employment';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { moneyText } from '../../production/formulas/shared';

export const MARKET_VALUE_DOC_REF = 'negotiation.md#market-value';
export const ASKING_TERMS_DOC_REF = 'negotiation.md#asking-terms';
export const PATIENCE_DOC_REF = 'negotiation.md#patience';
export const RENEWALS_DOC_REF = 'negotiation.md#renewals';
export const CONTRACT_VALUE_DOC_REF = 'negotiation.md#contract-value';
export const REACTION_DOC_REF = 'negotiation.md#reaction';
export const COUNTER_DOC_REF = 'negotiation.md#counter';

/** "62%": a share as a whole percent. */
export function percentText(share: number): string {
  return `${String(Math.round(share * 100))}%`;
}

/** The roles as the Why? names them: "Role: referee", "Skill as a referee". */
export const ROLE_WORDS: Readonly<Record<EmploymentRole, string>> = {
  wrestler: 'wrestler',
  manager: 'manager',
  presenter: 'presenter',
  announcer: 'announcer',
  referee: 'referee',
  producer: 'producer',
  booker: 'booker',
};

/** `1 + tunable`, traced: "No premium" then the premium. */
export function onePlus(
  title: string,
  stepLabel: string,
  tunables: EngineTunables,
  key: NumberTunableKey,
  docRef: string,
): Traced<number> {
  const calc = startCalc(title, 1, { unit: 'multiplier', docRef, startLabel: 'Unchanged' });
  return calc.add(stepLabel, calc.tunable(tunables, key)).done();
}

/** `1 − tunable`, traced. */
export function oneMinus(
  title: string,
  stepLabel: string,
  tunables: EngineTunables,
  key: NumberTunableKey,
  docRef: string,
): Traced<number> {
  const calc = startCalc(title, 1, { unit: 'multiplier', docRef, startLabel: 'Unchanged' });
  return calc.subtract(stepLabel, calc.tunable(tunables, key)).done();
}

/** 100, the top of the 0-100 popularity, rating, reach and prestige scales. */
export const OUT_OF_100 = constantOf(
  'Out of 100',
  100,
  'Popularity, ratings, reach and public image run from 0 to 100',
);

/** "−45", "12": a signed whole number with a real minus sign. */
export function signedText(value: number): string {
  const rounded = Math.round(value);
  return rounded < 0 ? `−${String(Math.abs(rounded))}` : String(rounded);
}

/** "72": a 0-100 value as the player reads it. */
export function wholeText(value: number): string {
  return String(Math.round(value));
}

export { moneyText };
