/**
 * Seasons (design decision D-08): the numbered stretches of game time that end with awards,
 * recaps and brand-war results.
 *
 * Seasons are world-wide: every promotion and brand shares them, so a season has no promotion.
 * They are rows rather than a counter on the world metadata so history screens can list past
 * seasons by number or date. The current season is `seasons.lookupOne('activeSeason', 'active')`;
 * there is no "current season" field to drift out of sync.
 *
 * The active season's `endDate` is its planned last day, computed from
 * `WorldMeta.settings.season.lengthDays` when the season is created. Season end, rollover and
 * awards belong to the DAY epic; results and brand-war standings are added later by the DAY and
 * BRW epics with a migration.
 *
 * Design notes: docs/design/data-model.md, "Titles, events, storylines and seasons".
 */

import { z } from 'zod';
import { compareDates, diffDays } from '../../core/date';
import type { IntegrityIssue } from '../integrity';
import { zGameDate, zId, zPositiveInt } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf, type WorldView } from '../world';

export const SEASON_STATUSES = ['active', 'completed'] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

/** The key the active season is filed under in the unique `activeSeason` index. */
export const ACTIVE_SEASON_KEY = 'active';

export const SeasonSchema = z
  .strictObject({
    id: zId('season'),
    /** 1 for the first season, then 2, 3, ... with no gaps. */
    number: zPositiveInt,
    startDate: zGameDate,
    /** The last day of the season (planned, for the active one). */
    endDate: zGameDate,
    status: z.enum(SEASON_STATUSES),
  })
  .refine((season) => compareDates(season.endDate, season.startDate) >= 0, {
    message: 'endDate must not be before startDate',
    path: ['endDate'],
  });

export type Season = z.infer<typeof SeasonSchema>;

const TABLE = 'seasons';

/**
 * Rule (9): when there are seasons at all, exactly one is active and it is the latest; numbers run
 * 1..n; each season starts the day after the previous one ends. An empty table is allowed: a world
 * still being built has no season until the new-game flow creates season 1.
 */
function checkSeasonSequence(view: WorldView): IntegrityIssue[] {
  const seasons = [...tableOf(view, seasonsTable).values()].sort(
    (left, right) => left.number - right.number,
  );
  const issues: IntegrityIssue[] = [];
  const latest = seasons.at(-1);
  if (latest === undefined) {
    return issues;
  }

  const active = seasons.filter((season) => season.status === 'active');
  if (active.length !== 1) {
    issues.push({
      code: 'seasons.activeCount',
      table: TABLE,
      message: `seasons: expected exactly one active season, found ${String(active.length)}`,
    });
  }
  for (const season of active) {
    if (season.number !== latest.number) {
      issues.push({
        code: 'seasons.activeNotLatest',
        table: TABLE,
        id: season.id,
        message: `seasons ${season.id}: active season ${String(season.number)} is older than season ${String(latest.number)}`,
      });
    }
  }

  seasons.forEach((season, index) => {
    if (season.number !== index + 1) {
      issues.push({
        code: 'seasons.numberGap',
        table: TABLE,
        id: season.id,
        path: 'number',
        message: `seasons ${season.id}: season number ${String(season.number)} where ${String(index + 1)} was expected`,
      });
    }
    const previous = seasons[index - 1];
    if (previous === undefined) {
      return;
    }
    const daysAfterPreviousEnd = diffDays(previous.endDate, season.startDate);
    if (daysAfterPreviousEnd < 1) {
      issues.push({
        code: 'seasons.overlap',
        table: TABLE,
        id: season.id,
        path: 'startDate',
        message: `seasons ${season.id}: season ${String(season.number)} starts ${season.startDate}, before season ${String(previous.number)} ends on ${previous.endDate}`,
      });
    } else if (daysAfterPreviousEnd > 1) {
      issues.push({
        code: 'seasons.notContiguous',
        table: TABLE,
        id: season.id,
        path: 'startDate',
        message: `seasons ${season.id}: season ${String(season.number)} starts ${season.startDate}; it should start the day after season ${String(previous.number)} ends`,
      });
    }
  });
  return issues;
}

export const seasonsTable = defineTable({
  kind: 'season',
  name: 'seasons',
  schema: SeasonSchema,
  refs: [],
  indexes: [
    { name: 'byNumber', key: (season) => String(season.number), unique: true },
    {
      name: 'activeSeason',
      key: (season) => (season.status === 'active' ? ACTIVE_SEASON_KEY : null),
      unique: true,
    },
  ],
  invariants: [{ name: 'seasonsNumberedAndContiguous', check: checkSeasonSequence }],
});
