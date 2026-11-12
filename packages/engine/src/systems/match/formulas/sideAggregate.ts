/**
 * Side aggregation: one number for a group, from its members' numbers.
 *
 * The best member counts most and each next one a little less: weights `decay^rank`, shared so
 * they add up to 1. The same rule turns a side's workers into the side's number and the sides into
 * the match's number, each with its own decay tunable. Decay 0 counts only the best member; 1 is a
 * plain mean.
 *
 * Design: docs/design/match-rating.md#sides.
 */

import { constantOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';

export const SIDES_DOC_REF = 'match-rating.md#sides';

/**
 * The tunables a side aggregate can decay by: workers into a side, sides into a match, and the
 * popularity of everyone in a segment into its star power.
 */
export type SideDecayKey = Extract<
  NumberTunableKey,
  'match.side.depthDecay' | 'match.sides.depthDecay' | 'match.starPower.depthDecay'
>;

export interface SideAggregateMember {
  /** Breaks ties between equal values, ascending. */
  id: string;
  name: string;
  value: Traced<number>;
}

export interface SideAggregateInputs {
  /** The result's title, such as "Side 1" or "Across sides". */
  label: string;
  members: readonly SideAggregateMember[];
  decayKey: SideDecayKey;
}

/** What a rank reads as for each decay: "best on side", "2nd side". */
const RANK_NOUNS: Readonly<Record<SideDecayKey, string>> = {
  'match.side.depthDecay': 'on side',
  'match.sides.depthDecay': 'side',
  'match.starPower.depthDecay': 'draw',
};

/** How far the weights may drift from summing to 1 before something is wrong. */
const WEIGHT_SUM_TOLERANCE = 1e-9;

export const WEIGHT_REASON =
  'Depth decay to the power of the rank, shared so the weights add up to 1';

function ordinal(rank: number): string {
  const lastTwo = rank % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${String(rank)}th`;
  }
  switch (rank % 10) {
    case 1:
      return `${String(rank)}st`;
    case 2:
      return `${String(rank)}nd`;
    case 3:
      return `${String(rank)}rd`;
    default:
      return `${String(rank)}th`;
  }
}

/** "best on side", "2nd on side", "3rd side". `index` is 0-based. */
export function rankLabel(index: number, decayKey: SideDecayKey): string {
  const position = index === 0 ? 'best' : ordinal(index + 1);
  return `${position} ${RANK_NOUNS[decayKey]}`;
}

/**
 * The weights of `count` ranked members: `decay^i` for i from 0, divided by their sum. Decay 0 gives
 * `[1, 0, 0, ...]`, decay 1 gives equal weights.
 *
 * @throws RangeError when `count` is not a whole number of at least 1, `decay` is not a finite number
 *   in 0..1, or the weights are not finite or do not sum to 1.
 */
export function aggregateWeights(count: number, decay: number): number[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(
      `aggregateWeights: count must be a whole number of at least 1, got ${String(count)}`,
    );
  }
  if (!Number.isFinite(decay) || decay < 0 || decay > 1) {
    throw new RangeError(
      `aggregateWeights: decay must be a number from 0 to 1, got ${String(decay)}`,
    );
  }
  // 0 ** 0 is 1, so decay 0 still gives the best member its full weight.
  const raw = Array.from({ length: count }, (_, index) => decay ** index);
  const total = raw.reduce((sum, weight) => sum + weight, 0);
  const weights = raw.map((weight) => weight / total);
  const sum = weights.reduce((running, weight) => running + weight, 0);
  if (
    !weights.every((weight) => Number.isFinite(weight)) ||
    Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE
  ) {
    throw new RangeError(
      `aggregateWeights: weights for count ${String(count)} and decay ${String(decay)} sum to ${String(sum)}, not 1`,
    );
  }
  return weights;
}

/** Highest value first; equal values by id, ascending. Never the default string sort. */
function compareMembers(left: SideAggregateMember, right: SideAggregateMember): number {
  if (left.value.value !== right.value.value) {
    return right.value.value - left.value.value;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

/** The members in the order they are weighted: highest value first, ties by id. */
export function rankMembers<Member extends SideAggregateMember>(
  members: readonly Member[],
): Member[] {
  return [...members].sort(compareMembers);
}

/**
 * The weighted mean of the members' values: `Σ value_i × w_i` over the members ranked by value
 * (ties by id), with `w = aggregateWeights(n, decay)` and `decay` read from `decayKey`. Each member
 * is one line of the trace: "Kade Morrow (best on side) × 0.65".
 *
 * @throws RangeError when there are no members (the rater refuses an empty side first).
 */
export function sideAggregate(
  inputs: SideAggregateInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  if (inputs.members.length === 0) {
    throw new RangeError(`sideAggregate: "${inputs.label}" has no members`);
  }
  const calc = startCalc(inputs.label, 0, {
    unit: 'points',
    docRef: SIDES_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  const decay = calc.tunable(deps.tunables, inputs.decayKey, 'Depth decay');
  const ranked = rankMembers(inputs.members);
  const weights = aggregateWeights(ranked.length, decay);
  for (const [index, member] of ranked.entries()) {
    const weight = weights[index] ?? 0;
    const line = `${member.name} (${rankLabel(index, inputs.decayKey)}) × ${formatNumber(weight)}`;
    const share = startCalc(`${member.name}'s share`, member.value, { unit: 'points' })
      .multiply('Weight', constantOf('Weight', weight, WEIGHT_REASON))
      .done();
    calc.add(line, share);
  }
  return calc.done();
}
