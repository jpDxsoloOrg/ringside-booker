/**
 * Milestone source `reigns` (DAY1-02): a current champion reaching 100, 200 or 300 days, or a
 * whole year, with their title. Design: docs/design/news.md#milestones.
 */

import type { NewsImportance } from '../../../model/entities/news';
import type { Title } from '../../../model/entities/title';
import type { TitleReign } from '../../../model/entities/title-reign';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import type { EngineTunables } from '../../tunables';
import { registerNewsTopic } from '../topics';
import { anniversariesIn, dayMarkIn } from './dates';
import {
  registerMilestoneSource,
  type MilestoneCandidate,
  type MilestoneSource,
  type MilestoneWindow,
} from './registry';

/** The day counts of a reign that make a story. Story beats, not balance. */
export const REIGN_MILESTONE_DAYS = [100, 200, 300] as const;

export const REIGN_MILESTONE_TOPIC = 'reign-milestone';

registerNewsTopic(REIGN_MILESTONE_TOPIC, {
  params: ['titleId', 'holderIds', 'days', 'years', 'onDate'],
});

/** An open reign of an active title, with its title. */
export interface OpenReign {
  readonly title: DeepReadonly<Title>;
  readonly reign: DeepReadonly<TitleReign>;
}

/** Every open reign of an active title, titles in id order. */
export function openReigns(read: GameWorldView): OpenReign[] {
  const found: OpenReign[] = [];
  for (const title of read.tables.titles.values()) {
    if (title.status !== 'active') {
      continue;
    }
    for (const reign of read.tables.titleReigns.lookup('openByTitle', title.id)) {
      found.push({ title, reign });
    }
  }
  return found;
}

/** The holders as one string param: person ids joined by commas, in stored order. */
export function holderIdsParam(reign: DeepReadonly<TitleReign>): string {
  return reign.holderIds.join(',');
}

/** One level more for a major title, capped at front page. */
function withPrestige(
  base: 1 | 2,
  title: DeepReadonly<Title>,
  tunables: EngineTunables,
): NewsImportance {
  if (title.prestige < tunables.get('news.milestones.majorTitlePrestige')) {
    return base;
  }
  return base === 1 ? 2 : 3;
}

function collectReigns(
  read: GameWorldView,
  window: MilestoneWindow,
  deps: { readonly tunables: EngineTunables },
): MilestoneCandidate[] {
  const candidates: MilestoneCandidate[] = [];
  for (const { title, reign } of openReigns(read)) {
    const holderIds = holderIdsParam(reign);
    const refs = { personIds: [...reign.holderIds], promotionIds: [title.promotionId] };
    for (const days of REIGN_MILESTONE_DAYS) {
      const onDate = dayMarkIn(reign.wonOn, days, window);
      if (onDate !== null) {
        candidates.push({
          onDate,
          topic: REIGN_MILESTONE_TOPIC,
          kind: 'milestone',
          importance: withPrestige(1, title, deps.tunables),
          params: { titleId: title.id, holderIds, days },
          bodyParams: {},
          refs,
          dedupeKey: `reign-milestone:${reign.id}:${String(days)}`,
        });
      }
    }
    for (const { years, onDate } of anniversariesIn(reign.wonOn, window)) {
      candidates.push({
        onDate,
        topic: REIGN_MILESTONE_TOPIC,
        kind: 'milestone',
        importance: withPrestige(2, title, deps.tunables),
        params: { titleId: title.id, holderIds, years },
        bodyParams: {},
        refs,
        dedupeKey: `reign-milestone:${reign.id}:${String(years)}`,
      });
    }
  }
  return candidates;
}

export const reignsSource: MilestoneSource = { id: 'reigns', collect: collectReigns };

registerMilestoneSource(reignsSource);
