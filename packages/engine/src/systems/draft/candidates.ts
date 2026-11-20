/**
 * Draft candidates: everyone a draft could take, with what a draft board reads about them, worked
 * out once per command in one pass (no traces), so a world of thousands of people stays cheap.
 *
 * A candidate is a person who can work (not retired, debuted), in a drafted category: a wrestler
 * (main role wrestler, including occasional wrestlers) or, when staff are drafted, a manager,
 * presenter, announcer, referee or producer. Bookers are never drafted.
 *
 * Design: docs/design/draft.md#candidates.
 */

import { ageInYears, type GameDate } from '../../core/date';
import type { PersonId } from '../../core/ids';
import type { DraftCategory } from '../../model/entities/draft';
import type { EmploymentRole, Push } from '../../model/entities/employment';
import {
  ATTRIBUTE_KEYS,
  type Gender,
  type Person,
  type RingStyle,
} from '../../model/entities/person';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';
import { availabilityOf } from '../workers/helpers/availability';
import { primaryEmploymentOf } from '../workers/helpers/employment';
import { mainRoleOf, type RatingRole } from '../workers/helpers/roles';
import { ratingWeightKey } from '../workers/ratingWeights';
import { createPopularityRoller } from '../world/formulas/popularityRollup';
import { geographyOf } from '../world/geography';
import { draftValueParts, draftValueWeights } from './draftValue';

/** The staff jobs a draft can fill, in the order a staff member's job is chosen. */
export const DRAFT_STAFF_ROLES = [
  'manager',
  'announcer',
  'referee',
  'presenter',
  'producer',
] as const satisfies readonly EmploymentRole[];
export type DraftStaffRole = (typeof DRAFT_STAFF_ROLES)[number];

/** Weight classes as a board groups them, lightest first. */
export const DRAFT_WEIGHT_CLASSES = [
  'lightweight',
  'cruiserweight',
  'lightHeavyweight',
  'heavyweight',
  'superHeavyweight',
] as const;
export type DraftWeightClass = (typeof DRAFT_WEIGHT_CLASSES)[number];

export interface DraftCandidate {
  readonly personId: PersonId;
  readonly name: string;
  readonly gender: Gender;
  readonly weightKg: number;
  readonly weightClass: DraftWeightClass;
  readonly style: RingStyle;
  /** Natural heels lean heel; everyone else face. */
  readonly heel: boolean;
  readonly category: DraftCategory;
  /** The job they are drafted for. */
  readonly role: EmploymentRole;
  readonly age: number;
  readonly rating: number;
  readonly peakPop: number;
  readonly worldPop: number;
  /** Draft value, 0-100. */
  readonly value: number;
  /** Their card position before the draft, or null when they had no wrestling contract. */
  readonly push: Push | null;
}

type RatingWeights = readonly (readonly [number, number])[];

function weightsFor(role: RatingRole, tunables: EngineTunables): RatingWeights {
  return ATTRIBUTE_KEYS.map(
    (attribute, index) => [index, tunables.get(ratingWeightKey(role, attribute))] as const,
  ).filter(([, weight]) => weight > 0);
}

/** `roleRating` without the trace: the weighted mean of the counted attributes, 0-100. */
function ratingOf(person: DeepReadonly<Person>, weights: RatingWeights): number {
  let total = 0;
  let totalWeight = 0;
  for (const [index, weight] of weights) {
    const attribute = ATTRIBUTE_KEYS[index];
    if (attribute === undefined) {
      continue;
    }
    total += person.attributes[attribute] * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, total / totalWeight));
}

/** Weight class limits, lightest first (the workers' `workers.weightClass.*MaxKg`). */
function weightLimits(tunables: EngineTunables): readonly number[] {
  return [
    tunables.get('workers.weightClass.lightweightMaxKg'),
    tunables.get('workers.weightClass.cruiserweightMaxKg'),
    tunables.get('workers.weightClass.lightHeavyweightMaxKg'),
    tunables.get('workers.weightClass.heavyweightMaxKg'),
  ];
}

export function weightClassOf(weightKg: number, limits: readonly number[]): DraftWeightClass {
  for (let index = 0; index < limits.length; index += 1) {
    const limit = limits[index];
    if (limit !== undefined && weightKg <= limit) {
      return DRAFT_WEIGHT_CLASSES[index] ?? 'superHeavyweight';
    }
  }
  return 'superHeavyweight';
}

function staffRoleOf(person: DeepReadonly<Person>): DraftStaffRole | null {
  return DRAFT_STAFF_ROLES.find((role) => person.roles.includes(role)) ?? null;
}

export interface CandidateOptions {
  readonly date: GameDate;
  readonly draftStaff: boolean;
  /** Leave out people with a live contract. True on a running draft (the pool). */
  readonly onlyUnsigned: boolean;
  /** Only these people, when set. */
  readonly only?: ReadonlySet<PersonId>;
}

/** True when the person has a signed, offered or active contract. */
function hasLiveContract(read: GameWorldView, personId: PersonId): boolean {
  return read.tables.employments
    .lookup('byPerson', personId)
    .some((row) => row.status === 'active' || row.status === 'signed' || row.status === 'offered');
}

/**
 * Every candidate, sorted by draft value (highest first), then by id. One pass over the people
 * table; the popularity roll-up and the rating weights are read once.
 */
export function draftCandidates(
  read: GameWorldView,
  tunables: EngineTunables,
  options: CandidateOptions,
): DraftCandidate[] {
  const roller = createPopularityRoller(geographyOf(read));
  const valueWeights = draftValueWeights(tunables);
  const limits = weightLimits(tunables);
  const ratingWeights = new Map<RatingRole, RatingWeights>();
  const weightsOf = (role: RatingRole): RatingWeights => {
    let weights = ratingWeights.get(role);
    if (weights === undefined) {
      weights = weightsFor(role, tunables);
      ratingWeights.set(role, weights);
    }
    return weights;
  };
  const candidates: DraftCandidate[] = [];
  const people = options.only === undefined ? read.tables.people.values() : null;
  const list =
    people ??
    [...(options.only ?? [])]
      .map((id) => read.tables.people.get(id))
      .filter((person): person is NonNullable<typeof person> => person !== undefined);
  for (const person of list) {
    const availability = availabilityOf(person, null, options.date);
    if (availability.status === 'retired' || availability.status === 'notDebuted') {
      continue;
    }
    if (options.onlyUnsigned && hasLiveContract(read, person.id)) {
      continue;
    }
    const primary = primaryEmploymentOf(read, person.id, options.date);
    if (primary?.role === 'booker') {
      continue;
    }
    const mainRole = mainRoleOf(person, primary);
    let category: DraftCategory;
    let role: EmploymentRole;
    if (mainRole === 'wrestler') {
      category = 'wrestler';
      role = 'wrestler';
    } else {
      if (!options.draftStaff) {
        continue;
      }
      const staffRole =
        DRAFT_STAFF_ROLES.find((candidate) => candidate === mainRole) ?? staffRoleOf(person);
      if (staffRole === null) {
        continue;
      }
      category = 'staff';
      role = staffRole;
    }
    const rating = ratingOf(person, weightsOf(role));
    const popularity = roller.rollValues(person.regionalPop);
    const peakPop = popularity.top?.value ?? 0;
    const worldPop = popularity.world;
    const age = ageInYears(person.birthDate, options.date);
    const value = draftValueParts(
      { roleRating: rating, peakPop, worldPop, age },
      valueWeights,
    ).value;
    candidates.push({
      personId: person.id,
      name: primary?.ringName ?? person.defaultRingName,
      gender: person.gender,
      weightKg: person.weightKg,
      weightClass: weightClassOf(person.weightKg, limits),
      style: person.style,
      heel: person.traits.includes('naturalHeel'),
      category,
      role,
      age,
      rating,
      peakPop,
      worldPop,
      value,
      push: primary !== null && primary.role === 'wrestler' ? primary.push : null,
    });
  }
  return candidates.sort(compareCandidates);
}

/** Highest value first, then by id: the order every board breaks ties in. */
export function compareCandidates(left: DraftCandidate, right: DraftCandidate): number {
  return right.value - left.value || compareIds(left.personId, right.personId);
}
