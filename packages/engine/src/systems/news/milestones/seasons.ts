/**
 * Milestone source `seasons` (DAY1-02): the start of a later season (number 2 and up). Season one
 * is announced by the new-game step `news.openingStory`. DAY3's own season story uses the same
 * dedupe key, so a season is never announced twice. Design: docs/design/news.md#milestones.
 */

import type { Season } from '../../../model/entities/season';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import type { NewsParams } from '../post';
import { registerNewsTopic } from '../topics';
import { inWindow } from './dates';
import {
  registerMilestoneSource,
  type MilestoneCandidate,
  type MilestoneSource,
  type MilestoneWindow,
} from './registry';

export const SEASON_START_TOPIC = 'season-start';

registerNewsTopic(SEASON_START_TOPIC, {
  params: ['seasonNumber', 'startDate', 'endDate', 'worldName', 'onDate'],
});

/** The "only once" key of a season's opening story, shared with DAY3. */
export function seasonStartDedupeKey(seasonNumber: number): string {
  return `season-start:${String(seasonNumber)}`;
}

/** The body parameters of a season's opening story. */
export function seasonStartBodyParams(
  read: GameWorldView,
  season: DeepReadonly<Season>,
): NewsParams {
  return {
    seasonNumber: season.number,
    startDate: season.startDate,
    endDate: season.endDate,
    worldName: read.meta.worldName,
  };
}

function collectSeasons(read: GameWorldView, window: MilestoneWindow): MilestoneCandidate[] {
  const candidates: MilestoneCandidate[] = [];
  for (const season of read.tables.seasons.values()) {
    if (season.number <= 1 || !inWindow(season.startDate, window)) {
      continue;
    }
    candidates.push({
      onDate: season.startDate,
      topic: SEASON_START_TOPIC,
      kind: 'season',
      importance: 3,
      params: { seasonNumber: season.number },
      bodyParams: seasonStartBodyParams(read, season),
      refs: {},
      dedupeKey: seasonStartDedupeKey(season.number),
    });
  }
  return candidates;
}

export const seasonsSource: MilestoneSource = { id: 'seasons', collect: collectSeasons };

registerMilestoneSource(seasonsSource);
