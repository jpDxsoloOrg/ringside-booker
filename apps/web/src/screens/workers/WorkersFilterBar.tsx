import { useId, useMemo } from 'react';
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  AVAILABILITY_STATUSES,
  GENDER_LABELS,
  GENDERS,
  PERSON_ROLES,
  RING_STYLES,
  STYLE_LABELS,
} from '@ringside/engine';
import type { WorkerListFacets } from '@ringside/engine';
import { AVAILABILITY_LABELS } from '@/components/AvailabilityChip';
import { Button } from '@/components/Button';
import { classNames } from '@/components/classNames';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { FREE_AGENT_LABEL, WORKER_ROLE_LABELS } from './workerLabels';
import {
  activeFilterCount,
  AGE_LIMIT,
  ATTRIBUTE_LIMIT,
  FREE_AGENT_PARAM,
  NO_WORKERS_FILTERS,
} from './workersListParams';
import type { WorkersFilterState } from './workersListParams';
import styles from './WorkersScreen.module.css';

/** The option every select starts on: no filter. Radix Select has no empty value. */
const ANY = 'any';

/** No employers or places to offer yet: what the bar shows before the first answer. */
export const NO_WORKER_FACETS: WorkerListFacets = { promotions: [], continents: [], countries: [] };

function withAny(anyLabel: string, options: readonly SelectOption[]): readonly SelectOption[] {
  return [{ value: ANY, label: anyLabel }, ...options];
}

function labelled<Value extends string>(
  values: readonly Value[],
  labels: Readonly<Record<Value, string>>,
): SelectOption[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

/** The value among `allowed` that a select reported, or null for "any" (or anything unknown). */
function chosen<Value extends string>(allowed: readonly Value[], value: string): Value | null {
  return allowed.find((candidate) => candidate === value) ?? null;
}

const ROLE_OPTIONS = withAny('Any role', labelled(PERSON_ROLES, WORKER_ROLE_LABELS));
const AVAILABILITY_OPTIONS = withAny(
  'Any availability',
  labelled(AVAILABILITY_STATUSES, AVAILABILITY_LABELS),
);
const GENDER_OPTIONS = withAny('Any gender', labelled(GENDERS, GENDER_LABELS));
const STYLE_OPTIONS = withAny('Any style', labelled(RING_STYLES, STYLE_LABELS));
const ATTRIBUTE_OPTIONS = withAny('No attribute', labelled(ATTRIBUTE_KEYS, ATTRIBUTE_LABELS));

interface NumberFilterProps {
  readonly label: string;
  readonly value: number | null;
  readonly max: number;
  readonly disabled?: boolean;
  readonly onChange: (value: number | null) => void;
}

/** A whole number from 0 to `max`; empty means no limit. Anything above `max` becomes `max`. */
function NumberFilter({ label, value, max, disabled = false, onChange }: NumberFilterProps) {
  const inputId = useId();
  return (
    <div className={styles['field']}>
      <label htmlFor={inputId} className={styles['fieldLabel']}>
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        className={classNames(styles['numberInput'], 'tabular')}
        min={0}
        max={max}
        step={1}
        disabled={disabled}
        value={value === null ? '' : String(value)}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '');
          onChange(digits === '' ? null : Math.min(max, Number(digits)));
        }}
      />
    </div>
  );
}

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
  const continentOptions = useMemo(
    () =>
      withAny(
        'Any continent',
        facets.continents.map((continent) => ({
          value: continent.continentId,
          label: continent.name,
        })),
      ),
    [facets.continents],
  );
  const countryOptions = useMemo(
    () =>
      withAny(
        'Any country',
        facets.countries
          .filter(
            (country) =>
              filters.continentId === null || country.continentId === filters.continentId,
          )
          .map((country) => ({ value: country.countryId, label: country.name })),
      ),
    [facets.countries, filters.continentId],
  );

  const change = (changes: Partial<WorkersFilterState>): void => {
    onChange({ ...filters, ...changes });
  };

  // A value the options do not hold yet (the first answer is still on its way, or the URL names a
  // promotion this world lacks) shows as "any" instead of an empty box.
  const shown = (options: readonly SelectOption[], value: string | null): string =>
    value !== null && options.some((option) => option.value === value) ? value : ANY;

  return (
    <div className={classNames(styles['filters'], styles[`filters-${layout}`])}>
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
        value={shown(employerOptions, filters.employer)}
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
      <Select
        label="Based in"
        options={continentOptions}
        value={shown(continentOptions, filters.continentId)}
        onValueChange={(value) => {
          const continent = facets.continents.find((option) => option.continentId === value);
          const continentId = continent?.continentId ?? null;
          const country = facets.countries.find((option) => option.countryId === filters.countryId);
          // A country outside the new continent would leave the list empty for no visible reason.
          const keepsCountry =
            continentId === null || country === undefined || country.continentId === continentId;
          change({ continentId, countryId: keepsCountry ? filters.countryId : null });
        }}
      />
      <Select
        label="Country"
        options={countryOptions}
        value={shown(countryOptions, filters.countryId)}
        onValueChange={(value) => {
          const country = facets.countries.find((option) => option.countryId === value);
          change({ countryId: country?.countryId ?? null });
        }}
      />
      <div className={styles['pair']}>
        <NumberFilter
          label="Age from"
          value={filters.ageMin}
          max={AGE_LIMIT}
          onChange={(ageMin) => {
            change({ ageMin });
          }}
        />
        <NumberFilter
          label="Age to"
          value={filters.ageMax}
          max={AGE_LIMIT}
          onChange={(ageMax) => {
            change({ ageMax });
          }}
        />
      </div>
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
      <div className={styles['clear']}>
        <Button
          size="sm"
          variant="ghost"
          iconStart="close"
          disabled={
            activeFilterCount(filters) === 0 &&
            filters.attribute === null &&
            filters.attributeMin === null
          }
          onClick={() => {
            onChange(NO_WORKERS_FILTERS);
          }}
        >
          Clear filters
        </Button>
      </div>
    </div>
  );
}
