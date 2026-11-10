/**
 * The workers list's filters and sort, as they live in the URL: `?employer=free&sort=age:desc`.
 *
 * The URL is the only place they are kept, so Back and Forward, a reload and the profile's "Back
 * to Workers" link all return to the same list. A parameter that is missing, or that this build
 * does not understand, counts as "no filter"; the default sort is never written.
 */
import {
  ATTRIBUTE_KEYS,
  AVAILABILITY_STATUSES,
  GENDERS,
  isId,
  PERSON_ROLES,
  RING_STYLES,
} from '@ringside/engine';
import type {
  AttributeKey,
  AvailabilityStatus,
  ContinentId,
  CountryId,
  Gender,
  PersonRole,
  PromotionId,
  RingStyle,
  WorkerListArgs,
  WorkerListFilters,
} from '@ringside/engine';
import type { SortDirection, SortState } from '@/components/DataTable';

/** The filters the filter bar offers. `null` is "any". */
export interface WorkersFilterState {
  readonly role: PersonRole | null;
  /** `'free'` for free agents, or one promotion. */
  readonly employer: 'free' | PromotionId | null;
  readonly availability: AvailabilityStatus | null;
  readonly gender: Gender | null;
  readonly style: RingStyle | null;
  readonly continentId: ContinentId | null;
  readonly countryId: CountryId | null;
  readonly ageMin: number | null;
  readonly ageMax: number | null;
  /** The attribute the minimum applies to. It only filters once `attributeMin` is set too. */
  readonly attribute: AttributeKey | null;
  readonly attributeMin: number | null;
}

export const NO_WORKERS_FILTERS: WorkersFilterState = {
  role: null,
  employer: null,
  availability: null,
  gender: null,
  style: null,
  continentId: null,
  countryId: null,
  ageMin: null,
  ageMax: null,
  attribute: null,
  attributeMin: null,
};

/** The search parameter of each filter, and of the sort. */
export const WORKERS_PARAMS = {
  role: 'role',
  employer: 'employer',
  availability: 'availability',
  gender: 'gender',
  style: 'style',
  continentId: 'continent',
  countryId: 'country',
  ageMin: 'ageMin',
  ageMax: 'ageMax',
  attribute: 'attr',
  attributeMin: 'attrMin',
  sort: 'sort',
} as const;

/** The `employer` value for free agents. */
export const FREE_AGENT_PARAM = 'free';

/** The columns the list can be sorted by. The ids are also the `sort` parameter's keys. */
export const WORKERS_SORT_COLUMN_IDS: readonly string[] = [
  'ringName',
  'age',
  'style',
  'overall',
  'popularity',
  'employer',
];

/** The list's order when the URL names none: best overall first. */
export const DEFAULT_WORKERS_SORT: NonNullable<SortState> = {
  columnId: 'overall',
  direction: 'desc',
};

export const AGE_LIMIT = 150;
export const ATTRIBUTE_LIMIT = 100;

function oneOf<Value extends string>(allowed: readonly Value[], raw: string | null): Value | null {
  return allowed.find((value) => value === raw) ?? null;
}

/** A whole number from 0 to `max`, or null for anything else (empty, text, out of range). */
function wholeNumber(raw: string | null, max: number): number | null {
  if (raw === null || !/^\d{1,3}$/.test(raw)) return null;
  const value = Number(raw);
  return value <= max ? value : null;
}

function employerOf(raw: string | null): WorkersFilterState['employer'] {
  if (raw === FREE_AGENT_PARAM) return 'free';
  return isId('promotion', raw) ? raw : null;
}

/** The filters a URL's search parameters describe. */
export function filtersFromSearch(params: URLSearchParams): WorkersFilterState {
  const continentRaw = params.get(WORKERS_PARAMS.continentId);
  const countryRaw = params.get(WORKERS_PARAMS.countryId);
  return {
    role: oneOf(PERSON_ROLES, params.get(WORKERS_PARAMS.role)),
    employer: employerOf(params.get(WORKERS_PARAMS.employer)),
    availability: oneOf(AVAILABILITY_STATUSES, params.get(WORKERS_PARAMS.availability)),
    gender: oneOf(GENDERS, params.get(WORKERS_PARAMS.gender)),
    style: oneOf(RING_STYLES, params.get(WORKERS_PARAMS.style)),
    continentId: isId('continent', continentRaw) ? continentRaw : null,
    countryId: isId('country', countryRaw) ? countryRaw : null,
    ageMin: wholeNumber(params.get(WORKERS_PARAMS.ageMin), AGE_LIMIT),
    ageMax: wholeNumber(params.get(WORKERS_PARAMS.ageMax), AGE_LIMIT),
    attribute: oneOf(ATTRIBUTE_KEYS, params.get(WORKERS_PARAMS.attribute)),
    attributeMin: wholeNumber(params.get(WORKERS_PARAMS.attributeMin), ATTRIBUTE_LIMIT),
  };
}

/** The sort a URL's search parameters describe: `sort=age:desc`, or the default. */
export function sortFromSearch(params: URLSearchParams): NonNullable<SortState> {
  const [columnId, direction] = (params.get(WORKERS_PARAMS.sort) ?? '').split(':');
  if (
    columnId === undefined ||
    !WORKERS_SORT_COLUMN_IDS.includes(columnId) ||
    (direction !== 'asc' && direction !== 'desc')
  ) {
    return DEFAULT_WORKERS_SORT;
  }
  return { columnId, direction };
}

type FilterKey = keyof WorkersFilterState;
const FILTER_KEYS: readonly FilterKey[] = [
  'role',
  'employer',
  'availability',
  'gender',
  'style',
  'continentId',
  'countryId',
  'ageMin',
  'ageMax',
  'attribute',
  'attributeMin',
];

/**
 * `current` with the filters replaced by `filters`. Every other parameter (the sort, anything a
 * later feature adds) is kept as it is.
 */
export function searchWithFilters(
  current: URLSearchParams,
  filters: WorkersFilterState,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value === null) {
      next.delete(WORKERS_PARAMS[key]);
    } else {
      next.set(WORKERS_PARAMS[key], String(value));
    }
  }
  return next;
}

/** `current` with the sort replaced. No sort, or the default one, removes the parameter. */
export function searchWithSort(current: URLSearchParams, sort: SortState): URLSearchParams {
  const next = new URLSearchParams(current);
  const isDefault =
    sort === null ||
    (sort.columnId === DEFAULT_WORKERS_SORT.columnId &&
      sort.direction === DEFAULT_WORKERS_SORT.direction);
  if (isDefault) {
    next.delete(WORKERS_PARAMS.sort);
  } else {
    const direction: SortDirection = sort.direction;
    next.set(WORKERS_PARAMS.sort, `${sort.columnId}:${direction}`);
  }
  return next;
}

/** True when the attribute minimum is complete enough to filter by. */
function hasAttributeMinimum(
  filters: WorkersFilterState,
): filters is WorkersFilterState & { attribute: AttributeKey; attributeMin: number } {
  return filters.attribute !== null && filters.attributeMin !== null;
}

/** How many filters are narrowing the list, for the phone's "Filters (2)" button. */
export function activeFilterCount(filters: WorkersFilterState): number {
  const simple: readonly (string | number | null)[] = [
    filters.role,
    filters.employer,
    filters.availability,
    filters.gender,
    filters.style,
    filters.continentId,
    filters.countryId,
    filters.ageMin,
    filters.ageMax,
  ];
  return simple.filter((value) => value !== null).length + (hasAttributeMinimum(filters) ? 1 : 0);
}

/**
 * The `workers.list` arguments for the filters. Only set filters are sent, in a fixed order, and
 * the sort is left out (the screen sorts the rows it gets), so changing the sort never refetches.
 */
export function listArgsFor(filters: WorkersFilterState): WorkerListArgs {
  const sent: WorkerListFilters = {};
  if (filters.role !== null) sent.roles = [filters.role];
  if (filters.employer === 'free') {
    sent.employer = { kind: 'freeAgent' };
  } else if (filters.employer !== null) {
    sent.employer = { kind: 'promotion', promotionId: filters.employer };
  }
  if (filters.availability !== null) sent.availability = [filters.availability];
  if (filters.gender !== null) sent.genders = [filters.gender];
  if (filters.style !== null) sent.styles = [filters.style];
  if (filters.continentId !== null) sent.continentId = filters.continentId;
  if (filters.countryId !== null) sent.countryId = filters.countryId;
  if (filters.ageMin !== null) sent.ageMin = filters.ageMin;
  if (filters.ageMax !== null) sent.ageMax = filters.ageMax;
  if (hasAttributeMinimum(filters)) {
    sent.attributeMin = [{ attribute: filters.attribute, min: filters.attributeMin }];
  }
  return Object.keys(sent).length === 0 ? {} : { filters: sent };
}
