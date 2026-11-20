/**
 * `npm run league:fetch -w @ringside/tool-worldgen`: reads the owner's league from its public API
 * (GET endpoints only, no credentials) and writes `content/worlds/default/league-roster.json`.
 *
 * Only the fields the world build uses are kept. League members' personal data (player names,
 * gamer tags, IDs, pictures, account fields) is read only to leave it out: a ring name that is the
 * player's own name or gamer tag is skipped, and so is a bio that mentions either.
 *
 * Players whose ring name is on the real-name blocklist are skipped too, as are move names and bios
 * that mention a blocked name, so the snapshot never holds a real performer's name.
 *
 * Usage: tsx src/league/fetch-league.ts [--api <base url>]
 */

import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { foldName } from '@ringside/validate-world/real-name-matcher';
import { format, resolveConfig } from 'prettier';
import { z } from 'zod';
import { readLeagueBlocklist, type LeagueBlocklist } from './blocklist';
import {
  LEAGUE_SNAPSHOT_FILE,
  leagueSnapshotSchema,
  type LeagueDivision,
  type LeagueSnapshot,
  type LeagueTeam,
  type LeagueTitle,
  type LeagueWrestler,
} from './snapshot';

/** The league site's production API (league_szn `frontend/.env.production`). */
const DEFAULT_API = 'https://9pcccl0caj.execute-api.us-east-1.amazonaws.com/dev';
const WORLD_DIR = 'content/worlds/default';
const MAX_FINISHERS = 6;
const MAX_SIGNATURES = 8;
const MOVE_MAX = 60;
const BIO_MAX = 600;
const CONCURRENCY = 8;

/** League entries that stand in for a slot rather than a wrestler (tournament byes and the like). */
const PLACEHOLDERS: readonly RegExp[] = [
  /^bye\s*\d*$/iu,
  /^mystery opponent$/iu,
  /^tbd$/iu,
  /^tba$/iu,
];

const DIVISION_BY_NAME: Readonly<Record<string, LeagueDivision>> = {
  heavyweight: 'heavyweight',
  'mid card': 'midCard',
  'young boys': 'youngBoys',
  jobber: 'jobber',
};

// Only the fields this script reads; anything else the API sends is ignored.
const optionalText = z.string().nullish();
const count = z.number().int().nullish();

const apiMoveSchema = z.looseObject({ gameName: optionalText, customName: optionalText });

const apiPlayerSchema = z.looseObject({
  playerId: z.string(),
  name: optionalText,
  psnId: optionalText,
  currentWrestler: optionalText,
  currentWrestlerId: optionalText,
  divisionId: optionalText,
  alignment: optionalText,
  wins: count,
  losses: count,
  draws: count,
  createdAt: optionalText,
  bio: optionalText,
  finishers: z.array(apiMoveSchema).nullish(),
  signatures: z.array(apiMoveSchema).nullish(),
  seasonRecords: z
    .array(z.looseObject({ seasonName: optionalText, wins: count, losses: count, draws: count }))
    .nullish(),
});
type ApiPlayer = z.infer<typeof apiPlayerSchema>;
type ApiMove = z.infer<typeof apiMoveSchema>;

const apiDivisionSchema = z.looseObject({ divisionId: z.string(), name: z.string() });

const apiChampionshipSchema = z.looseObject({
  name: z.string(),
  type: z.string(),
  isActive: z.boolean().nullish(),
  divisionId: optionalText,
  currentChampion: z.union([z.string(), z.array(z.string())]).nullish(),
});

const apiWrestlerSchema = z.looseObject({
  wrestlerId: z.string(),
  overallCap: z.number().nullish(),
  assignedPlayerId: optionalText,
  assignedSlot: optionalText,
});

const apiTagTeamSchema = z.looseObject({
  name: z.string(),
  status: z.string(),
  player1Id: z.string(),
  player2Id: z.string(),
  wins: count,
  losses: count,
});

async function getJson<Schema extends z.ZodType>(
  api: string,
  path: string,
  schema: Schema,
): Promise<z.output<Schema>> {
  const response = await fetch(`${api}${path}`, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${String(response.status)}`);
  }
  return schema.parse(await response.json());
}

async function mapLimited<Item, Result>(
  items: readonly Item[],
  limit: number,
  run: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array<Result>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await run(item);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

function compact(value: string): string {
  return foldName(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** True when `text` is, or (for a long enough handle) contains, the player's own name or tag. */
function isPersonal(text: string, player: ApiPlayer): boolean {
  const value = compact(text);
  for (const own of [player.name, player.psnId]) {
    const handle = compact(clean(own));
    if (handle.length === 0) {
      continue;
    }
    if (value === handle || (handle.length >= 4 && value.includes(handle))) {
      return true;
    }
  }
  return false;
}

function moveNames(
  moves: readonly ApiMove[] | null | undefined,
  max: number,
  player: ApiPlayer,
  blocklist: LeagueBlocklist,
): string[] {
  const names: string[] = [];
  for (const move of moves ?? []) {
    const name = clean(move.customName) || clean(move.gameName);
    if (name.length === 0 || name.length > MOVE_MAX) {
      continue;
    }
    if (blocklist.blocksText(name) || blocklist.blocksName(name) || isPersonal(name, player)) {
      continue;
    }
    if (!names.some((taken) => foldName(taken) === foldName(name))) {
      names.push(name);
    }
  }
  return names.slice(0, max);
}

function bioOf(player: ApiPlayer, blocklist: LeagueBlocklist): string | null {
  let bio = clean(player.bio);
  if (bio.length === 0 || blocklist.blocksText(bio) || isPersonal(bio, player)) {
    return null;
  }
  if (bio.length > BIO_MAX) {
    const cut = bio.slice(0, BIO_MAX - 1);
    bio = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), BIO_MAX / 2))}…`;
  }
  return bio;
}

function alignmentOf(value: string | null | undefined): LeagueWrestler['alignment'] {
  return value === 'face' || value === 'heel' ? value : 'neutral';
}

function matchesOf(player: ApiPlayer): number {
  return (player.wins ?? 0) + (player.losses ?? 0) + (player.draws ?? 0);
}

const DIVISION_RANK: Readonly<Record<string, number>> = {
  heavyweight: 0,
  midCard: 1,
  jobber: 2,
  youngBoys: 3,
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apiIndex = args.indexOf('--api');
  const api = apiIndex >= 0 ? (args[apiIndex + 1] ?? DEFAULT_API) : DEFAULT_API;
  const repoRoot = resolve(import.meta.dirname, '../../../..');
  const blocklist = await readLeagueBlocklist(repoRoot);

  const [players, divisions, championships, wrestlers, tagTeams] = await Promise.all([
    getJson(api, '/players', z.array(apiPlayerSchema)),
    getJson(api, '/divisions', z.array(apiDivisionSchema)),
    getJson(api, '/championships', z.array(apiChampionshipSchema)),
    getJson(api, '/wrestlers', z.array(apiWrestlerSchema)),
    getJson(api, '/tag-teams', z.array(apiTagTeamSchema)),
  ]);
  const details = await mapLimited(players, CONCURRENCY, (player) =>
    getJson(api, `/players/${encodeURIComponent(player.playerId)}`, apiPlayerSchema),
  );

  const divisionOf = new Map<string, LeagueDivision>();
  for (const division of divisions) {
    const key = DIVISION_BY_NAME[clean(division.name).toLowerCase()];
    if (key !== undefined) {
      divisionOf.set(division.divisionId, key);
    }
  }
  const capOf = (player: ApiPlayer): number | null => {
    const own = wrestlers.filter((wrestler) => wrestler.assignedPlayerId === player.playerId);
    const current =
      own.find((wrestler) => wrestler.wrestlerId === player.currentWrestlerId) ??
      own.find((wrestler) => wrestler.assignedSlot === 'primary');
    const cap = current?.overallCap;
    return typeof cap === 'number' && Number.isFinite(cap) ? Math.round(cap) : null;
  };

  const skipped = { blocklist: 0, personalName: 0, duplicate: 0, noRingName: 0, placeholder: 0 };
  const candidates: { player: ApiPlayer; wrestler: LeagueWrestler }[] = [];
  for (const player of details) {
    const ringName = clean(clean(player.currentWrestler).replace(/["“”]+/gu, ''));
    if (ringName.length === 0 || ringName.length > 60 || compact(ringName).length === 0) {
      skipped.noRingName += 1;
      continue;
    }
    if (PLACEHOLDERS.some((pattern) => pattern.test(ringName))) {
      skipped.placeholder += 1;
      continue;
    }
    if (blocklist.blocksName(ringName)) {
      skipped.blocklist += 1;
      continue;
    }
    if (isPersonal(ringName, player)) {
      skipped.personalName += 1;
      continue;
    }
    const seasons = [...(player.seasonRecords ?? [])]
      .map((season) => ({
        name: clean(season.seasonName),
        wins: season.wins ?? 0,
        losses: season.losses ?? 0,
        draws: season.draws ?? 0,
      }))
      .filter((season) => season.wins + season.losses + season.draws > 0)
      .sort((left, right) => compareText(left.name.replace(/\s+/gu, ' '), right.name));
    candidates.push({
      player,
      wrestler: {
        ringName,
        division:
          player.divisionId === null || player.divisionId === undefined
            ? null
            : (divisionOf.get(player.divisionId) ?? null),
        alignment: alignmentOf(player.alignment),
        wins: player.wins ?? 0,
        losses: player.losses ?? 0,
        draws: player.draws ?? 0,
        seasons,
        overallCap: capOf(player),
        finishers: moveNames(player.finishers, MAX_FINISHERS, player, blocklist),
        signatures: moveNames(player.signatures, MAX_SIGNATURES, player, blocklist),
        bio: bioOf(player, blocklist),
      },
    });
  }

  // One wrestler per ring name: the one with the most matches, then the higher division, then the
  // earliest sign-up.
  candidates.sort((left, right) => {
    const byName = compareText(compact(left.wrestler.ringName), compact(right.wrestler.ringName));
    if (byName !== 0) {
      return byName;
    }
    const byMatches = matchesOf(right.player) - matchesOf(left.player);
    if (byMatches !== 0) {
      return byMatches;
    }
    const rank = (division: LeagueDivision | null): number =>
      division === null ? 4 : (DIVISION_RANK[division] ?? 4);
    const byDivision = rank(left.wrestler.division) - rank(right.wrestler.division);
    return byDivision !== 0
      ? byDivision
      : compareText(left.player.createdAt ?? '', right.player.createdAt ?? '');
  });
  const kept = new Map<string, { player: ApiPlayer; wrestler: LeagueWrestler }>();
  for (const candidate of candidates) {
    const key = compact(candidate.wrestler.ringName);
    if (kept.has(key)) {
      skipped.duplicate += 1;
    } else {
      kept.set(key, candidate);
    }
  }
  const ringNameOf = new Map<string, string>(
    [...kept.values()].map(({ player, wrestler }) => [player.playerId, wrestler.ringName]),
  );

  const titles: LeagueTitle[] = championships
    .filter((championship) => championship.isActive !== false)
    .map((championship) => {
      const holders = Array.isArray(championship.currentChampion)
        ? championship.currentChampion
        : championship.currentChampion === null || championship.currentChampion === undefined
          ? []
          : [championship.currentChampion];
      const names = holders.flatMap((id) => {
        const ringName = ringNameOf.get(id);
        return ringName === undefined ? [] : [ringName];
      });
      return {
        name: clean(championship.name),
        kind: championship.type === 'tag' ? ('tag' as const) : ('singles' as const),
        division:
          championship.divisionId === null || championship.divisionId === undefined
            ? null
            : (divisionOf.get(championship.divisionId) ?? null),
        // Every holder must be imported, or the belt is treated as having no league champion.
        championRingNames: names.length === holders.length ? names : [],
      };
    })
    .sort((left, right) => compareText(left.name, right.name));

  const teams: LeagueTeam[] = tagTeams
    .filter((team) => team.status === 'active')
    .flatMap((team) => {
      const first = ringNameOf.get(team.player1Id);
      const second = ringNameOf.get(team.player2Id);
      const name = clean(team.name);
      if (
        first === undefined ||
        second === undefined ||
        name.length === 0 ||
        name.length > 60 ||
        blocklist.blocksName(name)
      ) {
        return [];
      }
      return [
        {
          name,
          memberRingNames: [first, second].sort(compareText),
          wins: team.wins ?? 0,
          losses: team.losses ?? 0,
        },
      ];
    })
    .sort((left, right) => compareText(left.name, right.name));

  const snapshot: LeagueSnapshot = leagueSnapshotSchema.parse({
    source:
      'leagueszn.jpdxsolo.com public API (GET /players, /players/{id}, /divisions, /championships, /wrestlers, /tag-teams)',
    fetchedOn: new Date().toISOString().slice(0, 10),
    skipped,
    titles,
    teams,
    wrestlers: [...kept.values()]
      .map(({ wrestler }) => wrestler)
      .sort((left, right) => compareText(left.ringName, right.ringName)),
  });
  const path = join(repoRoot, WORLD_DIR, LEAGUE_SNAPSHOT_FILE);
  // Written the way the repo's Prettier config formats it, so a refetch with no news is no diff.
  const options = (await resolveConfig(path)) ?? {};
  await writeFile(
    path,
    await format(JSON.stringify(snapshot, null, 2), { ...options, filepath: path }),
    'utf8',
  );
  process.stdout.write(
    `Wrote ${path}: ${String(snapshot.wrestlers.length)} wrestlers, ${String(teams.length)} teams, ${String(titles.length)} titles; skipped ${JSON.stringify(skipped)}\n`,
  );
}

await main();
