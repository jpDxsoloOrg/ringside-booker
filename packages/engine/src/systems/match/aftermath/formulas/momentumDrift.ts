/**
 * Momentum drift: the weekly pull of a worker's momentum back toward its resting point (MTCH3-07).
 *
 * ```
 * share  = weeklyDrift                          (one week)
 *        = 1 − (1 − weeklyDrift)^weeks          (several weeks at once)
 * change = (driftTarget − momentum) × share
 *          then the whole distance when less than SETTLE_WITHIN would be left
 * ```
 *
 * The change always points at the target and is never larger than the distance to it, so drift
 * never carries momentum past the target. With `weeklyDrift` 0 the change is 0. The result is the
 * delta WRK1's `applyMomentumChange` takes; the weekly phase (`aftermath/drift.ts`) applies it.
 * Morale is never read or touched. WRK5 (popularity and momentum over time) can replace this.
 *
 * Design: docs/design/match-aftermath.md#momentum-drift.
 */

import { InvalidArgumentError } from '../../../../core/errors';
import { constantOf, startCalc, type Calc, type Traced } from '../../../../core/trace';
import { formatNumber } from '../../../world/people/labels';
import type { EngineTunables } from '../../../tunables';

export const MOMENTUM_DRIFT_DOC_REF = 'docs/design/match-aftermath.md#momentum-drift';

/** The line shown when momentum already sits at its resting point. */
export const AT_REST_NOTE = 'Already at its resting point: nothing to cool off';
/** The line shown when drift is turned off. */
export const DRIFT_OFF_NOTE = 'Cooling off is turned off';

/**
 * Below this many points from the target, momentum settles on the target instead of creeping
 * toward it forever. Not a balance number: it only stops endless tiny weekly changes.
 */
export const SETTLE_WITHIN = 0.5;
const SETTLE_LABEL = 'Close enough to settle';
const SETTLE_REASON = 'Momentum this close to its resting point stops there instead of creeping';

export interface MomentumDriftInputs {
  /** Momentum now, with the promotion (never empty: empty momentum does not drift). */
  readonly before: number | Traced<number>;
  /** Whole weeks of drift to work out at once; 1 (the weekly phase) when left out. */
  readonly weeksIdle?: number;
}

function valueOf(before: number | Traced<number>): number {
  return typeof before === 'number' ? before : before.value;
}

function percent(share: number): string {
  return `${formatNumber(Math.round(share * 100))}%`;
}

/**
 * The plain-words line for one drift step, such as "Cooling off: 12% of the way back to 0". The
 * weekly phase uses it as the door's reason label, so the momentum Why? reads the same.
 */
export function momentumDriftLabel(before: number, target: number, share: number): string {
  const direction = before >= target ? 'Cooling off' : 'Warming back up';
  return `${direction}: ${percent(share)} of the way back to ${formatNumber(target)}`;
}

/** The share of the distance removed over `weeks` weeks, as its own small traced calculation. */
function shareOver(calc: Calc, weeks: number, tunables: EngineTunables): number | Traced<number> {
  const weekly = calc.tunable(tunables, 'match.momentum.weeklyDrift', 'Weekly cooling off');
  if (weeks === 1) {
    return weekly;
  }
  const kept = startCalc('Share left after one week', 1, { unit: 'ratio' })
    .subtract('Weekly cooling off', weekly)
    .power(`Over ${formatNumber(weeks)} weeks`, weeks)
    .done();
  return startCalc(`Share of the way back over ${formatNumber(weeks)} weeks`, 1, {
    unit: 'ratio',
  })
    .subtract('Share left', kept)
    .done();
}

/** The share {@link momentumDrift} removes over `weeks` weeks, without a trace. */
export function driftShare(weeklyDrift: number, weeks = 1): number {
  return weeks === 1 ? weeklyDrift : 1 - (1 - weeklyDrift) ** weeks;
}

/**
 * How much momentum drifts back toward `match.momentum.driftTarget` over `weeksIdle` weeks (1 by
 * default), in points: negative when cooling off from above the target, positive from below.
 * Pure: reads only its inputs and the tunables.
 */
export function momentumDrift(
  inputs: MomentumDriftInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const weeks = inputs.weeksIdle ?? 1;
  if (!Number.isSafeInteger(weeks) || weeks < 1) {
    throw new InvalidArgumentError(
      'momentumDrift',
      'weeksIdle',
      weeks,
      'a whole number of 1 or more',
    );
  }
  const before = valueOf(inputs.before);
  const target = tunables.get('match.momentum.driftTarget');
  const share = driftShare(tunables.get('match.momentum.weeklyDrift'), weeks);
  const label = momentumDriftLabel(before, target, share);

  const distance = startCalc('Distance to the resting point', 0, {
    unit: 'points',
    startLabel: 'Nothing yet',
  });
  distance.add(
    'Resting point',
    distance.tunable(tunables, 'match.momentum.driftTarget', 'Resting point'),
  );
  distance.subtract('Momentum now', inputs.before);

  const calc = startCalc(label, distance.done(), {
    unit: 'points',
    docRef: MOMENTUM_DRIFT_DOC_REF,
  });
  if (before === target) {
    return calc.note(AT_REST_NOTE).done();
  }
  const shareTraced = shareOver(calc, weeks, tunables);
  calc.multiply(`${percent(share)} of the way back`, shareTraced);
  if (share === 0) {
    return calc.note(DRIFT_OFF_NOTE).done();
  }
  const change = (target - before) * share;
  const left = target - before - change;
  const settles = Math.abs(left) < SETTLE_WITHIN;
  calc.branch(`Less than ${formatNumber(SETTLE_WITHIN)} left to the resting point`, settles);
  if (settles && left !== 0) {
    // The whole distance, so momentum lands exactly on the target.
    const whole = constantOf(SETTLE_LABEL, target - before, SETTLE_REASON);
    if (before > target) {
      calc.min(SETTLE_LABEL, whole);
    } else {
      calc.max(SETTLE_LABEL, whole);
    }
  }
  return calc.done();
}
