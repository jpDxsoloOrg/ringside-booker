/**
 * Card value: how much a worker is worth to one promotion, 0-100.
 *
 * It counts the worker's popularity only in the promotion's own markets (D-03: popularity is per
 * region, so a star abroad is worth little to a regional company), blends their attributes by the
 * promotion's taste, adds momentum and adjusts for age. AIP3 ranks pushes by it, AIP4 orders
 * cards, ECO6 hires with it and ECO9 ranks budget cuts.
 *
 * Ring style is bonus-only: the taste decides how much each attribute group counts, and every line
 * of the blend is a group's score times a taste weight of 0 or more. Nothing is taken away for a
 * worker whose strengths the promotion does not favour.
 *
 * Design: docs/design/rival-desk.md#card-value.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { constantOf, startCalc, type Traced } from '../../../core/trace';
import type { AttributeKey, Attributes } from '../../../model/entities/person';
import type { EngineTunables } from '../../tunables';
import { ATTRIBUTE_LABELS, formatNumber } from '../../world/people/labels';
import {
  fanBaseOf,
  FOOTPRINT_TRACE_TOP_REGIONS,
  type FanBase,
  type FootprintRegion,
  type FootprintRegionalPop,
} from '../../workers/formulas/footprintPopularity';
import { CARD_VALUE_DOC_REF } from '../cardValueTunables';
import { TASTE_AXIS_LABELS, type TasteAxis } from '../taste';
import { TASTE_MAX, type TracedTaste } from './defaultTaste';

/**
 * What card value reads. Later features (AIP2's booker taste, AIP3's featured boost) add optional
 * fields, so callers build it as an object literal and never spread a closed type into it.
 */
export interface CardValueInputs {
  workerName: string;
  promotionName: string;
  workerPop: FootprintRegionalPop;
  promotionPop: FootprintRegionalPop;
  regions: readonly FootprintRegion[];
  attributes: Attributes;
  /** The worker's momentum at the promotion; null before they have any (WRK5). */
  momentum: number | null;
  /** Age in whole years. */
  age: number;
  taste: TracedTaste;
}

/** The ends of the card value scale. */
export const CARD_VALUE_MIN = 0;
export const CARD_VALUE_MAX = 100;

/** One attribute group the blend weighs, and the taste axis that weighs it. */
interface AttributeGroup {
  readonly label: string;
  readonly axis: TasteAxis;
  readonly attributes: readonly AttributeKey[];
}

/** The groups, in the order the Why? lists them. */
export const CARD_VALUE_GROUPS: readonly AttributeGroup[] = [
  {
    label: 'Ring work group',
    axis: 'wrestlingFocus',
    attributes: ['ringwork', 'psychology', 'stamina', 'safety'],
  },
  { label: 'Character group', axis: 'entertainmentFocus', attributes: ['mic', 'charisma'] },
  { label: 'Athleticism', axis: 'athleticFocus', attributes: ['athleticism'] },
  { label: 'Presence', axis: 'starFocus', attributes: ['presence'] },
];

export const NO_MOMENTUM_LABEL = 'No momentum yet';
export const PRIME_AGE_NOTE = 'Prime age, no change';
export const NO_TASTE_NOTE = 'Every taste weight in the blend is 0, so the blend is 0';
export const NO_WEIGHTS_NOTE =
  'The popularity and ability weights are both 0, so the base value is 0';

/** "<promotion> has no fans yet". */
export function noFansNote(promotionName: string): string {
  return `${promotionName} has no fans yet`;
}

/** Fans in thousands or millions, for a trace line. */
function formatFans(weight: number): string {
  if (weight >= 1_000_000) {
    return `${formatNumber(weight / 1_000_000)} million`;
  }
  if (weight >= 1_000) {
    return `${formatNumber(weight / 1_000)} thousand`;
  }
  return formatNumber(weight);
}

/**
 * The worker's popularity in the promotion's markets: `Σ weight × popularity ÷ Σ weight` over the
 * regions where the promotion has at least `aip.cardValue.marketMinPop` popularity, each weighted
 * by `population × promotion popularity ÷ 100` (the shared fan-base rule, `fanBaseOf`). When no
 * region reaches the minimum, every region the promotion is known in counts; with none, 0.
 *
 * Card value's first step; AIP5's title decisions also read it on its own for each challenger.
 */
export function marketPopularity(
  inputs: Pick<CardValueInputs, 'promotionName' | 'workerPop' | 'promotionPop' | 'regions'>,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(`Popularity in ${inputs.promotionName}'s markets`, 0, {
    unit: 'points',
    docRef: CARD_VALUE_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  const minPop = calc.tunable(
    tunables,
    'aip.cardValue.marketMinPop',
    'Popularity a region needs to be a market',
  );
  const fanBase = fanBaseOf(inputs.promotionPop, inputs.regions, minPop);
  if (fanBase.members.length === 0) {
    return calc.note(noFansNote(inputs.promotionName)).done();
  }
  const count = fanBase.members.length;
  const regionWord = count === 1 ? 'region' : 'regions';
  calc.note(
    fanBase.widened
      ? `${inputs.promotionName} has not reached ${formatNumber(minPop)} popularity anywhere, so all ${String(count)} ${regionWord} it is known in count`
      : `Markets: ${String(count)} ${regionWord} where ${inputs.promotionName} has at least ${formatNumber(minPop)} popularity`,
  );
  let totalWeight = 0;
  let restWeighted = 0;
  for (const [index, member] of fanBase.members.entries()) {
    totalWeight += member.weight;
    const popularity = inputs.workerPop[member.region.id] ?? 0;
    if (index < FOOTPRINT_TRACE_TOP_REGIONS) {
      calc.add(
        `${member.region.name}: popularity ${formatNumber(popularity)} × ${formatFans(member.weight)} fans`,
        member.weight * popularity,
      );
    } else {
      restWeighted += member.weight * popularity;
    }
  }
  const restCount = count - FOOTPRINT_TRACE_TOP_REGIONS;
  if (restCount > 0) {
    calc.add(
      restCount === 1 ? '1 other market' : `${String(restCount)} other markets`,
      restWeighted,
    );
  }
  return calc.divide(`All fans: ${formatFans(totalWeight)}`, totalWeight).done();
}

/** The mean of a group's attributes. */
function groupScore(group: AttributeGroup, attributes: Attributes): Traced<number> {
  const calc = startCalc(group.label, 0, { unit: 'points', startLabel: 'Nothing counted yet' });
  for (const attribute of group.attributes) {
    calc.add(
      `${ATTRIBUTE_LABELS[attribute]} ${formatNumber(attributes[attribute])}`,
      attributes[attribute],
    );
  }
  if (group.attributes.length > 1) {
    calc.divide(
      'Mean of the group',
      constantOf(
        'Attributes in the group',
        group.attributes.length,
        'A group counts as the mean of its attributes',
      ),
    );
  }
  return calc.done();
}

/**
 * The worker's ability as the promotion sees it: `Σ taste × group ÷ Σ taste` over the four groups.
 * A taste weight of 0 leaves its group out; all four at 0 give 0.
 */
function attributeBlend(inputs: CardValueInputs): Traced<number> {
  const { taste } = inputs;
  const calc = startCalc(`Ability as ${inputs.promotionName} sees it`, 0, {
    unit: 'points',
    docRef: CARD_VALUE_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  let totalTaste = 0;
  for (const group of CARD_VALUE_GROUPS) {
    const weight = taste.values[group.axis];
    if (weight <= 0) {
      continue;
    }
    const score = groupScore(group, inputs.attributes);
    const weighted = startCalc(`${group.label} weighted by taste`, score)
      .multiply(`${taste.label}: ${TASTE_AXIS_LABELS[group.axis]}`, {
        value: weight,
        trace: taste.traces[group.axis],
      })
      .done();
    calc.add(
      `${group.label} ${formatNumber(score.value)} × ${taste.label} ${formatNumber(weight)}`,
      weighted,
    );
    totalTaste += weight;
  }
  if (totalTaste <= 0) {
    return calc.note(NO_TASTE_NOTE).done();
  }
  return calc.divide(`Total taste ${formatNumber(totalTaste)}`, totalTaste).done();
}

/** One side of the base value: a traced score times its weight tunable. */
function weightedPart(
  label: string,
  score: Traced<number>,
  tunables: EngineTunables,
  key: 'aip.cardValue.popularityWeight' | 'aip.cardValue.abilityWeight',
): { part: Traced<number>; weight: number } {
  const calc = startCalc(label, score, { unit: 'points' });
  const weight = calc.tunable(tunables, key);
  calc.multiply(`Weight ${formatNumber(weight)}`, weight);
  return { part: calc.done(), weight };
}

/** The age factor of a worker past the decline age: `max(floor, 1 − years past × per year)`. */
function ageFactor(age: number, declineAge: number, tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Age factor', 1, { unit: 'multiplier', startLabel: 'No change' });
  const perYear = calc.tunable(tunables, 'aip.cardValue.declinePerYear');
  const years = age - declineAge;
  calc.subtract(
    `${formatNumber(years)} ${years === 1 ? 'year' : 'years'} past ${formatNumber(declineAge)} × ${formatNumber(perYear)}`,
    years * perYear,
  );
  const floor = calc.tunable(tunables, 'aip.cardValue.ageFloor');
  return calc.max('Never below the age floor', floor).done();
}

/** The youth bonus: `youth focus ÷ 100 × aip.cardValue.youthBonus`. */
function youthBonus(taste: TracedTaste, tunables: EngineTunables): Traced<number> {
  const calc = startCalc(
    'Youth bonus',
    { value: taste.values.youthFocus, trace: taste.traces.youthFocus },
    { unit: 'points' },
  );
  calc.divide(
    'As a share of the taste scale',
    constantOf('Top of the taste scale', TASTE_MAX, 'Taste axes run from 0 to 100'),
  );
  const bonus = calc.tunable(tunables, 'aip.cardValue.youthBonus');
  return calc.multiply(`Youth bonus ${formatNumber(bonus)}`, bonus).done();
}

/**
 * A worker's card value at a promotion:
 *
 * 1. market popularity `M` (popularity in the promotion's markets only);
 * 2. attribute blend `B`, the four groups weighted by the promotion's taste;
 * 3. base `(popularityWeight × M + abilityWeight × B) ÷ (popularityWeight + abilityWeight)`;
 * 4. `+ momentum × momentumFactor` (nothing while momentum is null);
 * 5. past `declineAge`, `× max(ageFloor, 1 − years past × declinePerYear)`; under `youthAge`,
 *    `+ youthFocus ÷ 100 × youthBonus`;
 * 6. kept within 0-100. Not rounded: screens round.
 */
export function cardValue(
  inputs: CardValueInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(`Card value at ${inputs.promotionName}`, 0, {
    unit: 'points',
    docRef: CARD_VALUE_DOC_REF,
    startLabel: 'Nothing counted yet',
  });

  const market = weightedPart(
    'Market popularity',
    marketPopularity(inputs, { tunables }),
    tunables,
    'aip.cardValue.popularityWeight',
  );
  const ability = weightedPart(
    'Ability blend',
    attributeBlend(inputs),
    tunables,
    'aip.cardValue.abilityWeight',
  );
  calc.add('Market popularity', market.part).add('Ability blend', ability.part);
  const totalWeight = market.weight + ability.weight;
  if (totalWeight <= 0) {
    calc.note(NO_WEIGHTS_NOTE);
  } else {
    calc.divide(`Total weight ${formatNumber(totalWeight)}`, totalWeight);
  }

  if (inputs.momentum === null) {
    calc.note(`${NO_MOMENTUM_LABEL}: +0`);
  } else {
    const factor = calc.tunable(tunables, 'aip.cardValue.momentumFactor');
    calc.add(
      `Momentum ${formatNumber(inputs.momentum)} × ${formatNumber(factor)}`,
      inputs.momentum * factor,
    );
  }

  const declineAge = calc.tunable(tunables, 'aip.cardValue.declineAge');
  const youthAge = calc.tunable(tunables, 'aip.cardValue.youthAge');
  const ageText = `Age ${formatNumber(inputs.age)}`;
  if (inputs.age > declineAge) {
    calc.multiply(
      `${ageText}: past ${formatNumber(declineAge)}`,
      ageFactor(inputs.age, declineAge, tunables),
    );
  } else if (inputs.age < youthAge) {
    calc.add(`${ageText}: under ${formatNumber(youthAge)}`, youthBonus(inputs.taste, tunables));
  } else {
    calc.note(`${ageText}: ${PRIME_AGE_NOTE}`);
  }

  return calc.clamp(CARD_VALUE_MIN, CARD_VALUE_MAX).done();
}

/** `-0` read as `0`, as every step of a traced calculation does. */
function plain(value: number): number {
  return value === 0 ? 0 : value;
}

/** {@link marketPopularity}'s number alone, from a fan base already worked out. */
function marketPopularityNumber(workerPop: FootprintRegionalPop, fanBase: FanBase): number {
  if (fanBase.members.length === 0) {
    return 0;
  }
  let value = 0;
  let totalWeight = 0;
  let restWeighted = 0;
  for (const [index, member] of fanBase.members.entries()) {
    totalWeight += member.weight;
    const popularity = workerPop[member.region.id] ?? 0;
    if (index < FOOTPRINT_TRACE_TOP_REGIONS) {
      value = plain(value + plain(member.weight * popularity));
    } else {
      restWeighted += member.weight * popularity;
    }
  }
  if (fanBase.members.length > FOOTPRINT_TRACE_TOP_REGIONS) {
    value = plain(value + plain(restWeighted));
  }
  return plain(value / plain(totalWeight));
}

/** {@link attributeBlend}'s number alone. */
function attributeBlendNumber(attributes: Attributes, taste: TracedTaste): number {
  let value = 0;
  let totalTaste = 0;
  for (const group of CARD_VALUE_GROUPS) {
    const weight = taste.values[group.axis];
    if (weight <= 0) {
      continue;
    }
    let score = 0;
    for (const attribute of group.attributes) {
      score = plain(score + plain(attributes[attribute]));
    }
    if (group.attributes.length > 1) {
      score = plain(score / group.attributes.length);
    }
    value = plain(value + plain(score * plain(weight)));
    totalTaste += weight;
  }
  return totalTaste <= 0 ? value : plain(value / plain(totalTaste));
}

/** The promotion's fan base as card value counts it, for {@link cardValueNumber}'s `shared`. */
export function cardValueFanBase(
  inputs: Pick<CardValueInputs, 'promotionPop' | 'regions'>,
  deps: { tunables: EngineTunables },
): FanBase {
  return fanBaseOf(
    inputs.promotionPop,
    inputs.regions,
    deps.tunables.get('aip.cardValue.marketMinPop'),
  );
}

/**
 * {@link cardValue}'s number with no trace (POL4-09): the same steps in the same order, so the
 * value is identical to the bit. A rival books every show from its whole roster's card values and
 * never shows their Why?, which `cardValue` still builds when a screen asks. Pass the promotion's
 * fan base (`cardValueFanBase`) when working out a whole roster, so it is found once.
 */
export function cardValueNumber(
  inputs: CardValueInputs,
  deps: { tunables: EngineTunables },
  shared: { readonly fanBase?: FanBase } = {},
): number {
  const { tunables } = deps;
  const fanBase = shared.fanBase ?? cardValueFanBase(inputs, deps);
  const popularityWeight = tunables.get('aip.cardValue.popularityWeight');
  const abilityWeight = tunables.get('aip.cardValue.abilityWeight');
  const market = plain(
    plain(marketPopularityNumber(inputs.workerPop, fanBase)) * plain(popularityWeight),
  );
  const ability = plain(
    plain(attributeBlendNumber(inputs.attributes, inputs.taste)) * plain(abilityWeight),
  );
  let value = plain(plain(0 + market) + ability);
  const totalWeight = popularityWeight + abilityWeight;
  if (totalWeight > 0) {
    value = plain(value / plain(totalWeight));
  }
  if (inputs.momentum !== null) {
    value = plain(value + plain(inputs.momentum * tunables.get('aip.cardValue.momentumFactor')));
  }
  const declineAge = tunables.get('aip.cardValue.declineAge');
  if (inputs.age > declineAge) {
    const years = inputs.age - declineAge;
    const factor = plain(
      Math.max(
        plain(1 - plain(years * tunables.get('aip.cardValue.declinePerYear'))),
        plain(tunables.get('aip.cardValue.ageFloor')),
      ),
    );
    value = plain(value * factor);
  } else if (inputs.age < tunables.get('aip.cardValue.youthAge')) {
    const share = plain(plain(inputs.taste.values.youthFocus) / TASTE_MAX);
    value = plain(value + plain(share * plain(tunables.get('aip.cardValue.youthBonus'))));
  }
  if (!Number.isFinite(value)) {
    throw new InvalidArgumentError(
      'cardValueNumber',
      'inputs',
      value,
      'inputs with a finite value',
    );
  }
  return plain(Math.min(Math.max(value, CARD_VALUE_MIN), CARD_VALUE_MAX));
}
