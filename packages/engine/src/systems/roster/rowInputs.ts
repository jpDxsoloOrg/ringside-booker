/**
 * What one roster row is worked out from, and the traced formulas behind its derived numbers.
 *
 * `buildRosterRows` and `roster.explain` both start from {@link rowInputs} and run the formulas
 * below, so a cell and its Why? use the same inputs and the same code and cannot drift apart. The
 * formulas are pure and roll no dice, which is what makes rebuilding a Why? on demand exact.
 *
 * Design: docs/design/roster.md#roster-explain.
 */

import type { GameDate } from '../../core/date';
import type { Traced } from '../../core/trace';
import type { Employment, EmploymentRole, Push } from '../../model/entities/employment';
import type { Person } from '../../model/entities/person';
import type { Promotion } from '../../model/entities/promotion';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { geographyOf } from '../world/geography';
import { expectedPush, type ExpectedPushInputs } from '../workers/formulas/expectedPush';
import {
  footprintPopularity,
  type FootprintPopularityInputs,
  type FootprintRegion,
} from '../workers/formulas/footprintPopularity';
import { overallOf } from '../workers/formulas/roleRating';
import { ageOn } from '../workers/helpers/age';
import { availabilityOf, type Availability } from '../workers/helpers/availability';
import { computePushGap } from './formulas/pushGap';
import { computePushVerdict, type PushVerdict } from './formulas/pushVerdict';
import { roleHasPush } from './roleGroups';

/** Everything a roster row's derived values are worked out from. */
export interface RosterRowInputs {
  employment: Employment;
  person: Person;
  promotion: Promotion;
  /** The contracted role, which the overall is rated in. */
  role: EmploymentRole;
  /** What the expected push reads; null for a role with no card position. */
  expectedPush: ExpectedPushInputs | null;
  /** What popularity among the promotion's fans reads. */
  popularity: FootprintPopularityInputs;
  /** Whole years on the date. */
  age: number;
  availability: Availability;
}

interface FormulaDeps {
  tunables: EngineTunables;
}

/**
 * The inputs of `employment`'s row on `date`. `regions` may be passed in when many rows are built
 * at once, so the map is read once; it must be `geographyOf(read).regions`. Throws
 * `EntityNotFoundError` when the person or promotion is missing.
 */
export function rowInputs(
  read: GameWorldView,
  employment: Employment,
  date: GameDate,
  regions: readonly FootprintRegion[] = geographyOf(read).regions,
): RosterRowInputs {
  const person = read.tables.people.require(employment.personId);
  const promotion = read.tables.promotions.require(employment.promotionId);
  return {
    employment,
    person,
    promotion,
    role: employment.role,
    expectedPush: roleHasPush(employment.role)
      ? {
          employmentRole: employment.role,
          workerPop: person.regionalPop,
          promotionPop: promotion.regionalPop,
          promotionName: promotion.name,
          regions,
        }
      : null,
    popularity: {
      subjectPop: person.regionalPop,
      promotionPop: promotion.regionalPop,
      promotionName: promotion.name,
      regions,
    },
    age: ageOn(person, date),
    availability: availabilityOf(person, employment, date),
  };
}

/** The rating in the contracted role, unrounded. */
export function rowOverall(inputs: RosterRowInputs, deps: FormulaDeps): Traced<number> {
  return overallOf(inputs.person, inputs.role, deps);
}

/** The push they expect here, or null for a role with no card position. */
export function rowExpectedPush(inputs: RosterRowInputs, deps: FormulaDeps): Traced<Push> | null {
  return inputs.expectedPush === null ? null : expectedPush(inputs.expectedPush, deps);
}

/** The push gap and its verdict, or null for a role with no card position. */
export function rowPushGap(
  inputs: RosterRowInputs,
  deps: FormulaDeps,
): { expected: Traced<Push>; gap: Traced<number>; verdict: Traced<PushVerdict> } | null {
  const expected = rowExpectedPush(inputs, deps);
  if (expected === null) {
    return null;
  }
  const gap = computePushGap({ push: inputs.employment.push, expected }, deps);
  return { expected, gap, verdict: computePushVerdict(gap, deps) };
}

/**
 * Popularity among the promotion's fans, with its trace. The rows use the untraced
 * `footprintPopularityValue` on the same inputs, which adds up the same numbers in the same order.
 */
export function rowPopularity(inputs: RosterRowInputs, deps: FormulaDeps): Traced<number> {
  return footprintPopularity(inputs.popularity, deps);
}

/** How a roster shows a rating or popularity: to 1 decimal. */
export function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
