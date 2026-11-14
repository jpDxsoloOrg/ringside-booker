/**
 * Market value: what a worker is worth on the open market, in cents a month, before any promotion
 * is named. It moves smoothly with every input (no bands), so one point of popularity never makes
 * a wage jump.
 *
 * 1. Popularity index `Pi = (1 − b) × peak + b × world`, `b` = `contracts.value.breadthWeight`:
 *    the best continent counts most, world-wide breadth the rest.
 * 2. Popularity part: `contracts.value.popScale × (Pi ÷ 100) ^ contracts.value.popExponent`.
 * 3. Skill part: `contracts.value.skillScale × (rating ÷ 100) ^ contracts.value.skillExponent`,
 *    the rating being the worker's role rating in the role they would be hired for.
 * 4. Star merchandise: monthly merchandise sales × `contracts.value.merchShare` (ECO2; until it is
 *    tracked the line is a check that did not apply).
 * 5. Plus `contracts.value.floor`, then × `contracts.value.roleFactor.<role>`, rounded to cents.
 *
 * Design: docs/design/negotiation.md#market-value.
 */

import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { EmploymentRole } from '../../../model/entities/employment';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { MARKET_VALUE_DOC_REF, OUT_OF_100, ROLE_WORDS, wholeText } from './shared';

export interface MarketValueInputs {
  /** Popularity in the worker's best continent, 0-100. */
  readonly peakPop: number;
  /** World-wide popularity, 0-100. */
  readonly worldPop: number;
  /** Role rating in `role`, 0-100. */
  readonly roleRating: number;
  readonly role: EmploymentRole;
  /** Star merchandise sold a month in cents (ECO2), or null while it is not tracked. */
  readonly starMerchMonthly: number | null;
}

export const MERCH_NOT_TRACKED = 'Star merchandise: not tracked yet';

export const ROLE_FACTOR_KEYS = {
  wrestler: 'contracts.value.roleFactor.wrestler',
  manager: 'contracts.value.roleFactor.manager',
  presenter: 'contracts.value.roleFactor.presenter',
  announcer: 'contracts.value.roleFactor.announcer',
  referee: 'contracts.value.roleFactor.referee',
  producer: 'contracts.value.roleFactor.producer',
  booker: 'contracts.value.roleFactor.booker',
} as const satisfies Readonly<Record<EmploymentRole, NumberTunableKey>>;

function popularityIndex(inputs: MarketValueInputs, tunables: EngineTunables): Traced<number> {
  const bestWeight = startCalc('Weight of the best continent', 1, {
    unit: 'ratio',
    docRef: MARKET_VALUE_DOC_REF,
    startLabel: 'All of it',
  });
  bestWeight.subtract(
    'Left for world-wide popularity',
    bestWeight.tunable(tunables, 'contracts.value.breadthWeight'),
  );
  const world = startCalc('World-wide part', inputs.worldPop, {
    unit: 'points',
    docRef: MARKET_VALUE_DOC_REF,
    startLabel: `World-wide popularity ${wholeText(inputs.worldPop)}`,
  });
  world.multiply('Weight of breadth', world.tunable(tunables, 'contracts.value.breadthWeight'));
  return startCalc('Popularity index', inputs.peakPop, {
    unit: 'points',
    docRef: MARKET_VALUE_DOC_REF,
    startLabel: `Best continent ${wholeText(inputs.peakPop)}`,
  })
    .multiply('Weight of the best continent', bestWeight.done())
    .add('World-wide part', world.done())
    .done();
}

function curvePart(
  title: string,
  index: number | Traced<number>,
  tunables: EngineTunables,
  exponentKey: 'contracts.value.popExponent' | 'contracts.value.skillExponent',
  scaleKey: 'contracts.value.popScale' | 'contracts.value.skillScale',
): Traced<number> {
  const calc = startCalc(title, index, {
    unit: 'money',
    docRef: MARKET_VALUE_DOC_REF,
    startLabel: `Rating ${typeof index === 'number' ? wholeText(index) : wholeText(index.value)}`,
  });
  calc.divide('Out of 100', OUT_OF_100);
  calc.power('Curve', calc.tunable(tunables, exponentKey));
  calc.multiply('Value at the top of the scale', calc.tunable(tunables, scaleKey));
  return calc.done();
}

/** A worker's market value in whole cents a month, every step traced. */
export function marketValue(
  inputs: MarketValueInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const roleWord = ROLE_WORDS[inputs.role];
  const popularity = curvePart(
    `Popularity (peak ${wholeText(inputs.peakPop)}, world ${wholeText(inputs.worldPop)})`,
    popularityIndex(inputs, tunables),
    tunables,
    'contracts.value.popExponent',
    'contracts.value.popScale',
  );
  const skill = curvePart(
    `Skill as a ${roleWord}`,
    inputs.roleRating,
    tunables,
    'contracts.value.skillExponent',
    'contracts.value.skillScale',
  );

  const calc = startCalc('Market value', popularity, {
    unit: 'money',
    docRef: MARKET_VALUE_DOC_REF,
  }).add(`Skill as a ${roleWord}`, skill);

  if (inputs.starMerchMonthly === null) {
    calc.branch(MERCH_NOT_TRACKED, false);
  } else {
    const merch = startCalc('Star merchandise', inputs.starMerchMonthly, {
      unit: 'money',
      docRef: MARKET_VALUE_DOC_REF,
      startLabel: 'Merchandise sold a month',
    });
    merch.multiply('Share counted', merch.tunable(tunables, 'contracts.value.merchShare'));
    calc.add('Star merchandise', merch.done());
  }

  calc.add('Base', calc.tunable(tunables, 'contracts.value.floor'));
  calc.multiply(`Role: ${roleWord}`, calc.tunable(tunables, ROLE_FACTOR_KEYS[inputs.role]));
  return calc.round('round', 'To whole cents').done();
}
