/**
 * Number, money and date formatters for the UI.
 *
 * The engine hands the UI raw values: integer `Cents`, plain numbers and `GameDate` strings.
 * Presentation (compact money, signs, date wording) happens here, at the edge, once. Locale is
 * fixed to en-US for now; the viewer settings screen will make it a preference.
 *
 * Negative numbers use the true minus sign (U+2212), which is the width of a plus sign, so signed
 * columns line up.
 */
import { dayOfMonth, diffDays, month, year } from '@ringside/engine';
import type { Cents, GameDate } from '@ringside/engine';

const LOCALE = 'en-US';

/** U+2212, the typographic minus sign. */
export const MINUS_SIGN = '−';

const CENTS_PER_DOLLAR = 100;
const CURRENCY_SYMBOL = '$';

const groupedIntegerFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});

const shortDateFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
const longDateFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'UTC',
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});
/** The pieces of the day-first styles: `Mon`, `4`, `Jan` and `2027`, joined by hand in that order. */
const dayFirstDateFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'UTC',
  weekday: 'short',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
const relativeDayFormat = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/** Swaps the ASCII hyphen-minus that Intl writes for a true minus sign. */
function withTrueMinus(formatted: string): string {
  return formatted.replace(/-/g, MINUS_SIGN);
}

export type MoneyStyle = 'full' | 'compact';

export interface FormatMoneyOptions {
  /** `full` ($1,234,567, the default) or `compact` ($1.2M). */
  readonly style?: MoneyStyle;
  /** Show cents in the `full` style ($1,234,567.89). Whole dollars otherwise. */
  readonly showCents?: boolean;
}

/** Whole dollars and leftover cents of a non-negative amount, using integer maths only. */
function splitCents(absoluteCents: number): { dollars: number; centsPart: number } {
  const centsPart = absoluteCents % CENTS_PER_DOLLAR;
  // Subtracting the remainder first makes the division exact, even for very large amounts.
  const dollars = (absoluteCents - centsPart) / CENTS_PER_DOLLAR;
  return { dollars, centsPart };
}

/** Whole dollars of a non-negative amount, rounded to the nearest dollar (halves up). */
function roundedDollars(absoluteCents: number): number {
  const { dollars, centsPart } = splitCents(absoluteCents);
  return centsPart * 2 >= CENTS_PER_DOLLAR ? dollars + 1 : dollars;
}

/**
 * Money from integer cents. Whole dollars by default, rounded to the nearest dollar:
 * `123456700` is `$1,234,567` in full and `$1.2M` compact. Negatives read `−$1.2M`. An amount
 * that rounds to zero shows as `$0`, never `−$0`. The cents are split off with integer maths, so
 * no float artefact such as `$0.30000000000000004` can appear.
 */
export function formatMoney(amount: Cents, options: FormatMoneyOptions = {}): string {
  const { style = 'full', showCents = false } = options;
  const isNegative = amount < 0;
  const absoluteCents = Math.abs(amount);

  let body: string;
  let isZero: boolean;
  if (style === 'full' && showCents) {
    const { dollars, centsPart } = splitCents(absoluteCents);
    body = `${groupedIntegerFormat.format(dollars)}.${String(centsPart).padStart(2, '0')}`;
    isZero = absoluteCents === 0;
  } else {
    const dollars = roundedDollars(absoluteCents);
    body =
      style === 'compact' ? compactFormat.format(dollars) : groupedIntegerFormat.format(dollars);
    isZero = dollars === 0;
  }

  const sign = isNegative && !isZero ? MINUS_SIGN : '';
  return `${sign}${CURRENCY_SYMBOL}${body}`;
}

export interface FormatNumberOptions {
  /** Most decimal places to show. 0 by default. */
  readonly maximumFractionDigits?: number;
}

/** A grouped number (`12,345`), with a true minus sign for negatives. */
export function formatNumber(value: number, options: FormatNumberOptions = {}): string {
  const { maximumFractionDigits = 0 } = options;
  const formatted = new Intl.NumberFormat(LOCALE, { maximumFractionDigits }).format(value);
  return withTrueMinus(formatted);
}

/** A ratio as a percentage with exactly `digits` decimals: `formatPercent(0.125, 1)` is `12.5%`. */
export function formatPercent(ratio: number, digits = 0): string {
  const formatted = new Intl.NumberFormat(LOCALE, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio);
  return withTrueMinus(formatted);
}

/**
 * A change with its sign always shown: `+6`, `−3`, and a bare `0` for no change (including a
 * value that rounds to zero at the given precision).
 */
export function formatSigned(value: number, options: FormatNumberOptions = {}): string {
  const magnitude = formatNumber(Math.abs(value), options);
  if (/^[0.,]*$/.test(magnitude)) {
    return '0';
  }
  return `${value > 0 ? '+' : MINUS_SIGN}${magnitude}`;
}

export type GameDateStyle = 'short' | 'long' | 'dayMonth' | 'dayMonthYear';

/**
 * A game date for display:
 *
 * - `short` is `Jan 1, 2031`;
 * - `long` is `Wednesday, January 1, 2031`;
 * - `dayMonth` is `Mon 4 Jan`, for calendar rows and week labels where the year is already on
 *   screen;
 * - `dayMonthYear` is `Mon 4 Jan 2027`, the same with its year.
 *
 * Game dates are calendar days, not instants, so they are formatted in UTC and never shift a day
 * in the player's time zone.
 */
export function formatGameDate(date: GameDate, style: GameDateStyle = 'short'): string {
  const instant = utcMidnightOf(date);
  switch (style) {
    case 'long':
      return longDateFormat.format(instant);
    case 'dayMonth':
      return dayFirstText(instant, false);
    case 'dayMonthYear':
      return dayFirstText(instant, true);
    case 'short':
      return shortDateFormat.format(instant);
  }
}

/** `Mon 4 Jan`, with ` 2027` after it when asked: weekday, day, month, in that order. */
function dayFirstText(instant: Date, withYear: boolean): string {
  const parts = dayFirstDateFormat.formatToParts(instant);
  const partOf = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const dayMonth = `${partOf('weekday')} ${partOf('day')} ${partOf('month')}`;
  return withYear ? `${dayMonth} ${partOf('year')}` : dayMonth;
}

/** The short date in two pieces, so a crowded bar can drop the year and keep the day. */
export interface ShortGameDateParts {
  /** `Jan 1`. */
  readonly monthDay: string;
  /** `, 2031`: the year with the separator before it. */
  readonly year: string;
}

/**
 * The short game date split before its year: `Jan 1` and `, 2031`. The two pieces join back into
 * `formatGameDate(date)`.
 */
export function formatShortGameDateParts(date: GameDate): ShortGameDateParts {
  const parts = shortDateFormat.formatToParts(utcMidnightOf(date));
  const yearIndex = parts.findIndex((part) => part.type === 'year');
  if (yearIndex < 0) return { monthDay: joinParts(parts), year: '' };
  const splitAt = parts[yearIndex - 1]?.type === 'literal' ? yearIndex - 1 : yearIndex;
  return { monthDay: joinParts(parts.slice(0, splitAt)), year: joinParts(parts.slice(splitAt)) };
}

/** Game dates are calendar days, so they are formatted at UTC midnight. */
function utcMidnightOf(date: GameDate): Date {
  return new Date(Date.UTC(year(date), month(date) - 1, dayOfMonth(date)));
}

function joinParts(parts: readonly Intl.DateTimeFormatPart[]): string {
  return parts.map((part) => part.value).join('');
}

/**
 * How far `to` is from `from` in days, in words: `today`, `tomorrow`, `in 5 days`, `yesterday`,
 * `5 days ago`. `from` is usually the current game date.
 */
export function formatDaysBetween(from: GameDate, to: GameDate): string {
  return relativeDayFormat.format(diffDays(from, to), 'day');
}
