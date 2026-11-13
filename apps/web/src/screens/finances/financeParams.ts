import {
  firstDayOfYearMonth,
  isYearMonth,
  LEDGER_CATEGORIES,
  month as monthOf,
  year as yearOf,
} from '@ringside/engine';
import type { LedgerCategory, YearMonth } from '@ringside/engine';
import { FINANCES_PARAMS } from '@/app/routes';

/**
 * The Finances screen's URL: `?tab=` picks the tab, and the Ledger's filters ride along as
 * `?month=YYYY-MM&category=<key>`. Values that do not parse are ignored, never an error.
 */

/** The built-in tabs' ids, which are also their `?tab=` values. */
export const FINANCE_TAB_IDS = {
  overview: 'overview',
  monthly: 'monthly',
  ledger: 'ledger',
  policies: 'policies',
} as const;

/** The tab shown when the URL names none, or one that is unknown or hidden. */
export const DEFAULT_FINANCE_TAB_ID = FINANCE_TAB_IDS.overview;

export function isLedgerCategory(value: unknown): value is LedgerCategory {
  return LEDGER_CATEGORIES.some((category) => category === value);
}

/** The Ledger's filters, as the URL holds them. */
export interface LedgerFilters {
  readonly month: YearMonth | null;
  readonly category: LedgerCategory | null;
}

/** The Ledger filters in `search`; anything that does not parse is left out. */
export function ledgerFiltersOf(search: URLSearchParams): LedgerFilters {
  const month = search.get(FINANCES_PARAMS.month);
  const category = search.get(FINANCES_PARAMS.category);
  return {
    month: isYearMonth(month) ? month : null,
    category: isLedgerCategory(category) ? category : null,
  };
}

/** `search` with the Ledger filters replaced by `filters` (a null filter is removed). */
export function withLedgerFilters(
  search: URLSearchParams,
  filters: LedgerFilters,
): URLSearchParams {
  const next = new URLSearchParams(search);
  if (filters.month === null) next.delete(FINANCES_PARAMS.month);
  else next.set(FINANCES_PARAMS.month, filters.month);
  if (filters.category === null) next.delete(FINANCES_PARAMS.category);
  else next.set(FINANCES_PARAMS.category, filters.category);
  return next;
}

const LOCALE = 'en-US';
const shortMonthFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'UTC',
  month: 'short',
  year: 'numeric',
});
const longMonthFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});

/** A month for display: `Jan 2027` (short, the default) or `January 2027` (long). */
export function formatYearMonth(month: YearMonth, style: 'short' | 'long' = 'short'): string {
  const first = firstDayOfYearMonth(month);
  const instant = new Date(Date.UTC(yearOf(first), monthOf(first) - 1, 1));
  return (style === 'long' ? longMonthFormat : shortMonthFormat).format(instant);
}
