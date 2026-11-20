// The league roster on top of the default world. Design: docs/design/default-world.md#the-league-roster
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDefaultRoster, type RosterBuild } from '../src/build';
import { readBuildInputs, type BuildInputs } from '../src/content';
import { blocklistFromText } from '../src/league/blocklist';
import {
  BLX_PROMOTION,
  DIVISION_RULES,
  LEAGUE_PERSON_PREFIX,
  LEAGUE_TAG,
  LEAGUE_TITLE_PREFIX,
  rateLeagueWrestler,
  SLW_PROMOTION,
} from '../src/league/roster';
import type { LeagueWrestler } from '../src/league/snapshot';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let inputs: BuildInputs;
let build: RosterBuild;

beforeAll(async () => {
  inputs = await readBuildInputs(REPO_ROOT);
  build = buildDefaultRoster(inputs);
});

function wrestler(overrides: Partial<LeagueWrestler>): LeagueWrestler {
  return {
    ringName: 'Test Wrestler',
    division: 'midCard',
    alignment: 'neutral',
    wins: 0,
    losses: 0,
    draws: 0,
    seasons: [],
    overallCap: null,
    finishers: [],
    signatures: [],
    bio: null,
    ...overrides,
  };
}

describe('rating a league wrestler', () => {
  it('keeps talent inside the division band and moves it with the record', () => {
    for (const division of ['heavyweight', 'midCard', 'youngBoys', 'jobber', null] as const) {
      const rule = DIVISION_RULES[division ?? 'none'];
      const winner = rateLeagueWrestler(wrestler({ division, wins: 40, losses: 2 }));
      const loser = rateLeagueWrestler(wrestler({ division, wins: 2, losses: 40 }));
      for (const rating of [winner, loser]) {
        expect(rating.talent).toBeGreaterThanOrEqual(rule.min);
        expect(rating.talent).toBeLessThanOrEqual(rule.max);
      }
      expect(winner.talent).toBeGreaterThan(loser.talent);
    }
  });

  it('shrinks a short record toward .500', () => {
    const one = rateLeagueWrestler(wrestler({ wins: 1 }));
    const many = rateLeagueWrestler(wrestler({ wins: 20 }));
    expect(one.recordScore).toBeGreaterThan(0);
    expect(one.recordScore).toBeLessThan(many.recordScore);
    expect(rateLeagueWrestler(wrestler({})).recordScore).toBe(0);
  });

  it('nudges talent up with a higher overall cap', () => {
    const low = rateLeagueWrestler(wrestler({ overallCap: 65 }));
    const high = rateLeagueWrestler(wrestler({ overallCap: 90 }));
    expect(high.talent).toBeGreaterThan(low.talent);
  });
});

describe('the league roster in the default world', () => {
  it('adds the snapshot on top without changing a generated record', () => {
    const league = build.league;
    expect(league).not.toBeNull();
    const without = buildDefaultRoster({ ...inputs, league: null });
    const byKey = new Map(build.files.person.map((person) => [person.key, person]));
    for (const person of without.files.person) {
      expect(byKey.get(person.key), person.key).toEqual(person);
    }
    const employments = new Map(build.files.employment.map((row) => [row.key, row]));
    for (const row of without.files.employment) {
      expect(employments.get(row.key), row.key).toEqual(row);
    }
    expect(build.files.person.length).toBe(
      without.files.person.length + (league?.members.length ?? 0),
    );
  });

  it('imports every snapshot wrestler but the ring names the world already uses', () => {
    const league = build.league;
    const snapshot = inputs.league?.snapshot;
    expect(league?.members.length).toBe(
      (snapshot?.wrestlers.length ?? 0) - (league?.nameClashes.length ?? 0),
    );
    for (const member of league?.members ?? []) {
      expect(member.key.startsWith(LEAGUE_PERSON_PREFIX)).toBe(true);
      expect(member.person.tags).toEqual([LEAGUE_TAG]);
      expect(member.person.defaultRingName).toBe(member.league.ringName);
    }
  });

  it('pushes each wrestler by their division', () => {
    const employment = new Map(build.files.employment.map((row) => [row.personKey, row]));
    for (const member of build.league?.members ?? []) {
      const row = employment.get(member.key);
      if (member.promotionKey === null) {
        expect(row).toBeUndefined();
      } else {
        expect(row?.push, member.key).toBe(DIVISION_RULES[member.rating.division].push);
      }
    }
  });

  it('gives SLW and BLX the biggest share, with every heavyweight', () => {
    const counts = new Map<string, number>();
    for (const member of build.league?.members ?? []) {
      if (member.promotionKey !== null) {
        counts.set(member.promotionKey, (counts.get(member.promotionKey) ?? 0) + 1);
      }
      if (member.rating.division === 'heavyweight') {
        expect([SLW_PROMOTION, BLX_PROMOTION]).toContain(member.promotionKey);
      }
    }
    const others = [...counts.entries()].filter(
      ([key]) => key !== SLW_PROMOTION && key !== BLX_PROMOTION,
    );
    for (const [, count] of others) {
      expect(count).toBeLessThan(counts.get(BLX_PROMOTION) ?? 0);
    }
  });

  it('keeps tag partners together and crowns champions where they work', () => {
    const employer = new Map(build.files.employment.map((row) => [row.personKey, row]));
    for (const team of build.league?.teams ?? []) {
      const promotions = new Set(team.memberKeys.map((key) => employer.get(key)?.promotionKey));
      expect(promotions.size, team.name).toBe(1);
    }
    const titles = new Map(build.titles.map((title) => [title.key, title]));
    for (const reign of build.league?.reigns ?? []) {
      expect(reign.titleKey.startsWith(LEAGUE_TITLE_PREFIX)).toBe(true);
      const title = titles.get(reign.titleKey);
      for (const key of reign.holderPersonKeys) {
        const row = employer.get(key);
        expect(row?.promotionKey).toBe(title?.promotionKey);
        expect(row !== undefined && row.startsOn <= reign.wonOn).toBe(true);
      }
    }
  });

  it('keeps blocked names out of ring names, bios and moves', async () => {
    const { readFile } = await import('node:fs/promises');
    const blocklist = blocklistFromText(
      await readFile(`${REPO_ROOT}content/blocklist/real-names.txt`, 'utf8'),
    );
    for (const member of build.league?.members ?? []) {
      expect(blocklist.blocksName(member.ringName), member.ringName).toBe(false);
      const texts = [
        member.person.bio ?? '',
        ...(member.person.moves?.finishers ?? []),
        ...(member.person.moves?.signatures ?? []),
      ];
      for (const text of texts) {
        expect(blocklist.blocksText(text), text).toBe(false);
      }
    }
  });
});
