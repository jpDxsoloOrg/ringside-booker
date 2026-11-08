/**
 * The default roster build: from the roster spec, the headliners and the organisations of the
 * default world to the four generated pack files.
 *
 * Steps, each on its own RNG stream (see `streams.ts`):
 *
 * 1. Headliners, in key order, then every promotion's wrestlers and staff in promotion-key order,
 *    then the free agents, all through the engine's people generator.
 * 2. Card value, push, alignment and brand per promotion (`card.ts`).
 * 3. Popularity fitted to each promotion's footprint (`card.ts`).
 * 4. Teams (`teams.ts`), then title reigns (`reigns.ts`), then contracts (`contracts.ts`), so a
 *    current champion's contract can start no later than their reign.
 *
 * The result is a pure function of the inputs: the same spec, seed and content always give the
 * same files, byte for byte.
 *
 * Design: docs/design/default-world.md#the-roster.
 */

import { compareDates, type GameDate } from '@ringside/engine';
import { fitPopularity, placeOnCards } from './card';
import type { BuildInputs } from './content';
import { createBuildContext, RosterBuildError, type BuildContext } from './context';
import { buildEmployments } from './contracts';
import type { EmploymentOut, RosterMember, RosterTitle } from './model';
import { personRecordOf, type RosterFiles } from './output';
import {
  generateFreeAgents,
  generateHeadliners,
  generatePromotionPeople,
  reserveHeadlinerNames,
} from './people';
import { buildReigns } from './reigns';
import { buildTeams } from './teams';
import { compareText } from './stats';

/** Totals the build must hit, from the WLD-09 ticket. */
export const TARGETS = {
  wrestlersByTier: {
    flagship: { min: 44, max: 44 },
    national: { min: 26, max: 26 },
    regional: { min: 12, max: 16 },
    local: { min: 8, max: 8 },
  },
  freeAgentWrestlers: { min: 35, max: 45 },
  freeAgentStaff: { min: 8, max: Number.POSITIVE_INFINITY },
  nonWrestlers: { min: 55, max: 70 },
  total: { min: 240, max: 290 },
} as const;

/** Headcounts of a build, for the summary and the totals check. */
export interface RosterSummary {
  readonly total: number;
  readonly wrestlers: number;
  readonly nonWrestlers: number;
  readonly freeAgentWrestlers: number;
  readonly freeAgentStaff: number;
  readonly headliners: number;
  readonly teams: number;
  readonly reigns: number;
  /** Promotion key → wrestlers and staff under contract. */
  readonly byPromotion: ReadonlyMap<string, { wrestlers: number; staff: number }>;
}

export interface RosterBuild {
  readonly startDate: GameDate;
  /** Every active title of the world, sorted by key. */
  readonly titles: readonly RosterTitle[];
  readonly members: readonly RosterMember[];
  readonly files: RosterFiles;
  readonly summary: RosterSummary;
}

function summarise(
  context: BuildContext,
  members: readonly RosterMember[],
  files: Omit<RosterFiles, 'person'>,
): RosterSummary {
  const byPromotion = new Map<string, { wrestlers: number; staff: number }>();
  for (const key of [...context.promotions.keys()].sort(compareText)) {
    byPromotion.set(key, { wrestlers: 0, staff: 0 });
  }
  for (const member of members) {
    if (member.promotionKey === null) {
      continue;
    }
    const counts = byPromotion.get(member.promotionKey);
    if (counts !== undefined) {
      if (member.role === 'wrestler') {
        counts.wrestlers += 1;
      } else {
        counts.staff += 1;
      }
    }
  }
  const wrestlers = members.filter((member) => member.role === 'wrestler');
  const freeAgents = members.filter((member) => member.promotionKey === null);
  return {
    total: members.length,
    wrestlers: wrestlers.length,
    nonWrestlers: members.length - wrestlers.length,
    freeAgentWrestlers: freeAgents.filter((member) => member.role === 'wrestler').length,
    freeAgentStaff: freeAgents.filter((member) => member.role !== 'wrestler').length,
    headliners: members.filter((member) => member.headliner !== null).length,
    teams: files.team.length,
    reigns: files.titleReign.length,
    byPromotion,
  };
}

function inRange(value: number, range: { readonly min: number; readonly max: number }): boolean {
  return value >= range.min && value <= range.max;
}

/** Throws when the build misses a target total; lists every miss. */
export function checkTargets(context: BuildContext, summary: RosterSummary): void {
  const misses: string[] = [];
  const expect = (
    label: string,
    value: number,
    range: { readonly min: number; readonly max: number },
  ): void => {
    if (!inRange(value, range)) {
      misses.push(
        `${label} is ${String(value)}, expected ${String(range.min)}-${String(range.max)}`,
      );
    }
  };
  for (const [key, counts] of summary.byPromotion) {
    const promotion = context.promotions.get(key);
    if (promotion !== undefined) {
      expect(`${key} wrestlers`, counts.wrestlers, TARGETS.wrestlersByTier[promotion.tier]);
    }
  }
  expect('Free-agent wrestlers', summary.freeAgentWrestlers, TARGETS.freeAgentWrestlers);
  expect('Free-agent staff', summary.freeAgentStaff, TARGETS.freeAgentStaff);
  expect('Non-wrestlers', summary.nonWrestlers, TARGETS.nonWrestlers);
  expect('People', summary.total, TARGETS.total);
  if (misses.length > 0) {
    throw new RosterBuildError(`The roster misses its targets:\n  ${misses.join('\n  ')}`);
  }
}

/**
 * Lines contracts up with the title history: a contract starts after its holder's last reign at
 * another promotion, and no later than the day they won the title they hold now. A reign held
 * elsewhere always ended before any current reign began, so the two never conflict.
 */
function alignWithReigns(
  employments: EmploymentOut[],
  championSince: ReadonlyMap<string, GameDate>,
  leftAfter: ReadonlyMap<string, GameDate>,
): void {
  for (const employment of employments) {
    const left = leftAfter.get(employment.personKey);
    if (left !== undefined && compareDates(employment.startsOn, left) < 0) {
      employment.startsOn = left;
    }
    const wonOn = championSince.get(employment.personKey);
    if (wonOn !== undefined && compareDates(employment.startsOn, wonOn) > 0) {
      employment.startsOn = wonOn;
    }
  }
}

/** Runs every build step and returns the records, unwritten. */
export function buildDefaultRoster(inputs: BuildInputs): RosterBuild {
  const context = createBuildContext(inputs);
  reserveHeadlinerNames(context, inputs.headliners);
  const headliners = generateHeadliners(context, inputs.headliners);
  const members: RosterMember[] = [...headliners];
  for (const promotionKey of [...context.promotions.keys()].sort(compareText)) {
    const promotion = context.promotions.get(promotionKey);
    if (promotion !== undefined) {
      members.push(...generatePromotionPeople(context, promotion, headliners));
    }
  }
  members.push(...generateFreeAgents(context));

  placeOnCards(context, members);
  fitPopularity(context, members);
  const teams = buildTeams(context, members);
  const { reigns, championSince, leftAfter } = buildReigns(context, members, teams);
  const employments = buildEmployments(context, members);
  alignWithReigns(employments, championSince, leftAfter);

  const rest = { employment: employments, team: teams.map((team) => team.out), titleReign: reigns };
  const summary = summarise(context, members, rest);
  checkTargets(context, summary);
  return {
    startDate: context.startDate,
    titles: context.titles,
    members,
    files: { person: members.map((member) => personRecordOf(context, member)), ...rest },
    summary,
  };
}

/** A few lines describing a build, for the command's output. */
export function formatSummary(summary: RosterSummary): string {
  const lines = [
    `People: ${String(summary.total)} (${String(summary.wrestlers)} wrestlers, ${String(summary.nonWrestlers)} non-wrestlers, ${String(summary.headliners)} headliners)`,
    `Free agents: ${String(summary.freeAgentWrestlers)} wrestlers, ${String(summary.freeAgentStaff)} staff`,
    `Teams: ${String(summary.teams)}; title reigns: ${String(summary.reigns)}`,
    'Under contract:',
    ...[...summary.byPromotion].map(
      ([key, counts]) =>
        `  ${key.padEnd(22)} ${String(counts.wrestlers).padStart(3)} wrestlers, ${String(counts.staff).padStart(2)} staff`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}
