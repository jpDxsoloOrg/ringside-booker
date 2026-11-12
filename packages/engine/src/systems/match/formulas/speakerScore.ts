/**
 * Speaker score: the simple rating of a talking segment, in place of a match's work rate.
 *
 * Each speaker's talk is `workerPerformance` on the talk axis with the angle type's speaker
 * weights. The speakers are side-aggregated per side and then across sides, the same way work rate
 * combines workers, and an optional roll stands for how the promo landed. MTCH5's beat scores
 * replace this behind the same rater.
 *
 * Design: docs/design/match-rating.md#talking-segments-simple.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { rollNormal } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import { startCalc, type Traced } from '../../../core/trace';
import type { AngleTypeDef } from '../../../model/catalogs';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { sideAggregate, type SideAggregateMember } from './sideAggregate';
import { ACROSS_SIDES_LABEL, NO_VARIANCE_NOTE, sideLabel } from './workRate';

export const TALKING_DOC_REF = 'match-rating.md#talking-segments-simple';

export interface SpeakerScoreSpeaker {
  id: string;
  name: string;
  /** `workerPerformance` on the talk axis with the angle type's speaker weights. */
  talk: Traced<number>;
}

export interface SpeakerScoreSide {
  /** The stored side number, 0-based. Screens read side `n` as "Side n + 1". */
  side: number;
  members: readonly SpeakerScoreSpeaker[];
}

export interface SpeakerScoreInputs {
  angleType: Pick<AngleTypeDef, 'name' | 'speakerWeights'>;
  sides: readonly SpeakerScoreSide[];
  /**
   * Runs on each side's aggregate before the sides are combined (the rater's `side` stage). Left
   * out, the side aggregate is used as it is.
   */
  sideStage?: (side: SpeakerScoreSide, value: Traced<number>) => Traced<number>;
}

export const PROMO_VARIANCE_LABEL = 'How the promo landed';

const TALK_MIN = 0;
const TALK_MAX = 100;

/**
 * The side aggregate of each side's talk (`match.side.depthDecay`), then across sides
 * (`match.sides.depthDecay`), plus a normal roll with sd `match.angle.varianceSd` when `deps.rng`
 * is given, kept between 0 and 100. Titled "Talk: <angle type>".
 *
 * @throws InvalidArgumentError when there are no sides; RangeError (from the side aggregate) for an
 *   empty side.
 */
export function speakerScore(
  inputs: SpeakerScoreInputs,
  deps: { tunables: EngineTunables; rng?: RngStream },
): Traced<number> {
  if (inputs.sides.length === 0) {
    throw new InvalidArgumentError(
      'speakerScore',
      'sides',
      inputs.sides.length,
      'at least one side',
    );
  }
  const { tunables } = deps;
  const sideValues: SideAggregateMember[] = inputs.sides.map((side) => {
    const aggregate = sideAggregate(
      {
        label: sideLabel(side.side),
        members: side.members.map((speaker) => ({
          id: speaker.id,
          name: speaker.name,
          value: speaker.talk,
        })),
        decayKey: 'match.side.depthDecay',
      },
      { tunables },
    );
    return {
      id: String(side.side).padStart(2, '0'),
      name: sideLabel(side.side),
      value: inputs.sideStage === undefined ? aggregate : inputs.sideStage(side, aggregate),
    };
  });
  const acrossSides = sideAggregate(
    { label: ACROSS_SIDES_LABEL, members: sideValues, decayKey: 'match.sides.depthDecay' },
    { tunables },
  );

  const { name, speakerWeights } = inputs.angleType;
  const calc = startCalc(`Talk: ${name}`, acrossSides, {
    unit: 'points',
    docRef: TALKING_DOC_REF,
  });
  calc.note(
    `Speaker weights set by ${name}: mic ${formatNumber(speakerWeights.mic)}, charisma ${formatNumber(speakerWeights.charisma)}, presence ${formatNumber(speakerWeights.presence)}`,
  );

  if (deps.rng === undefined) {
    calc.note(NO_VARIANCE_NOTE);
  } else {
    const sd = calc.tunable(tunables, 'match.angle.varianceSd', 'Promo variance spread');
    const variance = rollNormal(deps.rng, 0, sd, PROMO_VARIANCE_LABEL);
    calc.roll(variance.roll).add(PROMO_VARIANCE_LABEL, variance.value);
  }

  return calc.clamp(TALK_MIN, TALK_MAX).done();
}
