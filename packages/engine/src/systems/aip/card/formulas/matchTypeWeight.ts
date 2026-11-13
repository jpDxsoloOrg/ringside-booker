/**
 * Match type weight: how likely a rival is to pick one match type for a filler match tonight, in
 * points. The planner rolls over every fitting type with these weights.
 *
 * ```
 * base       = aip.card.typeWeight.<family>
 * poolFactor = clamp(freeWrestlers ÷ (peopleNeeded × aip.card.poolComfort), 0, 1)
 *              when freeWrestlers ≥ peopleNeeded, else 0
 * tasteFactor = 1 for one-on-one, else 0.5 + riskAppetite ÷ 100
 * teamFactor = aip.card.noTeamFactor for tag and trios with fewer than two free teams, else 1
 * weight     = base × poolFactor × tasteFactor × teamFactor
 * ```
 *
 * Exactly enough free wrestlers at the default comfort of 2 halves the weight; a big roster gives
 * the full weight. A booker who likes risk (riskAppetite above 50) books more unusual matches.
 *
 * Design: docs/design/rival-booking.md#match-types.
 */

import { constantOf, inputOf, startCalc, type Traced } from '../../../../core/trace';
import type { MatchTypeDef } from '../../../../model/catalogs';
import type { EngineTunables } from '../../../tunables';
import { formatNumber } from '../../../world/people/labels';
import { MATCH_TYPES_DOC_REF, typeWeightKey, type MatchFamily } from '../tunables';

/** How the trace names each family. */
export const MATCH_FAMILY_LABELS: Readonly<Record<MatchFamily, string>> = {
  oneOnOne: 'one-on-one',
  tag: 'tag team',
  trios: 'trios',
  multiWay: 'multi-way',
  other: 'unusual',
};

export interface MatchTypeWeightInputs {
  /** The match type's name, for the trace's title. */
  typeName: string;
  family: MatchFamily;
  /** Wrestlers one match of this type takes. */
  peopleNeeded: number;
  /** Wrestlers still free to wrestle tonight. */
  freeWrestlers: number;
  /** Free teams of the type's side size (tag or trios); ignored for other families. */
  freeTeams: number;
  /**
   * The booker's risk appetite, 0-100 (`TracedTaste.values.riskAppetite`). Pass the traced axis
   * to keep where it came from in the Why?.
   */
  riskAppetite: number | Traced<number>;
}

/**
 * The family of a match type, from its shape: 2 sides of 1 is one-on-one, 2 of 2 tag, 2 of 3
 * trios, a fixed 3 or more sides of 1 multi-way, anything else (handicap, battle royal) other.
 */
export function matchFamilyOf(type: Pick<MatchTypeDef, 'sides' | 'sideSize'>): MatchFamily {
  const { sides, sideSize } = type;
  const fixedSides = sides.min === sides.max;
  const fixedSize = sideSize.min === sideSize.max;
  if (!fixedSides || !fixedSize) {
    return 'other';
  }
  if (sides.min === 2) {
    switch (sideSize.min) {
      case 1:
        return 'oneOnOne';
      case 2:
        return 'tag';
      case 3:
        return 'trios';
      default:
        return 'other';
    }
  }
  return sides.min >= 3 && sideSize.min === 1 ? 'multiWay' : 'other';
}

/** "Only 3 free wrestlers, needs 4" or "8 free wrestlers, needs 4". */
export function freeWrestlersText(free: number, needed: number): string {
  const counted = `${String(free)} free ${free === 1 ? 'wrestler' : 'wrestlers'}, needs ${String(needed)}`;
  return free < needed ? `Only ${counted}` : counted;
}

/** "Booker's taste for unusual matches (70)". */
export function unusualTasteText(risk: number): string {
  return `Booker's taste for unusual matches (${formatNumber(risk)})`;
}

/** "Fewer than two free teams (1)". */
export function fewTeamsText(teams: number): string {
  return `Fewer than two free teams (${String(teams)})`;
}

function poolFactorOf(inputs: MatchTypeWeightInputs, tunables: EngineTunables): Traced<number> {
  const calc = startCalc(
    'Room on the roster',
    inputOf('Free wrestlers', inputs.freeWrestlers, undefined, 'count'),
    { unit: 'ratio' },
  );
  calc
    .divide(
      'Over the wrestlers needed',
      inputOf('Wrestlers the match needs', inputs.peopleNeeded, undefined, 'count'),
    )
    .divide('Over the comfortable margin', calc.tunable(tunables, 'aip.card.poolComfort'));
  return calc.clamp(0, 1, 'Full weight at a comfortable margin').done();
}

function tasteFactorOf(risk: Traced<number>): Traced<number> {
  return startCalc('Taste factor', risk, { unit: 'multiplier' })
    .divide('Over 100', constantOf('Taste scale', 100, 'Taste runs from 0 to 100'))
    .add(
      'Plus a half',
      constantOf('Half weight at taste 0', 0.5, 'Taste 0 halves the weight, taste 100 adds half'),
    )
    .done();
}

/** The type's weight tonight. See the module comment for the formula. */
export function matchTypeWeight(
  inputs: MatchTypeWeightInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const { family } = inputs;
  const calc = startCalc(`Weight of ${inputs.typeName}`, 0, {
    unit: 'points',
    docRef: MATCH_TYPES_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  calc.add(`A ${MATCH_FAMILY_LABELS[family]} match`, calc.tunable(tunables, typeWeightKey(family)));

  const label = freeWrestlersText(inputs.freeWrestlers, inputs.peopleNeeded);
  if (inputs.freeWrestlers < inputs.peopleNeeded) {
    calc.multiply(label, 0, 'Not enough free wrestlers for this match');
  } else {
    calc.multiply(label, poolFactorOf(inputs, tunables));
  }

  if (family !== 'oneOnOne') {
    const risk =
      typeof inputs.riskAppetite === 'number'
        ? inputOf("Booker's risk appetite", inputs.riskAppetite, undefined, 'points')
        : inputs.riskAppetite;
    calc.multiply(unusualTasteText(risk.value), tasteFactorOf(risk));
  }

  if ((family === 'tag' || family === 'trios') && inputs.freeTeams < 2) {
    calc.multiply(
      fewTeamsText(inputs.freeTeams),
      calc.tunable(tunables, 'aip.card.noTeamFactor'),
      'Without two teams the sides are paired for tonight',
    );
  }
  return calc.done();
}
