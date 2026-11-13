/**
 * A rival booker's value for one side of a match: the mean card value of the side's wrestlers,
 * nudged by the booker's gut feeling on the night.
 *
 * ```
 * value = mean(cardValues) × (1 + jitterRoll)
 * jitterRoll = a float roll in −aip.winner.jitter .. +aip.winner.jitter (none at 0)
 * ```
 *
 * The mean (not the sum) lets a handicap side or a team compare fairly with a single wrestler.
 * There is no clamp: only the order of the sides matters to {@link matchWinner}.
 *
 * Pure: no world access. Draws one float on `rng` when the jitter is above 0, none otherwise.
 * Each card value is recorded as its number only (not its whole card value tree), so a stored
 * Why? stays small.
 *
 * Design: docs/design/rival-booking.md#winners.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { constantOf, startCalc, type Traced } from '../../../core/trace';
import type { RngStream } from '../../../core/rng/registry';
import { rollFloat } from '../../../core/rng/rolls';
import { formatNumber } from '../../world/people/labels';
import type { EngineTunables } from '../../tunables';
import { WINNERS_DOC_REF } from '../results/tunables';

export interface RivalSideValueInputs {
  /** The side's name, e.g. "Kai Moreno" or "Ash & Rook". */
  label: string;
  /** Each wrestler's card value at the promotion, one per wrestler (at least one). */
  cardValues: readonly Traced<number>[];
  /** The wrestlers' names in `cardValues` order, for the card value lines. */
  names?: readonly string[];
}

export interface RivalSideValueDeps {
  tunables: EngineTunables;
  rng: RngStream;
}

/** Recorded when `aip.winner.jitter` is 0: no roll is drawn. */
export const NO_GUT_FEELING_NOTE = 'No gut feeling (0)';

/** "Booker's gut feeling, Kai Moreno": the jitter roll's label. */
export function gutFeelingRollLabel(label: string): string {
  return `Booker's gut feeling, ${label}`;
}

/** "+5%", "-3.2%". */
function signedPercent(ratio: number): string {
  const percent = formatNumber(ratio * 100);
  return ratio >= 0 ? `+${percent}%` : `${percent}%`;
}

export function rivalSideValue(
  inputs: RivalSideValueInputs,
  deps: RivalSideValueDeps,
): Traced<number> {
  const count = inputs.cardValues.length;
  if (count === 0) {
    throw new InvalidArgumentError(
      'rivalSideValue',
      'cardValues',
      count,
      'at least one card value',
    );
  }
  const calc = startCalc(`${inputs.label}: booker's value`, 0, {
    unit: 'points',
    startLabel: 'Nothing counted yet',
    docRef: WINNERS_DOC_REF,
  });
  inputs.cardValues.forEach((cardValue, index) => {
    const name = inputs.names?.[index] ?? `wrestler ${String(index + 1)}`;
    calc.add(`Card value, ${name}`, cardValue.value);
  });
  if (count > 1) {
    calc.divide(
      `Mean of ${String(count)} card values`,
      constantOf(
        'Wrestlers on the side',
        count,
        'A side counts its mean, so bigger sides compare fairly',
      ),
    );
  }
  const jitter = calc.tunable(deps.tunables, 'aip.winner.jitter');
  if (jitter === 0) {
    calc.note(NO_GUT_FEELING_NOTE);
    return calc.done();
  }
  const roll = rollFloat(deps.rng, -jitter, jitter, gutFeelingRollLabel(inputs.label));
  calc.roll(roll.roll);
  return calc.multiply(`Gut feeling ${signedPercent(roll.value)}`, 1 + roll.value).done();
}
