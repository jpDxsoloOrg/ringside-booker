/**
 * Angle score: one 0-100 score for a whole angle from its beat scores (MTCH5-03).
 *
 * 1. **Delivered**: the weighted mean of the beats. Each beat counts with its catalog weight; the
 *    closing beat counts `closingBeatWeight` times more. Repeating a kind of beat wears thin: a
 *    beat keeps `repeatFactor` of its score for each earlier beat of its repetition group in the
 *    angle, and `cardRepeatFactor` for each one earlier on the card.
 * 2. **Crowd**: MTCH1's `crowdScore` with delivered as the performance, judged against what the
 *    crowd expected (D-02).
 * 3. **Blended**: delivered × (1 − `crowdBlend`) + crowd × `crowdBlend`, plus the rating policy's
 *    bonus (D-01; 0 under the full rules).
 * 4. **Writing band**: the promotion's writing team sets a floor and a ceiling.
 * 5. MTCH1's soft compression, then rounded to a whole score.
 *
 * Design: docs/design/angle-rating.md#angle-score.
 */

import { InvalidArgumentError } from '../../../../core/errors';
import type { RngStream } from '../../../../core/rng/registry';
import {
  constantOf,
  startCalc,
  traced,
  type Calc,
  type Traced,
  type TraceNode,
} from '../../../../core/trace';
import type { EngineTunables } from '../../../tunables';
import { formatNumber } from '../../../world/people/labels';
import { crowdScore } from '../../formulas/crowdScore';
import { signedNumber } from '../../formulas/shared';
import { softCompression } from '../../formulas/softCompression';

export const ANGLE_SCORE_DOC_REF = 'angle-rating.md#angle-score';

export const ANGLE_SCORE_LABEL = 'Angle score';
export const BEATS_DELIVERED_LABEL = 'Beats delivered';
export const CLOSING_BEAT_LABEL = 'Closing beat';
export const CEILING_RAISED_NOTE = 'The ceiling was below the floor, so it was raised to the floor';
/** The policy line when the caller gives none. */
export const NO_POLICY_LABEL = 'Same rules for every promotion';

/** Angle types carry no crowd factor (MTCH1-05). */
const ANGLE_CROWD_FACTOR = 1;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

/** One beat as the angle score reads it. */
export interface AngleScoreBeat {
  /** The catalog beat's name, such as "War of Words". */
  name: string;
  /** The beat's `beatScore`, 0..100. */
  score: Traced<number>;
  /** The catalog beat's weight, 0.1..3. */
  weight: number;
  /** The catalog beat's repetition group, such as "talk". */
  repetitionGroup: string;
  /** Beats of the same repetition group earlier in this angle. */
  earlierInAngle: number;
  /** Beats of the same repetition group earlier on the card. */
  earlierOnCard: number;
}

export interface AngleScoreInputs {
  /** The angle's beats in order; the last one is the closing beat. At least one. */
  beats: readonly AngleScoreBeat[];
  /** What the crowd expected (MTCH1's `crowdExpectation`). */
  expected: Traced<number>;
  /** The promotion's `production.writing`, 0..10. */
  writingLevel: number;
  /** The side-aggregated entertainment axis of everyone in the angle. */
  entertainment: Traced<number>;
  /** MTCH1's `starPower` over everyone in the angle. */
  starPower: Traced<number>;
  /** The angle type's name, for the crowd factor line. */
  typeName: string;
  /** The rating policy's score bonus (D-01). Left out: 0, the same rules for everyone. */
  policyBonus?: Traced<number>;
  /** The policy line's text. */
  policyLabel?: string;
}

/**
 * A rating stage the rater runs on delivered (`talk`) and the crowd (`crowd`), so MTCH1's
 * rating modifiers reach an angle. Left out: delivered as it is, the crowd soft-compressed.
 */
export type AngleStageHook = (stage: 'talk' | 'crowd', value: Traced<number>) => Traced<number>;

export interface AngleScoreDeps {
  tunables: EngineTunables;
  /** The crowd's roll; left out, no roll. */
  rng?: RngStream;
  stage?: AngleStageHook;
}

/** Every number the angle score is built from, each with its trace. */
export interface AngleScoreParts {
  /** The weighted mean of the beats, after the `talk` stage. */
  delivered: Traced<number>;
  /** The crowd's reaction, after the `crowd` stage (soft-compressed). */
  crowd: Traced<number>;
  /** The angle score, whole, 0..100. */
  score: Traced<number>;
}

const ORDINALS = [
  'First',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Eighth',
  'Ninth',
  'Tenth',
] as const;

function ordinal(position: number): string {
  return ORDINALS[position - 1] ?? `${String(position)}th`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** "Second talk beat in this angle ×0.85". */
export function repeatInAngleLine(group: string, earlier: number, factor: number): string {
  return `${ordinal(earlier + 1)} ${group} beat in this angle ×${formatNumber(factor)}`;
}

/** "2 talk beats earlier on the card ×0.86". */
export function repeatOnCardLine(group: string, earlier: number, factor: number): string {
  return `${String(earlier)} ${group} ${plural(earlier, 'beat', 'beats')} earlier on the card ×${formatNumber(factor)}`;
}

/** "Writing team (level 7): floor 21, ceiling 92.5". */
export function writingBandLabel(level: number, floor: number, ceiling: number): string {
  return `Writing team (level ${String(level)}): floor ${formatNumber(floor)}, ceiling ${formatNumber(ceiling)}`;
}

/** How many levels of delivered's and the crowd's own traces the score shows under them. */
const NESTED_LEVELS = 2;

/**
 * `node` with everything more than `levels` below it cut away: a formula there becomes a flat
 * input with its value, any other node loses its children. Delivered and the crowd have their own
 * sections in the Why? panel; the score shows their lines (each beat's weight, closing and
 * repetition lines; delivered against expected) without repeating their whole stories, so its
 * trace stays inside the depth limit.
 */
export function pruneTrace(node: TraceNode, levels: number): TraceNode {
  const children = node.children;
  if (children === undefined || children.length === 0) {
    return node;
  }
  if (levels <= 0) {
    if (node.kind === 'formula') {
      return {
        kind: 'input',
        label: node.label,
        value: node.value,
        ...(node.unit === undefined ? {} : { unit: node.unit }),
        ...(node.docRef === undefined ? {} : { docRef: node.docRef }),
      };
    }
    return { ...node, children: [] };
  }
  return { ...node, children: children.map((child) => pruneTrace(child, levels - 1)) };
}

function pruned(value: Traced<number>): Traced<number> {
  return traced(value.value, pruneTrace(value.trace, NESTED_LEVELS));
}

/** One beat's weighted share: score × repetition × weight (× the closing weight). */
function beatTerm(
  beat: AngleScoreBeat,
  index: number,
  closing: boolean,
  tunables: EngineTunables,
): { term: Traced<number>; weight: number } {
  const calc = startCalc(`${beat.name} (beat ${String(index + 1)})`, beat.score, {
    unit: 'points',
    docRef: ANGLE_SCORE_DOC_REF,
  });
  if (beat.earlierInAngle > 0) {
    const factor = calc.tunable(tunables, 'match.angle.repeatFactor', 'Repeat factor');
    const applied = factor ** beat.earlierInAngle;
    calc.multiply(
      repeatInAngleLine(beat.repetitionGroup, beat.earlierInAngle, applied),
      applied,
      `${formatNumber(factor)} for each earlier ${beat.repetitionGroup} beat in this angle`,
    );
  }
  if (beat.earlierOnCard > 0) {
    const factor = calc.tunable(tunables, 'match.angle.cardRepeatFactor', 'Card repeat factor');
    const applied = factor ** beat.earlierOnCard;
    calc.multiply(
      repeatOnCardLine(beat.repetitionGroup, beat.earlierOnCard, applied),
      applied,
      `${formatNumber(factor)} for each ${beat.repetitionGroup} beat earlier on the card`,
    );
  }
  calc.multiply('Beat weight', beat.weight, 'Set by the beat');
  let weight = beat.weight;
  if (closing) {
    const closingWeight = calc.tunable(
      tunables,
      'match.angle.closingBeatWeight',
      CLOSING_BEAT_LABEL,
    );
    calc.multiply(CLOSING_BEAT_LABEL, closingWeight, 'The last beat counts more');
    weight *= closingWeight;
  }
  return { term: calc.done(), weight };
}

/** Σ(effective weight × effective score) / Σ effective weight. */
export function beatsDelivered(
  beats: readonly AngleScoreBeat[],
  tunables: EngineTunables,
): Traced<number> {
  if (beats.length === 0) {
    throw new InvalidArgumentError('angleScore', 'beats', 0, 'at least one beat');
  }
  const calc = startCalc(BEATS_DELIVERED_LABEL, 0, {
    unit: 'points',
    docRef: ANGLE_SCORE_DOC_REF,
    startLabel: 'Nothing delivered yet',
  });
  let totalWeight = 0;
  for (const [index, beat] of beats.entries()) {
    const { term, weight } = beatTerm(beat, index, index === beats.length - 1, tunables);
    calc.add(`${term.trace.label} × ${formatNumber(weight)}`, term);
    totalWeight += weight;
  }
  return calc
    .divide('Total weight of the beats', totalWeight, 'Delivered is the weighted mean of the beats')
    .done();
}

/** The writing band: at least the floor, at most the ceiling (raised to the floor when below). */
function writingBand(calc: Calc, level: number, tunables: EngineTunables): void {
  const floorPerLevel = calc.tunable(
    tunables,
    'match.angle.writingFloorPerLevel',
    'Floor per level',
  );
  const ceilingAtZero = calc.tunable(
    tunables,
    'match.angle.writingCeilingAtZero',
    'Ceiling with no writing team',
  );
  const ceilingPerLevel = calc.tunable(
    tunables,
    'match.angle.writingCeilingPerLevel',
    'Ceiling per level',
  );
  const floor = level * floorPerLevel;
  let ceiling = ceilingAtZero + level * ceilingPerLevel;
  if (ceiling < floor) {
    calc.note(CEILING_RAISED_NOTE);
    ceiling = floor;
  }
  calc.clamp(floor, ceiling, writingBandLabel(level, floor, ceiling));
}

/** `base`'s own formula continued with the steps `extend` adds, under `label`: no extra level. */
function continueWith(
  base: Traced<number>,
  label: string,
  extend: (calc: Calc) => void,
): Traced<number> {
  const calc = startCalc(label, base, { unit: 'points', docRef: ANGLE_SCORE_DOC_REF });
  extend(calc);
  const result = calc.done();
  const source = base.trace;
  if (source.kind !== 'formula' || source.children.length === 0) {
    return result;
  }
  return traced(result.value, {
    ...source,
    label,
    value: result.value,
    children: [...source.children, ...(result.trace.children ?? []).slice(1)],
  });
}

/**
 * Delivered, the crowd and the angle score. See the file comment for the steps.
 *
 * @throws InvalidArgumentError when there are no beats or the writing level is outside 0..10.
 */
export function angleScoreParts(inputs: AngleScoreInputs, deps: AngleScoreDeps): AngleScoreParts {
  const { tunables } = deps;
  if (
    !Number.isFinite(inputs.writingLevel) ||
    inputs.writingLevel < 0 ||
    inputs.writingLevel > 10
  ) {
    throw new InvalidArgumentError('angleScore', 'writingLevel', inputs.writingLevel, '0 to 10');
  }
  const stage: AngleStageHook =
    deps.stage ??
    ((name, value) =>
      name === 'crowd' ? softCompression({ value, label: 'Crowd' }, { tunables }) : value);

  const delivered = stage('talk', beatsDelivered(inputs.beats, tunables));
  const crowd = stage(
    'crowd',
    crowdScore(
      {
        performance: delivered,
        performanceLabel: BEATS_DELIVERED_LABEL,
        entertainment: inputs.entertainment,
        starPower: inputs.starPower,
        expectation: inputs.expected,
        crowdFactor: ANGLE_CROWD_FACTOR,
        typeName: inputs.typeName,
      },
      deps.rng === undefined ? { tunables } : { tunables, rng: deps.rng },
    ),
  );

  const crowdPart = startCalc("Crowd's share", pruned(crowd), { unit: 'points' });
  const blend = crowdPart.tunable(tunables, 'match.angle.crowdBlend', 'Crowd blend');
  crowdPart.multiply('Crowd blend', blend);
  const deliveredShare = 1 - blend;
  const deliveredPart = startCalc(`${BEATS_DELIVERED_LABEL}' share`, pruned(delivered), {
    unit: 'points',
  }).multiply('What the crowd leaves', deliveredShare);

  const policyBonus =
    inputs.policyBonus ?? constantOf('Score bonus', 0, inputs.policyLabel ?? NO_POLICY_LABEL);
  const calc = startCalc(ANGLE_SCORE_LABEL, 0, {
    unit: 'points',
    docRef: ANGLE_SCORE_DOC_REF,
    startLabel: 'Nothing yet',
  })
    .add(`${BEATS_DELIVERED_LABEL} × ${formatNumber(deliveredShare)}`, deliveredPart.done())
    .add(`Crowd × ${formatNumber(blend)}`, crowdPart.done());
  writingBand(calc, inputs.writingLevel, tunables);
  calc.add(
    `${inputs.policyLabel ?? NO_POLICY_LABEL} ${signedNumber(policyBonus.value)}`,
    policyBonus,
  );

  const compressed = softCompression(
    { value: calc.done(), label: ANGLE_SCORE_LABEL },
    { tunables },
  );
  const score = continueWith(compressed, ANGLE_SCORE_LABEL, (finish) => {
    finish.round('round', 'Rounded to a whole number').clamp(SCORE_MIN, SCORE_MAX);
  });
  return { delivered, crowd, score };
}

/** The angle score, whole, 0..100. See {@link angleScoreParts}. */
export function angleScore(inputs: AngleScoreInputs, deps: AngleScoreDeps): Traced<number> {
  return angleScoreParts(inputs, deps).score;
}
