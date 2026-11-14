/**
 * The news system's new-game setup step (DAY1-02): the "Season one begins" front-page story.
 *
 * Order 950: after every other band in the catalog's setup-step list (SOC1's 940 is the last
 * before it), so the story is written into the finished world, and before the office baseline
 * (990). It is a setup step and not a reaction to `world.created` because `createNewGame` runs
 * with its own event bus and no system subscriptions, so a reaction would never run there.
 * See docs/design/news.md#opening-story and docs/design/new-game.md#setup-steps.
 */

import { ACTIVE_SEASON_KEY } from '../../model/entities/season';
import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';
import { registerSetupStep, type SetupContext } from '../newgame/steps';
import {
  SEASON_START_TOPIC,
  seasonStartBodyParams,
  seasonStartDedupeKey,
} from './milestones/seasons';
import { postNews } from './post';

export const NEWS_OPENING_STORY_STEP = { id: 'news.openingStory', order: 950 } as const;

function postOpeningStory(_tx: Tx<GameTables>, ctx: SetupContext): void {
  const season = ctx.read.tables.seasons.lookupOne('activeSeason', ACTIVE_SEASON_KEY);
  if (season === undefined) {
    ctx.log('No active season, so no opening story');
    return;
  }
  postNews(ctx, {
    kind: 'season',
    topic: SEASON_START_TOPIC,
    importance: 3,
    params: { seasonNumber: season.number },
    bodyParams: seasonStartBodyParams(ctx.read, season),
    dedupeKey: seasonStartDedupeKey(season.number),
  });
  ctx.log(`Posted the opening story of season ${String(season.number)}`);
}

registerSetupStep({ ...NEWS_OPENING_STORY_STEP, run: postOpeningStory });
