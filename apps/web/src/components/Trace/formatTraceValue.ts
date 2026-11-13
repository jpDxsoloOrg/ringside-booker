/**
 * How trace values read in the "Why?" panel. Traces carry raw numbers plus a unit (see
 * docs/design/tunables.md#units); this turns them into text with the shared formatters, so a
 * number reads the same in a breakdown as it does on the screen that showed it. The panel reads a
 * trace through `withStepUnits` first, so every step of a money calculation arrives here as money.
 */
import { cents } from '@ringside/engine';
import type { TraceUnit, TraceValue } from '@ringside/engine';
import { formatMoney, formatNumber, formatPopularity, MINUS_SIGN } from '../format';

/** Every unit a trace node can carry, plus `people` for headcounts such as attendance. */
export type TraceDisplayUnit = TraceUnit | 'people';

/** Most decimals shown for a number without a unit, or with a unit that allows fractions. */
const DEFAULT_DECIMALS = 2;

/** Decimals shown for factors (ratios and multipliers), which are often finer: `×0.885`. */
export const FACTOR_DECIMALS = 3;

/** Decimals shown for a worker attribute and its changes: learning gains are hundredths (`0.042`). */
const ATTRIBUTE_DECIMALS = 3;

/** Decimals shown for percentages (`15.3%`). */
const PERCENT_DECIMALS = 1;

/**
 * Decimals for a percentage under 1%: a daily chance such as an off-screen injury's (`0.082%`)
 * would otherwise read `0.1%` at every step and hide what each step did.
 */
const SMALL_PERCENT_DECIMALS = 3;

/** A value on the 0–100 scale as a percentage, finer under 1%. */
function percent(value: number): string {
  const decimals = Math.abs(value) < 1 ? SMALL_PERCENT_DECIMALS : PERCENT_DECIMALS;
  return `${decimal(value, decimals)}%`;
}

/** Turns a 0–1 probability into the 0–100 scale it is read on. */
const PERCENT_PER_PROBABILITY = 100;

function decimal(value: number, maximumFractionDigits = DEFAULT_DECIMALS): string {
  return formatNumber(value, { maximumFractionDigits });
}

function plural(value: number, singular: string, pluralForm: string): string {
  return `${decimal(value)} ${Math.abs(value) === 1 ? singular : pluralForm}`;
}

/** Below this many cents ($1,000) an amount that is not whole dollars shows its cents. */
const SHOW_CENTS_BELOW = 100_000;
const CENTS_PER_DOLLAR = 100;

/**
 * Money values are whole cents; a fraction that crept in through a multiplier is rounded. Cents
 * show only where they mean something: on a small amount that is not whole dollars (a $12.50
 * ticket), never on a big one ($38,703,208, not $38,703,208.40).
 */
function money(value: number, exact = false): string {
  const amount = cents(Math.round(value));
  const showCents =
    exact || (amount % CENTS_PER_DOLLAR !== 0 && Math.abs(amount) < SHOW_CENTS_BELOW);
  return formatMoney(amount, { showCents });
}

/**
 * Two values a step moved between, `before → after`. When they differ but read the same at the
 * usual precision (a big amount rounded to the cent), money shows its cents so the change is seen.
 */
export function formatTraceChange(before: number, after: number, unit?: TraceDisplayUnit): string {
  const beforeText = formatTraceNumber(before, unit);
  const afterText = formatTraceNumber(after, unit);
  if (beforeText !== afterText || before === after) return `${beforeText} → ${afterText}`;
  if (unit === 'money') return `${money(before, true)} → ${money(after, true)}`;
  if (unit === 'money/month') return `${money(before, true)}/month → ${money(after, true)}/month`;
  return `${beforeText} → ${afterText}`;
}

/**
 * A number in its unit:
 *
 * - `money` from cents (`−$1,250`, `$12.50` for a small amount with cents), `money/month` adds
 *   `/month`;
 * - `percent` on the 0–100 scale (`15.3` → `15.3%`), `probability` from 0–1 (`0.153` → `15.3%`),
 *   with up to 3 decimals under 1% (`0.00082` → `0.082%`);
 * - `ratio` as a plain factor (`0.885`), `multiplier` as `×1.15`, both with up to 3 decimals;
 * - `points` as popularity reads everywhere (`components/format/popularity.ts`): one decimal at
 *   most (`70.3`); `points/day` (`4/day`), `stars` (`3.75★`);
 * - `days`, `months` and `years` with their word, `count` grouped (`12,400`), `people` (`12,400 people`);
 * - `kilograms` as `95 kg`;
 * - `attribute` (a worker attribute or a change to one) with up to 3 decimals (`0.042`), since a
 *   match teaches hundredths of a point;
 * - anything else, or no unit, as the number with up to 2 decimals.
 */
export function formatTraceNumber(value: number, unit?: TraceDisplayUnit): string {
  switch (unit) {
    case 'money':
      return money(value);
    case 'money/month':
      return `${money(value)}/month`;
    case 'percent':
      return percent(value);
    case 'probability':
      return percent(value * PERCENT_PER_PROBABILITY);
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
    case 'attribute':
      return decimal(value, ATTRIBUTE_DECIMALS);
    case 'points':
      return formatPopularity(value);
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
