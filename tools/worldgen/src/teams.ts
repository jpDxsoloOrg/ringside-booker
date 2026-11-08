/**
 * Tag teams and trios: 3-6 per promotion that has a tag or trios title, made from its upper- and
 * midcard wrestlers of one gender whose styles go together, plus a few free-agent teams. Teams
 * belong to no promotion, so free agents can be a team too.
 */

import {
  addDays,
  addMonths,
  compareDates,
  diffDays,
  intBetween,
  normaliseName,
  pick,
  type GameDate,
  type RingStyle,
} from '@ringside/engine';
import type { BuildContext } from './context';
import type { RosterMember, TeamOut } from './model';
import { byCardValue } from './card';
import { compareText, twoDigits } from './stats';

/** A team the build made, with its members for the reign step. */
export interface BuiltTeam {
  readonly out: TeamOut;
  readonly members: readonly RosterMember[];
  /** The promotion its members work for, or null for free agents. */
  readonly promotionKey: string | null;
  /** The latest debut among its members. */
  readonly latestDebut: GameDate;
}

/** Fewest teams a promotion with a team title gets, even when it has to dip into the lower card. */
const MIN_TEAMS = 3;

function stylesMatch(context: BuildContext, left: RingStyle, right: RingStyle): boolean {
  return Object.values(context.spec.teams.styleGroups).some(
    (group) => group.some((style) => style === left) && group.some((style) => style === right),
  );
}

/**
 * Greedy teams from a pool sorted by card value: the best unteamed wrestler anchors a team and
 * takes the best partners of the same gender whose styles go with theirs (any style when none
 * does). Returns at most `wanted` teams.
 */
function formTeams(
  context: BuildContext,
  pool: readonly RosterMember[],
  size: number,
  wanted: number,
): RosterMember[][] {
  const free = [...pool].sort(byCardValue);
  const teams: RosterMember[][] = [];
  while (teams.length < wanted && free.length >= size) {
    const anchor = free.shift();
    if (anchor === undefined) {
      break;
    }
    const sameGender = free.filter((candidate) => candidate.person.gender === anchor.person.gender);
    const team: RosterMember[] = [anchor];
    for (const preferMatch of [true, false]) {
      for (const candidate of sameGender) {
        if (team.length >= size || team.includes(candidate)) {
          continue;
        }
        const fits = team.every((member) =>
          stylesMatch(context, member.person.style, candidate.person.style),
        );
        if (fits || !preferMatch) {
          team.push(candidate);
        }
      }
    }
    if (team.length < size) {
      continue;
    }
    for (const member of team.slice(1)) {
      free.splice(free.indexOf(member), 1);
    }
    teams.push(team);
  }
  return teams;
}

/** The ring name words every `ringNameWords` record holds, pooled in key order. */
function ringWords(context: BuildContext): { adjectives: string[]; nouns: string[] } {
  const adjectives = new Set<string>();
  const nouns = new Set<string>();
  for (const key of Object.keys(context.library.ringNameWords).sort(compareText)) {
    const record = context.library.ringNameWords[key];
    record?.adjectives.forEach((word) => adjectives.add(word));
    record?.nouns.forEach((word) => nouns.add(word));
  }
  return { adjectives: [...adjectives], nouns: [...nouns] };
}

/** A team name from the ring name words, never one already used by a team or a ring name. */
function teamName(context: BuildContext, used: Set<string>): string {
  const stream = context.stream('worldgen.roster.teams');
  const { adjectives, nouns } = ringWords(context);
  const registry = context.generator.names.registry;
  for (let attempt = 0; attempt < 200; attempt++) {
    const article = intBetween(stream, 0, 1) === 1 ? 'The ' : '';
    const name = `${article}${pick(stream, adjectives)} ${pick(stream, nouns)}`;
    const normalised = normaliseName(name.replace(/^The /, ''));
    if (!used.has(normalised) && !registry.has('ring', name) && !registry.has('legal', name)) {
      used.add(normalised);
      return name;
    }
  }
  throw new Error('Ran out of team names');
}

function latestDebutOf(members: readonly RosterMember[], fallback: GameDate): GameDate {
  let latest: GameDate | null = null;
  for (const member of members) {
    const debut = member.person.debutDate ?? fallback;
    if (latest === null || compareDates(debut, latest) > 0) {
      latest = debut;
    }
  }
  return latest ?? fallback;
}

function makeTeam(
  context: BuildContext,
  key: string,
  members: readonly RosterMember[],
  promotionKey: string | null,
  usedNames: Set<string>,
): BuiltTeam {
  const stream = context.stream('worldgen.roster.teams');
  const { formedMonthsAgo, experience } = context.spec.teams;
  const start = context.startDate;
  const earliest = addMonths(start, -formedMonthsAgo.max);
  const latest = addMonths(start, -formedMonthsAgo.min);
  let formedOn = addDays(earliest, intBetween(stream, 0, diffDays(earliest, latest)));
  const latestDebut = latestDebutOf(members, start);
  if (compareDates(formedOn, latestDebut) < 0) {
    formedOn = compareDates(latestDebut, start) < 0 ? latestDebut : addDays(start, -1);
  }
  return {
    out: {
      key,
      kind: members.length === 3 ? 'trio' : 'tag',
      name: teamName(context, usedNames),
      memberKeys: members.map((member) => member.key).sort(compareText),
      formedOn,
      experience: intBetween(stream, experience.min, experience.max),
      status: 'active',
    },
    members,
    promotionKey,
    latestDebut,
  };
}

/** Every team: per promotion with a team title (in key order), then the free-agent teams. */
export function buildTeams(context: BuildContext, members: readonly RosterMember[]): BuiltTeam[] {
  const stream = context.stream('worldgen.roster.teams');
  const usedNames = new Set<string>();
  const teams: BuiltTeam[] = [];
  const singlesChampions = new Set(
    members.flatMap((member) =>
      member.headliner?.holdsTitleKey === undefined ? [] : [member.key],
    ),
  );
  for (const promotionKey of [...context.promotions.keys()].sort(compareText)) {
    const teamTitles = context.titles.filter(
      (title) => title.promotionKey === promotionKey && title.holderCount > 1,
    );
    const size = Math.max(0, ...teamTitles.map((title) => title.holderCount));
    if (size < 2) {
      continue;
    }
    const femaleOnly = teamTitles.every((title) => title.gender === 'female');
    const roster = members.filter(
      (member) =>
        member.promotionKey === promotionKey &&
        member.role === 'wrestler' &&
        member.headliner === null &&
        !singlesChampions.has(member.key) &&
        (!femaleOnly || member.person.gender === 'female'),
    );
    const wanted = intBetween(
      stream,
      context.spec.teams.perPromotion.min,
      context.spec.teams.perPromotion.max,
    );
    const core = roster.filter(
      (member) => member.push === 'upperCard' || member.push === 'midCard',
    );
    let formed = formTeams(context, core, size, wanted);
    if (formed.length < Math.min(MIN_TEAMS, wanted)) {
      // Not enough upper- and midcarders of one gender: the lower card fills the gap.
      const wider = roster.filter((member) => member.push !== 'enhancement');
      formed = formTeams(context, wider, size, Math.max(MIN_TEAMS, formed.length));
    }
    formed.forEach((team, index) => {
      teams.push(
        makeTeam(
          context,
          `team-${promotionKey}-${twoDigits(index + 1)}`,
          team,
          promotionKey,
          usedNames,
        ),
      );
    });
  }
  const freeAgents = members.filter(
    (member) => member.promotionKey === null && member.role === 'wrestler',
  );
  formTeams(context, freeAgents, 2, context.spec.freeAgents.teams).forEach((team, index) => {
    teams.push(makeTeam(context, `team-fa-${twoDigits(index + 1)}`, team, null, usedNames));
  });
  return teams;
}
