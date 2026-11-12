/**
 * Crowd score: how the crowd reacted, judged against what it expected (D-02).
 *
 * The crowd first sees what was **delivered**: a weighted mean of the performance (work rate for a
 * match, talk for a talking segment), entertainment and star power. It then reacts to the gap
 * between that and what it **expected** (`crowdExpectation`): beating expectation adds to the
 * reaction and missing it takes away. The match type's crowd factor scales the result and an
 * optional roll stands for the crowd on the night.
 *
 * Popularity enters here only through star power, once in delivered and once in the expectation.
 * Soft compression and the final clamp happen in the rater.
 *
 * Design: docs/design/match-rating.md#crowd-and-expectation-d-02.
 */

import { rollNormal } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import { constantOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { EXPECTATION_DOC_REF } from './crowdExpectation';
import { signedNumber, summaryOf } from './shared';
import { NO_VARIANCE_NOTE } from './workRate';

export interface CrowdScoreInputs {
  /** Work rate for a match, talk for a talking segment. Read as one flat line (see `summaryOf`). */
  performance: Traced<number>;
  /** What `performance` is, such as "Work rate" or "Talk". */
  performanceLabel: string;
  /** The side-aggregated entertainment axis of everyone in the segment. */
  entertainment: Traced<number>;
  starPower: Traced<number>;
  /** What the crowd expected (`crowdExpectation`). */
  expectation: Traced<number>;
  /** The match or angle type's `crowdFactor`. */
  crowdFactor: number;
  /** The match or angle type's name, for the crowd factor line. */
  typeName: string;
}

export const CROWD_LABEL = 'Crowd';
export const DELIVERED_LABEL = 'Delivered';
export const CROWD_WEIGHTS_ZERO_NOTE = 'All crowd weights are 0';
export const CROWD_VARIANCE_LABEL = 'Crowd on the night';

const DELIVERED_WEIGHTS = {
  performance: 'match.crowd.performanceWeight',
  entertainment: 'match.crowd.entertainmentWeight',
  star: 'match.crowd.starWeight',
} as const satisfies Readonly<Record<string, NumberTunableKey>>;

const CROWD_FLOOR = 0;

/** One term of delivered: `value × weight`, titled "<label>'s share". */
function weightedTerm(
  label: string,
  value: Traced<number>,
  key: NumberTunableKey,
  tunables: EngineTunables,
): { label: string; term: Traced<number>; weight: number } {
  const calc = startCalc(`${label}'s share`, value, { unit: 'points' });
  const weight = calc.tunable(tunables, key, `${label} weight`);
  calc.multiply('Weight', weight);
  return { label, term: calc.done(), weight };
}

/**
 * Delivered: `(performance × wP + entertainment × wE + starPower × wS) ÷ (wP + wE + wS)`; when the
 * weights add up to 0 it is 0 with the note "All crowd weights are 0".
 */
function delivered(inputs: CrowdScoreInputs, tunables: EngineTunables): Traced<number> {
  const terms = [
    weightedTerm(
      inputs.performanceLabel,
      summaryOf(inputs.performance, inputs.performanceLabel, 'points'),
      DELIVERED_WEIGHTS.performance,
      tunables,
    ),
    weightedTerm('Entertainment', inputs.entertainment, DELIVERED_WEIGHTS.entertainment, tunables),
    weightedTerm('Star power', inputs.starPower, DELIVERED_WEIGHTS.star, tunables),
  ];
  const calc = startCalc(DELIVERED_LABEL, 0, {
    unit: 'points',
    docRef: EXPECTATION_DOC_REF,
    startLabel: 'Nothing delivered yet',
  });
  let weightSum = 0;
  for (const { label, term, weight } of terms) {
    calc.add(`${label} × ${formatNumber(weight)}`, term);
    weightSum += weight;
  }
  if (weightSum === 0) {
    calc.note(CROWD_WEIGHTS_ZERO_NOTE);
  } else {
    calc.divide('Total weight', weightSum);
  }
  return calc.done();
}

/** The reaction to the gap: "Above expectation +6", "Below expectation −4", "Met expectation +0". */
function surpriseLine(surprise: number): string {
  if (signedNumber(surprise) === '+0') {
    return 'Met expectation +0';
  }
  return `${surprise > 0 ? 'Above' : 'Below'} expectation ${signedNumber(surprise)}`;
}

/**
 * The crowd's reaction, floored at 0 and not capped:
 *
 * 1. "Delivered N": the weighted mean of performance, entertainment and star power;
 * 2. "Above/Below expectation ±N": `(delivered − expected) × match.crowd.surpriseWeight`, with the
 *    lines "Delivered N" and "Expected N" inside it;
 * 3. × the type's crowd factor;
 * 4. plus a normal roll with sd `match.crowd.varianceSd` when `deps.rng` is given;
 * 5. at least 0.
 */
export function crowdScore(
  inputs: CrowdScoreInputs,
  deps: { tunables: EngineTunables; rng?: RngStream },
): Traced<number> {
  const { tunables } = deps;
  const deliveredValue = delivered(inputs, tunables);
  const deliveredLine = `${DELIVERED_LABEL} ${formatNumber(deliveredValue.value)}`;

  const gap = startCalc('Surprise', 0, {
    unit: 'points',
    docRef: EXPECTATION_DOC_REF,
    startLabel: 'Nothing yet',
  });
  gap
    .add(deliveredLine, deliveredValue.value)
    .subtract(`Expected ${formatNumber(inputs.expectation.value)}`, inputs.expectation);
  gap.multiply(
    'Surprise weight',
    gap.tunable(tunables, 'match.crowd.surpriseWeight', 'Surprise weight'),
  );
  const surprise = gap.done();

  const calc = startCalc(CROWD_LABEL, 0, {
    unit: 'points',
    docRef: EXPECTATION_DOC_REF,
    startLabel: 'Nothing yet',
  });
  calc
    .add(deliveredLine, deliveredValue)
    .add(surpriseLine(surprise.value), surprise)
    .multiply(
      `${inputs.typeName} crowd factor`,
      constantOf(
        `${inputs.typeName} crowd factor`,
        inputs.crowdFactor,
        `Set by the ${inputs.typeName} type`,
      ),
    );

  if (deps.rng === undefined) {
    calc.note(NO_VARIANCE_NOTE);
  } else {
    const sd = calc.tunable(tunables, 'match.crowd.varianceSd', 'Crowd variance spread');
    const variance = rollNormal(deps.rng, 0, sd, CROWD_VARIANCE_LABEL);
    calc.roll(variance.roll).add(CROWD_VARIANCE_LABEL, variance.value);
  }

  return calc.max('Never below 0', CROWD_FLOOR).done();
}
