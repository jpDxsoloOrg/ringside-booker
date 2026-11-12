/**
 * Star power: how much drawing power the workers in a segment bring, in the show's region.
 *
 * D-02: popularity enters a rating once, here. Everyone's popularity in the show's region is
 * side-aggregated (the biggest star counts most) and then bent by a curve with diminishing returns
 * at the top. The same star power feeds both what the crowd thinks was delivered and what it
 * expected (`crowdExpectation`), so a hot act that underdelivers gets a flat reaction.
 *
 * Design: docs/design/match-rating.md#star-power.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { constantOf, inputOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';
import { sideAggregate } from './sideAggregate';

export const STAR_POWER_DOC_REF = 'match-rating.md#star-power';

export interface StarPowerMember {
  id: string;
  name: string;
  /** The worker's `regionalPop[regionId]` for the show's region; 0 when absent (D-03). */
  popularity: number;
}

export interface StarPowerInputs {
  /** The show's region as the player reads it, such as "Great Lakes". */
  regionName: string;
  /** Everyone in the segment, across every side. */
  members: readonly StarPowerMember[];
}

/** The top of the popularity scale, where the curve stops adding anything. */
const SCALE_TOP = 100;

/**
 * `sp = agg × (1 + curve × (100 − agg) ÷ 100)`, kept between 0 and 100, where `agg` is the side
 * aggregate of the members' popularity with `match.starPower.depthDecay`. Curve 0 is linear; at
 * 0.8, 50 → 70, 80 → 92.8 and 100 → 100. The trace is titled "Star power in <region>".
 *
 * @throws InvalidArgumentError when there are no members.
 */
export function starPower(
  inputs: StarPowerInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  if (inputs.members.length === 0) {
    throw new InvalidArgumentError(
      'starPower',
      'members',
      inputs.members.length,
      'at least one worker',
    );
  }
  const { tunables } = deps;
  const region = inputs.regionName;
  const popularity = sideAggregate(
    {
      label: `Popularity in ${region}`,
      members: inputs.members.map((member) => ({
        id: member.id,
        name: member.name,
        value: inputOf(`${member.name}'s popularity in ${region}`, member.popularity, {
          kind: 'person',
          id: member.id,
        }),
      })),
      decayKey: 'match.starPower.depthDecay',
    },
    { tunables },
  );

  const top = constantOf('Top of the scale', SCALE_TOP, 'Popularity and star power run 0–100');
  const bend = startCalc('Diminishing returns', top, { unit: 'multiplier' });
  bend
    .subtract('Popularity', popularity.value)
    .divide('Per point of the scale', top)
    .multiply('Curve', bend.tunable(tunables, 'match.starPower.curve', 'Star power curve'))
    .add('Plus the popularity itself', 1);

  return startCalc(`Star power in ${region}`, popularity, {
    unit: 'points',
    docRef: STAR_POWER_DOC_REF,
  })
    .multiply('Diminishing returns at the top', bend.done())
    .clamp(0, SCALE_TOP)
    .done();
}
