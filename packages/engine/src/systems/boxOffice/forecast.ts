/**
 * The crowd forecast for one show: the expected crowd with its Why?, and the range the real crowd
 * can land in. Read by the booking panel, the venue pick (EVT6-02, EVT6-03), the show-day crowd
 * roll (EVT6-04) and later ECO3 and BRW5.
 *
 * Popularity follows the same-day rule (promotion-popularity.md#same-day-ordering-for-attendance):
 * once a show is completed its popularity has already moved, so the forecast reads the popularity
 * the show started from. Capacity is applied by the caller. Design: docs/design/box-office.md#forecast.
 */

import type { RegionId } from '../../core/ids';
import type { Traced } from '../../core/trace';
import type { EventInstance } from '../../model/entities/event-instance';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { popularityBeforeShow } from '../promoPop/helpers';
import type { EngineTunables } from '../tunables';
import { bigShowsBefore, type BigShowsBefore } from './bigShows';
import { computeBigShowFatigue } from './formulas/bigShowFatigue';
import {
  computeExpectedAttendance,
  type ExpectedAttendanceInputs,
} from './formulas/expectedAttendance';
import { computeRecentFormMultiplier } from './formulas/recentFormMultiplier';
import { hypeLineFor } from './hype';
import { recentFormOf, type RecentForm } from './recentForm';

/** Where to forecast the show, when not in its own region ("what if this venue elsewhere"). */
export interface ForecastPlace {
  readonly regionId: RegionId;
}

export interface AttendanceForecast {
  /** The expected crowd, before any venue cap. */
  readonly expected: Traced<number>;
  /** The lowest the real crowd can be, before any venue cap. */
  readonly low: number;
  /** The highest the real crowd can be, before any venue cap. */
  readonly high: number;
  /** What the forecast was built from. */
  readonly inputs: ExpectedAttendanceInputs & {
    readonly regionId: RegionId;
    readonly recentShows: RecentForm;
    readonly bigShows: BigShowsBefore;
  };
}

/** The crowd forecast for `instance`, in its own region unless `at` names another. */
export function forecastAttendance(
  read: GameWorldView,
  tunables: EngineTunables,
  instance: DeepReadonly<EventInstance>,
  at?: ForecastPlace,
): AttendanceForecast {
  const regionId = at?.regionId ?? instance.regionId;
  const promotion = read.tables.promotions.get(instance.promotionId);
  const region = read.tables.regions.get(regionId);
  const popularity =
    popularityBeforeShow(read, instance.id, regionId) ?? promotion?.regionalPop[regionId] ?? 0;
  const recentShows = recentFormOf(read, {
    promotionId: instance.promotionId,
    beforeDate: instance.date,
    excludeEventInstanceId: instance.id,
    tunables,
  });
  const bigShows = bigShowsBefore(read, {
    promotionId: instance.promotionId,
    date: instance.date,
    excludeEventInstanceId: instance.id,
    tunables,
  });
  const inputs: ExpectedAttendanceInputs = {
    popularity,
    regionName: region?.name ?? regionId,
    regionRef: { kind: 'region', id: regionId },
    marketingLevel: promotion?.production.marketing ?? 0,
    importance: instance.importance,
    recentForm: computeRecentFormMultiplier(
      { averageScore: recentShows.averageScore, showCount: recentShows.showCount },
      { tunables },
    ),
    bigShowFatigue: computeBigShowFatigue(
      { importance: instance.importance, bigShowsBefore: bigShows.count },
      { tunables },
    ),
    hype: hypeLineFor(read, instance, tunables),
  };
  const expected = computeExpectedAttendance(inputs, { tunables });
  const spread = tunables.get('boxOffice.crowd.spread');
  return {
    expected,
    low: Math.round(expected.value * (1 - spread)),
    high: Math.round(expected.value * (1 + spread)),
    inputs: { ...inputs, regionId, recentShows, bigShows },
  };
}
