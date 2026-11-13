/**
 * Momentum drift: the weekly pull of a worker's momentum back toward its resting point (MTCH3-07).
 *
 * ```
 * share  = weeklyDrift                          (no match in the past week)
 *        = weeklyDrift × activeDriftShare       (wrestled in the past week: weeksIdle 0)
 * change = (driftTarget − momentum) × share
 *          then the whole distance when less than SETTLE_WITHIN would be left
 * ```
 *
 * A worker who keeps wrestling cools off more slowly than one who sits at home, so a busy winner
 * can hold a high momentum while an idle one cools off within months. The change always points at
 * the target and is never larger than the distance to it, so drift never carries momentum past
 * the target. With `weeklyDrift` 0 the change is 0. The result is the delta WRK1's
 * `applyMomentumChange` takes; the weekly phase (`aftermath/drift.ts`) applies it. Morale is never
 * read or touched. WRK5 (popularity and momentum over time) can replace this.
 *
 * Design: docs/design/match-aftermath.md#momentum-drift.
 */

import { InvalidArgumentError } from '../../../../core/errors';
import { constantOf, startCalc, type Traced } from '../../../../core/trace';
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
  /**
   * Whole weeks since the worker's last match for the promotion: 0 when they wrestled in the past
   * week. Left out when no match is on record, which cools off at the full rate.
   */
  readonly weeksIdle?: number;
}

function valueOf(before: number | Traced<number>): number {
  return typeof before === 'number' ? before : before.value;
}

function percent(share: number): string {
  return `${formatNumber(Math.round(share * 100))}%`;
}

/** The line for a worker who wrestled in the past week. */
export const ACTIVE_DRIFT_LABEL = 'Wrestled this week: cools off more slowly';

/**
 * The plain-words line for one drift step, such as "Cooling off: 12% of the way back to 0". The
 * weekly phase uses it as the door's reason label, so the momentum Why? reads the same.
 */
export function momentumDriftLabel(before: number, target: number, share: number): string {
  const direction = before >= target ? 'Cooling off' : 'Warming back up';
  return `${direction}: ${percent(share)} of the way back to ${formatNumber(target)}`;
}

/** The share of the distance {@link momentumDrift} removes this week, without a trace. */
export function driftShare(tunables: EngineTunables, weeksIdle?: number): number {
  const weekly = tunables.get('match.momentum.weeklyDrift');
  return weeksIdle === 0 ? weekly * tunables.get('match.momentum.activeDriftShare') : weekly;
}

function idleNote(weeksIdle: number | undefined): string {
  if (weeksIdle === undefined) {
    return 'No match on record: cools off at the full rate';
  }
  return weeksIdle === 1
    ? 'Last match over a week ago: cools off at the full rate'
    : `Last match over ${formatNumber(weeksIdle)} weeks ago: cools off at the full rate`;
}

/**
 * How much momentum drifts back toward `match.momentum.driftTarget` this week, in points: negative
 * when cooling off from above the target, positive from below. Pure: reads only its inputs and
 * the tunables.
 */
export function momentumDrift(
  inputs: MomentumDriftInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const { weeksIdle } = inputs;
  if (weeksIdle !== undefined && (!Number.isSafeInteger(weeksIdle) || weeksIdle < 0)) {
    throw new InvalidArgumentError(
      'momentumDrift',
      'weeksIdle',
      weeksIdle,
      'a whole number of 0 or more',
    );
  }
  const before = valueOf(inputs.before);
  const target = tunables.get('match.momentum.driftTarget');
  const share = driftShare(tunables, weeksIdle);
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
  const shareCalc = startCalc(`${percent(share)} of the way back`, 0, {
    unit: 'ratio',
    startLabel: 'Nothing yet',
  });
  shareCalc.add(
    'Weekly cooling off',
    shareCalc.tunable(tunables, 'match.momentum.weeklyDrift', 'Weekly cooling off'),
  );
  if (weeksIdle === 0) {
    shareCalc.multiply(
      ACTIVE_DRIFT_LABEL,
      shareCalc.tunable(tunables, 'match.momentum.activeDriftShare', ACTIVE_DRIFT_LABEL),
    );
  } else {
    shareCalc.note(idleNote(weeksIdle));
  }
  calc.multiply(`${percent(share)} of the way back`, shareCalc.done());
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
