/**
 * Milestone source `reignRecords` (DAY1-02): a current champion passing the longest finished reign
 * in their title's history. Design: docs/design/news.md#milestones.
 */

import { diffDays } from '../../../core/date';
import type { TitleReign } from '../../../model/entities/title-reign';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import type { EngineTunables } from '../../tunables';
import { registerNewsTopic } from '../topics';
import { dayMarkIn } from './dates';
import {
  registerMilestoneSource,
  type MilestoneCandidate,
  type MilestoneSource,
  type MilestoneWindow,
} from './registry';
import { holderIdsParam, openReigns } from './reigns';

export const REIGN_RECORD_TOPIC = 'reign-record';

registerNewsTopic(REIGN_RECORD_TOPIC, {
  params: ['titleId', 'holderIds', 'previousHolderIds', 'days', 'onDate'],
});

/** The longest finished reign and its length in days; the lower id wins a tie. */
function longestFinished(
  reigns: readonly DeepReadonly<TitleReign>[],
): { reign: DeepReadonly<TitleReign>; days: number } | null {
  let best: { reign: DeepReadonly<TitleReign>; days: number } | null = null;
  for (const reign of reigns) {
    if (reign.lostOn === null) {
      continue;
    }
    const days = diffDays(reign.wonOn, reign.lostOn);
    if (best === null || days > best.days) {
      best = { reign, days };
    }
  }
  return best;
}

function collectReignRecords(
  read: GameWorldView,
  window: MilestoneWindow,
  deps: { readonly tunables: EngineTunables },
): MilestoneCandidate[] {
  const minReigns = deps.tunables.get('news.milestones.recordMinReigns');
  const candidates: MilestoneCandidate[] = [];
  for (const { title, reign } of openReigns(read)) {
    const history = read.tables.titleReigns.lookup('byTitle', title.id);
    const finished = history.filter((past) => past.lostOn !== null);
    if (finished.length < minReigns) {
      continue;
    }
    const record = longestFinished(finished);
    if (record === null) {
      continue;
    }
    // Days held passes the record on the day after it equals it.
    const days = record.days + 1;
    const onDate = dayMarkIn(reign.wonOn, days, window);
    if (onDate === null) {
      continue;
    }
    candidates.push({
      onDate,
      topic: REIGN_RECORD_TOPIC,
      kind: 'milestone',
      importance: 3,
      params: {
        titleId: title.id,
        holderIds: holderIdsParam(reign),
        previousHolderIds: holderIdsParam(record.reign),
        days,
      },
      bodyParams: {},
      refs: {
        personIds: [...new Set([...reign.holderIds, ...record.reign.holderIds])],
        promotionIds: [title.promotionId],
      },
      dedupeKey: `reign-record:${reign.id}`,
    });
  }
  return candidates;
}

export const reignRecordsSource: MilestoneSource = {
  id: 'reignRecords',
  collect: collectReignRecords,
};

registerMilestoneSource(reignRecordsSource);
