/**
 * `workers.list`: everyone in the world as one row each, filtered and sorted.
 *
 * Rows carry numbers only, never traces, so a few hundred of them stay small enough to send whole.
 * A number a row shows is explained on demand by `workers.explain`, which runs the same formulas.
 *
 * What a row leaves out is the same for every viewer: development (potential and ceilings), vices,
 * morale and contract terms are never in a row. Push and alignment are public, as on the profile.
 *
 * Design: docs/design/workers.md#workers-list.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { diffDays, type GameDate } from '../../../core/date';
import type { ContinentId, CountryId, PersonId, PromotionId, RegionId } from '../../../core/ids';
import { injuryKindOf } from '../../../model/catalogs';
import type { Alignment, Push } from '../../../model/entities/employment';
import {
  ATTRIBUTE_KEYS,
  type BodyPart,
  GENDERS,
  PERSON_ROLES,
  PERSON_STATUSES,
  RING_STYLES,
  type AttributeKey,
  type Gender,
  type Person,
  type PersonRole,
  type PersonStatus,
  type RingStyle,
} from '../../../model/entities/person';
import { zId } from '../../../model/primitives';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { createPopularityRoller } from '../../world/formulas/popularityRollup';
import { geographyOf } from '../../world/geography';
import { gradeOf, type Grade } from '../formulas/grade';
import { overallOf } from '../formulas/roleRating';
import { ageOn } from '../helpers/age';
import {
  AVAILABILITY_STATUSES,
  availabilityOf,
  type AvailabilityStatus,
} from '../helpers/availability';
import { primaryEmploymentOf } from '../helpers/employment';
import { mainRoleOf, type RatingRole } from '../helpers/roles';

// ---------------------------------------------------------------------------------------------
// Arguments

/** Who a person works for, as a filter. */
export type WorkerEmployerFilter =
  { kind: 'any' } | { kind: 'freeAgent' } | { kind: 'promotion'; promotionId: PromotionId };

/** One "at least this much of this attribute" condition. */
export interface WorkerAttributeMinimum {
  attribute: AttributeKey;
  min: number;
}

/**
 * Every filter is optional, and a person must pass all the ones that are set. A list filter
 * (`roles`, `styles`, ...) passes anyone who matches one of its entries; an empty list is the same
 * as leaving the filter out.
 */
export interface WorkerListFilters {
  /** Anyone who holds one of these roles. */
  roles?: PersonRole[] | undefined;
  statuses?: PersonStatus[] | undefined;
  availability?: AvailabilityStatus[] | undefined;
  genders?: Gender[] | undefined;
  styles?: RingStyle[] | undefined;
  employer?: WorkerEmployerFilter | undefined;
  /** Based in a region of this continent. */
  continentId?: ContinentId | undefined;
  /** Based in a region of this country. */
  countryId?: CountryId | undefined;
  /** Youngest age, in whole years, included. */
  ageMin?: number | undefined;
  /** Oldest age, in whole years, included. */
  ageMax?: number | undefined;
  /** Every condition must hold. */
  attributeMin?: WorkerAttributeMinimum[] | undefined;
  /** The lowest main-role overall, included. */
  overallMin?: number | undefined;
}

/** What a list can be sorted by besides one attribute. */
export const WORKER_SORT_FIELDS = ['overall', 'ringName', 'age', 'popularity', 'employer'] as const;

/** Every sort key: the five fields, then each attribute. */
export const WORKER_SORT_KEYS = [...WORKER_SORT_FIELDS, ...ATTRIBUTE_KEYS] as const;
export type WorkerSortKey = (typeof WORKER_SORT_KEYS)[number];

export const WORKER_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type WorkerSortDirection = (typeof WORKER_SORT_DIRECTIONS)[number];

export interface WorkerListSort {
  key: WorkerSortKey;
  direction: WorkerSortDirection;
}

/** The order of a list nobody asked to sort: best main-role overall first. */
export const DEFAULT_WORKER_SORT: Readonly<WorkerListSort> = Object.freeze({
  key: 'overall',
  direction: 'desc',
});

export interface WorkerListArgs {
  filters?: WorkerListFilters | undefined;
  sort?: WorkerListSort | undefined;
}

const zAge = z.number().int().min(0).max(150);
const zRating = z.number().min(0).max(100);

const zEmployerFilter = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('any') }),
  z.strictObject({ kind: z.literal('freeAgent') }),
  z.strictObject({ kind: z.literal('promotion'), promotionId: zId('promotion') }),
]);

const zWorkerListFilters = z.strictObject({
  roles: z.array(z.enum(PERSON_ROLES)).optional(),
  statuses: z.array(z.enum(PERSON_STATUSES)).optional(),
  availability: z.array(z.enum(AVAILABILITY_STATUSES)).optional(),
  genders: z.array(z.enum(GENDERS)).optional(),
  styles: z.array(z.enum(RING_STYLES)).optional(),
  employer: zEmployerFilter.optional(),
  continentId: zId('continent').optional(),
  countryId: zId('country').optional(),
  ageMin: zAge.optional(),
  ageMax: zAge.optional(),
  attributeMin: z
    .array(z.strictObject({ attribute: z.enum(ATTRIBUTE_KEYS), min: zRating }))
    .optional(),
  overallMin: zRating.optional(),
});

const zWorkerListArgs = z.strictObject({
  filters: zWorkerListFilters.optional(),
  sort: z
    .strictObject({ key: z.enum(WORKER_SORT_KEYS), direction: z.enum(WORKER_SORT_DIRECTIONS) })
    .optional(),
});

// ---------------------------------------------------------------------------------------------
// The result

export interface WorkerRowEmployer {
  promotionId: PromotionId;
  name: string;
  shortName: string;
}

export interface WorkerRowTopPopularity {
  /** 0 to 100, not rounded. */
  value: number;
  countryId: CountryId;
  countryName: string;
}

export interface WorkerRowAvailability {
  status: AvailabilityStatus;
  /** Why, written for the player: "Injured (back injury)". */
  label: string;
  /** The first day back, or null when there is no known end. */
  until: GameDate | null;
}

/** The injury that keeps someone out, on an injured row (WRK6-06). */
export interface WorkerRowInjury {
  /** The catalog's name for it ("Torn ACL"), or the raw key when the catalog no longer has it. */
  label: string;
  bodyPart: BodyPart;
  /** The first day back. */
  expectedReturn: GameDate;
  /** Days from today to the first day back. */
  daysRemaining: number;
}

/** One person in the list. Plain JSON, numbers only. */
export interface WorkerRow {
  personId: PersonId;
  /** The ring name at their main employer, or their own default for a free agent. */
  ringName: string;
  legalName: string;
  /** The stored image reference, or null for none. */
  imageRef: string | null;
  gender: Gender;
  roles: PersonRole[];
  mainRole: RatingRole;
  /** Whole years on the world's current date. */
  age: number;
  style: RingStyle;
  /** The main-role rating, 0 to 100, not rounded. */
  overall: number;
  grade: Grade;
  /** The country they are best known in, or null for someone unknown everywhere. */
  topPopularity: WorkerRowTopPopularity | null;
  /** The whole map's roll-up, 0 to 100, not rounded. */
  worldPopularity: number;
  /** Null for a free agent. */
  employer: WorkerRowEmployer | null;
  /** The card position at the main employer; null for a free agent. */
  push: Push | null;
  /** The alignment at the main employer; null for a free agent. */
  alignment: Alignment | null;
  availability: WorkerRowAvailability;
  /** Set only while availability is `injured`; null otherwise. */
  injury: WorkerRowInjury | null;
}

export interface WorkerListContinentFacet {
  continentId: ContinentId;
  name: string;
}

export interface WorkerListCountryFacet {
  countryId: CountryId;
  name: string;
  continentId: ContinentId;
}

/**
 * What the filter controls can offer: the employers and home places that appear among everyone in
 * the world, before any filter, each sorted by name. They do not shrink as filters are applied, so
 * a control never loses the option it is set to.
 */
export interface WorkerListFacets {
  promotions: WorkerRowEmployer[];
  continents: WorkerListContinentFacet[];
  countries: WorkerListCountryFacet[];
}

/** `workers.list`. */
export interface WorkerList {
  /** The people who passed the filters, sorted. */
  rows: WorkerRow[];
  /** How many people the world holds, before any filter. */
  total: number;
  /** How many of those have no employer, before any filter. */
  freeAgents: number;
  facets: WorkerListFacets;
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'workers.list': { args: WorkerListArgs; result: WorkerList };
  }
}

// ---------------------------------------------------------------------------------------------
// Building it

/** A row with what the filters and the sort read but a row does not carry. */
interface Candidate {
  row: WorkerRow;
  person: Person;
  countryId: CountryId;
  continentId: ContinentId;
}

function legalNameOf(person: Pick<Person, 'givenName' | 'familyName'>): string {
  return person.familyName === '' ? person.givenName : `${person.givenName} ${person.familyName}`;
}

/** True when the filter is unset or empty, or lists `value`. */
function allows<Value>(allowed: readonly Value[] | undefined, value: Value): boolean {
  return allowed === undefined || allowed.length === 0 || allowed.includes(value);
}

function passesEmployer(filter: WorkerEmployerFilter | undefined, row: WorkerRow): boolean {
  if (filter === undefined) {
    return true;
  }
  switch (filter.kind) {
    case 'any':
      return true;
    case 'freeAgent':
      return row.employer === null;
    case 'promotion':
      return row.employer?.promotionId === filter.promotionId;
  }
}

function passes(candidate: Candidate, filters: WorkerListFilters): boolean {
  const { row, person } = candidate;
  const roles = filters.roles ?? [];
  if (roles.length > 0 && !roles.some((role) => person.roles.includes(role))) {
    return false;
  }
  if (
    !allows(filters.statuses, person.status) ||
    !allows(filters.availability, row.availability.status) ||
    !allows(filters.genders, row.gender) ||
    !allows(filters.styles, row.style) ||
    !passesEmployer(filters.employer, row)
  ) {
    return false;
  }
  if (filters.continentId !== undefined && candidate.continentId !== filters.continentId) {
    return false;
  }
  if (filters.countryId !== undefined && candidate.countryId !== filters.countryId) {
    return false;
  }
  if (filters.ageMin !== undefined && row.age < filters.ageMin) {
    return false;
  }
  if (filters.ageMax !== undefined && row.age > filters.ageMax) {
    return false;
  }
  if (filters.overallMin !== undefined && row.overall < filters.overallMin) {
    return false;
  }
  return (filters.attributeMin ?? []).every(
    (minimum) => person.attributes[minimum.attribute] >= minimum.min,
  );
}

/** Lower-cased code-unit order: the same on every machine, and "abel" sorts beside "Abel". */
function compareNames(left: string, right: string): number {
  const leftName = left.toLowerCase();
  const rightName = right.toLowerCase();
  return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
}

type SortValue = number | string | null;

function sortValueOf(candidate: Candidate, key: WorkerSortKey): SortValue {
  const { row, person } = candidate;
  if (key === 'overall') {
    return row.overall;
  }
  if (key === 'ringName') {
    return row.ringName;
  }
  if (key === 'age') {
    return row.age;
  }
  if (key === 'popularity') {
    return row.topPopularity?.value ?? null;
  }
  if (key === 'employer') {
    return row.employer?.name ?? null;
  }
  return person.attributes[key];
}

function compareValues(left: number | string, right: number | string): number {
  if (typeof left === 'string' && typeof right === 'string') {
    return compareNames(left, right);
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Sorts in place. Someone with no value for the key (a free agent's employer, an unknown's top
 * popularity) goes last in both directions. Equal values are ordered by ring name, then by ID,
 * ascending whatever the direction, so the order never depends on how the rows were stored.
 */
function sortCandidates(candidates: Candidate[], sort: WorkerListSort): void {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const keyed = candidates.map((candidate) => ({
    candidate,
    value: sortValueOf(candidate, sort.key),
  }));
  keyed.sort((left, right) => {
    if (left.value === null || right.value === null) {
      if (left.value !== right.value) {
        return left.value === null ? 1 : -1;
      }
    } else {
      const order = compareValues(left.value, right.value);
      if (order !== 0) {
        return order * sign;
      }
    }
    return (
      compareNames(left.candidate.row.ringName, right.candidate.row.ringName) ||
      compareIds(left.candidate.row.personId, right.candidate.row.personId)
    );
  });
  keyed.forEach((entry, index) => {
    candidates[index] = entry.candidate;
  });
}

function byName(left: { readonly name: string }, right: { readonly name: string }): number {
  return compareNames(left.name, right.name) || compareIds(left.name, right.name);
}

/**
 * The list for `args`. One pass over the people in ID order builds every row, with the map's
 * population shares, each region's country and continent and each promotion's names worked out
 * once; the filters and the sort then run over those rows.
 */
export function workerListOf(
  read: GameWorldView,
  args: WorkerListArgs,
  tunables: EngineTunables,
): WorkerList {
  const today = read.meta.currentDate;
  const geography = geographyOf(read);
  const roller = createPopularityRoller(geography);

  const places = new Map<RegionId, { countryId: CountryId; continentId: ContinentId }>();
  const placeOf = (regionId: RegionId): { countryId: CountryId; continentId: ContinentId } => {
    let place = places.get(regionId);
    if (place === undefined) {
      const country = geography.countryOf(regionId);
      place = { countryId: country.id, continentId: country.continentId };
      places.set(regionId, place);
    }
    return place;
  };

  const employers = new Map<PromotionId, WorkerRowEmployer>();
  const employerOf = (promotionId: PromotionId): WorkerRowEmployer => {
    let employer = employers.get(promotionId);
    if (employer === undefined) {
      const promotion = read.tables.promotions.require(promotionId);
      employer = { promotionId, name: promotion.name, shortName: promotion.shortName };
      employers.set(promotionId, employer);
    }
    return employer;
  };

  const homeCountryIds = new Set<CountryId>();
  const homeContinentIds = new Set<ContinentId>();
  const candidates: Candidate[] = [];
  let freeAgents = 0;

  for (const person of read.tables.people.values()) {
    const primary = primaryEmploymentOf(read, person.id, today);
    const mainRole = mainRoleOf(person, primary);
    const overall = overallOf(person, mainRole, { tunables }).value;
    const popularity = roller.rollValues(person.regionalPop);
    const availability = availabilityOf(person, primary, today);
    const place = placeOf(person.basedInRegionId);
    homeCountryIds.add(place.countryId);
    homeContinentIds.add(place.continentId);
    if (primary === null) {
      freeAgents += 1;
    }
    // A copy per row, so no two rows share an object.
    const employer = primary === null ? null : { ...employerOf(primary.promotionId) };

    candidates.push({
      person,
      countryId: place.countryId,
      continentId: place.continentId,
      row: {
        personId: person.id,
        ringName: primary?.ringName ?? person.defaultRingName,
        legalName: legalNameOf(person),
        imageRef: person.imageRef,
        gender: person.gender,
        roles: [...person.roles],
        mainRole,
        age: ageOn(person, today),
        style: person.style,
        overall,
        grade: gradeOf(overall).grade,
        topPopularity:
          popularity.top === null
            ? null
            : {
                value: popularity.top.value,
                countryId: popularity.top.countryId,
                countryName: geography.country(popularity.top.countryId).name,
              },
        worldPopularity: popularity.world,
        employer,
        push: primary?.push ?? null,
        alignment: primary?.alignment ?? null,
        availability: {
          status: availability.status,
          label: availability.reason,
          until: availability.until,
        },
        injury:
          availability.status === 'injured' && person.injury !== null
            ? {
                label: injuryKindOf(read, person.injury.kindKey)?.label ?? person.injury.kindKey,
                bodyPart: person.injury.bodyPart,
                expectedReturn: person.injury.expectedReturn,
                daysRemaining: Math.max(0, diffDays(today, person.injury.expectedReturn)),
              }
            : null,
      },
    });
  }

  const filters = args.filters ?? {};
  const kept = candidates.filter((candidate) => passes(candidate, filters));
  sortCandidates(kept, args.sort ?? DEFAULT_WORKER_SORT);

  return {
    rows: kept.map((candidate) => candidate.row),
    total: candidates.length,
    freeAgents,
    facets: {
      promotions: [...employers.values()].sort(byName),
      continents: geography.continents
        .filter((continent) => homeContinentIds.has(continent.id))
        .map((continent) => ({ continentId: continent.id, name: continent.name }))
        .sort(byName),
      countries: geography.countries
        .filter((country) => homeCountryIds.has(country.id))
        .map((country) => ({
          countryId: country.id,
          name: country.name,
          continentId: country.continentId,
        }))
        .sort(byName),
    },
  };
}

export const listQuery: QueryDefinition<'workers.list'> = defineQuery('workers.list', {
  args: zWorkerListArgs,
  run: (ctx, args) => workerListOf(ctx.read, args, ctx.tunables),
});
