/**
 * Heat cooling (CRTV3-02): what a storyline's heat drops to after one more day without progress.
 *
 * Heat holds for a grace period after the story starts or last moves on. After that it loses a
 * fixed amount each day, down to a floor and never below it. Cooling never raises heat: a story
 * already at or below the floor stays where it is.
 *
 * Design: docs/design/storylines.md#heat-decay.
 */

import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';

export const HEAT_DECAY_DOC_REF = 'docs/design/storylines.md#heat-decay';

export interface HeatDecayInputs {
  /** The stored heat before today's cooling, 0–100. */
  readonly heatBefore: number;
  /** Days from the last progress (or the start) to today. */
  readonly daysSinceProgress: number;
  /** What the days count from, in words: "Started 4 Jan 2027", "Last linked segment 10 Feb 2027". */
  readonly progressLabel: string;
}

/** "1 day" or "N days". */
function days(count: number): string {
  return count === 1 ? '1 day' : `${String(count)} days`;
}

/**
 * Heat after today's cooling: unchanged inside the grace period (`daysSinceProgress ≤
 * decayGraceDays`) or at or below the floor; otherwise `heatBefore − decayPerDay`, no lower than
 * `decayFloor`, kept within 0–100.
 */
export function heatDecay(
  inputs: HeatDecayInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc('Heat after cooling', inputs.heatBefore, {
    unit: 'points',
    docRef: HEAT_DECAY_DOC_REF,
    startLabel: 'Heat yesterday',
  });
  calc.note(`Days since progress: ${days(inputs.daysSinceProgress)} (${inputs.progressLabel})`);
  const graceDays = calc.tunable(
    tunables,
    'storylines.heat.decayGraceDays',
    'Days without progress before heat cools',
  );
  // Each check is recorded as the branch that was taken, so the Why? shows it (with its setting)
  // without "Show checks that didn't apply": the grace period and the floor are why it cools.
  if (inputs.daysSinceProgress <= graceDays) {
    calc.branch(`Inside the grace period of ${days(graceDays)}`, true);
    return calc.done();
  }
  calc.branch(`Past the grace period of ${days(graceDays)}`, true);
  const floor = calc.tunable(tunables, 'storylines.heat.decayFloor', 'Cooling floor');
  if (inputs.heatBefore <= floor) {
    calc.branch('Already at or below the cooling floor', true);
    return calc.done();
  }
  calc.branch(`Above the cooling floor of ${String(floor)}`, true);
  return calc
    .subtract(
      'Daily cooling',
      calc.tunable(tunables, 'storylines.heat.decayPerDay', 'Heat lost each day'),
    )
    .max('Cooling floor', calc.tunable(tunables, 'storylines.heat.decayFloor', 'Cooling floor'))
    .clamp(0, 100)
    .note(`Cooling for ${days(inputs.daysSinceProgress - graceDays)} so far`)
    .done();
}
