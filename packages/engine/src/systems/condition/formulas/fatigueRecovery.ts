/**
 * Fatigue recovery: how much fatigue a person has left after a day of rest.
 *
 * Design: docs/design/calculation-traces.md#worked-example. This is the reference formula every
 * system copies: plain inputs, the tunable reader and one named stream in, a traced number out.
 */

import type { RngStream } from '../../../core/rng/registry';
import { rollInt } from '../../../core/rng/rolls';
import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';

/** What the formula needs to know about the person. */
export interface FatigueRecoveryInputs {
  /** Fatigue before the day's rest, 0 to 100. */
  fatigue: number;
}

/** The ends of the fatigue scale. Fixed by the Person schema (`fatigue: zStat`), not tunable. */
export const FATIGUE_MIN = 0;
export const FATIGUE_MAX = 100;

export const FATIGUE_RECOVERY_DOC_REF = 'docs/design/calculation-traces.md#worked-example';

/**
 * Fatigue after a day of rest: the starting fatigue, less the daily recovery (a tunable), less a
 * random extra of 0 to `condition.fatigueRecoveryBonusMax` (both ends included), kept between 0
 * and 100.
 *
 * The extra rest is always rolled, even when its maximum is 0, so every call draws exactly once
 * from `deps.rng` and changing the tunable never shifts the stream.
 */
export function computeFatigueRecovery(
  inputs: FatigueRecoveryInputs,
  deps: { tunables: EngineTunables; rng: RngStream },
): Traced<number> {
  const calc = startCalc('Fatigue after a day of rest', inputs.fatigue, {
    unit: 'points',
    docRef: FATIGUE_RECOVERY_DOC_REF,
    startLabel: 'Fatigue before rest',
  });
  calc.subtract(
    'Daily recovery',
    calc.tunable(deps.tunables, 'condition.fatigueRecoveryPerDay', 'Daily recovery'),
  );
  const bonusMax = calc.tunable(
    deps.tunables,
    'condition.fatigueRecoveryBonusMax',
    'Most extra rest',
  );
  const extraRest = rollInt(deps.rng, 0, bonusMax, 'Extra rest');
  return calc
    .roll(extraRest.roll)
    .subtract('Extra rest', extraRest.value)
    .clamp(FATIGUE_MIN, FATIGUE_MAX)
    .done();
}
