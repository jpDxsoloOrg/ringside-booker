import { describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import {
  activeFilterCount,
  DEFAULT_WORKERS_SORT,
  filtersFromSearch,
  listArgsFor,
  NO_WORKERS_FILTERS,
  searchWithFilters,
  searchWithSort,
  sortFromSearch,
} from './workersListParams';

const PROMOTION_ID = parseId('promotion', 'pro_0000000001');
const COUNTRY_ID = parseId('country', 'cty_0000000002');

describe('the workers list URL', () => {
  it('reads no filters and the default sort from an empty URL', () => {
    const params = new URLSearchParams();
    expect(filtersFromSearch(params)).toEqual(NO_WORKERS_FILTERS);
    expect(sortFromSearch(params)).toEqual(DEFAULT_WORKERS_SORT);
    expect(listArgsFor(NO_WORKERS_FILTERS)).toEqual({});
    expect(activeFilterCount(NO_WORKERS_FILTERS)).toBe(0);
  });

  it('reads every filter', () => {
    const params = new URLSearchParams(
      `role=referee&employer=${PROMOTION_ID}&availability=injured&gender=female&style=brawler` +
        `&country=${COUNTRY_ID}&ageMin=20&ageMax=35&attr=mic&attrMin=70&sort=age:asc`,
    );
    const filters = filtersFromSearch(params);
    expect(filters).toEqual({
      role: 'referee',
      employer: PROMOTION_ID,
      availability: 'injured',
      gender: 'female',
      style: 'brawler',
      continentId: null,
      countryId: COUNTRY_ID,
      ageMin: 20,
      ageMax: 35,
      attribute: 'mic',
      attributeMin: 70,
    });
    expect(sortFromSearch(params)).toEqual({ columnId: 'age', direction: 'asc' });
    expect(activeFilterCount(filters)).toBe(9);
    expect(listArgsFor(filters)).toEqual({
      filters: {
        roles: ['referee'],
        employer: { kind: 'promotion', promotionId: PROMOTION_ID },
        availability: ['injured'],
        genders: ['female'],
        styles: ['brawler'],
        countryId: COUNTRY_ID,
        ageMin: 20,
        ageMax: 35,
        attributeMin: [{ attribute: 'mic', min: 70 }],
      },
    });
  });

  it('reads free agents', () => {
    const filters = filtersFromSearch(new URLSearchParams('employer=free'));
    expect(filters.employer).toBe('free');
    expect(listArgsFor(filters)).toEqual({ filters: { employer: { kind: 'freeAgent' } } });
  });

  it('ignores values it does not understand', () => {
    const params = new URLSearchParams(
      'role=astronaut&employer=nobody&ageMin=-3&ageMax=999&attrMin=abc&continent=x&sort=hair:up',
    );
    expect(filtersFromSearch(params)).toEqual(NO_WORKERS_FILTERS);
    expect(sortFromSearch(params)).toEqual(DEFAULT_WORKERS_SORT);
    expect(sortFromSearch(new URLSearchParams('sort=age'))).toEqual(DEFAULT_WORKERS_SORT);
  });

  it('only filters by an attribute once it has a minimum', () => {
    const filters = filtersFromSearch(new URLSearchParams('attr=mic'));
    expect(filters.attribute).toBe('mic');
    expect(listArgsFor(filters)).toEqual({});
    expect(activeFilterCount(filters)).toBe(0);
  });

  it('writes filters without touching the sort, and clears them', () => {
    const current = new URLSearchParams('sort=age:asc&gender=male');
    const next = searchWithFilters(current, {
      ...NO_WORKERS_FILTERS,
      employer: 'free',
      ageMin: 30,
    });
    expect(next.toString()).toBe('sort=age%3Aasc&employer=free&ageMin=30');
    expect(searchWithFilters(next, NO_WORKERS_FILTERS).toString()).toBe('sort=age%3Aasc');
  });

  it('writes the sort, and leaves the default one out', () => {
    const current = new URLSearchParams('employer=free');
    const sorted = searchWithSort(current, { columnId: 'age', direction: 'desc' });
    expect(sorted.get('sort')).toBe('age:desc');
    expect(sorted.get('employer')).toBe('free');
    expect(searchWithSort(sorted, DEFAULT_WORKERS_SORT).has('sort')).toBe(false);
    expect(searchWithSort(sorted, null).has('sort')).toBe(false);
  });
});
