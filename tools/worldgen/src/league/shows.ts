/**
 * SLW's recurring shows from the league snapshot: its weekly TV shows on their weekdays and its
 * PPVs as the year's majors, in the order the league ran them.
 *
 * `events.json` is hand-written for every other promotion, so this rewrites only SLW's entries in
 * it and leaves the rest byte for byte. The Monday and Wednesday shows keep the record keys of the
 * shows they replace, so the TV deals that name those keys carry on unchanged.
 *
 * Design: docs/design/default-world.md#the-league-roster.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { z } from 'zod';
import { compareText } from '../stats';
import { SLW_PROMOTION } from './roster';
import type { LeagueShow, LeagueSnapshot } from './snapshot';

export const EVENTS_FILE = 'events.json';

/** Weekday → the existing record key a weekly show takes over (its TV deal names that key). */
const KEPT_WEEKLY_KEYS: Readonly<Record<number, string>> = {
  0: 'flagship-mainstage-weekly',
  2: 'flagship-overclock-weekly',
};

const MAIN_BRAND = 'flagship-main-brand';
const YOUNG_BRAND = 'flagship-young-brand';

/** Weekday → brand: Mainstage takes Monday, Thursday and Friday; Overclock the rest. */
const BRAND_BY_WEEKDAY: Readonly<Record<number, string>> = {
  0: MAIN_BRAND,
  1: YOUNG_BRAND,
  2: YOUNG_BRAND,
  3: MAIN_BRAND,
  4: MAIN_BRAND,
  5: YOUNG_BRAND,
  6: MAIN_BRAND,
};

const WEEKLY_VENUES = ['harrowmere-arena', 'calderwick-arena'] as const;
const PPV_VENUES = ['brackwater-arena', 'harrowmere-arena', 'calderwick-arena'] as const;
const VENUE_REGION: Readonly<Record<string, string>> = {
  'harrowmere-arena': 'us-northeast',
  'calderwick-arena': 'us-northeast',
  'brackwater-arena': 'us-mid-atlantic',
};

/** The PPVs spread over the year: the first in February, then every other month, on a Sunday. */
const FIRST_PPV_MONTH = 2;
const PPV_MONTH_STEP = 2;
const PPV_WEEK = 2;
const SUNDAY = 6;

export interface EventDefinitionOut {
  key: string;
  promotionKey: string;
  brandKey: string | null;
  name: string;
  importance: 'regular' | 'major';
  recurrence:
    | { kind: 'weekly'; weekdays: number[] }
    | { kind: 'annual'; month: number; week: number; weekday: number };
  format: { slots: number; preShowSlots: number };
  televised: boolean;
  preferredRegionKey: string;
  preferredVenueKey: string;
  activeFrom: string;
  activeUntil: null;
  logoRef: null;
}

function slugOf(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function venueRegion(venue: string): string {
  return VENUE_REGION[venue] ?? 'us-northeast';
}

function weeklyShow(show: LeagueShow, index: number): EventDefinitionOut {
  const weekday = show.weekday ?? 0;
  const kept = KEPT_WEEKLY_KEYS[weekday];
  const venue = WEEKLY_VENUES[index % WEEKLY_VENUES.length] ?? WEEKLY_VENUES[0];
  return {
    key: kept ?? `slw-${slugOf(show.name)}-weekly`,
    promotionKey: SLW_PROMOTION,
    brandKey: BRAND_BY_WEEKDAY[weekday] ?? MAIN_BRAND,
    name: show.name,
    importance: 'regular',
    recurrence: { kind: 'weekly', weekdays: [weekday] },
    format: { slots: 6, preShowSlots: 0 },
    // Only the shows with a TV deal (Monday and Wednesday) are on television.
    televised: kept !== undefined,
    preferredRegionKey: venueRegion(venue),
    preferredVenueKey: venue,
    activeFrom: show.since,
    activeUntil: null,
    logoRef: null,
  };
}

function ppvShow(show: LeagueShow): EventDefinitionOut {
  const order = show.order ?? 0;
  const venue = PPV_VENUES[order % PPV_VENUES.length] ?? PPV_VENUES[0];
  return {
    key: `slw-${slugOf(show.name)}`,
    promotionKey: SLW_PROMOTION,
    brandKey: null,
    name: show.name,
    importance: 'major',
    recurrence: {
      kind: 'annual',
      month: FIRST_PPV_MONTH + ((order * PPV_MONTH_STEP) % 12),
      week: PPV_WEEK,
      weekday: SUNDAY,
    },
    format: { slots: 8, preShowSlots: 1 },
    televised: true,
    preferredRegionKey: venueRegion(venue),
    preferredVenueKey: venue,
    activeFrom: show.since,
    activeUntil: null,
    logoRef: null,
  };
}

/** SLW's event definitions from the snapshot; at most six PPVs fit the every-other-month year. */
export function leagueEventDefinitions(snapshot: LeagueSnapshot): EventDefinitionOut[] {
  const weekly = snapshot.shows.filter((show) => show.kind === 'weekly');
  const ppvs = snapshot.shows.filter((show) => show.kind === 'ppv' && (show.order ?? 0) < 6);
  return [...weekly.map(weeklyShow), ...ppvs.map(ppvShow)];
}

const keyedRecordsSchema = z.array(z.looseObject({ key: z.string(), promotionKey: z.string() }));
interface KeyedRecord {
  readonly key: string;
  readonly promotionKey: string;
}

/**
 * The world's `events.json` with SLW's shows replaced by the league's, or null when the snapshot
 * has no shows (then SLW keeps the shows it has).
 */
export async function renderLeagueEvents(
  worldDir: string,
  snapshot: LeagueSnapshot,
): Promise<string | null> {
  const definitions = leagueEventDefinitions(snapshot);
  if (definitions.length === 0) {
    return null;
  }
  const current = keyedRecordsSchema.parse(
    JSON.parse(await readFile(join(worldDir, EVENTS_FILE), 'utf8')),
  );
  const rows: KeyedRecord[] = [
    ...current.filter((row) => row.promotionKey !== SLW_PROMOTION),
    ...definitions,
  ].sort((left, right) => compareText(left.key, right.key));
  // Formatted the way the repo's Prettier config formats it, like the hand-written file.
  const path = join(worldDir, EVENTS_FILE);
  const options = (await resolveConfig(path)) ?? {};
  return format(JSON.stringify(rows, null, 2), { ...options, filepath: path });
}

export async function writeLeagueEvents(worldDir: string, text: string): Promise<void> {
  await writeFile(join(worldDir, EVENTS_FILE), text, 'utf8');
}
