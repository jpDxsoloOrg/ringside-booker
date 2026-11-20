/**
 * Draft value: how much a draft board rates a person, 0 to 100. Shared by every draft: the draft
 * start (DRF-01) and the brand drafts (BRW1-01 #560) read this module, so one formula ranks a pool
 * the same way everywhere.
 *
 * 1. Popularity index `Pi = (1 − b) × best country + b × world`, `b` = `draft.value.breadthWeight`.
 * 2. Skill part `draft.value.skillWeight × role rating` (the rating in the role they are drafted
 *    for: wrestler, or their staff job).
 * 3. Popularity part `draft.value.popularityWeight × Pi`.
 * 4. Age: + `draft.value.youthBonusPerYear` per year under `draft.value.youthAge` (at most
 *    `draft.value.youthBonusMax`), − `draft.value.oldPenaltyPerYear` per year over
 *    `draft.value.oldAge`.
 * 5. Kept between 0 and 100.
 *
 * Only public facts go in (attributes the scouting screens show, popularity, age), never hidden
 * potential. {@link draftValueParts} is the untraced version boards use for thousands of people;
 * {@link draftValue} is the same arithmetic with a Why? trace, for one person on screen. Both give
 * the same number (a test checks it).
 *
 * Design: docs/design/draft.md#draft-value.
 */

import { startCalc, type Traced } from '../../core/trace';
import type { EngineTunables } from '../tunables';

export const DRAFT_VALUE_DOC_REF = 'draft.md#draft-value';
export const DRAFT_VALUE_MIN = 0;
export const DRAFT_VALUE_MAX = 100;

export interface DraftValueInputs {
  /** Role rating in the role they would be drafted for, 0-100. */
  readonly roleRating: number;
  /** Popularity in their best country, 0-100. */
  readonly peakPop: number;
  /** World-wide popularity, 0-100. */
  readonly worldPop: number;
  /** Age in whole years on the draft day. */
  readonly age: number;
}

/** The tunables the formula reads, read once per board. */
export interface DraftValueWeights {
  readonly skillWeight: number;
  readonly popularityWeight: number;
  readonly breadthWeight: number;
  readonly youthAge: number;
  readonly youthBonusPerYear: number;
  readonly youthBonusMax: number;
  readonly oldAge: number;
  readonly oldPenaltyPerYear: number;
}

export function draftValueWeights(tunables: EngineTunables): DraftValueWeights {
  return {
    skillWeight: tunables.get('draft.value.skillWeight'),
    popularityWeight: tunables.get('draft.value.popularityWeight'),
    breadthWeight: tunables.get('draft.value.breadthWeight'),
    youthAge: tunables.get('draft.value.youthAge'),
    youthBonusPerYear: tunables.get('draft.value.youthBonusPerYear'),
    youthBonusMax: tunables.get('draft.value.youthBonusMax'),
    oldAge: tunables.get('draft.value.oldAge'),
    oldPenaltyPerYear: tunables.get('draft.value.oldPenaltyPerYear'),
  };
}

export interface DraftValueParts {
  readonly popularityIndex: number;
  readonly skill: number;
  readonly popularity: number;
  /** Positive for the youth bonus, negative for the age penalty, 0 between. */
  readonly age: number;
  readonly value: number;
}

function clamp(value: number): number {
  return Math.min(DRAFT_VALUE_MAX, Math.max(DRAFT_VALUE_MIN, value));
}

/** The draft value and its parts, untraced. */
export function draftValueParts(
  inputs: DraftValueInputs,
  weights: DraftValueWeights,
): DraftValueParts {
  const popularityIndex =
    (1 - weights.breadthWeight) * inputs.peakPop + weights.breadthWeight * inputs.worldPop;
  const skill = weights.skillWeight * inputs.roleRating;
  const popularity = weights.popularityWeight * popularityIndex;
  let age = 0;
  if (inputs.age < weights.youthAge) {
    age = Math.min(
      weights.youthBonusMax,
      (weights.youthAge - inputs.age) * weights.youthBonusPerYear,
    );
  } else if (inputs.age > weights.oldAge) {
    age = -(inputs.age - weights.oldAge) * weights.oldPenaltyPerYear;
  }
  return { popularityIndex, skill, popularity, age, value: clamp(skill + popularity + age) };
}

function whole(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** The draft value with its Why? trace: the same number as {@link draftValueParts}. */
export function draftValue(
  inputs: DraftValueInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const weights = draftValueWeights(deps.tunables);
  const parts = draftValueParts(inputs, weights);
  const calc = startCalc('Draft value', 0, {
    unit: 'points',
    docRef: DRAFT_VALUE_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  calc.add(
    `Role rating ${whole(inputs.roleRating)} × weight ${whole(weights.skillWeight)}`,
    parts.skill,
  );
  calc.add(
    `Popularity ${whole(parts.popularityIndex)} (best country ${whole(inputs.peakPop)}, world ${whole(inputs.worldPop)}) × weight ${whole(weights.popularityWeight)}`,
    parts.popularity,
  );
  if (parts.age > 0) {
    calc.add(`Age ${String(inputs.age)}: young, years ahead of them`, parts.age);
  } else if (parts.age < 0) {
    calc.add(`Age ${String(inputs.age)}: past their best years`, parts.age);
  }
  return calc.clamp(DRAFT_VALUE_MIN, DRAFT_VALUE_MAX).done();
}
