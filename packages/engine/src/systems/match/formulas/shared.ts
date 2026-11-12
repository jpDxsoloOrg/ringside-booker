/**
 * Small helpers the crowd and scoring formulas share: signed labels and flat summaries of a big
 * upstream value.
 */

import { inputOf, type Traced, type TraceUnit } from '../../../core/trace';
import { formatNumber } from '../../world/people/labels';

/** "+8", "−3" (a real minus sign) or "+0", rounded to 2 decimals like every other label. */
export function signedNumber(value: number): string {
  const shown = formatNumber(Math.abs(value));
  if (shown === '0') {
    return '+0';
  }
  return value < 0 ? `−${shown}` : `+${shown}`;
}

/**
 * A traced value as one flat `input` node with its label, value and unit, without its subtree.
 *
 * Work rate, talk and the crowd score each have their own deep trace (work rate alone nears the
 * trace depth limit), and the rater shows each as its own section. The formulas that blend them
 * read them through this summary, so a blended trace stays shallow and does not repeat the same
 * story two or three times.
 */
export function summaryOf(value: Traced<number>, label: string, unit: TraceUnit): Traced<number> {
  return inputOf(label, value.value, undefined, unit);
}
