/**
 * Milestone source `careers` (DAY1-02): a working wrestler's debut anniversary, every
 * `news.milestones.careerYearStep` years from `news.milestones.careerMinYears`.
 * Design: docs/design/news.md#milestones.
 */

import type { PersonId, PromotionId } from '../../../core/ids';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { registerNewsTopic } from '../topics';
import { anniversariesIn } from './dates';
import {
  registerMilestoneSource,
  type MilestoneCandidate,
  type MilestoneSource,
  type MilestoneWindow,
} from './registry';

export const CAREER_ANNIVERSARY_TOPIC = 'career-anniversary';

/** From this many years in the business a career anniversary is one level more important. */
export const CAREER_MAJOR_YEARS = 25;

registerNewsTopic(CAREER_ANNIVERSARY_TOPIC, { params: ['personId', 'years', 'onDate'] });

/** The people still in the business (`active` or `semiRetired`), in id order. */
const WORKING_STATUSES = ['active', 'semiRetired'] as const;

/** The promotions a person has an active contract with, in id order. */
function activeEmployers(read: GameWorldView, personId: PersonId): PromotionId[] {
  const employers = read.tables.employments
    .lookup('byPerson', personId)
    .filter((employment) => employment.status === 'active')
    .map((employment) => employment.promotionId);
  return [...new Set(employers)].sort();
}

function collectCareers(
  read: GameWorldView,
  window: MilestoneWindow,
  deps: { readonly tunables: EngineTunables },
): MilestoneCandidate[] {
  const step = deps.tunables.get('news.milestones.careerYearStep');
  const minYears = deps.tunables.get('news.milestones.careerMinYears');
  const people = WORKING_STATUSES.flatMap((status) =>
    read.tables.people.lookup('byStatus', status),
  ).sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const candidates: MilestoneCandidate[] = [];
  for (const person of people) {
    if (person.debutDate === null) {
      continue;
    }
    for (const { years, onDate } of anniversariesIn(person.debutDate, window)) {
      if (years % step !== 0 || years < minYears) {
        continue;
      }
      candidates.push({
        onDate,
        topic: CAREER_ANNIVERSARY_TOPIC,
        kind: 'milestone',
        importance: years >= CAREER_MAJOR_YEARS ? 2 : 1,
        params: { personId: person.id, years },
        bodyParams: {},
        refs: { personIds: [person.id], promotionIds: activeEmployers(read, person.id) },
        dedupeKey: `career:${person.id}:${String(years)}`,
      });
    }
  }
  return candidates;
}

export const careersSource: MilestoneSource = { id: 'careers', collect: collectCareers };

registerMilestoneSource(careersSource);
