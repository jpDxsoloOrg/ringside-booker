// The "Season one begins" new-game story (DAY1-02). Design: docs/design/news.md#opening-story
import { describe, expect, it } from 'vitest';
import { createNewGame, setupSteps } from '../../../src/systems/newgame';
// Importing the news system registers its setup step; `createNewGame` alone does not know it.
import { NEWS_OPENING_STORY_STEP, SEASON_START_TOPIC } from '../../../src/systems/news';
import { miniWorldPacks } from '../../support/fixture-packs';

function newGameState() {
  const result = createNewGame(miniWorldPacks(), {
    rootPackId: 'mini-world',
    seed: 'opening-story',
    playerId: 'local-player',
    playerName: 'Alex Booker',
    saveName: 'Opening story',
    seasonLength: { preset: '6m' },
    player: { mode: 'existing', promotionKey: 'harbour-city-wrestling' },
    settings: {},
  });
  if (!result.ok) throw new Error(`New game was refused: ${JSON.stringify(result.reasons)}`);
  return result.state;
}

describe('news.openingStory', () => {
  it('is setup step 950', () => {
    expect(NEWS_OPENING_STORY_STEP).toEqual({ id: 'news.openingStory', order: 950 });
    expect(setupSteps()).toContainEqual(NEWS_OPENING_STORY_STEP);
  });

  it('posts exactly one front-page season story on the start date', () => {
    const state = newGameState();
    const { startDate, worldName } = state.world.meta;
    const season = state.world.tables.seasons.find((row) => row.status === 'active');
    if (season === undefined) throw new Error('no active season');
    const stories = state.world.tables.news.filter((story) => story.kind === 'season');
    expect(stories).toHaveLength(1);
    expect(stories[0]).toMatchObject({
      date: startDate,
      kind: 'season',
      importance: 3,
      expiresOn: null,
      dedupeKey: 'season-start:1',
      headline: { key: `news.${SEASON_START_TOPIC}.headline`, params: { seasonNumber: 1 } },
      body: {
        key: `news.${SEASON_START_TOPIC}.body`,
        params: {
          seasonNumber: 1,
          startDate: season.startDate,
          endDate: season.endDate,
          worldName,
        },
      },
    });
    expect(season.startDate).toBe(startDate);
  });
});
