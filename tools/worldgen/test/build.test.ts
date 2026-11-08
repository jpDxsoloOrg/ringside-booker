// The default roster build (WLD-09). Design: docs/design/default-world.md#the-roster
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDefaultRoster, TARGETS, type RosterBuild } from '../src/build';
import { pushRank } from '../src/card';
import { GENERATED_FILES, readBuildInputs } from '../src/content';
import type { EmploymentOut, ReignOut, RosterMember } from '../src/model';
import { renderRosterFiles, writeRosterFiles } from '../src/output';
import { fitsDivision } from '../src/reigns';
import { spearman } from '../src/stats';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Smallest rank correlation between push and card value the build must reach per promotion. */
const MIN_PUSH_CORRELATION = 0.6;

let build: RosterBuild;
const tempDirs: string[] = [];

beforeAll(async () => {
  build = buildDefaultRoster(await readBuildInputs(REPO_ROOT));
});

afterAll(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function buildInto(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'worldgen-'));
  tempDirs.push(dir);
  const fresh = buildDefaultRoster(await readBuildInputs(REPO_ROOT));
  await writeRosterFiles(dir, renderRosterFiles(fresh.files));
  return dir;
}

function memberByKey(): Map<string, RosterMember> {
  return new Map(build.members.map((member) => [member.key, member]));
}

function employmentsOf(role: EmploymentOut['role']): EmploymentOut[] {
  return build.files.employment.filter((employment) => employment.role === role);
}

describe('the default roster build', () => {
  it('writes byte-identical files when run twice from the same spec and seed', async () => {
    const first = await buildInto();
    const second = await buildInto();
    for (const file of Object.values(GENERATED_FILES)) {
      const firstText = await readFile(join(first, file), 'utf8');
      const secondText = await readFile(join(second, file), 'utf8');
      expect(secondText, file).toBe(firstText);
      expect(firstText.endsWith(']\n'), file).toBe(true);
    }
  });

  it('hits the target totals', () => {
    const { summary } = build;
    const inRange = (value: number, range: { min: number; max: number }): boolean =>
      value >= range.min && value <= range.max;
    expect(inRange(summary.total, TARGETS.total), `total ${String(summary.total)}`).toBe(true);
    expect(inRange(summary.nonWrestlers, TARGETS.nonWrestlers)).toBe(true);
    expect(inRange(summary.freeAgentWrestlers, TARGETS.freeAgentWrestlers)).toBe(true);
    expect(summary.freeAgentStaff).toBeGreaterThanOrEqual(TARGETS.freeAgentStaff.min);
    expect(summary.headliners).toBeGreaterThanOrEqual(20);
    expect(summary.headliners).toBeLessThanOrEqual(30);
    expect(summary.byPromotion.get('pro-flagship')?.wrestlers).toBe(44);
    expect(summary.byPromotion.get('pro-jp-major')?.wrestlers).toBe(26);
    expect(summary.byPromotion.get('pro-mx-major')?.wrestlers).toBe(26);
  });

  it('gives every promotion at least one referee and one announcer', () => {
    const promotions = [...build.summary.byPromotion.keys()];
    expect(promotions).toHaveLength(12);
    for (const role of ['referee', 'announcer'] as const) {
      const staffed = new Set(employmentsOf(role).map((employment) => employment.promotionKey));
      expect(
        promotions.filter((key) => !staffed.has(key)),
        role,
      ).toEqual([]);
    }
  });

  it('gives every promotion a main-event headliner', () => {
    const promotions = new Set(
      build.members
        .filter((member) => member.headliner?.employment.push === 'mainEvent')
        .map((member) => member.promotionKey),
    );
    expect(promotions.size).toBe(12);
  });

  it('gives every title exactly one open reign, held by an eligible person or team', () => {
    const members = memberByKey();
    const teams = new Map(build.files.team.map((team) => [team.key, team]));
    const employer = new Map(
      build.files.employment.map((employment) => [employment.personKey, employment.promotionKey]),
    );
    expect(build.titles).toHaveLength(28);
    for (const title of build.titles) {
      const titleKey = title.key;
      const open = build.files.titleReign.filter(
        (reign) => reign.titleKey === titleKey && reign.lostOn === null,
      );
      expect(open, titleKey).toHaveLength(1);
      const reign = open[0]!;
      expect(reign.holderPersonKeys, titleKey).toHaveLength(title.holderCount);
      for (const holderKey of reign.holderPersonKeys) {
        const holder = members.get(holderKey);
        expect(holder, holderKey).toBeDefined();
        expect(employer.get(holderKey), `${titleKey}: ${holderKey}`).toBe(title.promotionKey);
        expect(holder?.role).toBe('wrestler');
        expect(holder !== undefined && fitsDivision(holder, title), holderKey).toBe(true);
      }
      if (reign.holderPersonKeys.length > 1) {
        const team = teams.get(reign.teamKey ?? '');
        expect(team, titleKey).toBeDefined();
        expect([...(team?.memberKeys ?? [])].sort()).toEqual([...reign.holderPersonKeys].sort());
      } else {
        expect(members.get(reign.holderPersonKeys[0] ?? '')?.headliner?.holdsTitleKey).toBe(
          titleKey,
        );
      }
    }
  });

  it('keeps every title history in order, with 1-4 past reigns that never overlap', () => {
    const byTitle = new Map<string, ReignOut[]>();
    const sorted = [...build.files.titleReign].sort((left, right) =>
      left.key < right.key ? -1 : 1,
    );
    for (const reign of sorted) {
      byTitle.set(reign.titleKey, [...(byTitle.get(reign.titleKey) ?? []), reign]);
    }
    for (const [titleKey, reigns] of byTitle) {
      expect(reigns.length - 1, titleKey).toBeGreaterThanOrEqual(1);
      expect(reigns.length - 1, titleKey).toBeLessThanOrEqual(4);
      reigns.forEach((reign, index) => {
        const next = reigns[index + 1];
        if (next !== undefined) {
          expect(reign.lostOn, reign.key).toBe(next.wonOn);
          expect(reign.endReason).toBe('lost');
        }
      });
    }
  });

  it('puts better workers higher on the card (Spearman at least 0.6 per promotion)', () => {
    for (const promotionKey of build.summary.byPromotion.keys()) {
      const wrestlers = build.members.filter(
        (member) => member.promotionKey === promotionKey && member.role === 'wrestler',
      );
      const correlation = spearman(
        wrestlers.map((member) => -pushRank(member)),
        wrestlers.map((member) => member.cardValue),
      );
      expect(correlation, promotionKey).toBeGreaterThanOrEqual(MIN_PUSH_CORRELATION);
    }
  });

  it('gives no free agent a contract', () => {
    const employed = new Set(build.files.employment.map((employment) => employment.personKey));
    const freeAgents = build.members.filter((member) => member.promotionKey === null);
    expect(freeAgents.length).toBeGreaterThanOrEqual(TARGETS.freeAgentWrestlers.min);
    expect(freeAgents.filter((member) => employed.has(member.key))).toEqual([]);
    expect(freeAgents.every((member) => member.key.startsWith('gen-fa-'))).toBe(true);
  });

  it('keys generated people by promotion and keeps the headliners’ authored keys', () => {
    for (const member of build.members) {
      if (member.headliner !== null) {
        expect(member.key).toBe(member.headliner.key);
      } else if (member.promotionKey !== null) {
        expect(member.key).toMatch(new RegExp(`^gen-${member.promotionKey}-\\d{2}$`));
      }
    }
  });

  it('staggers contract expiries over 2-30 months after the start', () => {
    const start = Date.parse(build.startDate);
    const months = build.files.employment.map(
      (employment) => (Date.parse(employment.endsOn) - start) / (30.44 * 86_400_000),
    );
    expect(Math.min(...months)).toBeGreaterThanOrEqual(1.9);
    expect(Math.max(...months)).toBeLessThanOrEqual(30.1);
    expect(
      build.files.employment.every((employment) => employment.startsOn <= build.startDate),
    ).toBe(true);
  });
});
