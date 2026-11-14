import { describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import {
  aContractRow,
  aFreeAgentRow,
  FIXTURE_CONTINENT,
  FIXTURE_COUNTRY,
} from './contractFixtures';
import {
  contractFiltersFromSearch,
  filterContracts,
  filterFreeAgents,
  freeAgentFilterCount,
  freeAgentFiltersFromSearch,
  freeAgentPlaces,
  freeAgentsSearchFromWorkers,
  NO_FREE_AGENT_FILTERS,
  searchWithFreeAgentFilters,
  searchWithSort,
  shownOfText,
  sortFromSearch,
} from './contractsListParams';
import { searchWithTabId } from './contractsParams';

describe('the Contracts lists in the URL (ECO5-09)', () => {
  it('reads a sort only for a column the tab can sort by, else its own order', () => {
    const fallback = { columnId: 'ringName', direction: 'asc' } as const;
    const sortable = ['ringName', 'ask'];
    expect(sortFromSearch(new URLSearchParams('sort=ask:desc'), sortable, fallback)).toEqual({
      columnId: 'ask',
      direction: 'desc',
    });
    for (const raw of ['sort=wage:desc', 'sort=ask:sideways', 'sort=', '']) {
      expect(sortFromSearch(new URLSearchParams(raw), sortable, fallback)).toBe(fallback);
    }
  });

  it('never writes the tab’s own order', () => {
    const fallback = { columnId: 'ringName', direction: 'asc' } as const;
    const start = new URLSearchParams('tab=active&sort=wage:desc');
    expect(searchWithSort(start, fallback, fallback).toString()).toBe('tab=active');
    expect(searchWithSort(start, null, fallback).toString()).toBe('tab=active');
    expect(
      searchWithSort(start, { columnId: 'morale', direction: 'desc' }, fallback).toString(),
    ).toBe('tab=active&sort=morale%3Adesc');
  });

  it('reads the free agent filters back as they were written, and ignores what it does not know', () => {
    const filters = {
      ...NO_FREE_AGENT_FILTERS,
      role: 'wrestler',
      gender: 'female',
      push: 'midCard',
      ageMax: 35,
      popMin: 20,
      countryId: FIXTURE_COUNTRY,
    } as const;
    const written = searchWithFreeAgentFilters(new URLSearchParams('tab=free-agents'), filters);
    expect(freeAgentFiltersFromSearch(written)).toEqual(filters);
    expect(freeAgentFilterCount(filters)).toBe(6);
    expect(
      freeAgentFiltersFromSearch(new URLSearchParams('push=legend&popMin=900&gender=robot')),
    ).toEqual(NO_FREE_AGENT_FILTERS);
  });

  it('drops every list parameter when the tab changes', () => {
    const search = new URLSearchParams(
      'tab=free-agents&gender=female&push=midCard&sort=ask:desc&q=rhea&popMin=10&situation=free',
    );
    expect(searchWithTabId(search, 'offers').toString()).toBe('tab=offers');
  });

  it('carries the filters both lists have from Workers to Free agents, and nothing else', () => {
    const workers = new URLSearchParams(
      `gender=female&role=wrestler&style=brawler&ageMin=20&employer=free&availability=injured&attr=strength&attrMin=50&sort=age:asc&country=${FIXTURE_COUNTRY}`,
    );
    const carried = new URLSearchParams(freeAgentsSearchFromWorkers(workers, 'free-agents'));
    expect(Object.fromEntries(carried)).toEqual({
      tab: 'free-agents',
      role: 'wrestler',
      gender: 'female',
      style: 'brawler',
      ageMin: '20',
      country: FIXTURE_COUNTRY,
    });
    expect(freeAgentsSearchFromWorkers(new URLSearchParams(), 'free-agents')).toBe(
      '?tab=free-agents',
    );
  });

  it('keeps the free agents every filter allows', () => {
    const rhea = aFreeAgentRow();
    const elsewhere = aFreeAgentRow({
      personId: parseId('person', 'per_0000000903'),
      gender: 'male',
      age: 41,
      popularityHere: 5,
      pushExpectation: 'enhancement',
      roles: ['referee'],
      basedIn: {
        countryId: parseId('country', 'cty_0000000902'),
        countryName: 'Japan',
        continentId: parseId('continent', 'ctn_0000000902'),
        continentName: 'Asia',
      },
    });
    const rows = [rhea, elsewhere];
    expect(filterFreeAgents(rows, NO_FREE_AGENT_FILTERS)).toBe(rows);
    for (const filters of [
      { gender: 'female' },
      { ageMax: 30 },
      { popMin: 20 },
      { push: 'midCard' },
      { role: 'wrestler' },
      { continentId: FIXTURE_CONTINENT },
      { countryId: FIXTURE_COUNTRY },
    ] as const) {
      expect(filterFreeAgents(rows, { ...NO_FREE_AGENT_FILTERS, ...filters })).toEqual([rhea]);
    }
    expect(freeAgentPlaces(rows)).toEqual({
      continents: [
        { continentId: parseId('continent', 'ctn_0000000902'), name: 'Asia' },
        { continentId: FIXTURE_CONTINENT, name: 'North America' },
      ],
      countries: [
        {
          countryId: parseId('country', 'cty_0000000902'),
          name: 'Japan',
          continentId: parseId('continent', 'ctn_0000000902'),
        },
        { countryId: FIXTURE_COUNTRY, name: 'Mexico', continentId: FIXTURE_CONTINENT },
      ],
    });
  });

  it('filters the contract lists by role, gender and push', () => {
    const mara = aContractRow();
    const tor = aContractRow({
      employmentId: parseId('employment', 'emp_0000000902'),
      gender: 'male',
      push: 'mainEvent',
      role: 'referee',
    });
    const filters = contractFiltersFromSearch(new URLSearchParams('gender=male&push=mainEvent'));
    expect(filterContracts([mara, tor], filters)).toEqual([tor]);
    expect(
      filterContracts([mara, tor], contractFiltersFromSearch(new URLSearchParams('role=wrestler'))),
    ).toEqual([mara]);
  });

  it('says how many rows are left of how many', () => {
    expect(shownOfText(12, 44, 'free agent', 'free agents')).toBe('12 of 44 free agents');
    expect(shownOfText(1, 1, 'contract', 'contracts')).toBe('1 of 1 contract');
  });
});
