/**
 * The league roster: the owner's league wrestlers (from the committed snapshot, see `snapshot.ts`)
 * added on top of the generated default roster.
 *
 * It runs after every other build step and draws only from its own RNG (one registry per wrestler,
 * seeded from their ring name) plus the tail of the shared contract and popularity streams, so the
 * default world's own people, contracts, teams and reigns come out byte for byte as before.
 *
 * - **Division → card.** Heavyweight is main event, Mid Card midcard, Young Boys lower card
 *   (young, rookie or prospect, with extra potential), Jobber enhancement, no division lower card.
 * - **Skill.** The division sets a base talent and a band. The win rate, shrunk toward 50% by
 *   `RECORD_PRIOR_MATCHES` imaginary .500 matches, moves talent inside the band, and so does the
 *   league's overall cap for the wrestler they use. The engine's people generator turns talent and
 *   career stage into attributes with the usual seeding curves, with a per-wrestler RNG.
 * - **Popularity and momentum.** Popularity is fitted to the promotion like everyone else's, then
 *   scaled by up to ±20% by the record; momentum starts at up to ±40 for anyone with 3+ matches.
 * - **Where they work.** SLW (`pro-flagship`) and BLX (`pro-ca`) take the biggest share, the
 *   heavyweights only go there, every division is spread by each promotion's room, and the rest
 *   are free agents. Tag partners always end up together.
 *
 * Design: docs/design/default-world.md#the-league-roster.
 */

import {
  addDays,
  compareDates,
  hashString32,
  PersonSchema,
  RngRegistry,
  type CareerStage,
  type GameDate,
  type Person,
  type Push,
} from '@ringside/engine';
import { fitPopularity } from '../card';
import { RosterBuildError, type BuildContext } from '../context';
import { buildEmployments } from '../contracts';
import type { EmploymentOut, ReignOut, RosterMember, TeamOut } from '../model';
import { compareText, roundToTenth } from '../stats';
import type { LeagueBlocklist } from './blocklist';
import type { LeagueDivision, LeagueSnapshot, LeagueWrestler } from './snapshot';

/** Title keys of the league's belts start with this; the main reign step leaves them alone. */
export const LEAGUE_TITLE_PREFIX = 'league-';
export const LEAGUE_PERSON_PREFIX = 'league-';
export const LEAGUE_TAG = 'league';

export const SLW_PROMOTION = 'pro-flagship';
export const BLX_PROMOTION = 'pro-ca';

/** Imaginary .500 matches the win rate is shrunk with: 8 matches weigh as much as the prior. */
export const RECORD_PRIOR_MATCHES = 8;
/** Matches from which a record also sets a starting momentum. */
const MOMENTUM_MIN_MATCHES = 3;
const MOMENTUM_SPAN = 40;
const POPULARITY_SPAN = 0.2;
const YOUNG_POTENTIAL_BONUS = 150;
const POTENTIAL_MAX = 1000;

interface DivisionRule {
  readonly base: number;
  readonly min: number;
  readonly max: number;
  readonly push: Push;
  readonly stage: (seasonsActive: number) => CareerStage;
}

type DivisionKey = LeagueDivision | 'none';

/** Talent is the people generator's z-score: generated wrestlers roll N(0, 1), headliners 1.2-2.3. */
export const DIVISION_RULES: Readonly<Record<DivisionKey, DivisionRule>> = {
  heavyweight: {
    base: 1.5,
    min: 1.0,
    max: 2.2,
    push: 'mainEvent',
    stage: (seasons) => (seasons >= 3 ? 'veteran' : 'established'),
  },
  midCard: {
    base: 0.5,
    min: 0.0,
    max: 1.0,
    push: 'midCard',
    stage: (seasons) => (seasons <= 1 ? 'prospect' : 'established'),
  },
  youngBoys: {
    base: -0.6,
    min: -1.3,
    max: 0.1,
    push: 'lowerCard',
    stage: (seasons) => (seasons >= 2 ? 'prospect' : 'rookie'),
  },
  jobber: {
    base: -1.0,
    min: -1.6,
    max: -0.5,
    push: 'enhancement',
    stage: (seasons) => (seasons >= 2 ? 'established' : 'prospect'),
  },
  none: {
    base: -0.5,
    min: -1.2,
    max: 0.0,
    push: 'lowerCard',
    stage: () => 'prospect',
  },
};

/**
 * How many league wrestlers each promotion takes on top of its own roster. SLW and BLX take the
 * most; Golden Poppy is an all-women company and the league roster is listed as men, so it takes
 * none. Everyone past these numbers is a free agent.
 */
export const LEAGUE_ROOM: Readonly<Record<string, number>> = {
  'pro-flagship': 45,
  'pro-ca': 35,
  'pro-jp-major': 10,
  'pro-mx-major': 10,
  'pro-us-southeast': 5,
  'pro-us-greatlakes': 5,
  'pro-uk': 5,
  'pro-de': 5,
  'pro-us-texas-indie': 2,
  'pro-jp-kansai-indie': 2,
  'pro-au-indie': 2,
  'pro-us-west-women': 0,
};

/** Divisions in the order they are placed: the scarce top of the card first. */
const PLACEMENT_ORDER: readonly DivisionKey[] = [
  'heavyweight',
  'midCard',
  'jobber',
  'none',
  'youngBoys',
];

/** Divisions only SLW and BLX get. */
const SLW_BLX_ONLY: ReadonlySet<DivisionKey> = new Set<DivisionKey>(['heavyweight']);

/** Where league wrestlers are from when nothing says otherwise. */
const LEAGUE_HOME_COUNTRY = 'us';

// ---------------------------------------------------------------------------------------------
// Skill

export interface LeagueRating {
  readonly division: DivisionKey;
  /** -1..1: the shrunk win rate, 0 at .500. */
  readonly recordScore: number;
  /** -1..1: the overall cap against 75, 0 when unknown. */
  readonly capScore: number;
  readonly talent: number;
  readonly seasonsActive: number;
  readonly matches: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 0..1 from a string, the same everywhere. */
function unitHash(text: string): number {
  return hashString32(text) / 0x1_0000_0000;
}

export function rateLeagueWrestler(wrestler: LeagueWrestler): LeagueRating {
  const division: DivisionKey = wrestler.division ?? 'none';
  const rule = DIVISION_RULES[division];
  const matches = wrestler.wins + wrestler.losses + wrestler.draws;
  const shrunk =
    (wrestler.wins + 0.5 * wrestler.draws + 0.5 * RECORD_PRIOR_MATCHES) /
    (matches + RECORD_PRIOR_MATCHES);
  const recordScore = clamp((shrunk - 0.5) * 2, -1, 1);
  const capScore = wrestler.overallCap === null ? 0 : clamp((wrestler.overallCap - 75) / 15, -1, 1);
  const halfBand = (rule.max - rule.min) / 2;
  const jitter = (unitHash(`league-talent:${wrestler.ringName}`) - 0.5) * 0.2;
  const raw = rule.base + halfBand * (0.8 * recordScore + 0.3 * capScore) + jitter;
  const talent = Math.round(clamp(raw, rule.min, rule.max) * 100) / 100;
  return {
    division,
    recordScore,
    capScore,
    talent,
    seasonsActive: wrestler.seasons.length,
    matches,
  };
}

// ---------------------------------------------------------------------------------------------
// People

export interface LeagueMember extends RosterMember {
  readonly league: LeagueWrestler;
  readonly rating: LeagueRating;
}

function slugOf(ringName: string): string {
  const slug = ringName
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return slug.length > 0 ? slug : `w${hashString32(ringName).toString(36)}`;
}

function foldedName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function generateLeaguePerson(
  context: BuildContext,
  wrestler: LeagueWrestler,
  rating: LeagueRating,
): { person: Person; talent: number; stage: CareerStage } {
  const rule = DIVISION_RULES[rating.division];
  const stage = rule.stage(rating.seasonsActive);
  const rng = new RngRegistry(`league:${wrestler.ringName}`);
  const result = context.generator.generate(
    {
      role: 'wrestler',
      careerStage: stage,
      gender: 'male',
      countryId: context.countryId(LEAGUE_HOME_COUNTRY),
      talent: rating.talent,
    },
    {
      personId: context.nextPersonId(),
      worldDate: context.startDate,
      rng: (name) => rng.stream(name),
    },
  );
  let person = result.value.person;
  if (rating.division === 'youngBoys') {
    person = {
      ...person,
      development: {
        ...person.development,
        potential: Math.min(POTENTIAL_MAX, person.development.potential + YOUNG_POTENTIAL_BONUS),
      },
    };
  }
  const moves =
    wrestler.finishers.length + wrestler.signatures.length > 0
      ? { moves: { finishers: [...wrestler.finishers], signatures: [...wrestler.signatures] } }
      : {};
  person = PersonSchema.parse({
    ...person,
    defaultRingName: wrestler.ringName,
    tags: [LEAGUE_TAG],
    ...(wrestler.bio === null ? {} : { bio: wrestler.bio }),
    ...moves,
  });
  return { person, talent: result.value.talent, stage };
}

// ---------------------------------------------------------------------------------------------
// Placement

interface Placement {
  readonly promotionKey: string | null;
}

/**
 * Hands each league wrestler a promotion (or free agency). Within a division the strongest go
 * first, each to the promotion furthest behind its share of that division, among those with room.
 */
function placeLeagueWrestlers(
  rated: readonly { wrestler: LeagueWrestler; rating: LeagueRating }[],
  teams: readonly { memberRingNames: readonly string[] }[],
): Map<string, Placement> {
  const room = new Map<string, number>(Object.entries(LEAGUE_ROOM));
  const totalRoom = [...room.values()].reduce((sum, value) => sum + value, 0);
  const placed = new Map<string, Placement>();
  const byName = new Map(rated.map((entry) => [entry.wrestler.ringName, entry]));
  const promotionKeys = [...room.keys()].sort(compareText);

  // Tag teams first, taking turns between SLW and BLX, where the league's tag titles are.
  let turn = 0;
  for (const team of [...teams].sort((left, right) =>
    compareText(left.memberRingNames.join('|'), right.memberRingNames.join('|')),
  )) {
    const names = team.memberRingNames.filter((name) => byName.has(name));
    if (names.length !== 2 || names.some((name) => placed.has(name))) {
      continue;
    }
    const order = turn % 2 === 0 ? [SLW_PROMOTION, BLX_PROMOTION] : [BLX_PROMOTION, SLW_PROMOTION];
    turn += 1;
    const home = order.find((key) => (room.get(key) ?? 0) >= 2);
    const placement = { promotionKey: home ?? null };
    for (const name of names) {
      placed.set(name, placement);
    }
    if (home !== undefined) {
      room.set(home, (room.get(home) ?? 0) - 2);
    }
  }

  for (const division of PLACEMENT_ORDER) {
    const group = rated
      .filter((entry) => entry.rating.division === division)
      .sort(
        (left, right) =>
          right.rating.talent - left.rating.talent ||
          compareText(left.wrestler.ringName, right.wrestler.ringName),
      );
    const eligible = SLW_BLX_ONLY.has(division)
      ? [SLW_PROMOTION, BLX_PROMOTION]
      : promotionKeys.filter((key) => (LEAGUE_ROOM[key] ?? 0) > 0);
    const weight = (key: string): number =>
      SLW_BLX_ONLY.has(division) ? 1 : (LEAGUE_ROOM[key] ?? 0) / totalRoom;
    const given = new Map<string, number>(eligible.map((key) => [key, 0]));
    let index = 0;
    for (const entry of group) {
      const name = entry.wrestler.ringName;
      if (placed.has(name)) {
        continue;
      }
      let best: string | null = null;
      let bestDeficit = Number.NEGATIVE_INFINITY;
      for (const key of eligible) {
        if ((room.get(key) ?? 0) < 1) {
          continue;
        }
        const deficit = weight(key) * (index + 1) - (given.get(key) ?? 0);
        if (deficit > bestDeficit) {
          best = key;
          bestDeficit = deficit;
        }
      }
      index += 1;
      const placement = { promotionKey: best };
      placed.set(name, placement);
      if (best !== null) {
        room.set(best, (room.get(best) ?? 0) - 1);
        given.set(best, (given.get(best) ?? 0) + 1);
      }
    }
  }
  return placed;
}

function assignLeagueBrands(context: BuildContext, members: readonly LeagueMember[]): void {
  for (const promotionKey of [...context.promotions.keys()].sort(compareText)) {
    const shares = context.spec.promotions[promotionKey]?.brandShares;
    if (shares === undefined) {
      continue;
    }
    const brandKeys = Object.keys(shares).sort(compareText);
    const assigned = new Map<string, number>(brandKeys.map((key) => [key, 0]));
    members
      .filter((member) => member.promotionKey === promotionKey)
      .forEach((member, index) => {
        let best = brandKeys[0] ?? null;
        let bestDeficit = Number.NEGATIVE_INFINITY;
        for (const key of brandKeys) {
          const deficit = (shares[key] ?? 0) * (index + 1) - (assigned.get(key) ?? 0);
          if (deficit > bestDeficit) {
            best = key;
            bestDeficit = deficit;
          }
        }
        if (best !== null) {
          member.brandKey = best;
          assigned.set(best, (assigned.get(best) ?? 0) + 1);
        }
      });
  }
}

// ---------------------------------------------------------------------------------------------
// The step

export interface LeagueBuild {
  readonly members: LeagueMember[];
  readonly employments: EmploymentOut[];
  readonly teams: TeamOut[];
  readonly reigns: ReignOut[];
  /** League ring names left out because the default world already uses them. */
  readonly nameClashes: string[];
  /** League wrestlers left out because a name or text field hit the blocklist at build time. */
  readonly blocked: string[];
}

function laterOf(left: GameDate, right: GameDate): GameDate {
  return compareDates(left, right) >= 0 ? left : right;
}

/** Days back from the start, picked from the hash of `seed`, in `min..max`. */
function daysBack(seed: string, min: number, max: number): number {
  return min + Math.floor(unitHash(seed) * (max - min + 1));
}

function teamKeyOf(name: string): string {
  return `team-league-${slugOf(name)}`;
}

export function buildLeagueRoster(
  context: BuildContext,
  existing: readonly RosterMember[],
  snapshot: LeagueSnapshot,
  blocklist: LeagueBlocklist,
): LeagueBuild {
  const takenRingNames = new Set<string>();
  for (const member of existing) {
    takenRingNames.add(foldedName(member.ringName));
    takenRingNames.add(foldedName(member.person.defaultRingName));
  }

  const nameClashes: string[] = [];
  const blocked: string[] = [];
  const kept: { wrestler: LeagueWrestler; rating: LeagueRating }[] = [];
  const keptNames = new Set<string>();
  for (const wrestler of [...snapshot.wrestlers].sort((left, right) =>
    compareText(left.ringName, right.ringName),
  )) {
    const folded = foldedName(wrestler.ringName);
    if (takenRingNames.has(folded)) {
      nameClashes.push(wrestler.ringName);
      continue;
    }
    if (keptNames.has(folded)) {
      continue;
    }
    if (blocklist.blocksName(wrestler.ringName)) {
      blocked.push(wrestler.ringName);
      continue;
    }
    const clean: LeagueWrestler = {
      ...wrestler,
      bio: wrestler.bio !== null && blocklist.blocksText(wrestler.bio) ? null : wrestler.bio,
      finishers: wrestler.finishers.filter((move) => !blocklist.blocksText(move)),
      signatures: wrestler.signatures.filter((move) => !blocklist.blocksText(move)),
    };
    keptNames.add(folded);
    kept.push({ wrestler: clean, rating: rateLeagueWrestler(clean) });
  }

  const leagueTeams = snapshot.teams.filter(
    (team) =>
      team.memberRingNames.every((name) => keptNames.has(foldedName(name))) &&
      !blocklist.blocksName(team.name),
  );
  const placements = placeLeagueWrestlers(kept, leagueTeams);

  // Ring names first, so the generator can't hand a league name to a generated legal name.
  const registry = context.generator.names.registry;
  for (const { wrestler } of kept) {
    registry.add('ring', wrestler.ringName);
  }

  const usedKeys = new Set(existing.map((member) => member.key));
  const members: LeagueMember[] = [];
  for (const { wrestler, rating } of kept) {
    let key = `${LEAGUE_PERSON_PREFIX}${slugOf(wrestler.ringName)}`;
    for (let suffix = 2; usedKeys.has(key); suffix++) {
      key = `${LEAGUE_PERSON_PREFIX}${slugOf(wrestler.ringName)}-${String(suffix)}`;
    }
    usedKeys.add(key);
    const promotionKey = placements.get(wrestler.ringName)?.promotionKey ?? null;
    const generated = generateLeaguePerson(context, wrestler, rating);
    let person = generated.person;
    const promotion = promotionKey === null ? undefined : context.promotions.get(promotionKey);
    if (
      promotion !== undefined &&
      context.geography.countryOf(person.birthRegionId).id !==
        context.geography.countryOf(context.regionId(promotion.homeRegionKey)).id
    ) {
      person = { ...person, basedInRegionId: context.regionId(promotion.homeRegionKey) };
    }
    const rule = DIVISION_RULES[rating.division];
    members.push({
      key,
      person,
      talent: generated.talent,
      stage: generated.stage,
      role: 'wrestler',
      promotionKey,
      headliner: null,
      ringName: wrestler.ringName,
      homePopularity: person.regionalPop[person.birthRegionId] ?? 0,
      cardValue: rating.talent,
      push: rule.push,
      alignment:
        wrestler.alignment === 'neutral'
          ? 'tweener'
          : wrestler.alignment === 'heel'
            ? 'heel'
            : 'face',
      brandKey: null,
      league: wrestler,
      rating,
    });
  }
  members.sort((left, right) => compareText(left.key, right.key));

  assignLeagueBrands(context, members);
  fitPopularity(context, members);
  for (const member of members) {
    const factor = 1 + POPULARITY_SPAN * member.rating.recordScore;
    const regionalPop: Record<string, number> = {};
    for (const [regionId, value] of Object.entries(member.person.regionalPop)) {
      // Never below 1 (a pack's floor), never pushed past 100.
      regionalPop[regionId] = clamp(roundToTenth(value * factor), Math.min(1, value), 100);
    }
    member.person = { ...member.person, regionalPop };
  }

  const employments = buildEmployments(context, members);
  const byKey = new Map(members.map((member) => [member.key, member]));
  for (const employment of employments) {
    const member = byKey.get(employment.personKey);
    if (member !== undefined && member.rating.matches >= MOMENTUM_MIN_MATCHES) {
      employment.momentum = Math.round(MOMENTUM_SPAN * member.rating.recordScore);
    }
  }

  // Teams: the league's active tag teams whose members both made it in.
  const memberByName = new Map(members.map((member) => [member.ringName, member]));
  const teams: TeamOut[] = [];
  for (const team of leagueTeams) {
    const teamMembers = team.memberRingNames
      .map((name) => memberByName.get(name))
      .filter((member): member is LeagueMember => member !== undefined);
    if (teamMembers.length !== 2) {
      continue;
    }
    let formedOn = addDays(context.startDate, -daysBack(`league-team:${team.name}`, 60, 240));
    for (const member of teamMembers) {
      if (member.person.debutDate !== null) {
        formedOn = laterOf(formedOn, member.person.debutDate);
      }
    }
    teams.push({
      key: teamKeyOf(team.name),
      kind: 'tag',
      name: team.name,
      memberKeys: teamMembers.map((member) => member.key).sort(compareText),
      formedOn,
      experience: 20 + Math.min(40, (team.wins + team.losses) * 5),
      status: 'active',
    });
  }

  const reigns = buildLeagueReigns(context, snapshot, members, teams, employments);
  return { members, employments, teams, reigns, nameClashes, blocked };
}

// ---------------------------------------------------------------------------------------------
// Titles

/** The title in `promotionKey` that carries `leagueTitleName`, by key convention. */
export function leagueTitleKey(promotionKey: string, leagueTitleName: string): string {
  const owner = promotionKey === SLW_PROMOTION ? 'slw' : 'blx';
  return `${LEAGUE_TITLE_PREFIX}${owner}-${slugOf(leagueTitleName.replace(/^SZN\s+/iu, ''))}`;
}

function buildLeagueReigns(
  context: BuildContext,
  snapshot: LeagueSnapshot,
  members: readonly LeagueMember[],
  teams: readonly TeamOut[],
  employments: EmploymentOut[],
): ReignOut[] {
  const reigns: ReignOut[] = [];
  const holding = new Set<string>();
  const teamOf = new Map<string, TeamOut>();
  for (const team of teams) {
    for (const key of team.memberKeys) {
      teamOf.set(key, team);
    }
  }
  const employmentOf = new Map(employments.map((employment) => [employment.personKey, employment]));
  const titles = new Map(context.titles.map((title) => [title.key, title]));

  for (const promotionKey of [SLW_PROMOTION, BLX_PROMOTION]) {
    for (const leagueTitle of snapshot.titles) {
      const titleKey = leagueTitleKey(promotionKey, leagueTitle.name);
      const title = titles.get(titleKey);
      if (title === undefined) {
        throw new RosterBuildError(
          `League title "${leagueTitle.name}" has no title ${titleKey} in titles.json`,
        );
      }
      const own = members.filter((member) => member.promotionKey === promotionKey);
      let holders: LeagueMember[] = [];
      let teamKey: string | null = null;
      if (leagueTitle.kind === 'tag') {
        const ownTeams = teams
          .filter((team) =>
            team.memberKeys.every(
              (key) => own.some((member) => member.key === key) && !holding.has(key),
            ),
          )
          .map((team) => ({
            team,
            strength: team.memberKeys.reduce(
              (sum, key) => sum + (own.find((member) => member.key === key)?.rating.talent ?? 0),
              0,
            ),
          }))
          .sort(
            (left, right) =>
              right.strength - left.strength || compareText(left.team.key, right.team.key),
          );
        const best = ownTeams[0]?.team;
        if (best !== undefined) {
          teamKey = best.key;
          holders = best.memberKeys
            .map((key) => own.find((member) => member.key === key))
            .filter((member): member is LeagueMember => member !== undefined);
        }
      } else {
        const named = leagueTitle.championRingNames
          .map((name) => own.find((member) => member.ringName === name))
          .filter((member): member is LeagueMember => member !== undefined);
        const division = leagueTitle.division ?? 'heavyweight';
        const fallback = own
          .filter(
            (member) =>
              member.rating.division === division &&
              !holding.has(member.key) &&
              !teamOf.has(member.key),
          )
          .sort(
            (left, right) =>
              right.rating.talent - left.rating.talent || compareText(left.key, right.key),
          )[0];
        holders =
          named.length === 1 && !holding.has(named[0]?.key ?? '')
            ? named
            : fallback === undefined
              ? []
              : [fallback];
      }
      if (holders.length !== title.holderCount) {
        continue; // Vacant.
      }
      let wonOn = addDays(context.startDate, -daysBack(`league-reign:${titleKey}`, 20, 240));
      wonOn = laterOf(wonOn, title.introducedOn);
      for (const holder of holders) {
        if (holder.person.debutDate !== null) {
          wonOn = laterOf(wonOn, holder.person.debutDate);
        }
      }
      if (teamKey !== null) {
        const team = teams.find((candidate) => candidate.key === teamKey);
        if (team !== undefined) {
          wonOn = laterOf(wonOn, team.formedOn);
        }
      }
      for (const holder of holders) {
        holding.add(holder.key);
        const employment = employmentOf.get(holder.key);
        if (employment !== undefined && compareDates(employment.startsOn, wonOn) > 0) {
          employment.startsOn = wonOn;
        }
      }
      reigns.push({
        key: `reign-${titleKey}-01`,
        titleKey,
        holderPersonKeys: holders.map((holder) => holder.key).sort(compareText),
        teamKey,
        wonOn,
        lostOn: null,
        endReason: null,
        defences: daysBack(`league-defences:${titleKey}`, 0, 6),
      });
    }
  }
  return reigns;
}
