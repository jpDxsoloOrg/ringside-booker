/**
 * Beat limits (MTCH5-03): how many beats an angle may have in its slot.
 *
 * The slot's duration class (MTCH1's `durationClassOf`, D-10) decides it; angle types never shift
 * the class. Each class reads its own `match.angle.maxBeats.<class>` tunable, whose range stops at
 * the schema's 8 beats, so a limit can never let an angle hold more than booking can store.
 *
 * Design: docs/design/angle-rating.md#beat-limits.
 */

import { startCalc, type Traced } from '../../../core/trace';
import { MAX_ANGLE_BEATS } from '../../../model/entities/segment';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { DURATION_CLASS_LABELS, type DurationClass } from '../slots';

export const BEAT_LIMIT_DOC_REF = 'angle-rating.md#beat-limits';

/** The tunable each duration class reads its limit from. */
export const BEAT_LIMIT_KEYS = {
  short: 'match.angle.maxBeats.short',
  standard: 'match.angle.maxBeats.standard',
  long: 'match.angle.maxBeats.long',
} as const satisfies Readonly<Record<DurationClass, NumberTunableKey>>;

function beatWord(count: number): string {
  return count === 1 ? 'beat' : 'beats';
}

/** "Short slot: up to 2 beats", "Long slot: up to 1 beat". */
export function beatLimitMessage(durationClass: DurationClass, max: number): string {
  return `${DURATION_CLASS_LABELS[durationClass]} slot: up to ${String(max)} ${beatWord(max)}`;
}

/** "Only the first 2 beats count in a short slot": the note on an angle rated past its limit. */
export function overLimitNote(durationClass: DurationClass, max: number): string {
  const first =
    max === 1 ? 'Only the first beat counts' : `Only the first ${String(max)} beats count`;
  return `${first} in a ${DURATION_CLASS_LABELS[durationClass].toLowerCase()} slot`;
}

/**
 * The most beats an angle may have in a slot of `durationClass`, titled with its message
 * ("Short slot: up to 2 beats"). Never above the schema's {@link MAX_ANGLE_BEATS}.
 */
export function beatLimitOf(
  durationClass: DurationClass,
  tunables: EngineTunables,
): Traced<number> {
  const configured = tunables.get(BEAT_LIMIT_KEYS[durationClass]);
  const max = Math.min(configured, MAX_ANGLE_BEATS);
  const calc = startCalc(beatLimitMessage(durationClass, max), 0, {
    unit: 'count',
    docRef: BEAT_LIMIT_DOC_REF,
    startLabel: 'No beats yet',
  });
  calc.add(
    `${DURATION_CLASS_LABELS[durationClass]} slot`,
    calc.tunable(tunables, BEAT_LIMIT_KEYS[durationClass], 'Most beats in this slot'),
  );
  return calc.min('Most beats an angle can hold', MAX_ANGLE_BEATS).done();
}
