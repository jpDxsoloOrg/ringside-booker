/**
 * The Contracts lists' sort, search and filters as they live in the URL (ECO5-09), so a reload,
 * Back and a link from the Workers list all land on the same rows:
 * `?tab=free-agents&gender=female&push=midCard&sort=ask:desc&q=mara`.
 *
 * The filters shared with the Workers list keep the Workers list's parameter names (`role`,
 * `gender`, `style`, `continent`, `country`, `ageMin`, `ageMax`), so "Find free agents" carries them
 * across as they are. Each tab reads only the parameters it has; changing tab drops them all (see
 * `searchWithTabId`), since every tab has its own columns and filters. A parameter that is missing
 * or not understood counts as "no filter"; the default sort is never written.
 */
import {
  EMPLOYMENT_ROLES,
  GENDERS,
  isId,
  PERSON_ROLES,
  PUSH_LEVELS,
  RING_STYLES,
} from '@ringside/engine';
import type {
  ContinentId,
  ContractRow,
  CountryId,
  EmploymentRole,
  FreeAgentRow,
  Gender,
  PersonRole,
  Push,
  RingStyle,
} from '@ringside/engine';
import type { SortState } from '@/components/DataTable';
import { formatNumber } from '@/components/format';
import { AGE_LIMIT, WORKERS_PARAMS } from '@/screens/workers/workersListParams';

export const SORT_PARAM = 'sort';
/** The search box's text. */
export const SEARCH_PARAM = 'q';
export const PUSH_PARAM = 'push';
/** The lowest popularity among your fans a free agent may have. */
export const POP_MIN_PARAM = 'popMin';
export const POPULARITY_LIMIT = 100;
/** Free agents' "Situation": `free` leaves out the workers whose deals elsewhere end soon. */
export const SITUATION_PARAM = 'situation';
export const FREE_AGENTS_ONLY = 'free';
/** Offers' "Closed talks" switch: `closed=1`. */
export const CLOSED_PARAM = 'closed';

/** Every parameter a Contracts list reads, dropped when the tab changes. */
export const LIST_PARAMS: readonly string[] = [
  SORT_PARAM,
  SEARCH_PARAM,
  PUSH_PARAM,
  POP_MIN_PARAM,
  SITUATION_PARAM,
  CLOSED_PARAM,
  WORKERS_PARAMS.role,
  WORKERS_PARAMS.gender,
  WORKERS_PARAMS.style,
  WORKERS_PARAMS.continentId,
  WORKERS_PARAMS.countryId,
  WORKERS_PARAMS.ageMin,
  WORKERS_PARAMS.ageMax,
];

/** `search` without any list's sort, search or filters. */
export function searchWithoutListParams(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const param of LIST_PARAMS) next.delete(param);
  return next;
}

function oneOf<Value extends string>(allowed: readonly Value[], raw: string | null): Value | null {
  return allowed.find((value) => value === raw) ?? null;
}

/** A whole number from 0 to `max`, or null for anything else. */
function wholeNumber(raw: string | null, max: number): number | null {
  if (raw === null || !/^\d{1,3}$/.test(raw)) return null;
  const value = Number(raw);
  return value <= max ? value : null;
}

function setOrDelete(search: URLSearchParams, param: string, value: string | number | null): void {
  if (value === null) search.delete(param);
  else search.set(param, String(value));
}

// ---------------------------------------------------------------------------------------------
// Sort and search

/**
 * The sort the URL names (`sort=ask:desc`), when it is one of `sortable`'s columns, else
 * `fallback` (the tab's own order).
 */
export function sortFromSearch(
  search: URLSearchParams,
  sortable: readonly string[],
  fallback: SortState,
): SortState {
  const [columnId, direction] = (search.get(SORT_PARAM) ?? '').split(':');
  if (
    columnId === undefined ||
    !sortable.includes(columnId) ||
    (direction !== 'asc' && direction !== 'desc')
  ) {
    return fallback;
  }
  return { columnId, direction };
}

/** `search` with the sort set; the tab's own order (or none) removes the parameter. */
export function searchWithSort(
  search: URLSearchParams,
  sort: SortState,
  fallback: SortState,
): URLSearchParams {
  const next = new URLSearchParams(search);
  const isDefault =
    sort === null ||
    (fallback !== null &&
      sort.columnId === fallback.columnId &&
      sort.direction === fallback.direction);
  setOrDelete(next, SORT_PARAM, isDefault ? null : `${sort.columnId}:${sort.direction}`);
  return next;
}

export function searchTextFromSearch(search: URLSearchParams): string {
  return search.get(SEARCH_PARAM) ?? '';
}

/** `search` with the search box's text, or without it when the box is empty. */
export function searchWithSearchText(search: URLSearchParams, text: string): URLSearchParams {
  const next = new URLSearchParams(search);
  setOrDelete(next, SEARCH_PARAM, text === '' ? null : text);
  return next;
}

/** "12 of 44 free agents": the rows left by the filters and search, of all the tab's rows. */
export function shownOfText(shown: number, total: number, one: string, many: string): string {
  return `${formatNumber(shown)} of ${formatNumber(total)} ${total === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------------------------
// Free agents

/** The Free agents tab's filters, the same as the Workers list's where both have them. */
export interface FreeAgentFilters {
  readonly role: PersonRole | null;
  readonly gender: Gender | null;
  /** The card position they would expect with you. */
  readonly push: Push | null;
  readonly style: RingStyle | null;
  readonly ageMin: number | null;
  readonly ageMax: number | null;
  /** The lowest popularity among your fans, 0-100. */
  readonly popMin: number | null;
  readonly continentId: ContinentId | null;
  readonly countryId: CountryId | null;
}

export const NO_FREE_AGENT_FILTERS: FreeAgentFilters = {
  role: null,
  gender: null,
  push: null,
  style: null,
  ageMin: null,
  ageMax: null,
  popMin: null,
  continentId: null,
  countryId: null,
};

const FREE_AGENT_PARAMS: Readonly<Record<keyof FreeAgentFilters, string>> = {
  role: WORKERS_PARAMS.role,
  gender: WORKERS_PARAMS.gender,
  push: PUSH_PARAM,
  style: WORKERS_PARAMS.style,
  ageMin: WORKERS_PARAMS.ageMin,
  ageMax: WORKERS_PARAMS.ageMax,
  popMin: POP_MIN_PARAM,
  continentId: WORKERS_PARAMS.continentId,
  countryId: WORKERS_PARAMS.countryId,
};

const FREE_AGENT_KEYS: readonly (keyof FreeAgentFilters)[] = [
  'role',
  'gender',
  'push',
  'style',
  'ageMin',
  'ageMax',
  'popMin',
  'continentId',
  'countryId',
];

export function freeAgentFiltersFromSearch(search: URLSearchParams): FreeAgentFilters {
  const continent = search.get(FREE_AGENT_PARAMS.continentId);
  const country = search.get(FREE_AGENT_PARAMS.countryId);
  return {
    role: oneOf(PERSON_ROLES, search.get(FREE_AGENT_PARAMS.role)),
    gender: oneOf(GENDERS, search.get(FREE_AGENT_PARAMS.gender)),
    push: oneOf(PUSH_LEVELS, search.get(FREE_AGENT_PARAMS.push)),
    style: oneOf(RING_STYLES, search.get(FREE_AGENT_PARAMS.style)),
    ageMin: wholeNumber(search.get(FREE_AGENT_PARAMS.ageMin), AGE_LIMIT),
    ageMax: wholeNumber(search.get(FREE_AGENT_PARAMS.ageMax), AGE_LIMIT),
    popMin: wholeNumber(search.get(FREE_AGENT_PARAMS.popMin), POPULARITY_LIMIT),
    continentId: isId('continent', continent) ? continent : null,
    countryId: isId('country', country) ? country : null,
  };
}

/** `search` with the Free agents filters replaced; every other parameter is kept. */
export function searchWithFreeAgentFilters(
  search: URLSearchParams,
  filters: FreeAgentFilters,
): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const key of FREE_AGENT_KEYS) setOrDelete(next, FREE_AGENT_PARAMS[key], filters[key]);
  return next;
}

/** How many filters are narrowing the list, for the phone's "Filters (2)" button. */
export function freeAgentFilterCount(filters: FreeAgentFilters): number {
  return FREE_AGENT_KEYS.filter((key) => filters[key] !== null).length;
}

/** The rows the filters keep, in their order. */
export function filterFreeAgents(
  rows: readonly FreeAgentRow[],
  filters: FreeAgentFilters,
): readonly FreeAgentRow[] {
  if (freeAgentFilterCount(filters) === 0) return rows;
  return rows.filter(
    (row) =>
      (filters.role === null || row.roles.includes(filters.role)) &&
      (filters.gender === null || row.gender === filters.gender) &&
      (filters.push === null || row.pushExpectation === filters.push) &&
      (filters.style === null || row.style === filters.style) &&
      (filters.ageMin === null || row.age >= filters.ageMin) &&
      (filters.ageMax === null || row.age <= filters.ageMax) &&
      (filters.popMin === null || row.popularityHere >= filters.popMin) &&
      (filters.continentId === null || row.basedIn.continentId === filters.continentId) &&
      (filters.countryId === null || row.basedIn.countryId === filters.countryId),
  );
}

/** The continents and countries the free agents are based in, each by name, for the selects. */
export function freeAgentPlaces(rows: readonly FreeAgentRow[]): {
  readonly continents: { continentId: ContinentId; name: string }[];
  readonly countries: { countryId: CountryId; name: string; continentId: ContinentId }[];
} {
  const continents = new Map<ContinentId, string>();
  const countries = new Map<CountryId, { name: string; continentId: ContinentId }>();
  for (const { basedIn } of rows) {
    continents.set(basedIn.continentId, basedIn.continentName);
    countries.set(basedIn.countryId, {
      name: basedIn.countryName,
      continentId: basedIn.continentId,
    });
  }
  const byName = (left: { name: string }, right: { name: string }): number =>
    left.name.localeCompare(right.name);
  return {
    continents: [...continents].map(([continentId, name]) => ({ continentId, name })).sort(byName),
    countries: [...countries].map(([countryId, place]) => ({ countryId, ...place })).sort(byName),
  };
}

/** The Workers parameters Free agents also has, which "Find free agents" carries across. */
const CARRIED_FROM_WORKERS: readonly string[] = [
  WORKERS_PARAMS.role,
  WORKERS_PARAMS.gender,
  WORKERS_PARAMS.style,
  WORKERS_PARAMS.continentId,
  WORKERS_PARAMS.countryId,
  WORKERS_PARAMS.ageMin,
  WORKERS_PARAMS.ageMax,
];

/**
 * The Free agents tab's search for a Workers list's search: `?tab=free-agents` with the filters
 * both lists have (role, gender, style, place, age), the others (employer, availability, an
 * attribute minimum, the sort) left behind.
 */
export function freeAgentsSearchFromWorkers(workersSearch: URLSearchParams, tab: string): string {
  const next = new URLSearchParams({ tab });
  for (const param of CARRIED_FROM_WORKERS) {
    const value = workersSearch.get(param);
    if (value !== null && value !== '') next.set(param, value);
  }
  // Read back through the Free agents filters, so nothing it would not understand is carried.
  const carried = searchWithFreeAgentFilters(
    new URLSearchParams({ tab }),
    freeAgentFiltersFromSearch(next),
  );
  return `?${carried.toString()}`;
}

// ---------------------------------------------------------------------------------------------
// Active, Expiring and Ended

/** The contract lists' filters: the job, and on Active and Expiring gender and push too. */
export interface ContractFilters {
  readonly role: EmploymentRole | null;
  readonly gender: Gender | null;
  readonly push: Push | null;
}

export const NO_CONTRACT_FILTERS: ContractFilters = { role: null, gender: null, push: null };

export function contractFiltersFromSearch(search: URLSearchParams): ContractFilters {
  return {
    role: oneOf(EMPLOYMENT_ROLES, search.get(WORKERS_PARAMS.role)),
    gender: oneOf(GENDERS, search.get(WORKERS_PARAMS.gender)),
    push: oneOf(PUSH_LEVELS, search.get(PUSH_PARAM)),
  };
}

export function searchWithContractFilters(
  search: URLSearchParams,
  filters: ContractFilters,
): URLSearchParams {
  const next = new URLSearchParams(search);
  setOrDelete(next, WORKERS_PARAMS.role, filters.role);
  setOrDelete(next, WORKERS_PARAMS.gender, filters.gender);
  setOrDelete(next, PUSH_PARAM, filters.push);
  return next;
}

export function contractFilterCount(filters: ContractFilters): number {
  return [filters.role, filters.gender, filters.push].filter((value) => value !== null).length;
}

export function filterContracts(
  rows: readonly ContractRow[],
  filters: ContractFilters,
): readonly ContractRow[] {
  if (contractFilterCount(filters) === 0) return rows;
  return rows.filter(
    (row) =>
      (filters.role === null || row.role === filters.role) &&
      (filters.gender === null || row.gender === filters.gender) &&
      (filters.push === null || row.push === filters.push),
  );
}
