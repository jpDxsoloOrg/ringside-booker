import { useMemo } from 'react';
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  AVAILABILITY_STATUSES,
  GENDERS,
  PERSON_ROLES,
  RING_STYLES,
} from '@ringside/engine';
import type { WorkerListFacets } from '@ringside/engine';
import { AVAILABILITY_LABELS } from '@/components/AvailabilityChip';
import { Select } from '@/components/Select';
import {
  ANY,
  chosen,
  FilterBarFrame,
  GENDER_OPTIONS,
  labelled,
  NumberFilter,
  PlaceFilters,
  RangeFilter,
  ROLE_OPTIONS,
  shownValue,
  STYLE_OPTIONS,
  withAny,
} from './filterControls';
import { FREE_AGENT_LABEL } from './workerLabels';
import {
  activeFilterCount,
  AGE_LIMIT,
  ATTRIBUTE_LIMIT,
  FREE_AGENT_PARAM,
  NO_WORKERS_FILTERS,
} from './workersListParams';
import type { WorkersFilterState } from './workersListParams';
import styles from './WorkersScreen.module.css';

/** No employers or places to offer yet: what the bar shows before the first answer. */
export const NO_WORKER_FACETS: WorkerListFacets = { promotions: [], continents: [], countries: [] };

const AVAILABILITY_OPTIONS = withAny(
  'Any availability',
  labelled(AVAILABILITY_STATUSES, AVAILABILITY_LABELS),
);
const ATTRIBUTE_OPTIONS = withAny('No attribute', labelled(ATTRIBUTE_KEYS, ATTRIBUTE_LABELS));

export interface WorkersFilterBarProps {
  readonly filters: WorkersFilterState;
  /** The employers and home places to offer, from the list's answer. */
  readonly facets: WorkerListFacets;
  readonly onChange: (filters: WorkersFilterState) => void;
  /** `bar` wraps across the page; `sheet` is one column for the phone's bottom sheet. */
  readonly layout?: 'bar' | 'sheet';
}

/**
 * The workers list's filters: role, employer, availability, gender, style, where someone is
 * based, an age range and a minimum for one attribute. It holds no state of its own: the screen
 * hands it the filters read from the URL and writes back what it reports.
 */
export function WorkersFilterBar({
  filters,
  facets,
  onChange,
  layout = 'bar',
}: WorkersFilterBarProps) {
  const employerOptions = useMemo(
    () =>
      withAny('Any employer', [
        { value: FREE_AGENT_PARAM, label: FREE_AGENT_LABEL },
        ...facets.promotions.map((promotion) => ({
          value: promotion.promotionId,
          label: promotion.name,
        })),
      ]),
    [facets.promotions],
  );
  const change = (changes: Partial<WorkersFilterState>): void => {
    onChange({ ...filters, ...changes });
  };

  return (
    <FilterBarFrame
      layout={layout}
      clearDisabled={
        activeFilterCount(filters) === 0 &&
        filters.attribute === null &&
        filters.attributeMin === null
      }
      onClear={() => {
        onChange(NO_WORKERS_FILTERS);
      }}
    >
      <Select
        label="Role"
        options={ROLE_OPTIONS}
        value={filters.role ?? ANY}
        onValueChange={(value) => {
          change({ role: chosen(PERSON_ROLES, value) });
        }}
      />
      <Select
        label="Employer"
        options={employerOptions}
        value={shownValue(employerOptions, filters.employer)}
        onValueChange={(value) => {
          const promotion = facets.promotions.find((option) => option.promotionId === value);
          change({
            employer: value === FREE_AGENT_PARAM ? 'free' : (promotion?.promotionId ?? null),
          });
        }}
      />
      <Select
        label="Availability"
        options={AVAILABILITY_OPTIONS}
        value={filters.availability ?? ANY}
        onValueChange={(value) => {
          change({ availability: chosen(AVAILABILITY_STATUSES, value) });
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
        label="Style"
        options={STYLE_OPTIONS}
        value={filters.style ?? ANY}
        onValueChange={(value) => {
          change({ style: chosen(RING_STYLES, value) });
        }}
      />
      <PlaceFilters
        value={{ continentId: filters.continentId, countryId: filters.countryId }}
        facets={facets}
        onChange={change}
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
      <div className={styles['pair']}>
        <Select
          label="Attribute"
          options={ATTRIBUTE_OPTIONS}
          value={filters.attribute ?? ANY}
          onValueChange={(value) => {
            const attribute = chosen(ATTRIBUTE_KEYS, value);
            change({ attribute, attributeMin: attribute === null ? null : filters.attributeMin });
          }}
        />
        <NumberFilter
          label="At least"
          value={filters.attributeMin}
          max={ATTRIBUTE_LIMIT}
          disabled={filters.attribute === null}
          onChange={(attributeMin) => {
            change({ attributeMin });
          }}
        />
      </div>
    </FilterBarFrame>
  );
}
