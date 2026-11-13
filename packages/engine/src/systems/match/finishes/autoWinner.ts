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
 * Upsets (MTCH2-09): when the winner's score before the unpredictability was more than
 * `match.autoWinner.upsetNoteGap` behind the best other side's, the decision carries an "Upset"
 * note, so the Why? calls it out.
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

/** How the winner is decided: the standard auto-winner, or Random winners mode. */
export type AutoWinnerMode = 'standard' | 'randomWinners';

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
  /**
   * MTCH2-09: how far behind on score a winner must have been to be called an upset; no upset note
   * when absent.
   */
  readonly upsetNoteGap?: Traced<number>;
}

/** "Upset: Side 2 won from 14.5 points behind". */
export function upsetNote(sideLabel: string, gap: number): string {
  return `Upset: ${sideLabel} won from ${String(Math.round(gap * 10) / 10)} points behind`;
}

/** How far the winner's score was behind the best other side's; 0 or less when it was not. */
function upsetGapOf(sides: readonly AutoWinnerSideScore[], winner: AutoWinnerSideScore): number {
  const others = sides.filter((side) => side !== winner).map((side) => side.score.value);
  return others.length === 0 ? 0 : Math.max(...others) - winner.score.value;
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
  const upsetGap = upsetGapOf(inputs.sides, best);
  const upset = inputs.upsetNoteGap !== undefined && upsetGap > inputs.upsetNoteGap.value;
  if (upset) {
    decision.note(upsetNote(best.label, upsetGap));
  }
  const chosen = decision.choose(best.label, tied ? TIE_BREAK_REASON : HIGHEST_SCORE_REASON);
  // The randomness (a tunable read) leads the story, so the Why? shows where the spread came from.
  // An upset adds the gap setting it was measured against.
  const leading =
    upset && inputs.upsetNoteGap !== undefined
      ? [inputs.randomness.trace, inputs.upsetNoteGap.trace]
      : [inputs.randomness.trace];
  const trace = limitTrace({
    ...chosen.trace,
    children: [...leading, ...(chosen.trace.children ?? [])],
  });
  return { value: best.side, trace };
}
