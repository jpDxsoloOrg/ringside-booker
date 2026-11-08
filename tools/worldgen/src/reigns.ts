/**
 * Title history: every title starts the game with a champion and a short lineage.
 *
 * The current reign of a singles title goes to the headliner who holds it in `headliners.json`; a
 * tag or trios title goes to the promotion's best team. Before that come 1-4 past reigns by other
 * wrestlers of the promotion (now and then a headliner of another promotion, for flavour), back to
 * at most five years before the start and never before the title was introduced. Each past reign
 * ends on the day the next one starts, so reigns never overlap.
 */

import {
  addDays,
  addYears,
  ageInYears,
  chance,
  compareDates,
  diffDays,
  intBetween,
  pick,
  type GameDate,
} from '@ringside/engine';
import { RosterBuildError, type BuildContext } from './context';
import { byCardValue } from './card';
import type { ReignOut, RosterMember, RosterTitle } from './model';
import type { BuiltTeam } from './teams';
import { TIERS } from './specSchema';
import { twoDigits } from './stats';

/** Youngest a past champion may have been when they won. */
const MIN_CHAMPION_AGE = 18;

/** How many of the best eligible wrestlers a past singles champion is drawn from. */
const PAST_HOLDER_POOL = 10;

/** How many tiers bigger a visiting past champion's promotion may be than the title's. */
const MAX_VISITOR_TIER_GAP = 1;

/** True when a person fits a title's division. */
export function fitsDivision(member: RosterMember, title: RosterTitle): boolean {
  const { gender, weightKg } = member.person;
  if (title.gender !== 'open' && gender !== title.gender) {
    return false;
  }
  if (title.minWeightKg !== null && weightKg < title.minWeightKg) {
    return false;
  }
  return title.maxWeightKg === null || weightKg <= title.maxWeightKg;
}

/** True when someone had debuted and was old enough to be champion on `date`. */
function couldHoldOn(member: RosterMember, date: GameDate): boolean {
  const debut = member.person.debutDate;
  return (
    debut !== null &&
    compareDates(debut, date) <= 0 &&
    ageInYears(member.person.birthDate, date) >= MIN_CHAMPION_AGE
  );
}

function teamCardValue(team: BuiltTeam): number {
  return team.members.reduce((sum, member) => sum + member.cardValue, 0);
}

interface Holder {
  readonly personKeys: readonly string[];
  readonly teamKey: string | null;
}

function holderOfMember(member: RosterMember): Holder {
  return { personKeys: [member.key], teamKey: null };
}

function holderOfTeam(team: BuiltTeam): Holder {
  return { personKeys: team.out.memberKeys, teamKey: team.out.key };
}

function sameHolder(left: Holder, right: Holder): boolean {
  return left.personKeys.join('|') === right.personKeys.join('|');
}

/** The current singles champion: the headliner who holds the title. */
function singlesChampion(title: RosterTitle, members: readonly RosterMember[]): RosterMember {
  const holders = members.filter((member) => member.headliner?.holdsTitleKey === title.key);
  const [holder] = holders;
  if (holder === undefined || holders.length > 1) {
    throw new RosterBuildError(
      `Title ${title.key} needs exactly one headliner holding it, found ${String(holders.length)}`,
    );
  }
  if (holder.promotionKey !== title.promotionKey || !fitsDivision(holder, title)) {
    throw new RosterBuildError(`Headliner ${holder.key} cannot hold ${title.key}`);
  }
  return holder;
}

/** Teams of the title's promotion and size that fit its division, best first. */
function eligibleTeams(title: RosterTitle, teams: readonly BuiltTeam[]): BuiltTeam[] {
  return teams
    .filter(
      (team) =>
        team.promotionKey === title.promotionKey &&
        team.members.length === title.holderCount &&
        team.members.every((member) => fitsDivision(member, title)),
    )
    .sort((left, right) => teamCardValue(right) - teamCardValue(left));
}

/**
 * Who held what, when: each person's reigns as `[wonOn, lostOn)` spans (an open reign runs to the
 * start date), so nobody is given two titles at once.
 */
class TitleCalendar {
  readonly #spans = new Map<string, { from: GameDate; until: GameDate }[]>();

  isFree(personKeys: readonly string[], from: GameDate, until: GameDate): boolean {
    return personKeys.every((personKey) =>
      (this.#spans.get(personKey) ?? []).every(
        (span) => compareDates(until, span.from) <= 0 || compareDates(span.until, from) <= 0,
      ),
    );
  }

  book(personKeys: readonly string[], from: GameDate, until: GameDate): void {
    for (const personKey of personKeys) {
      const spans = this.#spans.get(personKey) ?? [];
      spans.push({ from, until });
      this.#spans.set(personKey, spans);
    }
  }
}

/** A past reign being chosen: the title, its span, and who held it next. */
interface PastSlot {
  readonly title: RosterTitle;
  readonly wonOn: GameDate;
  readonly lostOn: GameDate;
  readonly next: Holder;
  /** The current champion's gender: an open title's lineage keeps to it where it can. */
  readonly gender: RosterMember['person']['gender'];
}

/** The size tier of a promotion as a rank, biggest first. */
function tierRank(context: BuildContext, promotionKey: string | null): number {
  const tier = promotionKey === null ? undefined : context.promotions.get(promotionKey)?.tier;
  return tier === undefined ? TIERS.length : TIERS.indexOf(tier);
}

/**
 * A past singles champion: one of the promotion's best eligible wrestlers, or now and then a
 * headliner of a promotion the same size or one tier bigger (a star who passed through before
 * moving on). The lineage of an open title stays with the current champion's gender while anyone
 * of it is free, and falls back to everyone otherwise.
 */
function pastSinglesHolder(
  context: BuildContext,
  slot: PastSlot,
  members: readonly RosterMember[],
  teamMembers: ReadonlySet<string>,
  calendar: TitleCalendar,
): Holder | null {
  const stream = context.stream('worldgen.roster.reigns');
  const { title } = slot;
  const eligible = (member: RosterMember): boolean =>
    member.role === 'wrestler' &&
    fitsDivision(member, title) &&
    couldHoldOn(member, slot.wonOn) &&
    !sameHolder(holderOfMember(member), slot.next) &&
    calendar.isFree([member.key], slot.wonOn, slot.lostOn);
  const visitor = chance(stream, context.spec.reigns.otherPromotionHolderChance);
  const titleTier = tierRank(context, title.promotionKey);
  const visitors = members
    .filter((member) => {
      const tierGap = titleTier - tierRank(context, member.promotionKey);
      return (
        member.headliner !== null &&
        member.promotionKey !== title.promotionKey &&
        tierGap >= 0 &&
        tierGap <= MAX_VISITOR_TIER_GAP &&
        member.person.gender === slot.gender &&
        eligible(member)
      );
    })
    .sort(byCardValue);
  const ownPeople = members
    .filter((member) => member.promotionKey === title.promotionKey && eligible(member))
    .sort(byCardValue);
  // Tag team members are left for the team titles' history while anyone else is free.
  const singles = ownPeople.filter((member) => !teamMembers.has(member.key));
  const sameGender = (singles.length > 0 ? singles : ownPeople).filter(
    (member) => member.person.gender === slot.gender,
  );
  const locals = (sameGender.length > 0 ? sameGender : ownPeople).slice(0, PAST_HOLDER_POOL);
  const pool = visitor && visitors.length > 0 ? visitors : locals;
  return pool.length === 0 ? null : holderOfMember(pick(stream, pool));
}

/**
 * A past team champion: another team of the promotion whose members had all debuted by then. A
 * team picked for a reign before its formation date is moved back to have formed on the day it
 * won; the team dates are the build's own, so the history decides them.
 */
function pastTeamHolder(
  context: BuildContext,
  slot: PastSlot,
  teams: readonly BuiltTeam[],
  calendar: TitleCalendar,
): Holder | null {
  const pool = eligibleTeams(slot.title, teams).filter(
    (team) =>
      compareDates(team.latestDebut, slot.wonOn) <= 0 &&
      team.members.every((member) => couldHoldOn(member, slot.wonOn)) &&
      !sameHolder(holderOfTeam(team), slot.next) &&
      calendar.isFree(team.out.memberKeys, slot.wonOn, slot.lostOn),
  );
  const sameGender = pool.filter((team) =>
    team.members.every((member) => member.person.gender === slot.gender),
  );
  const choices = sameGender.length > 0 ? sameGender : pool;
  if (choices.length === 0) {
    return null;
  }
  const team = pick(context.stream('worldgen.roster.reigns'), choices);
  if (compareDates(team.out.formedOn, slot.wonOn) > 0) {
    team.out.formedOn = slot.wonOn;
  }
  return holderOfTeam(team);
}

function reignOut(
  title: RosterTitle,
  holder: Holder,
  wonOn: GameDate,
  lostOn: GameDate | null,
  defences: number,
): Omit<ReignOut, 'key'> {
  return {
    titleKey: title.key,
    holderPersonKeys: [...holder.personKeys],
    teamKey: holder.teamKey,
    wonOn,
    lostOn,
    endReason: lostOn === null ? null : 'lost',
    defences,
  };
}

/** The result of the reign step: the reigns, and when people held titles. */
export interface BuiltReigns {
  readonly reigns: ReignOut[];
  /** Person key → the day their current title reign began. */
  readonly championSince: ReadonlyMap<string, GameDate>;
  /**
   * Person key → the last day they held a title of a promotion they no longer work for. Their
   * current contract starts no earlier.
   */
  readonly leftAfter: ReadonlyMap<string, GameDate>;
}

interface CurrentReign {
  readonly title: RosterTitle;
  readonly holder: Holder;
  readonly gender: RosterMember['person']['gender'];
  readonly wonOn: GameDate;
  readonly defences: number;
}

/** Each title's current champion and the day they won, in title-key order. */
function currentReigns(
  context: BuildContext,
  members: readonly RosterMember[],
  teams: readonly BuiltTeam[],
): CurrentReign[] {
  const stream = context.stream('worldgen.roster.reigns');
  const { reigns: rules } = context.spec;
  const start = context.startDate;
  return context.titles.map((title) => {
    let wonOn = addDays(
      start,
      -intBetween(stream, rules.currentWonDaysAgo.min, rules.currentWonDaysAgo.max),
    );
    if (compareDates(wonOn, title.introducedOn) < 0) {
      wonOn = title.introducedOn;
    }
    const defences = intBetween(stream, rules.defences.min, rules.defences.max);
    if (title.holderCount === 1) {
      const champion = singlesChampion(title, members);
      const debut = champion.person.debutDate;
      if (debut !== null && compareDates(debut, wonOn) > 0) {
        wonOn = debut;
      }
      return {
        title,
        holder: holderOfMember(champion),
        gender: champion.person.gender,
        wonOn,
        defences,
      };
    }
    const candidates = eligibleTeams(title, teams);
    const team =
      candidates.find((candidate) => compareDates(candidate.latestDebut, wonOn) <= 0) ??
      candidates[0];
    const [firstMember] = team?.members ?? [];
    if (team === undefined || firstMember === undefined) {
      throw new RosterBuildError(`No team of ${title.promotionKey} can hold ${title.key}`);
    }
    if (compareDates(team.latestDebut, wonOn) > 0) {
      wonOn = team.latestDebut;
    }
    if (compareDates(team.out.formedOn, wonOn) > 0) {
      team.out.formedOn = wonOn;
    }
    return {
      title,
      holder: holderOfTeam(team),
      gender: firstMember.person.gender,
      wonOn,
      defences,
    };
  });
}

/**
 * Every title's current reign and lineage. The current reigns are settled first, for every
 * title, so a past reign never overlaps anyone's current one; then each title's history is built
 * backwards from its current reign.
 */
export function buildReigns(
  context: BuildContext,
  members: readonly RosterMember[],
  teams: readonly BuiltTeam[],
): BuiltReigns {
  const stream = context.stream('worldgen.roster.reigns');
  const { reigns: rules } = context.spec;
  const start = context.startDate;
  const historyStart = addYears(start, -rules.historyYears);
  const calendar = new TitleCalendar();
  const championSince = new Map<string, GameDate>();
  const leftAfter = new Map<string, GameDate>();
  const promotionOf = new Map(members.map((member) => [member.key, member.promotionKey]));
  const teamMembers = new Set(teams.flatMap((team) => team.out.memberKeys));

  const current = currentReigns(context, members, teams);
  for (const reign of current) {
    calendar.book(reign.holder.personKeys, reign.wonOn, start);
    for (const personKey of reign.holder.personKeys) {
      championSince.set(personKey, reign.wonOn);
    }
  }

  const reigns: ReignOut[] = [];
  for (const reign of current) {
    const { title } = reign;
    const lineage: Omit<ReignOut, 'key'>[] = [
      reignOut(title, reign.holder, reign.wonOn, null, reign.defences),
    ];
    // Past reigns, newest first, each ending the day the next began.
    const earliest =
      compareDates(title.introducedOn, historyStart) > 0 ? title.introducedOn : historyStart;
    const wantedPast = intBetween(stream, rules.pastReigns.min, rules.pastReigns.max);
    let next = reign.holder;
    let lostOn = reign.wonOn;
    for (let i = 0; i < wantedPast; i++) {
      const length = intBetween(stream, rules.pastReignDays.min, rules.pastReignDays.max);
      let wonOn = addDays(lostOn, -length);
      if (compareDates(wonOn, earliest) < 0) {
        if (i > 0 || diffDays(earliest, lostOn) < 1) {
          break;
        }
        wonOn = earliest;
      }
      const slot: PastSlot = { title, wonOn, lostOn, next, gender: reign.gender };
      const past =
        title.holderCount === 1
          ? pastSinglesHolder(context, slot, members, teamMembers, calendar)
          : pastTeamHolder(context, slot, teams, calendar);
      if (past === null) {
        break;
      }
      calendar.book(past.personKeys, wonOn, lostOn);
      for (const personKey of past.personKeys) {
        const previous = leftAfter.get(personKey);
        const elsewhere = promotionOf.get(personKey) !== title.promotionKey;
        if (elsewhere && (previous === undefined || compareDates(lostOn, previous) > 0)) {
          leftAfter.set(personKey, lostOn);
        }
      }
      const maxDefences = Math.max(
        rules.defences.min,
        Math.min(rules.defences.max, Math.floor(diffDays(wonOn, lostOn) / 30)),
      );
      lineage.push(
        reignOut(title, past, wonOn, lostOn, intBetween(stream, rules.defences.min, maxDefences)),
      );
      next = past;
      lostOn = wonOn;
    }
    lineage.reverse().forEach((entry, index) => {
      reigns.push({ key: `reign-${title.key}-${twoDigits(index + 1)}`, ...entry });
    });
  }
  return { reigns, championSince, leftAfter };
}
