/**
 * The Workers list's filter controls, shared with every list that filters people the same way
 * (ECO5-09: Contracts › Free agents and the contract lists): the select option lists, a whole
 * number field, the "Based in" and "Country" pair, the bar that holds them with Clear filters, and
 * the panel that shows them above the table on desktop and in a bottom sheet on a phone.
 */
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import {
  GENDER_LABELS,
  GENDERS,
  PERSON_ROLES,
  PUSH_LABELS,
  PUSH_LEVELS,
  RING_STYLES,
  STYLE_LABELS,
} from '@ringside/engine';
import type { ContinentId, CountryId, WorkerListFacets } from '@ringside/engine';
import { Button } from '@/components/Button';
import { classNames } from '@/components/classNames';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Sheet } from '@/components/Sheet';
import { WORKER_ROLE_LABELS } from './workerLabels';
import styles from './WorkersScreen.module.css';

/** The option every select starts on: no filter. Radix Select has no empty value. */
export const ANY = 'any';

export function withAny(anyLabel: string, options: readonly SelectOption[]): readonly SelectOption[] {
  return [{ value: ANY, label: anyLabel }, ...options];
}

export function labelled<Value extends string>(
  values: readonly Value[],
  labels: Readonly<Record<Value, string>>,
): SelectOption[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

/** The value among `allowed` that a select reported, or null for "any" (or anything unknown). */
export function chosen<Value extends string>(
  allowed: readonly Value[],
  value: string,
): Value | null {
  return allowed.find((candidate) => candidate === value) ?? null;
}

/**
 * A value the options do not hold yet (the first answer is still on its way, or the URL names a
 * place this world lacks) shows as "any" instead of an empty box.
 */
export function shownValue(options: readonly SelectOption[], value: string | null): string {
  return value !== null && options.some((option) => option.value === value) ? value : ANY;
}

export const ROLE_OPTIONS = withAny('Any role', labelled(PERSON_ROLES, WORKER_ROLE_LABELS));
export const GENDER_OPTIONS = withAny('Any gender', labelled(GENDERS, GENDER_LABELS));
export const STYLE_OPTIONS = withAny('Any style', labelled(RING_STYLES, STYLE_LABELS));
/** Card positions top down; crew expect none, which reads "None". */
export const PUSH_OPTIONS = withAny('Any push', labelled(PUSH_LEVELS, PUSH_LABELS));

interface NumberFilterProps {
  readonly label: string;
  readonly value: number | null;
  readonly max: number;
  readonly disabled?: boolean;
  readonly onChange: (value: number | null) => void;
}

/** A whole number from 0 to `max`; empty means no limit. Anything above `max` becomes `max`. */
export function NumberFilter({ label, value, max, disabled = false, onChange }: NumberFilterProps) {
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

/** Two number fields read as one range: "Age from" and "Age to". */
export function RangeFilter({
  fromLabel,
  toLabel,
  from,
  to,
  max,
  onChange,
}: {
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly from: number | null;
  readonly to: number | null;
  readonly max: number;
  readonly onChange: (range: { from: number | null; to: number | null }) => void;
}) {
  return (
    <div className={styles['pair']}>
      <NumberFilter
        label={fromLabel}
        value={from}
        max={max}
        onChange={(value) => {
          onChange({ from: value, to });
        }}
      />
      <NumberFilter
        label={toLabel}
        value={to}
        max={max}
        onChange={(value) => {
          onChange({ from, to: value });
        }}
      />
    </div>
  );
}

export interface PlaceFilterValue {
  readonly continentId: ContinentId | null;
  readonly countryId: CountryId | null;
}

/** "Based in" (a continent) and "Country", the countries narrowed to the continent picked. */
export function PlaceFilters({
  value,
  facets,
  onChange,
}: {
  readonly value: PlaceFilterValue;
  readonly facets: Pick<WorkerListFacets, 'continents' | 'countries'>;
  readonly onChange: (value: PlaceFilterValue) => void;
}) {
  const continentOptions = withAny(
    'Any continent',
    facets.continents.map((continent) => ({
      value: continent.continentId,
      label: continent.name,
    })),
  );
  const countryOptions = withAny(
    'Any country',
    facets.countries
      .filter((country) => value.continentId === null || country.continentId === value.continentId)
      .map((country) => ({ value: country.countryId, label: country.name })),
  );
  return (
    <>
      <Select
        label="Based in"
        options={continentOptions}
        value={shownValue(continentOptions, value.continentId)}
        onValueChange={(picked) => {
          const continent = facets.continents.find((option) => option.continentId === picked);
          const continentId = continent?.continentId ?? null;
          const country = facets.countries.find((option) => option.countryId === value.countryId);
          // A country outside the new continent would leave the list empty for no visible reason.
          const keepsCountry =
            continentId === null || country === undefined || country.continentId === continentId;
          onChange({ continentId, countryId: keepsCountry ? value.countryId : null });
        }}
      />
      <Select
        label="Country"
        options={countryOptions}
        value={shownValue(countryOptions, value.countryId)}
        onValueChange={(picked) => {
          const country = facets.countries.find((option) => option.countryId === picked);
          onChange({ continentId: value.continentId, countryId: country?.countryId ?? null });
        }}
      />
    </>
  );
}

/** `bar` wraps across the page; `sheet` is one column for the phone's bottom sheet. */
export type FilterLayout = 'bar' | 'sheet';

/** The filters' grid, ending with Clear filters (disabled while nothing is set). */
export function FilterBarFrame({
  layout,
  clearDisabled,
  onClear,
  children,
}: {
  readonly layout: FilterLayout;
  readonly clearDisabled: boolean;
  readonly onClear: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div className={classNames(styles['filters'], styles[`filters-${layout}`])}>
      {children}
      <div className={styles['clear']}>
        <Button size="sm" variant="ghost" iconStart="close" disabled={clearDisabled} onClick={onClear}>
          Clear filters
        </Button>
      </div>
    </div>
  );
}

/** The phone's filter button: "Filters", or "Filters (2)" while some are set. */
export function filtersButtonText(activeCount: number): string {
  return activeCount === 0 ? 'Filters' : `Filters (${String(activeCount)})`;
}

/**
 * The filters above a list: a card above the table on desktop, a "Filters (2)" button that opens
 * them in a bottom sheet on a phone, whose footer says how many rows they leave ("Show 12 free
 * agents"). `children` draws the filter bar in the layout it is given.
 */
export function FilterPanel({
  isMobile,
  activeCount,
  showText,
  children,
}: {
  readonly isMobile: boolean;
  readonly activeCount: number;
  readonly showText: string;
  readonly children: (layout: FilterLayout) => ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  if (!isMobile) {
    return (
      <section className={styles['filterPanel']} aria-label="Filters">
        {children('bar')}
      </section>
    );
  }
  const close = (): void => {
    setSheetOpen(false);
  };
  return (
    <div className={styles['filterButton']}>
      <Button
        variant="secondary"
        iconStart="settings"
        aria-haspopup="dialog"
        onClick={() => {
          setSheetOpen(true);
        }}
      >
        {filtersButtonText(activeCount)}
      </Button>
      <Sheet
        open={sheetOpen}
        onClose={close}
        title="Filters"
        side="bottom"
        size="lg"
        footer={
          <Button variant="primary" onClick={close}>
            {showText}
          </Button>
        }
      >
        {children('sheet')}
      </Sheet>
    </div>
  );
}
