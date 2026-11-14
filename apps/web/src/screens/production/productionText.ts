import type { EngineQueryError } from '@/app/engine/queryCache';
import type { TraceDisplayUnit } from '@/components/Trace';

/**
 * Small wording and unit helpers the Production screen, its change dialog and its gallery entries
 * share.
 */

/** The units a production number can carry and the trace formatter knows. */
const KNOWN_UNITS: ReadonlySet<string> = new Set<TraceDisplayUnit>([
  'money',
  'money/month',
  'points',
  'points/day',
  'percent',
  'probability',
  'ratio',
  'multiplier',
  'count',
  'days',
  'months',
  'years',
  'people',
  'stars',
  'attribute',
]);

function isDisplayUnit(unit: string): unit is TraceDisplayUnit {
  return KNOWN_UNITS.has(unit);
}

/**
 * The formatter's unit for an engine unit string (`money`, `points`), or undefined for one it does
 * not know (an effect's `level`), which then reads as a plain number.
 */
export function displayUnitOf(unit: string | null | undefined): TraceDisplayUnit | undefined {
  return unit !== null && unit !== undefined && isDisplayUnit(unit) ? unit : undefined;
}

/** True for money: a cost going up is bad news, any other number going up is good news. */
export function isMoneyUnit(unit: string | null | undefined): boolean {
  return unit === 'money' || unit === 'money/month';
}

/** "4 weeks" for 28 days, "1 week", "10 days" when it is not whole weeks. */
export function forecastWindowText(days: number): string {
  if (days > 0 && days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? 'week' : `${String(weeks)} weeks`;
  }
  return days === 1 ? 'day' : `${String(days)} days`;
}

/** "4 shows", "1 show". */
export function showCountText(count: number): string {
  return count === 1 ? '1 show' : `${String(count)} shows`;
}

/** The words behind a query that could not answer: the engine's reasons, or the transport's. */
export function queryErrorText(error: EngineQueryError | null): string {
  if (error === null) return 'Something went wrong.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}
