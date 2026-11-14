/**
 * `titles.eligibleHolders`: who could hold a title right now. Everyone working for the title's
 * promotion (or its parent) is checked with `isEligibleHolder` as a single holder; the holder count
 * and team rules are checked when the title is awarded. For tag and trios titles, the active teams
 * of that kind whose members are all eligible come first.
 *
 * A brand mismatch is a hint (`sameBrand: false`), never a refusal (D-06: warn, don't block).
 *
 * Design: docs/design/titles.md#queries.
 */

import type { Reason } from '../../core/api/result';
import { isAfter } from '../../core/date';
import type { BrandId, PersonId, TeamId, TitleId } from '../../core/ids';
import { PUSH_LEVELS, type Push } from '../../model/entities/employment';
import type { Gender } from '../../model/entities/person';
import type { TeamKind } from '../../model/entities/team';
import type { TitleHolderCount } from '../../model/entities/title';
import { compareIds } from '../../model/table';
import { weightClass, type WeightClass } from '../workers/formulas/weightClass';
import { availabilityOf, type Availability } from '../workers/helpers/availability';
import { isEligibleHolder, type HolderEligibilityCode } from './helpers/eligibility';
import { employmentForTitle, ringNameForTitle, titlePromotionIds } from './helpers/employment';
import { currentReign } from './helpers/holders';
import { compareNames, type TitleRowContext } from './rows';

/** One person who could hold the title. */
export interface EligiblePerson {
  personId: PersonId;
  ringName: string;
  imageRef: string | null;
  gender: Gender;
  weightKg: number;
  weightClass: WeightClass;
  push: Push;
  brandId: BrandId | null;
  /** False when they work for another brand than the title's: a hint, not a refusal. */
  sameBrand: boolean;
  availability: Availability;
  isCurrentHolder: boolean;
}

/** One team whose members could hold a tag or trios title together. */
export interface EligibleTeam {
  teamId: TeamId;
  name: string;
  kind: TeamKind;
  members: { personId: PersonId; ringName: string }[];
  /** True when every member is on the title's brand (or the title has none). */
  sameBrand: boolean;
  isCurrentHolder: boolean;
}

/** Someone on the roster who cannot hold the title, and why. */
export interface IneligiblePerson {
  personId: PersonId;
  ringName: string;
  reasons: Reason[];
}

export interface EligibleHolders {
  holderCount: TitleHolderCount;
  /** Tag and trios titles only; empty for singles. */
  teams: EligibleTeam[];
  people: EligiblePerson[];
  /** Filled only when asked for (`includeIneligible`). */
  ineligible: IneligiblePerson[];
}

/** The codes a single-holder check leaves out: count and title status are award-time rules. */
const AWARD_TIME_CODES: ReadonlySet<string> = new Set<HolderEligibilityCode>([
  'wrongHolderCount',
  'titleRetired',
]);

const TEAM_KIND_BY_COUNT: Readonly<Record<TitleHolderCount, TeamKind | null>> = {
  1: null,
  2: 'tag',
  3: 'trio',
};

function pushRank(push: Push): number {
  return PUSH_LEVELS.indexOf(push);
}

/** `titles.eligibleHolders`, or null when the title does not exist. */
export function eligibleHoldersOf(
  ctx: TitleRowContext,
  titleId: TitleId,
  includeIneligible: boolean,
): EligibleHolders | null {
  const { read } = ctx;
  const title = read.tables.titles.get(titleId);
  if (title === undefined) {
    return null;
  }
  const today = read.meta.currentDate;
  const reign = currentReign(read, titleId);
  const holderIds = new Set<PersonId>(reign?.holderIds ?? []);

  // Everyone working for the title's promotion or its parent: one promotion's employments only.
  const personIds = new Set<PersonId>();
  for (const promotionId of titlePromotionIds(read, title.promotionId)) {
    for (const employment of read.tables.employments.lookup('byPromotion', promotionId)) {
      if (employment.status === 'active' && !isAfter(employment.startsOn, today)) {
        personIds.add(employment.personId);
      }
    }
  }

  const people: EligiblePerson[] = [];
  const ineligible: IneligiblePerson[] = [];
  for (const personId of [...personIds].sort(compareIds)) {
    const person = read.tables.people.get(personId);
    const employment = employmentForTitle(read, personId, title.promotionId, today);
    if (person === undefined || employment === null) {
      continue;
    }
    const ringName = ringNameForTitle(read, personId, title.promotionId, today);
    const reasons = isEligibleHolder(
      read,
      title,
      { holderIds: [personId], teamId: null },
      today,
    ).filter((reason) => !AWARD_TIME_CODES.has(reason.code));
    if (reasons.length > 0) {
      if (includeIneligible) {
        ineligible.push({ personId, ringName, reasons });
      }
      continue;
    }
    people.push({
      personId,
      ringName,
      imageRef: person.imageRef,
      gender: person.gender,
      weightKg: person.weightKg,
      weightClass: weightClass({ weightKg: person.weightKg }, { tunables: ctx.tunables }).value,
      push: employment.push,
      brandId: employment.brandId,
      sameBrand: title.brandId === null || employment.brandId === title.brandId,
      availability: availabilityOf(person, employment, today),
      isCurrentHolder: holderIds.has(personId),
    });
  }
  people.sort(
    (left, right) =>
      Number(right.sameBrand) - Number(left.sameBrand) ||
      pushRank(left.push) - pushRank(right.push) ||
      compareNames(left.ringName, right.ringName) ||
      compareIds(left.personId, right.personId),
  );
  ineligible.sort(
    (left, right) =>
      compareNames(left.ringName, right.ringName) || compareIds(left.personId, right.personId),
  );

  const teamKind = TEAM_KIND_BY_COUNT[title.holderCount];
  const eligibleById = new Map(people.map((person) => [person.personId, person]));
  const teams: EligibleTeam[] = [];
  if (teamKind !== null) {
    const seen = new Set<TeamId>();
    for (const person of people) {
      for (const team of read.tables.teams.lookup('byMember', person.personId)) {
        if (seen.has(team.id)) {
          continue;
        }
        seen.add(team.id);
        const members = team.memberIds.map((memberId) => eligibleById.get(memberId));
        if (team.status !== 'active' || team.kind !== teamKind) {
          continue;
        }
        const eligibleMembers = members.filter((member) => member !== undefined);
        if (eligibleMembers.length !== team.memberIds.length) {
          continue;
        }
        teams.push({
          teamId: team.id,
          name: team.name,
          kind: team.kind,
          members: eligibleMembers.map((member) => ({
            personId: member.personId,
            ringName: member.ringName,
          })),
          sameBrand: eligibleMembers.every((member) => member.sameBrand),
          isCurrentHolder:
            reign !== null &&
            (reign.teamId === team.id ||
              (team.memberIds.length === holderIds.size &&
                team.memberIds.every((memberId) => holderIds.has(memberId)))),
        });
      }
    }
    teams.sort(
      (left, right) =>
        Number(right.sameBrand) - Number(left.sameBrand) ||
        compareNames(left.name, right.name) ||
        compareIds(left.teamId, right.teamId),
    );
  }

  return { holderCount: title.holderCount, teams, people, ineligible };
}
