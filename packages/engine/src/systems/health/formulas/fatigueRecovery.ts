/**
 * Fatigue recovery: how much fatigue a person has left after a day of rest.
 *
 * Design: docs/design/health.md#fatigue-recovery. This is the reference formula every system
 * copies: plain inputs, the tunable reader and one named stream in, a traced number out.
 */

import type { RngStream } from '../../../core/rng/registry';
import { rollInt } from '../../../core/rng/rolls';
import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { TraitKey } from '../../../model/entities/person';
import type { EngineTunables } from '../../tunables';
import { AGING_OFF, HEALTH_DOC, tunableStart } from './shared';

/** What the formula needs to know about the person. */
export interface FatigueRecoveryInputs {
  /** Fatigue before the day's rest, 0 to 100. */
  fatigue: number;
  /** The stamina attribute, 0 to 100. */
  stamina: number;
  /** Age in whole years on the day. */
  age: number;
  traits: readonly TraitKey[];
  /** The world's aging setting (`meta.settings.agingEnabled`); off, age never slows recovery. */
  agingEnabled: boolean;
  /**
   * True when the person's last show day was spent talking (a promo, angle or interview) and not
   * wrestling: they rested less than someone who stayed home.
   */
  workedPromo: boolean;
}

/** The ends of the fatigue scale. Fixed by the Person schema (`fatigue: zStat`), not tunable. */
export const FATIGUE_MIN = 0;
export const FATIGUE_MAX = 100;

/** The middle of the 0–100 attribute scale: stamina 50 recovers at the plain daily rate. */
const STAMINA_MIDPOINT = 50;

export const FATIGUE_RECOVERY_DOC_REF = `${HEALTH_DOC}#fatigue-recovery`;

/** `1 + (stamina − 50) / 50 × staminaWeight`. */
function staminaFactor(stamina: number, tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Stamina', stamina, { unit: 'points', startLabel: 'Stamina' });
  return calc
    .subtract('Midpoint of the 0–100 scale', STAMINA_MIDPOINT)
    .divide('Midpoint of the 0–100 scale', STAMINA_MIDPOINT)
    .multiply(
      'Stamina weight',
      calc.tunable(tunables, 'health.fatigue.staminaWeight', 'Stamina weight'),
    )
    .add('Average recovery', 1)
    .done();
}

/** `max(ageFactorMin, 1 − max(0, age − ageFrom) × agePenaltyPerYear)`, or 1 with aging off. */
function ageFactor(age: number, agingEnabled: boolean, tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Age', 1, { unit: 'multiplier', startLabel: 'Full recovery' });
  if (!agingEnabled) {
    return calc.branch(AGING_OFF, true).done();
  }
  const years = startCalc('Years past the age recovery slows', age, {
    unit: 'years',
    startLabel: 'Age',
  });
  years
    .subtract(
      'Recovery slows from',
      years.tunable(tunables, 'health.fatigue.ageFrom', 'Recovery slows from'),
    )
    .max('Not below 0', 0);
  const loss = startCalc('Recovery lost to age', years.done(), { unit: 'ratio' });
  loss.multiply(
    'Lost per year',
    loss.tunable(tunables, 'health.fatigue.agePenaltyPerYear', 'Lost per year'),
  );
  return calc
    .subtract('Older body', loss.done())
    .max('Least age can leave', calc.tunable(tunables, 'health.fatigue.ageFactorMin'))
    .done();
}

/** `recoveryPerDay × stamina × age × trait × promo`. */
function dailyRecovery(inputs: FatigueRecoveryInputs, tunables: EngineTunables): Traced<number> {
  const calc = startCalc(
    'Daily recovery',
    tunableStart(tunables, 'health.fatigue.recoveryPerDay', 'Daily recovery'),
    { unit: 'points' },
  );
  calc.multiply('Stamina', staminaFactor(inputs.stamina, tunables));
  calc.multiply('Age', ageFactor(inputs.age, inputs.agingEnabled, tunables));
  if (inputs.traits.includes('workhorse')) {
    calc
      .branch('Workhorse', true)
      .multiply(
        'Workhorse',
        calc.tunable(tunables, 'health.fatigue.workhorseMultiplier', 'Workhorse'),
      );
  } else if (inputs.traits.includes('coaster')) {
    calc
      .branch('Coaster', true)
      .multiply('Coaster', calc.tunable(tunables, 'health.fatigue.coasterMultiplier', 'Coaster'));
  }
  if (inputs.workedPromo) {
    calc
      .branch('Worked a promo today', true)
      .multiply(
        'Worked a promo today',
        calc.tunable(tunables, 'health.fatigue.workedPromoRecovery', 'Worked a promo today'),
      );
  }
  return calc.done();
}

/**
 * Fatigue after a day of rest: the starting fatigue, less the daily recovery (scaled by stamina,
 * age, the workhorse or coaster trait, and a talking-only show day), less a random extra of 0 to
 * `health.fatigue.recoveryBonusMax` (both ends included), kept between 0 and 100.
 *
 * The extra rest is always rolled, even when its maximum is 0, so every call draws exactly once
 * from `deps.rng` and changing a tunable never shifts the stream.
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
  calc.subtract('Daily recovery', dailyRecovery(inputs, deps.tunables));
  const bonusMax = calc.tunable(
    deps.tunables,
    'health.fatigue.recoveryBonusMax',
    'Most extra rest',
  );
  const extraRest = rollInt(deps.rng, 0, bonusMax, 'Extra rest');
  return calc
    .roll(extraRest.roll)
    .subtract('Extra rest', extraRest.value)
    .clamp(FATIGUE_MIN, FATIGUE_MAX)
    .done();
}
