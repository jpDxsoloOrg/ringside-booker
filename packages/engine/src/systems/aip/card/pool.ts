/**
 * The card pool: who and what one show may use today.
 *
 * Read-only and deterministic: rows are walked in ID order and candidates sorted by card value,
 * then person ID, so two builds on the same world give the same pool and every later pick (AIP4-02
 * onwards) can take "the first that fits" without a tie-break of its own.
 *
 * Rules (docs/design/rival-booking.md#card-pool):
 *
 * - roster: the promotion's active, started contracts as a wrestler, manager or presenter (crew
 *   are not booked into segments). On a brand's show only that brand's contracts and brandless
 *   ones count; the planner never books another brand's worker. One contract per person, the
 *   lowest ID;
 * - each person's WRK1 availability on the date decides `canWrestle` (available, a wrestling role
 *   and a wrestler's contract) and `canTalk` (available, or out but still able to do talking
 *   segments). Nobody who can do neither is a candidate;
 * - fatigue above `aip.card.maxFatigue` and a contract that rules the show out (appearance cap
 *   used up, no house shows) keep a candidate in the pool but flag them as a last resort;
 * - teams count only when every member can wrestle; titles are the promotion's active ones that
 *   belong to the show's brand or to no brand (all of them on a show without a brand).
 */

import { isAfter, type GameDate } from '../../../core/date';
import type { PersonId, TitleId } from '../../../core/ids';
import { constantOf, startCalc, type Traced } from '../../../core/trace';
import { promotionStatusKey, type Employment } from '../../../model/entities/employment';
import type { EventInstance } from '../../../model/entities/event-instance';
import { WRESTLING_ROLES, type Person, type PersonRole } from '../../../model/entities/person';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { availabilityText } from '../../match/availabilityText';
import type { EngineTunables } from '../../tunables';
import { geographyOf } from '../../world/geography';
import { ATTRIBUTE_LABELS, formatNumber } from '../../world/people/labels';
import { availabilityOf } from '../../workers/helpers/availability';
import { cardValue } from '../formulas/cardValue';
import type { TracedTaste } from '../formulas/defaultTaste';
import { cardValueInputsFor, deciderBrandOf, holderNamesOf, openReignOf } from '../inputs';
import { tasteOf } from '../taste';
import type {
  CardCandidate,
  CardExclusion,
  CardPool,
  CardTeam,
  CardTitle,
  ContractBlock,
} from './types';

/** The contract roles that appear in segments. Referees, announcers, producers and bookers don't. */
export const CARD_EMPLOYMENT_ROLES: readonly Employment['role'][] = [
  'wrestler',
  'manager',
  'presenter',
];

/** The show fields the pool reads. */
export type CardPoolShow = Pick<
  EventInstance,
  'id' | 'promotionId' | 'brandId' | 'name' | 'importance'
>;

export interface CardPoolArgs {
  readonly instance: DeepReadonly<CardPoolShow>;
  /** The day the show runs (its `date`). */
  readonly date: GameDate;
  readonly tunables: EngineTunables;
}

/** "Tired (fatigue 82, limit 75)". */
export function tiredReason(fatigue: number, limit: number): string {
  return `Tired (fatigue ${formatNumber(fatigue)}, limit ${formatNumber(limit)})`;
}

export const NO_HOUSE_SHOWS_REASON = 'Contract: no house shows';

/** "Used 24 of 24 contracted appearances". */
export function appearanceCapReason(used: number, cap: number): string {
  return `Used ${String(used)} of ${String(cap)} contracted appearances`;
}

function hasWrestlingRole(roles: readonly PersonRole[]): boolean {
  return roles.some((role) => WRESTLING_ROLES.some((wrestlingRole) => wrestlingRole === role));
}

/** The started, active contracts this show may draw on, one per person, in employment ID order. */
function rosterFor(
  read: GameWorldView,
  instance: DeepReadonly<CardPoolShow>,
  date: GameDate,
): DeepReadonly<Employment>[] {
  const seen = new Set<PersonId>();
  return read.tables.employments
    .lookup('byPromotionStatus', promotionStatusKey(instance.promotionId, 'active'))
    .filter(
      (employment) =>
        !isAfter(employment.startsOn, date) &&
        CARD_EMPLOYMENT_ROLES.includes(employment.role) &&
        (instance.brandId === null ||
          employment.brandId === null ||
          employment.brandId === instance.brandId),
    )
    .sort((left, right) => compareIds(left.id, right.id))
    .filter((employment) => {
      if (seen.has(employment.personId)) {
        return false;
      }
      seen.add(employment.personId);
      return true;
    });
}

/** The contract's reason to keep this person off the show, if any. */
function contractBlockOf(
  employment: DeepReadonly<Employment>,
  instance: DeepReadonly<CardPoolShow>,
): { block: ContractBlock; reason: string } | null {
  const cap = employment.terms.appearanceCap;
  if (cap !== null && employment.appearancesThisYear >= cap) {
    return {
      block: 'appearanceCap',
      reason: appearanceCapReason(employment.appearancesThisYear, cap),
    };
  }
  if (employment.terms.perks.noHouseShows && instance.importance === 'house') {
    return { block: 'noHouseShows', reason: NO_HOUSE_SHOWS_REASON };
  }
  return null;
}

/** The mean of mic and charisma. */
export function talkValueOf(person: DeepReadonly<Pick<Person, 'attributes'>>): Traced<number> {
  const { mic, charisma } = person.attributes;
  return startCalc('Talking ability', 0, { unit: 'points', startLabel: 'Nothing counted yet' })
    .add(`${ATTRIBUTE_LABELS.mic} ${formatNumber(mic)}`, mic)
    .add(`${ATTRIBUTE_LABELS.charisma} ${formatNumber(charisma)}`, charisma)
    .divide(
      'Mean of mic and charisma',
      constantOf('Talking attributes', 2, 'Talking ability is the mean of mic and charisma'),
    )
    .done();
}

/** The show's titles: active, and the show's brand's or brandless (all on a brandless show). */
function titlesFor(
  read: GameWorldView,
  instance: DeepReadonly<CardPoolShow>,
  date: GameDate,
): CardTitle[] {
  return read.tables.titles
    .lookup('byPromotion', instance.promotionId)
    .filter(
      (title) =>
        title.status === 'active' &&
        (instance.brandId === null || title.brandId === null || title.brandId === instance.brandId),
    )
    .sort((left, right) => compareIds(left.id, right.id))
    .map((title) => {
      const reign = openReignOf(read, title.id);
      return {
        titleId: title.id,
        name: title.name,
        prestige: title.prestige,
        holderCount: title.holderCount,
        division: { ...title.division },
        reignId: reign?.id ?? null,
        wonOn: reign?.wonOn ?? null,
        holderIds: reign === null ? [] : [...reign.holderIds],
        holderNames: reign === null ? [] : holderNamesOf(read, reign, instance.promotionId, date),
      };
    });
}

/** Active teams whose members can all wrestle on the show, in team ID order. */
function teamsFor(read: GameWorldView, wrestlerValues: ReadonlyMap<PersonId, number>): CardTeam[] {
  const teams = new Map<string, CardTeam>();
  for (const personId of wrestlerValues.keys()) {
    for (const team of read.tables.teams.lookup('byMember', personId)) {
      if (teams.has(team.id) || team.status !== 'active') {
        continue;
      }
      const values = team.memberIds.map((memberId) => wrestlerValues.get(memberId));
      if (values.some((value) => value === undefined)) {
        continue;
      }
      const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
      teams.set(team.id, {
        teamId: team.id,
        name: team.name,
        kind: team.kind,
        memberIds: [...team.memberIds],
        experience: team.experience,
        meanCardValue: total / values.length,
      });
    }
  }
  return [...teams.values()].sort((left, right) => compareIds(left.teamId, right.teamId));
}

/**
 * Builds the card pool of `instance` on `date`. See the module comment for the rules.
 *
 * @throws EntityNotFoundError when the show's promotion, or a contract's person, is missing.
 */
export function buildCardPool(read: GameWorldView, args: CardPoolArgs): CardPool {
  const { instance, date, tunables } = args;
  const maxFatigue = tunables.get('aip.card.maxFatigue');
  const regions = geographyOf(read).regions;
  const tastes = new Map<string, TracedTaste>();
  const tasteFor = (employment: DeepReadonly<Employment>): TracedTaste => {
    const brandId = deciderBrandOf(read, employment);
    const key = brandId ?? '';
    const known = tastes.get(key);
    if (known !== undefined) {
      return known;
    }
    const taste = tasteOf(read, tunables, employment.promotionId, brandId);
    tastes.set(key, taste);
    return taste;
  };

  const titles = titlesFor(read, instance, date);
  const championships = new Map<PersonId, TitleId[]>();
  for (const title of titles) {
    for (const holderId of title.holderIds) {
      championships.set(holderId, [...(championships.get(holderId) ?? []), title.titleId]);
    }
  }

  const drafts: Omit<CardCandidate, 'teamIds'>[] = [];
  const excluded: CardExclusion[] = [];
  for (const employment of rosterFor(read, instance, date)) {
    const person = read.tables.people.require(employment.personId);
    const availability = availabilityOf(person, employment, date);
    const available = availability.status === 'available';
    const canWrestle =
      available && employment.role === 'wrestler' && hasWrestlingRole(person.roles);
    const canTalk = available || availability.canWorkAngles;
    const restedEnough = person.fatigue <= maxFatigue;
    const contract = contractBlockOf(employment, instance);

    const reasons: string[] = [];
    if (!available) {
      reasons.push(availabilityText(availability, date));
    }
    if (contract !== null) {
      reasons.push(contract.reason);
    }
    if (!restedEnough) {
      reasons.push(tiredReason(person.fatigue, maxFatigue));
    }
    if (reasons.length > 0) {
      excluded.push({
        personId: person.id,
        ringName: employment.ringName,
        reason: reasons.join('; '),
      });
    }
    if (!canWrestle && !canTalk) {
      continue;
    }

    drafts.push({
      personId: person.id,
      employmentId: employment.id,
      ringName: employment.ringName,
      gender: person.gender,
      alignment: employment.alignment,
      push: employment.push,
      roles: [...person.roles],
      cardValue: cardValue(
        cardValueInputsFor(read, tunables, employment, date, {
          regions,
          taste: tasteFor(employment),
        }),
        { tunables },
      ),
      availability: { ...availability },
      fatigue: person.fatigue,
      canWrestle,
      canTalk,
      restedEnough,
      contractBlock: contract?.block ?? null,
      championOf: championships.get(person.id) ?? [],
      talkValue: talkValueOf(person),
    });
  }

  const wrestlerValues = new Map<PersonId, number>(
    drafts
      .filter((draft) => draft.canWrestle)
      .map((draft) => [draft.personId, draft.cardValue.value]),
  );
  const teams = teamsFor(read, wrestlerValues);
  const candidates: CardCandidate[] = drafts
    .map((draft) => ({
      ...draft,
      teamIds: teams
        .filter((team) => team.memberIds.includes(draft.personId))
        .map((team) => team.teamId),
    }))
    .sort(
      (left, right) =>
        right.cardValue.value - left.cardValue.value || compareIds(left.personId, right.personId),
    );

  return {
    instanceId: instance.id,
    promotionId: instance.promotionId,
    brandId: instance.brandId,
    showName: instance.name,
    importance: instance.importance,
    date,
    taste: tasteOf(read, tunables, instance.promotionId, deciderBrandOf(read, instance)),
    candidates,
    teams,
    titles,
    availableWrestlers: candidates.filter(
      (candidate) =>
        candidate.canWrestle && candidate.restedEnough && candidate.contractBlock === null,
    ).length,
    excluded,
  };
}
