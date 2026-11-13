/**
 * A KPI's change since its last comparable history row (DAY2-03): `delta = current − previous`.
 *
 * "Last week" is a lookback rule, not a calendar rule: the caller compares with the latest row
 * dated on or before `today − office.delta.lookbackDays` (`previousSnapshot`). When that row is
 * older than the lookback plus six days (a long skip, or rows thinned to months) or is a monthly
 * row, a note says so instead of hiding it. Nothing is rounded; screens round. A missing previous
 * row is the caller's business: no delta at all, never a fake 0.
 *
 * Design: docs/design/office.md#kpis-and-deltas.
 */

import { diffDays, type GameDate } from '../../../core/date';
import { inputOf, startCalc, type Traced, type TraceUnit } from '../../../core/trace';
import type { PromotionSnapshotGranularity } from '../../../model/entities/promotion-snapshot';
import type { EngineTunables } from '../../tunables';
import { officeDateText } from '../dashboard/dateText';

export const KPI_DELTA_DOC_REF = 'office.md#kpis-and-deltas';

/** Days a weekly row may be late past the lookback before the comparison counts as stale. */
export const STALE_GRACE_DAYS = 6;

/** The plain inputs of {@link kpiDelta}. */
export interface KpiDeltaInputs {
  /** The KPI's name, such as "Cash". */
  readonly label: string;
  readonly unit: TraceUnit;
  /** Today's live value; a traced value nests its own Why?. */
  readonly current: number | Traced<number>;
  /** The history row compared with. */
  readonly previous: {
    readonly value: number;
    readonly date: GameDate;
    readonly granularity: PromotionSnapshotGranularity;
  };
  readonly today: GameDate;
}

/** The change in a KPI since the compared history row, with its Why?. */
export function kpiDelta(
  inputs: KpiDeltaInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { previous, today } = inputs;
  const previousText = officeDateText(previous.date, today);
  const age = diffDays(previous.date, today);
  const stale = age > deps.tunables.get('office.delta.lookbackDays') + STALE_GRACE_DAYS;
  const current =
    typeof inputs.current === 'number'
      ? inputOf(
          `This week (${officeDateText(today, today)})`,
          inputs.current,
          undefined,
          inputs.unit,
        )
      : inputs.current;
  const previousLabel =
    previous.granularity === 'week' && !stale
      ? `Last week (${previousText})`
      : `Last record (${previousText})`;
  const calc = startCalc(`Change in ${inputs.label} since ${previousText}`, current, {
    unit: inputs.unit,
    docRef: KPI_DELTA_DOC_REF,
  }).subtract(previousLabel, previous.value);
  if (stale) {
    calc.note(`The last record before that is from ${previousText}, ${String(age)} days ago`);
  }
  if (previous.granularity === 'month') {
    calc.note('Older weeks are kept as one record a month, so this compares with a monthly record');
  } else if (previous.granularity === 'baseline') {
    calc.note('This compares with the day the game began');
  }
  return calc.done();
}
