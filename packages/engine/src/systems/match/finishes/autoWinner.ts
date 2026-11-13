/**
 * The auto-winner (MTCH2-03): who wins a match nobody booked a winner for.
 *
 * Each side's total is its `autoWinnerScore`, plus, when the randomness is above 0, a seeded
 * unpredictability roll between −randomness and +randomness. The highest total wins; an exact tie
 * goes to the side whose lowest person id sorts first. It never produces a draw.
 *
 * In Random winners mode the decision is labelled "Random winners mode, winner decided on the
 * night", so the Why? panel's first line says so; the caller passes the larger
 * `match.randomWinners.randomness`.
 *
 * In `coinFlip` mode (MTCH2-08, a match booked as Random) the scores and the randomness are
 * ignored: every side scores 0 and draws one roll between 0 and 1, so each has an equal chance.
 * The highest draw wins, with the same tie-break.
 *
 * When the side with the highest score loses to the roll, the decision notes the upset in words.
 *
 * Design: docs/design/match-finishes.md#auto-winner.
 */

import { InvalidArgumentError } from '../../../core/errors';
import type { PersonId } from '../../../core/ids';
import { rollFloat } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import { limitTrace, startCalc, startDecision, type Traced } from '../../../core/trace';
import { AUTO_WINNER_DOC_REF } from '../formulas/autoWinnerScore';

export const AUTO_WINNER_LABEL = 'Winner decided automatically';
export const RANDOM_WINNERS_LABEL = 'Random winners mode, winner decided on the night';
export const NO_UNPREDICTABILITY_NOTE = 'No unpredictability (0)';
export const HIGHEST_SCORE_RULE = 'Highest score wins';
export const TIE_BREAK_RULE = 'Tie broken by lowest person id';
export const HIGHEST_SCORE_REASON = 'Highest score';
export const TIE_BREAK_REASON = 'Tied for the highest score; lowest person id';

/**
 * How the winner is decided: the standard auto-winner, Random winners mode, or a coin flip (a
 * match booked as Random, MTCH2-08).
 */
export type AutoWinnerMode = 'standard' | 'randomWinners' | 'coinFlip';

/** "Unpredictability, Side 1". */
export function unpredictabilityLabel(sideLabel: string): string {
  return `Unpredictability, ${sideLabel}`;
}

export interface AutoWinnerSideScore {
  /** Stored 0-based side number. */
  readonly side: number;
  /** "Side 1"; unique across the sides. */
  readonly label: string;
  readonly score: Traced<number>;
  /** The side's lowest competitor id, for the tie-break. A side with no competitor is not passed. */
  readonly lowestPersonId: PersonId;
}

export interface AutoWinnerInputs {
  /** In side order. At least one. */
  readonly sides: readonly AutoWinnerSideScore[];
  /** The most unpredictability added to each side, in points; 0 for none. */
  readonly randomness: Traced<number>;
  readonly mode: AutoWinnerMode;
}

/**
 * The winning side's number. Rolls once per side on `deps.rng` when the randomness is above 0,
 * otherwise never.
 *
 * @throws InvalidArgumentError when there are no sides.
 */
export function autoWinner(
  inputs: AutoWinnerInputs,
  deps: { readonly rng: RngStream },
): Traced<number> {
  const [first] = inputs.sides;
  if (first === undefined) {
    throw new InvalidArgumentError('autoWinner', 'sides', 0, 'at least one side');
  }
  if (inputs.mode === 'coinFlip') {
    return coinFlipWinner(inputs.sides, first, deps);
  }
  const randomness = inputs.randomness.value;
  const decision = startDecision<string>(
    inputs.mode === 'randomWinners' ? RANDOM_WINNERS_LABEL : AUTO_WINNER_LABEL,
    { docRef: AUTO_WINNER_DOC_REF },
  );
  if (randomness <= 0) {
    decision.note(NO_UNPREDICTABILITY_NOTE);
  }

  let best = first;
  let bestTotal = Number.NEGATIVE_INFINITY;
  let tied = false;
  for (const side of inputs.sides) {
    let total = side.score;
    if (randomness > 0) {
      const label = unpredictabilityLabel(side.label);
      const rolled = rollFloat(deps.rng, -randomness, randomness, label);
      total = startCalc(`${side.label} on the night`, side.score, {
        unit: 'points',
        docRef: AUTO_WINNER_DOC_REF,
      })
        .roll(rolled.roll)
        .add(label, rolled.value)
        .done();
    }
    decision.consider(side.label, total);
    if (total.value > bestTotal) {
      best = side;
      bestTotal = total.value;
      tied = false;
    } else if (total.value === bestTotal) {
      tied = true;
      if (side.lowestPersonId < best.lowestPersonId) {
        best = side;
      }
    }
  }

  decision.rule(HIGHEST_SCORE_RULE, true);
  if (tied) {
    decision.rule(TIE_BREAK_RULE, true);
  }
  const upset = upsetNote(inputs.sides, best);
  if (upset !== null) {
    decision.note(upset);
  }
  const chosen = decision.choose(best.label, tied ? TIE_BREAK_REASON : HIGHEST_SCORE_REASON);
  // The randomness (a tunable read) leads the story, so the Why? shows where the spread came from.
  const trace = limitTrace({
    ...chosen.trace,
    children: [inputs.randomness.trace, ...(chosen.trace.children ?? [])],
  });
  return { value: best.side, trace };
}

// ---------------------------------------------------------------------------------------------
// Coin flip and upsets (MTCH2-08)

export const COIN_FLIP_LABEL = 'Random: every side had an equal chance';
export const COIN_FLIP_RULE = 'Highest draw wins';
export const COIN_FLIP_REASON = 'Highest draw';

/** "Side 1 drew". */
export function coinFlipDrawLabel(sideLabel: string): string {
  return `${sideLabel} drew`;
}

/**
 * "Upset: Side 2 had a lower score than Side 1" when the winner's score (before the roll) is below
 * the best score; null when the favourite (or a side tied with it) won.
 */
export function upsetNote(
  sides: readonly AutoWinnerSideScore[],
  winner: AutoWinnerSideScore,
): string | null {
  let favourite = winner;
  for (const side of sides) {
    if (side.score.value > favourite.score.value) {
      favourite = side;
    }
  }
  return favourite === winner
    ? null
    : `Upset: ${winner.label} had a lower score than ${favourite.label}`;
}

/** Every side draws once between 0 and 1; the highest draw wins, ties to the lowest person id. */
function coinFlipWinner(
  sides: readonly AutoWinnerSideScore[],
  first: AutoWinnerSideScore,
  deps: { readonly rng: RngStream },
): Traced<number> {
  const decision = startDecision<string>(COIN_FLIP_LABEL, { docRef: AUTO_WINNER_DOC_REF });
  let best = first;
  let bestDraw = Number.NEGATIVE_INFINITY;
  let tied = false;
  for (const side of sides) {
    const label = coinFlipDrawLabel(side.label);
    const rolled = rollFloat(deps.rng, 0, 1, label);
    const draw = startCalc(label, 0, { docRef: AUTO_WINNER_DOC_REF })
      .roll(rolled.roll)
      .add('Coin flip', rolled.value)
      .done();
    decision.consider(side.label, draw);
    if (draw.value > bestDraw) {
      best = side;
      bestDraw = draw.value;
      tied = false;
    } else if (draw.value === bestDraw) {
      tied = true;
      if (side.lowestPersonId < best.lowestPersonId) {
        best = side;
      }
    }
  }
  decision.rule(COIN_FLIP_RULE, true);
  if (tied) {
    decision.rule(TIE_BREAK_RULE, true);
  }
  const chosen = decision.choose(best.label, tied ? TIE_BREAK_REASON : COIN_FLIP_REASON);
  return { value: best.side, trace: limitTrace(chosen.trace) };
}
