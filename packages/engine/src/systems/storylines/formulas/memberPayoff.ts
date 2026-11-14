/**
 * One member's storyline payoff (CRTV4-03): the popularity and momentum a member gets when the
 * storyline ends, from the payoff's quality.
 *
 * - **Popularity:** `popularityMax × quality`. A gain is also multiplied by the member's room to
 *   grow, `clamp((heat + headroomMargin − marketPop) ÷ headroomSpan, 0, 1)`: a star already bigger
 *   than the story gains little or nothing ("Already bigger than this story"). A loss is never
 *   reduced, so a cold story really costs everyone in it.
 * - **Momentum:** `momentumMax × quality`.
 *
 * No rolls, no rounding: WRK1's doors round what they store. Design: docs/design/storylines.md#payoff.
 */

import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';
import { PAYOFF_DOC_REF } from './payoffQuality';

export interface MemberPayoffInputs {
  /** The payoff's quality from `payoffQuality`. */
  readonly quality: Traced<number>;
  /** The storyline's heat when it ends, 0–100. */
  readonly heat: number;
  /** The member's popularity among the promotion's fans (footprint popularity), 0–100. */
  readonly memberMarketPop: number;
  readonly memberName: string;
}

export interface MemberPayoff {
  readonly popularity: Traced<number>;
  readonly momentum: Traced<number>;
}

export const ALREADY_BIGGER_TEXT = 'Already bigger than this story';

/** The member's room to grow from this story, 0–1. */
function headroom(inputs: MemberPayoffInputs, tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Room to grow', inputs.heat, {
    unit: 'ratio',
    startLabel: 'Heat when it ended',
  });
  calc.add(
    'Margin above the heat',
    calc.tunable(
      tunables,
      'storylines.payoff.headroomMargin',
      'Popularity above the heat that still gains in full',
    ),
  );
  calc.subtract(`${inputs.memberName}'s popularity with the fans`, inputs.memberMarketPop);
  calc.divide(
    'Popularity over which the gain shrinks',
    calc.tunable(
      tunables,
      'storylines.payoff.headroomSpan',
      'Popularity over which the gain shrinks',
    ),
  );
  calc.clamp(0, 1);
  return calc.done();
}

/** What one member gets from the payoff: popularity (spread over the fan base) and momentum. */
export function memberPayoff(
  inputs: MemberPayoffInputs,
  deps: { tunables: EngineTunables },
): MemberPayoff {
  const { tunables } = deps;
  const popularity = startCalc(`Popularity payoff for ${inputs.memberName}`, inputs.quality, {
    unit: 'points',
    docRef: PAYOFF_DOC_REF,
  });
  popularity.multiply(
    'Popularity at full payoff',
    popularity.tunable(tunables, 'storylines.payoff.popularityMax', 'Popularity at full payoff'),
  );
  if (inputs.quality.value > 0) {
    const room = headroom(inputs, tunables);
    popularity.branch(ALREADY_BIGGER_TEXT, room.value === 0);
    popularity.multiply('Room to grow', room);
  }

  const momentum = startCalc(`Momentum payoff for ${inputs.memberName}`, inputs.quality, {
    unit: 'points',
    docRef: PAYOFF_DOC_REF,
  });
  momentum.multiply(
    'Momentum at full payoff',
    momentum.tunable(tunables, 'storylines.payoff.momentumMax', 'Momentum at full payoff'),
  );
  return { popularity: popularity.done(), momentum: momentum.done() };
}
