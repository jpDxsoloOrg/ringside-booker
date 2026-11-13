/**
 * Whether a rival booker moves a title in tonight's match, and to whom, as one traced decision.
 *
 * The rules run in a fixed order, each recorded whether it applied or not:
 *
 * 1. House show: with `aip.titles.houseShowsRetain` on, the champion retains. With it off, a house
 *    show goes on like any other.
 * 2. Expiring champion: the champion's contract ends within `aip.titles.expiringDays` days. The
 *    title changes to a strong challenger, else a valid one, else any eligible one; with nobody
 *    eligible the champion retains.
 * 3. Overdue: the reign has lasted `aip.titles.overdueDays` days or more and someone is valid. The
 *    title changes without a chance roll.
 * 4. The chance ({@link titleChangeChance}) is rolled. A hit with a valid or strong challenger
 *    changes the title; a hit with nobody popular enough, or a miss, keeps it.
 *
 * A change picks the new champion from the strong list, else the valid list, weighted by the
 * sides' values (at least 1 each, so every fit challenger keeps a chance). One candidate is picked
 * without a roll.
 *
 * Rolls come from the caller's `aip.titles` stream in a fixed order: the chance roll (only when
 * rule 4 is reached and the chance is above 0), then the pick roll. The winners stream is never
 * touched, so title rolls never shift ordinary match rolls.
 *
 * Pure: no world access. AIP5 only plans the change; EVT3 applies it on show night
 * (docs/design/show-night.md#title-outcomes).
 *
 * Design: docs/design/rival-booking.md#title-changes.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { constantOf, startDecision, type Decision, type Traced } from '../../../core/trace';
import type { RngStream } from '../../../core/rng/registry';
import { rollChance, rollWeighted } from '../../../core/rng/rolls';
import type { EventImportance } from '../../../model/entities/event-definition';
import { formatPopularity } from '../../office/formulas/headlinePopularity';
import { formatNumber } from '../../world/people/labels';
import type { EngineTunables } from '../../tunables';
import { TITLE_CHANGES_DOC_REF } from '../results/tunables';
import type { ChallengerPool } from './challengerPool';
import { winPlanKey } from './matchWinner';

export interface TitleChangeInputs {
  titleName: string;
  importance: EventImportance;
  /** Days the current reign has lasted. */
  reignDays: number;
  /** The champions' `side` number. */
  championSide: number;
  /** The champions' names joined with " & ". */
  championLabel: string;
  /** Days left on the champions' shortest contract, or null when open-ended. */
  championContractDaysLeft: number | null;
  /** From {@link titleChangeChance}, in percent. */
  chance: Traced<number>;
  /** From {@link challengerPool}. */
  pool: ChallengerPool;
  /** Each side's value ({@link rivalSideValue}): needed for every eligible challenger side. */
  sideValues: ReadonlyMap<number, Traced<number>>;
}

export interface TitleChangeDeps {
  tunables: EngineTunables;
  rng: RngStream;
}

export type TitleReasonKey =
  | 'houseShow'
  | 'expiring'
  | 'expiringNoChallenger'
  | 'overdue'
  | 'rolled'
  | 'readyNoChallenger'
  | 'notReady';

export interface TitleChangeResult {
  /** `'retain'` or `'side:<n>'` (the new champions' side). */
  plan: Traced<string>;
  reasonKey: TitleReasonKey;
}

export const RETAIN_PLAN = 'retain';

export interface TitleReasonNames {
  /** The new champion's name, added to a change's text. */
  newChampion?: string;
}

/** Short player text for a reason: "House show", "Contract ending" ... */
export function titleReasonText(reasonKey: TitleReasonKey, names: TitleReasonNames = {}): string {
  const changed = (text: string): string =>
    names.newChampion === undefined ? text : `${text}: ${names.newChampion}`;
  switch (reasonKey) {
    case 'houseShow':
      return 'House show';
    case 'expiring':
      return changed('Contract ending');
    case 'overdue':
      return changed('Overdue reign');
    case 'rolled':
      return changed('Time for a change');
    case 'notReady':
      return 'Champion retains';
    case 'expiringNoChallenger':
    case 'readyNoChallenger':
      return 'No challenger good enough';
  }
}

// Trace texts.
export const HOUSE_SHOW_RULE = 'House show: titles stay put';
export const HOUSE_SHOWS_CAN_CHANGE_NOTE = 'House shows can change titles here (setting off)';
export const CHANGE_CHANCE_LABEL = 'Change chance';
export const CHANGE_ROLL = 'Time for a change?';
export const ZERO_CHANCE_NOTE = 'Chance is 0%';
export const CHAMPION_RETAINS = 'Champion retains';
export const ONLY_ONE_CHALLENGER_NOTE = 'Only one challenger fits';
export const PICK_ROLL = 'New champion pick';
export const MIN_PICK_WEIGHT_LABEL = 'Lowest pick weight';
export const MIN_PICK_WEIGHT_REASON = 'Every fit challenger keeps a chance';

export function titleDecisionLabel(titleName: string): string {
  return `Title decision: ${titleName}`;
}

export function expiringRuleText(championLabel: string, days: number): string {
  return `${championLabel}'s contract ends in ${formatNumber(days)} days`;
}

export function notExpiringRuleText(expiringDays: number): string {
  return `Champion's contract ends within ${formatNumber(expiringDays)} days`;
}

/** "Overdue reign: 410 days, overdue from 400": reads as a check whether or not it passed. */
export function overdueRuleText(reignDays: number, overdueDays: number): string {
  return `Overdue reign: ${formatNumber(reignDays)} days, overdue from ${formatNumber(overdueDays)}`;
}

export function readyNoChallengerText(validNeeds: number): string {
  return `Ready for a change, but no challenger is popular enough (needs ${formatPopularity(validNeeds)} in our markets)`;
}

interface Choice {
  option: string;
  because: string;
  reasonKey: TitleReasonKey;
}

function valueOf(inputs: TitleChangeInputs, side: number): Traced<number> {
  const value = inputs.sideValues.get(side);
  if (value === undefined) {
    throw new InvalidArgumentError(
      'titleChange',
      'sideValues',
      side,
      'a value for every eligible challenger side',
    );
  }
  return value;
}

function labelOf(inputs: TitleChangeInputs, side: number): string {
  return inputs.pool.labels.get(side) ?? `side ${String(side)}`;
}

/** Picks the new champions from `candidates` (non-empty): no roll for one, else weighted. */
function pickChallenger(
  decision: Decision<string>,
  inputs: TitleChangeInputs,
  candidates: readonly number[],
  rng: RngStream,
): number {
  const [only] = candidates;
  if (candidates.length === 1 && only !== undefined) {
    decision.note(ONLY_ONE_CHALLENGER_NOTE);
    return only;
  }
  const minWeight = constantOf(MIN_PICK_WEIGHT_LABEL, 1, MIN_PICK_WEIGHT_REASON);
  decision.include(MIN_PICK_WEIGHT_LABEL, minWeight);
  const roll = rollWeighted(
    rng,
    candidates.map((side) => ({
      item: side,
      weight: Math.max(valueOf(inputs, side).value, minWeight.value),
    })),
    PICK_ROLL,
    (side) => labelOf(inputs, side),
  );
  decision.roll(roll.roll);
  return roll.value;
}

/**
 * The sides the decision weighs against the champion: the ones a change could pick tonight. That
 * is the popular list, or every eligible side when an expiring contract forces a change with
 * nobody popular (and a house show isn't keeping titles put). A side that could never take the
 * title tonight is left out, so the Why? doesn't list it as "Also considered" with a score.
 */
function contenders(inputs: TitleChangeInputs, tunables: EngineTunables): readonly number[] {
  const popular = popularCandidates(inputs.pool);
  if (popular.length > 0) return popular;
  const houseRetains = inputs.importance === 'house' && tunables.get('aip.titles.houseShowsRetain');
  const daysLeft = inputs.championContractDaysLeft;
  const expiring = daysLeft !== null && daysLeft <= tunables.get('aip.titles.expiringDays');
  return expiring && !houseRetains ? inputs.pool.eligible : [];
}

/** Strong, else valid: the list a change picks from (empty when nobody is valid). */
function popularCandidates(pool: ChallengerPool): number[] {
  return pool.strong.length > 0 ? pool.strong : pool.valid;
}

function change(
  decision: Decision<string>,
  inputs: TitleChangeInputs,
  candidates: readonly number[],
  rng: RngStream,
  why: string,
  reasonKey: TitleReasonKey,
): Choice {
  const side = pickChallenger(decision, inputs, candidates, rng);
  return {
    option: winPlanKey(side),
    because: `${why}. New champion: ${labelOf(inputs, side)}`,
    reasonKey,
  };
}

function houseRule(
  decision: Decision<string>,
  inputs: TitleChangeInputs,
  tunables: EngineTunables,
): Choice | null {
  if (inputs.importance !== 'house') {
    decision.rule(HOUSE_SHOW_RULE, false);
    return null;
  }
  const retain = decision.tunable(tunables, 'aip.titles.houseShowsRetain');
  decision.rule(HOUSE_SHOW_RULE, retain);
  if (!retain) {
    decision.note(HOUSE_SHOWS_CAN_CHANGE_NOTE);
    return null;
  }
  return { option: RETAIN_PLAN, because: HOUSE_SHOW_RULE, reasonKey: 'houseShow' };
}

function expiringRule(
  decision: Decision<string>,
  inputs: TitleChangeInputs,
  deps: TitleChangeDeps,
): Choice | null {
  const expiringDays = decision.tunable(deps.tunables, 'aip.titles.expiringDays');
  const daysLeft = inputs.championContractDaysLeft;
  if (daysLeft === null || daysLeft > expiringDays) {
    decision.rule(notExpiringRuleText(expiringDays), false);
    return null;
  }
  const why = expiringRuleText(inputs.championLabel, daysLeft);
  decision.rule(why, true);
  const popular = popularCandidates(inputs.pool);
  const candidates = popular.length > 0 ? popular : inputs.pool.eligible;
  if (candidates.length === 0) {
    return {
      option: RETAIN_PLAN,
      because: `${why}, but nobody in this match can take the title`,
      reasonKey: 'expiringNoChallenger',
    };
  }
  return change(decision, inputs, candidates, deps.rng, why, 'expiring');
}

function overdueRule(
  decision: Decision<string>,
  inputs: TitleChangeInputs,
  deps: TitleChangeDeps,
): Choice | null {
  const overdueDays = decision.tunable(deps.tunables, 'aip.titles.overdueDays');
  const why = overdueRuleText(inputs.reignDays, overdueDays);
  if (inputs.reignDays < overdueDays) {
    decision.rule(why, false);
    return null;
  }
  const candidates = popularCandidates(inputs.pool);
  decision.rule(why, candidates.length > 0);
  if (candidates.length === 0) {
    decision.note(readyNoChallengerText(inputs.pool.validNeeds));
    return null;
  }
  return change(decision, inputs, candidates, deps.rng, why, 'overdue');
}

function chanceRule(decision: Decision<string>, inputs: TitleChangeInputs, rng: RngStream): Choice {
  const chance = inputs.chance.value;
  if (chance <= 0) {
    decision.note(ZERO_CHANCE_NOTE);
    return { option: RETAIN_PLAN, because: CHAMPION_RETAINS, reasonKey: 'notReady' };
  }
  const roll = rollChance(rng, Math.min(chance / 100, 1), CHANGE_ROLL);
  decision.roll(roll.roll);
  if (!roll.value) {
    return { option: RETAIN_PLAN, because: CHAMPION_RETAINS, reasonKey: 'notReady' };
  }
  const candidates = popularCandidates(inputs.pool);
  if (candidates.length === 0) {
    return {
      option: RETAIN_PLAN,
      because: readyNoChallengerText(inputs.pool.validNeeds),
      reasonKey: 'readyNoChallenger',
    };
  }
  return change(
    decision,
    inputs,
    candidates,
    rng,
    `Chance ${formatNumber(chance)}%: time for a change`,
    'rolled',
  );
}

export function titleChange(inputs: TitleChangeInputs, deps: TitleChangeDeps): TitleChangeResult {
  const decision = startDecision<string>(titleDecisionLabel(inputs.titleName), {
    docRef: TITLE_CHANGES_DOC_REF,
  });
  const championValue = inputs.sideValues.get(inputs.championSide);
  decision.consider(RETAIN_PLAN, championValue?.value ?? 0, `${inputs.championLabel} keeps it`);
  for (const side of contenders(inputs, deps.tunables)) {
    decision.consider(winPlanKey(side), valueOf(inputs, side).value, labelOf(inputs, side));
  }
  decision.include('Challengers', inputs.pool.pool);
  const choice =
    houseRule(decision, inputs, deps.tunables) ??
    expiringRule(decision, inputs, deps) ??
    chanceRules(decision, inputs, deps);
  return { plan: decision.choose(choice.option, choice.because), reasonKey: choice.reasonKey };
}

/** Rules 3 and 4, under the chance (recorded once both are reached). */
function chanceRules(
  decision: Decision<string>,
  inputs: TitleChangeInputs,
  deps: TitleChangeDeps,
): Choice {
  decision.include(CHANGE_CHANCE_LABEL, inputs.chance);
  return overdueRule(decision, inputs, deps) ?? chanceRule(decision, inputs, deps.rng);
}
