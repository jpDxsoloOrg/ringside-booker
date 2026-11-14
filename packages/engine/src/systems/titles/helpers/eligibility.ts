/**
 * May these people hold this title together? The one holder check: CRTV1-03's award command, the
 * eligible-holders query (CRTV1-02) and later booking (EVT2, AIP) all call `isEligibleHolder`.
 *
 * Design: docs/design/titles.md#holders.
 */

import type { Reason } from '../../../core/api/result';
import type { GameDate } from '../../../core/date';
import type { EntityRef } from '../../../core/trace/types';
import type { PersonId, TeamId } from '../../../core/ids';
import type { Title } from '../../../model/entities/title';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { isEligibleForTitle } from '../../workers/helpers/eligibility';
import { employedForTitle, ringNameForTitle } from './employment';

export const HOLDER_ELIGIBILITY_CODES = [
  'titleRetired',
  'wrongHolderCount',
  'duplicateHolder',
  'notOnRoster',
  'teamMismatch',
] as const;
export type HolderEligibilityCode = (typeof HOLDER_ELIGIBILITY_CODES)[number];

/** The people who would hold the title, and the team they would hold it as (tag and trios). */
export interface Holding {
  readonly holderIds: readonly PersonId[];
  readonly teamId: TeamId | null;
}

function sameMembers(memberIds: readonly PersonId[], holderIds: readonly PersonId[]): boolean {
  const holders = new Set(holderIds);
  return memberIds.length === holders.size && memberIds.every((memberId) => holders.has(memberId));
}

function championsText(count: number): string {
  return count === 1 ? '1 champion' : `${String(count)} champions`;
}

/**
 * Every reason the holding cannot hold `title` on `date`, in a fixed order; an empty list means it
 * can. Messages are written for the player.
 *
 * - `titleRetired`: the title is retired (reactivate it first). WRK1's own `titleRetired` is not
 *   repeated per holder.
 * - `wrongHolderCount`: not as many people as the title takes.
 * - `duplicateHolder`: the same person named twice.
 * - `notOnRoster`: a holder does not work for the title's promotion (or its parent) on `date`.
 * - WRK1's `isEligibleForTitle` reasons for each holder: not a wrestler, wrong division, weight.
 * - `teamMismatch`: a team was given, but it is not an active team made of exactly these holders.
 */
export function isEligibleHolder(
  read: GameWorldView,
  title: DeepReadonly<Title>,
  holding: Holding,
  date: GameDate,
): Reason[] {
  const reasons: Reason[] = [];
  const titleSubject: EntityRef = { kind: 'title', id: title.id };
  const refuse = (code: HolderEligibilityCode, message: string, subject = titleSubject): void => {
    reasons.push({ code, message, subject });
  };
  const { holderIds, teamId } = holding;

  if (title.status === 'retired') {
    refuse('titleRetired', `The ${title.name} is retired. Reactivate it first.`);
  }
  if (holderIds.length !== title.holderCount) {
    refuse('wrongHolderCount', `The ${title.name} needs ${championsText(title.holderCount)}.`);
  }

  const promotionName = read.tables.promotions.get(title.promotionId)?.name ?? title.promotionId;
  const seen = new Set<PersonId>();
  for (const personId of holderIds) {
    const name = ringNameForTitle(read, personId, title.promotionId, date);
    const personSubject: EntityRef = { kind: 'person', id: personId };
    if (seen.has(personId)) {
      refuse('duplicateHolder', `${name} is named more than once.`, personSubject);
      continue;
    }
    seen.add(personId);
    const person = read.tables.people.get(personId);
    if (person === undefined || !employedForTitle(read, personId, title.promotionId, date)) {
      refuse('notOnRoster', `${name} doesn't work for ${promotionName}.`, personSubject);
    }
    if (person !== undefined) {
      reasons.push(
        ...isEligibleForTitle(person, title).filter((reason) => reason.code !== 'titleRetired'),
      );
    }
  }

  if (teamId !== null) {
    const team = read.tables.teams.get(teamId);
    if (team === undefined) {
      refuse('teamMismatch', "That team doesn't exist.");
    } else if (team.status !== 'active') {
      refuse('teamMismatch', `${team.name} isn't an active team.`, { kind: 'team', id: team.id });
    } else if (!sameMembers(team.memberIds, holderIds)) {
      refuse('teamMismatch', `${team.name} isn't made up of these champions.`, {
        kind: 'team',
        id: team.id,
      });
    }
  }
  return reasons;
}
