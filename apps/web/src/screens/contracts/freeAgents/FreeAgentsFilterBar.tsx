import { useMemo } from 'react';
import { GENDERS, PERSON_ROLES, PUSH_LEVELS, RING_STYLES } from '@ringside/engine';
import type { FreeAgentRow } from '@ringside/engine';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import {
  ANY,
  chosen,
  FilterBarFrame,
  GENDER_OPTIONS,
  NumberFilter,
  PlaceFilters,
  PUSH_OPTIONS,
  RangeFilter,
  ROLE_OPTIONS,
  STYLE_OPTIONS,
} from '@/screens/workers/filterControls';
import type { FilterLayout } from '@/screens/workers/filterControls';
import { AGE_LIMIT } from '@/screens/workers/workersListParams';
import {
  freeAgentFilterCount,
  freeAgentPlaces,
  NO_FREE_AGENT_FILTERS,
  POPULARITY_LIMIT,
} from '../contractsListParams';
import type { FreeAgentFilters } from '../contractsListParams';

const SITUATION_OPTIONS: readonly SelectOption[] = [
  { value: 'freeAgent', label: 'Free agents' },
  { value: 'all', label: 'Include ending soon' },
];

export interface FreeAgentsFilterBarProps {
  readonly filters: FreeAgentFilters;
  /** Every row before the filters: the places they are based in fill "Based in" and "Country". */
  readonly rows: readonly FreeAgentRow[];
  readonly situation: 'freeAgent' | 'all';
  readonly onChange: (filters: FreeAgentFilters) => void;
  readonly onSituationChange: (situation: 'freeAgent' | 'all') => void;
  readonly layout: FilterLayout;
}

/**
 * Contracts › Free agents' filters (ECO5-09), built from the Workers list's controls: who to list
 * (free agents only, or also workers whose deals end soon), role, gender, the push they would
 * expect with you, style, an age range, a lowest popularity among your fans, and where they are
 * based. It holds no state: the tab reads the filters from the URL and writes back what it reports.
 */
export function FreeAgentsFilterBar({
  filters,
  rows,
  situation,
  onChange,
  onSituationChange,
  layout,
}: FreeAgentsFilterBarProps) {
  const places = useMemo(() => freeAgentPlaces(rows), [rows]);
  const change = (changes: Partial<FreeAgentFilters>): void => {
    onChange({ ...filters, ...changes });
  };
  return (
    <FilterBarFrame
      layout={layout}
      clearDisabled={freeAgentFilterCount(filters) === 0}
      onClear={() => {
        onChange(NO_FREE_AGENT_FILTERS);
      }}
    >
      <Select
        label="Situation"
        options={SITUATION_OPTIONS}
        value={situation}
        onValueChange={(value) => {
          onSituationChange(value === 'freeAgent' ? 'freeAgent' : 'all');
        }}
      />
      <Select
        label="Role"
        options={ROLE_OPTIONS}
        value={filters.role ?? ANY}
        onValueChange={(value) => {
          change({ role: chosen(PERSON_ROLES, value) });
        }}
      />
      <Select
        label="Gender"
        options={GENDER_OPTIONS}
        value={filters.gender ?? ANY}
        onValueChange={(value) => {
          change({ gender: chosen(GENDERS, value) });
        }}
      />
      <Select
        label="Push expectation"
        options={PUSH_OPTIONS}
        value={filters.push ?? ANY}
        onValueChange={(value) => {
          change({ push: chosen(PUSH_LEVELS, value) });
        }}
      />
      <Select
        label="Style"
        options={STYLE_OPTIONS}
        value={filters.style ?? ANY}
        onValueChange={(value) => {
          change({ style: chosen(RING_STYLES, value) });
        }}
      />
      <RangeFilter
        fromLabel="Age from"
        toLabel="Age to"
        from={filters.ageMin}
        to={filters.ageMax}
        max={AGE_LIMIT}
        onChange={({ from, to }) => {
          change({ ageMin: from, ageMax: to });
        }}
      />
      <NumberFilter
        label="Popularity in your regions, at least"
        value={filters.popMin}
        max={POPULARITY_LIMIT}
        onChange={(popMin) => {
          change({ popMin });
        }}
      />
      <PlaceFilters
        value={{ continentId: filters.continentId, countryId: filters.countryId }}
        facets={places}
        onChange={change}
      />
    </FilterBarFrame>
  );
}
