/**
 * How trace values read in the "Why?" panel. Traces carry raw numbers plus a unit (see
 * docs/design/tunables.md#units); this turns them into text with the shared formatters, so a
 * number reads the same in a breakdown as it does on the screen that showed it.
 */
import { cents } from '@ringside/engine';
import type { TraceUnit, TraceValue } from '@ringside/engine';
import { formatMoney, formatNumber, MINUS_SIGN } from '../format';

/** Every unit a trace node can carry, plus `people` for headcounts such as attendance. */
export type TraceDisplayUnit = TraceUnit | 'people';

/** Most decimals shown for a number without a unit, or with a unit that allows fractions. */
const DEFAULT_DECIMALS = 2;

/** Decimals shown for factors (ratios and multipliers), which are often finer: `×0.885`. */
export const FACTOR_DECIMALS = 3;

/** Decimals shown for percentages (`15.3%`). */
const PERCENT_DECIMALS = 1;

/** Turns a 0–1 probability into the 0–100 scale it is read on. */
const PERCENT_PER_PROBABILITY = 100;

function decimal(value: number, maximumFractionDigits = DEFAULT_DECIMALS): string {
  return formatNumber(value, { maximumFractionDigits });
}

function plural(value: number, singular: string, pluralForm: string): string {
  return `${decimal(value)} ${Math.abs(value) === 1 ? singular : pluralForm}`;
}

/** Money values are whole cents; a fraction that crept in through a multiplier is rounded. */
function money(value: number): string {
  return formatMoney(cents(Math.round(value)));
}

/**
 * A number in its unit:
 *
 * - `money` from cents (`−$1,250`), `money/month` adds `/month`;
 * - `percent` on the 0–100 scale (`15.3` → `15.3%`), `probability` from 0–1 (`0.153` → `15.3%`);
 * - `ratio` as a plain factor (`0.885`), `multiplier` as `×1.15`, both with up to 3 decimals;
 * - `points` (`37.6`), `points/day` (`4/day`), `stars` (`3.75★`);
 * - `days`, `months` and `years` with their word, `count` grouped (`12,400`), `people` (`12,400 people`);
 * - `kilograms` as `95 kg`;
 * - anything else, or no unit, as the number with up to 2 decimals.
 */
export function formatTraceNumber(value: number, unit?: TraceDisplayUnit): string {
  switch (unit) {
    case 'money':
      return money(value);
    case 'money/month':
      return `${money(value)}/month`;
    case 'percent':
      return `${decimal(value, PERCENT_DECIMALS)}%`;
    case 'probability':
      return `${decimal(value * PERCENT_PER_PROBABILITY, PERCENT_DECIMALS)}%`;
    case 'ratio':
      return decimal(value, FACTOR_DECIMALS);
    case 'multiplier':
      return `×${decimal(value, FACTOR_DECIMALS)}`;
    case 'points/day':
      return `${decimal(value)}/day`;
    case 'stars':
      return `${decimal(value)}★`;
    case 'days':
      return plural(value, 'day', 'days');
    case 'months':
      return plural(value, 'month', 'months');
    case 'years':
      return plural(value, 'year', 'years');
    case 'people':
      return plural(value, 'person', 'people');
    case 'kilograms':
      return `${decimal(value)} kg`;
    case 'points':
    case 'count':
    case 'flag':
    case 'choice':
    case undefined:
      return decimal(value);
  }
}

/** Any trace value: numbers in their unit, `yes`/`no` for booleans, text as it is, `–` for none. */
export function formatTraceValue(value: TraceValue, unit?: TraceDisplayUnit): string {
  if (typeof value === 'number') return formatTraceNumber(value, unit);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value === null) return '–';
  return value;
}

/**
 * A change with its sign always shown, in the unit: `+6`, `−$500`, `+2.5%`. A change that rounds
 * to nothing at the shown precision reads `±0`.
 */
export function formatTraceDelta(delta: number, unit?: TraceDisplayUnit): string {
  const magnitude = formatTraceNumber(Math.abs(delta), unit);
  if (!/[1-9]/.test(magnitude)) return `±${magnitude}`;
  return `${delta > 0 ? '+' : MINUS_SIGN}${magnitude}`;
}
