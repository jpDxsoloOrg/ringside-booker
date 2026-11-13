/**
 * Which challenger sides in a rival title match could take the title, and how good a pick each is.
 *
 * ```
 * validNeeds  = max(prestige − aip.titles.valid.gap,  aip.titles.valid.floor)
 * strongNeeds = max(prestige − aip.titles.strong.gap, aip.titles.strong.floor)
 * ```
 *
 * Per side, in side order:
 *
 * 1. It is eligible: no WRK1 title eligibility or availability reason (each reason is noted).
 * 2. Its contract runs at least `aip.titles.challengerMinContractDays` more days (an open-ended
 *    contract passes).
 * 3. Strong when its popularity in the promotion's markets reaches `strongNeeds`; valid when it
 *    reaches `validNeeds` (a strong side is always valid too).
 *
 * `eligible` lists the sides passing 1 and 2 (the forced change on an expiring champion picks from
 * it when nobody is valid). The pool is `'strong'` when any side is strong, else `'valid'` when any
 * is valid, else `'none'`.
 *
 * Pure: no world access, no rolls. Market popularity is recorded as a number only, so the stored
 * Why? stays small.
 *
 * Design: docs/design/rival-booking.md#title-changes.
 */

import type { Reason } from '../../../core/api/result';
import { startCalc, startDecision, type Traced } from '../../../core/trace';
import { formatPopularity } from '../../office/formulas/headlinePopularity';
import { formatNumber } from '../../world/people/labels';
import type { EngineTunables } from '../../tunables';
import { TITLE_CHANGES_DOC_REF } from '../results/tunables';

export type ChallengerPoolKind = 'strong' | 'valid' | 'none';

export interface ChallengerPoolSide {
  /** The participants' `side` number. */
  side: number;
  /** Ring names joined with " & ". */
  label: string;
  /** The side's popularity in the promotion's markets, 0-100. */
  marketPopularity: Traced<number>;
  /** WRK1 reasons the side can't hold the title or work tonight; empty when fit. */
  eligibility: readonly Reason[];
  /** Days left on the side's shortest contract, or null when open-ended. */
  contractDaysLeft: number | null;
}

export interface ChallengerPoolInputs {
  titleName: string;
  /** The title's prestige, 0-100. */
  prestige: number;
  /** The challenger sides (not the champions), in side order. */
  sides: readonly ChallengerPoolSide[];
}

export interface ChallengerPoolDeps {
  tunables: EngineTunables;
}

export interface ChallengerPool {
  /** Which list a new champion is picked from. */
  pool: Traced<ChallengerPoolKind>;
  /** Side numbers reaching `strongNeeds`. */
  strong: number[];
  /** Side numbers reaching `validNeeds` (strong sides included). */
  valid: number[];
  /** Side numbers that are eligible with a long enough contract, whatever their popularity. */
  eligible: number[];
  /** The market popularity a valid challenger needs. */
  validNeeds: number;
  /** The market popularity a strong challenger needs. */
  strongNeeds: number;
  /** Each considered side's label, by side number. */
  labels: ReadonlyMap<number, string>;
}

export function challengerPoolLabel(titleName: string): string {
  return `Challengers for the ${titleName}`;
}

export function eligibleRuleText(label: string): string {
  return `${label} is eligible`;
}

export function contractRuleText(label: string, minDays: number): string {
  return `${label}'s contract runs at least ${formatNumber(minDays)} more days`;
}

/** "Vance Troy (29.7 in our markets, needs 24)": popularity to one decimal, as elsewhere. */
export function popularityText(label: string, popularity: number, needs: number): string {
  return `${label} (${formatPopularity(popularity)} in our markets, needs ${formatPopularity(needs)})`;
}

export function noChallengerText(validNeeds: number): string {
  return `No challenger is popular enough (needs ${formatPopularity(validNeeds)} in our markets)`;
}

/** What a strong pool means, in words: "Strong challengers: popular enough to be a real threat (...)". */
export function strongPoolText(strongNeeds: number): string {
  return `Strong challengers: popular enough to be a real threat (${formatPopularity(strongNeeds)} or more in our markets)`;
}

/** What a valid pool means, in words. */
export function validPoolText(validNeeds: number): string {
  return `Valid challengers: popular enough to hold the title (${formatPopularity(validNeeds)} or more in our markets)`;
}

function needsOf(
  name: 'Valid' | 'Strong',
  prestige: number,
  tunables: EngineTunables,
): Traced<number> {
  const gapKey = name === 'Valid' ? 'aip.titles.valid.gap' : 'aip.titles.strong.gap';
  const floorKey = name === 'Valid' ? 'aip.titles.valid.floor' : 'aip.titles.strong.floor';
  const calc = startCalc(`${name} challenger needs`, prestige, {
    unit: 'points',
    startLabel: 'Title prestige',
    docRef: TITLE_CHANGES_DOC_REF,
  });
  calc.subtract(`${name} gap`, calc.tunable(tunables, gapKey));
  calc.max(`${name} floor`, calc.tunable(tunables, floorKey));
  return calc.done();
}

export function challengerPool(
  inputs: ChallengerPoolInputs,
  deps: ChallengerPoolDeps,
): ChallengerPool {
  const { tunables } = deps;
  const decision = startDecision<ChallengerPoolKind>(challengerPoolLabel(inputs.titleName), {
    docRef: TITLE_CHANGES_DOC_REF,
  });
  const valid = needsOf('Valid', inputs.prestige, tunables);
  const strong = needsOf('Strong', inputs.prestige, tunables);
  decision.include('Valid challenger needs', valid);
  decision.include('Strong challenger needs', strong);
  const minContract = decision.tunable(tunables, 'aip.titles.challengerMinContractDays');

  const result = {
    strong: [] as number[],
    valid: [] as number[],
    eligible: [] as number[],
  };
  const labels = new Map<number, string>();
  const strongText: string[] = [];
  const validText: string[] = [];
  for (const side of inputs.sides) {
    labels.set(side.side, side.label);
    const isEligible = side.eligibility.length === 0;
    decision.rule(eligibleRuleText(side.label), isEligible);
    for (const reason of side.eligibility) {
      decision.note(reason.message);
    }
    const longEnough = side.contractDaysLeft === null || side.contractDaysLeft >= minContract;
    decision.rule(contractRuleText(side.label, minContract), longEnough);
    if (!isEligible || !longEnough) {
      continue;
    }
    result.eligible.push(side.side);
    const popularity = side.marketPopularity.value;
    if (popularity >= strong.value) {
      result.strong.push(side.side);
      result.valid.push(side.side);
      strongText.push(popularityText(side.label, popularity, strong.value));
    } else if (popularity >= valid.value) {
      result.valid.push(side.side);
      validText.push(popularityText(side.label, popularity, valid.value));
    } else {
      decision.note(`${popularityText(side.label, popularity, valid.value)}: not popular enough`);
    }
  }

  // The pools are explained in words, not weighed as scored options: a count of challengers read
  // like a code ("Strong, score 0") in the Why?.
  decision.note(strongPoolText(strong.value));
  decision.note(validPoolText(valid.value));
  const pool =
    result.strong.length > 0
      ? decision.choose('strong', `Strong challengers: ${strongText.join(', ')}`)
      : result.valid.length > 0
        ? decision.choose('valid', `Valid challengers: ${validText.join(', ')}`)
        : decision.choose('none', noChallengerText(valid.value));
  return {
    pool,
    ...result,
    validNeeds: valid.value,
    strongNeeds: strong.value,
    labels,
  };
}
