/**
 * The league roster snapshot: the fields of the owner's league (its public API) that the default
 * world uses, committed as plain JSON so the world build is deterministic and needs no network.
 *
 * It holds ring names and wrestling data only. Nothing personal about league members goes in: no
 * player names, gamer tags, IDs, pictures or account fields. `fetch-league.ts` writes it.
 */

import { z } from 'zod';

export const LEAGUE_SNAPSHOT_FILE = 'league-roster.json';

/** The league's divisions, as the build knows them. */
export const LEAGUE_DIVISIONS = ['heavyweight', 'midCard', 'youngBoys', 'jobber'] as const;
export type LeagueDivision = (typeof LEAGUE_DIVISIONS)[number];

export const LEAGUE_ALIGNMENTS = ['face', 'heel', 'neutral'] as const;

const moveListSchema = z.array(z.string().min(1).max(60));

export const leagueWrestlerSchema = z.strictObject({
  ringName: z.string().min(1).max(60),
  /** Null = no division. */
  division: z.enum(LEAGUE_DIVISIONS).nullable(),
  alignment: z.enum(LEAGUE_ALIGNMENTS),
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  draws: z.number().int().min(0),
  /** Seasons they had at least one match in, oldest first. */
  seasons: z.array(
    z.strictObject({
      name: z.string(),
      wins: z.number().int().min(0),
      losses: z.number().int().min(0),
      draws: z.number().int().min(0),
    }),
  ),
  /** The league's overall cap for the wrestler they use, when they have one. */
  overallCap: z.number().int().min(0).max(100).nullable(),
  finishers: moveListSchema,
  signatures: moveListSchema,
  bio: z.string().min(1).nullable(),
});
export type LeagueWrestler = z.infer<typeof leagueWrestlerSchema>;

export const leagueTitleSchema = z.strictObject({
  name: z.string().min(1),
  kind: z.enum(['singles', 'tag']),
  division: z.enum(LEAGUE_DIVISIONS).nullable(),
  /** Ring names of the current champion(s); empty when vacant or not imported. */
  championRingNames: z.array(z.string()),
});
export type LeagueTitle = z.infer<typeof leagueTitleSchema>;

export const leagueTeamSchema = z.strictObject({
  name: z.string().min(1).max(60),
  /** A tag team (2), or a stable of exactly 3, which the world keeps as a trio. */
  kind: z.enum(['tag', 'trio']),
  memberRingNames: z.array(z.string()).min(2).max(3),
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
});
export type LeagueTeam = z.infer<typeof leagueTeamSchema>;

/** A recurring league show: a weekly TV show on its weekday, or a PPV in its place in the year. */
export const leagueShowSchema = z.strictObject({
  name: z.string().min(1).max(80),
  kind: z.enum(['weekly', 'ppv']),
  /** Weekly shows: 0 = Monday … 6 = Sunday. Null for PPVs. */
  weekday: z.number().int().min(0).max(6).nullable(),
  /** PPVs: their place in the league's calendar year, from its PPV dates (0 first). */
  order: z.number().int().min(0).nullable(),
  /** The day the league created the show (YYYY-MM-DD). */
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
});
export type LeagueShow = z.infer<typeof leagueShowSchema>;

export const leagueSnapshotSchema = z.strictObject({
  source: z.string(),
  fetchedOn: z.string(),
  /** How many league players were left out, and why. */
  skipped: z.strictObject({
    blocklist: z.number().int().min(0),
    personalName: z.number().int().min(0),
    duplicate: z.number().int().min(0),
    noRingName: z.number().int().min(0),
    placeholder: z.number().int().min(0),
  }),
  titles: z.array(leagueTitleSchema),
  teams: z.array(leagueTeamSchema),
  /** Sorted: weekly shows by weekday, then PPVs in order. */
  shows: z.array(leagueShowSchema),
  /** How many league shows were left out because their name hit the blocklist. */
  skippedShows: z.number().int().min(0),
  /** Sorted by ring name. */
  wrestlers: z.array(leagueWrestlerSchema),
});
export type LeagueSnapshot = z.infer<typeof leagueSnapshotSchema>;
