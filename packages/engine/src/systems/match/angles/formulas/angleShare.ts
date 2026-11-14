/**
 * A person's share of an angle (MTCH5-06): the beats they appear in over the beats that ran. Both
 * angle aftermath formulas scale by it, so someone in one beat of four gets a quarter of what
 * someone in every beat gets.
 *
 * Design: docs/design/angle-rating.md#angle-aftermath.
 */

import { constantOf, startCalc, type Traced } from '../../../../core/trace';
import { InvalidArgumentError } from '../../../../core/errors';

export const ANGLE_AFTERMATH_DOC_REF = 'docs/design/angle-rating.md#angle-aftermath';

/** The person in an angle and how many of its beats they were in. */
export interface AngleShareInputs {
  readonly personName: string;
  /** Beats that ran (counted) with this person in them. */
  readonly beatsIn: number;
  /** Beats that ran; beats past the slot's limit don't count. */
  readonly totalBeats: number;
}

function beatWord(count: number): string {
  return count === 1 ? 'beat' : 'beats';
}

/** "In 2 of 3 beats". */
export function angleShareLabel(beatsIn: number, totalBeats: number): string {
  return `In ${String(beatsIn)} of ${String(totalBeats)} ${beatWord(totalBeats)}`;
}

/**
 * The share 0..1: beats in ÷ beats that ran. 0 when the angle ran no beats.
 *
 * @throws InvalidArgumentError on a negative count, or more beats in than ran.
 */
export function angleShare(inputs: AngleShareInputs): Traced<number> {
  const { beatsIn, totalBeats } = inputs;
  if (!Number.isInteger(beatsIn) || beatsIn < 0 || beatsIn > totalBeats) {
    throw new InvalidArgumentError('angleShare', 'beatsIn', beatsIn, `0..${String(totalBeats)}`);
  }
  if (!Number.isInteger(totalBeats) || totalBeats < 0) {
    throw new InvalidArgumentError('angleShare', 'totalBeats', totalBeats, 'a count of 0 or more');
  }
  const label = angleShareLabel(beatsIn, totalBeats);
  if (totalBeats === 0 || beatsIn === 0) {
    return constantOf(label, 0, `${inputs.personName} was in none of the beats that ran`);
  }
  return startCalc(label, beatsIn, { unit: 'ratio', startLabel: 'Beats they were in' })
    .divide('Beats that ran', totalBeats)
    .done();
}
