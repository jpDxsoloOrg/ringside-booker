/**
 * Beat score: how well one beat of an angle went (MTCH5-02).
 *
 * Each group scores the mean of its people's beat worker values; the beat is the weighted mean of
 * the groups that counted, plus a small seeded roll for how the beat landed, kept between 0 and
 * 100. Not rounded: MTCH5-03's angle score rounds once at the end.
 *
 * Design: docs/design/angle-rating.md#beat-score.
 */

import { InvalidArgumentError } from '../../../../core/errors';
import { rollInt } from '../../../../core/rng/rolls';
import type { RngStream } from '../../../../core/rng/registry';
import { constantOf, startCalc, type Traced } from '../../../../core/trace';
import type { EngineTunables } from '../../../tunables';
import { NO_NOISE_BRANCH } from './beatWorkerValue';

export const BEAT_SCORE_DOC_REF = 'angle-rating.md#beat-score';

export const BEAT_NOISE_LABEL = 'How the beat landed';

export interface BeatScoreGroup {
  /** The catalog group's label, such as "Speaker" or "Host". */
  label: string;
  /** The catalog group's weight (0.1..5). */
  weight: number;
  /** An optional group with nobody in it is left out instead of scoring 0. */
  optional: boolean;
  /** Each person's `beatWorkerValue`, titled with their name. */
  workerValues: readonly Traced<number>[];
}

export interface BeatScoreInputs {
  beatName: string;
  groups: readonly BeatScoreGroup[];
}

const SCORE_MIN = 0;
const SCORE_MAX = 100;

/** "Host: nobody, not counted". */
export function skippedGroupNote(label: string): string {
  return `${label}: nobody, not counted`;
}

/** The note on a beat that scores 0 because a group it needs is empty. */
export function emptyRequiredGroupNote(label: string): string {
  return `${label}: nobody in a group the beat needs, so the beat scores 0`;
}

/** The group's mean worker value times its weight. */
function weightedGroup(group: BeatScoreGroup, first: Traced<number>): Traced<number> {
  const calc = startCalc(group.label, first);
  for (const value of group.workerValues.slice(1)) {
    calc.add(value.trace.label, value);
  }
  return calc
    .divide(
      'People in the group',
      group.workerValues.length,
      'A group scores the mean of its people',
    )
    .multiply('Group weight', group.weight, 'Set by the beat')
    .done();
}

/**
 * The beat's score, 0..100: Σ(weight × group mean) / Σ(weights that counted), plus a roll of up
 * to `match.angle.beatNoise` points either way. Titled "Beat: <name>". An empty required group
 * gives 0 with a note and draws no roll.
 *
 * @throws InvalidArgumentError when there are no groups.
 */
export function beatScore(
  inputs: BeatScoreInputs,
  deps: { tunables: EngineTunables; rng: RngStream },
): Traced<number> {
  if (inputs.groups.length === 0) {
    throw new InvalidArgumentError('beatScore', 'groups', 0, 'at least one group');
  }
  const label = `Beat: ${inputs.beatName}`;
  const options = { unit: 'points', docRef: BEAT_SCORE_DOC_REF } as const;

  const emptyRequired = inputs.groups.find(
    (group) => !group.optional && group.workerValues.length === 0,
  );
  if (emptyRequired !== undefined) {
    return startCalc(
      label,
      constantOf('No score', 0, 'A beat cannot be scored without a group it needs'),
      options,
    )
      .note(emptyRequiredGroupNote(emptyRequired.label))
      .done();
  }

  const skipped: string[] = [];
  const weighted: Traced<number>[] = [];
  let totalWeight = 0;
  for (const group of inputs.groups) {
    const [first] = group.workerValues;
    if (first === undefined) {
      skipped.push(skippedGroupNote(group.label));
      continue;
    }
    weighted.push(weightedGroup(group, first));
    totalWeight += group.weight;
  }
  const [firstWeighted, ...restWeighted] = weighted;
  if (firstWeighted === undefined) {
    // Only reachable when every group is optional and empty; the catalog never allows that.
    throw new InvalidArgumentError('beatScore', 'groups', 0, 'at least one group with people');
  }

  const calc = startCalc(label, firstWeighted, options);
  for (const group of restWeighted) {
    calc.add(group.trace.label, group);
  }
  for (const note of skipped) {
    calc.note(note);
  }
  calc.divide(
    'Total weight of the groups that counted',
    totalWeight,
    'The beat is the weighted mean of its groups',
  );

  const spread = calc.tunable(deps.tunables, 'match.angle.beatNoise', 'Most the night can move it');
  if (spread === 0) {
    calc.branch(NO_NOISE_BRANCH, true);
  } else {
    const noise = rollInt(deps.rng, -spread, spread, BEAT_NOISE_LABEL);
    calc.roll(noise.roll).add(BEAT_NOISE_LABEL, noise.value);
  }
  return calc.clamp(SCORE_MIN, SCORE_MAX).done();
}
