/**
 * The Office's world clock (DAY2-03): today, the season and when the next weekly history row is
 * taken. Dates only; the game has no time of day.
 *
 * Design: docs/design/office.md#world-clock.
 */

import { nextOccurrence } from '../../../core/calendar/cadence';
import { diffDays, weekday, type GameDate, type Weekday } from '../../../core/date';
import { ACTIVE_SEASON_KEY } from '../../../model/entities/season';
import type { GameWorldView } from '../../../model/tables';
import { weeklySnapshotPhase } from '../phases';

/** Days in a week, for the season's week number. */
const DAYS_PER_WEEK = 7;

/** The active season as the clock shows it. */
export interface OfficeClockSeason {
  number: number;
  startDate: GameDate;
  endDate: GameDate;
  /** 1 for the season's first seven days, then 2, 3, ... */
  week: number;
  /** Days after today until the season's last day (0 on the last day). */
  daysLeft: number;
}

/** `office.dashboard`'s clock. */
export interface OfficeClock {
  date: GameDate;
  /** 0 = Monday .. 6 = Sunday. */
  weekday: Weekday;
  /** Day 1 is the world's start date (as `clock.get`). */
  dayNumber: number;
  /** The active season, or null before the first season exists. */
  season: OfficeClockSeason | null;
  /**
   * The day the next weekly history row is taken: the next Monday on or after today, since today's
   * row is taken when today is simulated.
   */
  nextSnapshotOn: GameDate;
}

/** The clock on `date`. */
export function officeClock(read: GameWorldView, date: GameDate): OfficeClock {
  const season = read.tables.seasons.lookupOne('activeSeason', ACTIVE_SEASON_KEY);
  return {
    date,
    weekday: weekday(date),
    dayNumber: diffDays(read.meta.startDate, date) + 1,
    season:
      season === undefined
        ? null
        : {
            number: season.number,
            startDate: season.startDate,
            endDate: season.endDate,
            week: Math.floor(Math.max(0, diffDays(season.startDate, date)) / DAYS_PER_WEEK) + 1,
            daysLeft: Math.max(0, diffDays(date, season.endDate)),
          },
    nextSnapshotOn: nextOccurrence(date, weeklySnapshotPhase.cadence),
  };
}
