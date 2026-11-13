/**
 * Who a rival booker puts over in one match, as one traced decision.
 *
 * The rules run in a fixed order and each is recorded whether it applied or not:
 *
 * 1. Draw: two sides only, `aip.winner.drawChance` (0 = never, no roll).
 * 2. Storyline finale: the first storyline at its finale with a face and a heel side; a roll on
 *    `aip.winner.finale.faceChance` picks the faces, else the heels.
 * 3. Protection: one side holds the ace or a prospect; a roll on `aip.winner.protect.ace` /
 *    `.prospect` puts that side over (0 = never, no roll).
 * 4. Squash: the sides' card positions are `aip.winner.squash.pushGap` or more apart and one side
 *    alone is on top; a roll on `aip.winner.squash.chance` puts it over (0 = never, no roll).
 * 5. Value: the highest side value wins; an exact tie goes to the side with the lowest person id.
 *
 * Rolls come from the caller's `aip.winners` stream in that order, each only when its rule is
 * reached, so a rule that decides stops later rules from drawing. The side values (and their
 * jitter rolls, one per side in side order) are built by the caller with {@link rivalSideValue}
 * before this runs.
 *
 * Pure: no world, transaction or clock access. Reused for vacant titles (AIP5-03) and computer-GM
 * brands (BRW6). Never a "random winner": that setting is for the player's own shows.
 *
 * Design: docs/design/rival-booking.md#winners.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { startDecision, type Decision, type Traced } from '../../../core/trace';
import type { PersonId } from '../../../core/ids';
import type { RngStream } from '../../../core/rng/registry';
import { rollChance } from '../../../core/rng/rolls';
import { formatNumber } from '../../world/people/labels';
import type { EngineTunables } from '../../tunables';
import type { FeaturedRole } from '../results/inputs';
import { WINNERS_DOC_REF } from '../results/tunables';

export interface MatchWinnerSide {
  /** The participants' `side` number. */
  side: number;
  /** Ring names joined with " & ". */
  label: string;
  /** The booker's value for the side ({@link rivalSideValue}). */
  values: Traced<number>;
  /** The side's top push: main event 5 .. none 0. */
  pushIndex: number;
  featured: FeaturedRole | null;
  /** The featured wrestler's name, when `featured` is set. */
  featuredName: string | null;
  /** The side's lowest person id, for an exact tie. */
  lowestPersonId: PersonId;
}

export interface MatchWinnerStoryline {
  name: string;
  /** Sorts storylines with the same name; optional for hand-built inputs. */
  storylineId?: string;
  /** Worked out by the caller: the storyline names this match as its finale, or is old enough. */
  isFinale: boolean;
  /** Why it is (or is not) at its finale, in words, e.g. "23 days old; finales start at 56". */
  finaleReason: string;
  faceSide: number | null;
  heelSide: number | null;
}

export interface MatchWinnerInputs {
  /** The matchup, e.g. "Kai Moreno vs Vance Troy". */
  segmentLabel: string;
  sides: readonly MatchWinnerSide[];
  storylines: readonly MatchWinnerStoryline[];
  /** False when the match type can't end in a draw. */
  allowDraw: boolean;
}

export interface MatchWinnerDeps {
  tunables: EngineTunables;
  rng: RngStream;
}

export type WinnerReasonKey = 'draw' | 'finale' | 'protected' | 'squash' | 'value' | 'tieBreak';

export interface MatchWinnerResult {
  /** `'side:<n>'` or `'draw'`; read it with {@link parseWinnerPlan}. */
  plan: Traced<string>;
  reasonKey: WinnerReasonKey;
  /** The protected wrestler's role when `reasonKey` is `'protected'`, else null. */
  protectedRole: FeaturedRole | null;
}

export type WinnerPlan = { kind: 'win'; side: number } | { kind: 'draw' };

export const DRAW_PLAN = 'draw';

/** `'side:<n>'`: the plan key of a win for side `n`. */
export function winPlanKey(side: number): string {
  return `side:${String(side)}`;
}

/** Reads a plan key back. Throws on anything that is not `'draw'` or `'side:<n>'`. */
export function parseWinnerPlan(key: string): WinnerPlan {
  if (key === DRAW_PLAN) {
    return { kind: 'draw' };
  }
  const match = /^side:(-?\d+)$/.exec(key);
  if (match?.[1] === undefined) {
    throw new InvalidArgumentError('parseWinnerPlan', 'key', key, "'draw' or 'side:<n>'");
  }
  return { kind: 'win', side: Number(match[1]) };
}

export interface WinnerReasonNames {
  /** Which featured role was protected, for `'protected'`. */
  protectedRole?: FeaturedRole | null;
}

/** Short player text for a reason: "Protected prospect", "Squash", "Draw" ... */
export function winnerReasonText(
  reasonKey: WinnerReasonKey,
  names: WinnerReasonNames = {},
): string {
  switch (reasonKey) {
    case 'draw':
      return 'Draw';
    case 'finale':
      return 'Storyline finale';
    case 'protected':
      return names.protectedRole === 'ace' ? 'Protected ace' : 'Protected prospect';
    case 'squash':
      return 'Squash';
    case 'value':
      return 'Higher value';
    case 'tieBreak':
      return 'Even on value';
  }
}

// Trace texts.
export const DRAW_RULE = 'Booked as a draw?';
export const DRAWS_OFF_NOTE = 'Draws are off (0)';
export const DRAWS_NEED_TWO_RULE = 'Draws need exactly two sides';
export const NO_DRAW_TYPE_RULE = 'This match type can end in a draw';
export const DRAW_REASON = 'Booked as a draw';
export const FINALE_RULE = 'Storyline finale';
export const NO_STORYLINE_NOTE = 'No storyline on this match';
export const FACES_WIN_ROLL = 'Faces win the finale?';
export const FACES_WIN_REASON = 'Storyline finale: the faces get their win';
export const HEELS_WIN_REASON = 'Storyline finale: the heels have the last word';
export const BOTH_FEATURED_RULE = 'Featured workers on both sides: no protection';
/** A rule that did not apply reads "Did not apply: An ace or prospect to protect". */
export const NO_FEATURED_RULE = 'An ace or prospect to protect';
export const PROTECTION_OFF_NOTE = 'Protection is off (0)';
export const SQUASH_ROLL = 'Squash?';
export const SQUASHES_OFF_NOTE = 'Squashes are off (0)';
export const VALUE_REASON = 'Higher value on the night';
export const TIE_BREAK_RULE = 'Tie broken by lowest person id';

export function finaleRuleText(name: string, reason: string): string {
  return `Storyline finale: ${name} (${reason})`;
}

export function protectRollText(name: string): string {
  return `Protect ${name}?`;
}

export function protectReasonText(role: FeaturedRole, name: string): string {
  return `Protecting the ${role} ${name}`;
}

export function squashRuleText(gap: number, pushGap: number): string {
  return `Squash: card positions ${formatNumber(gap)} apart, needs ${formatNumber(pushGap)}`;
}

export function squashReasonText(label: string, gap: number): string {
  return `Squash: ${label} is ${formatNumber(gap)} card positions higher`;
}

type Choice = Omit<MatchWinnerResult, 'plan'> & { option: string; because: string };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function byStorylineOrder(left: MatchWinnerStoryline, right: MatchWinnerStoryline): number {
  return (
    compareText(left.name, right.name) ||
    compareText(left.storylineId ?? '', right.storylineId ?? '')
  );
}

function drawRule(
  decision: Decision<string>,
  inputs: MatchWinnerInputs,
  deps: MatchWinnerDeps,
): Choice | null {
  if (inputs.sides.length !== 2) {
    decision.rule(DRAWS_NEED_TWO_RULE, false);
    return null;
  }
  if (!inputs.allowDraw) {
    decision.rule(NO_DRAW_TYPE_RULE, false);
    return null;
  }
  const drawChance = decision.tunable(deps.tunables, 'aip.winner.drawChance');
  if (drawChance === 0) {
    decision.note(DRAWS_OFF_NOTE);
    return null;
  }
  const roll = rollChance(deps.rng, drawChance, DRAW_RULE);
  decision.roll(roll.roll);
  if (!roll.value) {
    return null;
  }
  decision.consider(DRAW_PLAN, drawChance, 'Chance of a draw');
  return {
    option: DRAW_PLAN,
    because: DRAW_REASON,
    reasonKey: 'draw',
    protectedRole: null,
  };
}

function finaleRule(
  decision: Decision<string>,
  inputs: MatchWinnerInputs,
  deps: MatchWinnerDeps,
): Choice | null {
  const sorted = [...inputs.storylines].sort(byStorylineOrder);
  const finale = sorted.find(
    (storyline) => storyline.isFinale && storyline.faceSide !== null && storyline.heelSide !== null,
  );
  if (finale?.faceSide === undefined || finale.faceSide === null || finale.heelSide === null) {
    decision.rule(FINALE_RULE, false);
    if (sorted.length === 0) {
      decision.note(NO_STORYLINE_NOTE);
    }
    for (const storyline of sorted) {
      decision.note(
        storyline.isFinale
          ? `${storyline.name} has no face side against a heel side here`
          : `${storyline.name} is ${storyline.finaleReason}`,
      );
    }
    return null;
  }
  decision.rule(finaleRuleText(finale.name, finale.finaleReason), true);
  const faceChance = decision.tunable(deps.tunables, 'aip.winner.finale.faceChance');
  const roll = rollChance(deps.rng, faceChance, FACES_WIN_ROLL);
  decision.roll(roll.roll);
  return {
    option: winPlanKey(roll.value ? finale.faceSide : finale.heelSide),
    because: roll.value ? FACES_WIN_REASON : HEELS_WIN_REASON,
    reasonKey: 'finale',
    protectedRole: null,
  };
}

function protectionRule(
  decision: Decision<string>,
  inputs: MatchWinnerInputs,
  deps: MatchWinnerDeps,
): Choice | null {
  const featuredSides = inputs.sides.filter((side) => side.featured !== null);
  if (featuredSides.length === 0) {
    decision.rule(NO_FEATURED_RULE, false);
    return null;
  }
  const [only] = featuredSides;
  if (featuredSides.length > 1 || only?.featured === null || only?.featured === undefined) {
    decision.rule(BOTH_FEATURED_RULE, false);
    return null;
  }
  const role = only.featured;
  const name = only.featuredName ?? only.label;
  const chance = decision.tunable(
    deps.tunables,
    role === 'ace' ? 'aip.winner.protect.ace' : 'aip.winner.protect.prospect',
  );
  if (chance === 0) {
    decision.note(PROTECTION_OFF_NOTE);
    return null;
  }
  const roll = rollChance(deps.rng, chance, protectRollText(name));
  decision.roll(roll.roll);
  if (!roll.value) {
    return null;
  }
  return {
    option: winPlanKey(only.side),
    because: protectReasonText(role, name),
    reasonKey: 'protected',
    protectedRole: role,
  };
}

function squashRule(
  decision: Decision<string>,
  inputs: MatchWinnerInputs,
  deps: MatchWinnerDeps,
): Choice | null {
  const pushes = inputs.sides.map((side) => side.pushIndex);
  const top = Math.max(...pushes);
  const gap = top - Math.min(...pushes);
  const pushGap = decision.tunable(deps.tunables, 'aip.winner.squash.pushGap');
  const onTop = inputs.sides.filter((side) => side.pushIndex === top);
  const [topSide] = onTop;
  if (gap < pushGap || onTop.length !== 1 || topSide === undefined) {
    decision.rule(squashRuleText(gap, pushGap), false);
    return null;
  }
  decision.rule(squashRuleText(gap, pushGap), true);
  const chance = decision.tunable(deps.tunables, 'aip.winner.squash.chance');
  if (chance === 0) {
    decision.note(SQUASHES_OFF_NOTE);
    return null;
  }
  const roll = rollChance(deps.rng, chance, SQUASH_ROLL);
  decision.roll(roll.roll);
  if (!roll.value) {
    return null;
  }
  return {
    option: winPlanKey(topSide.side),
    because: squashReasonText(topSide.label, gap),
    reasonKey: 'squash',
    protectedRole: null,
  };
}

function valueRule(decision: Decision<string>, inputs: MatchWinnerInputs): Choice {
  const best = Math.max(...inputs.sides.map((side) => side.values.value));
  const leaders = inputs.sides.filter((side) => side.values.value === best);
  if (leaders.length === 1 && leaders[0] !== undefined) {
    return {
      option: winPlanKey(leaders[0].side),
      because: VALUE_REASON,
      reasonKey: 'value',
      protectedRole: null,
    };
  }
  decision.rule(TIE_BREAK_RULE, true);
  const [winner] = [...leaders].sort((left, right) =>
    compareText(left.lowestPersonId, right.lowestPersonId),
  );
  if (winner === undefined) {
    throw new InvalidArgumentError('matchWinner', 'sides', 0, 'at least two sides');
  }
  return {
    option: winPlanKey(winner.side),
    because: `Level on the night: the tie goes to ${winner.label}`,
    reasonKey: 'tieBreak',
    protectedRole: null,
  };
}

export function matchWinner(inputs: MatchWinnerInputs, deps: MatchWinnerDeps): MatchWinnerResult {
  if (inputs.sides.length < 2) {
    throw new InvalidArgumentError(
      'matchWinner',
      'sides',
      inputs.sides.length,
      'at least two sides',
    );
  }
  const decision = startDecision<string>(`Who wins: ${inputs.segmentLabel}`, {
    docRef: WINNERS_DOC_REF,
  });
  for (const side of inputs.sides) {
    decision.consider(winPlanKey(side.side), side.values, side.label);
  }
  const choice =
    drawRule(decision, inputs, deps) ??
    finaleRule(decision, inputs, deps) ??
    protectionRule(decision, inputs, deps) ??
    squashRule(decision, inputs, deps) ??
    valueRule(decision, inputs);
  return {
    plan: decision.choose(choice.option, choice.because),
    reasonKey: choice.reasonKey,
    protectedRole: choice.protectedRole,
  };
}
