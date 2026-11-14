// The news queries: news.feed, news.top and news.item (DAY1-03). Design: docs/design/news.md#queries
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEngine, defineSystem, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { Viewer } from '../../../src/core/api/controller';
import { assertSerialisable } from '../../../src/core/api/serialisable';
import { parseGameDate, type GameDate } from '../../../src/core/date';
import type { NewsId, PersonId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import type { News } from '../../../src/model/entities/news';
import type { GameWorld } from '../../../src/model/tables';
import {
  NEWS_ITEM_NOT_FOUND,
  NO_LONGER_IN_RECORDS,
  newsSystem,
  postNews,
  registerNewsTopic,
  type NewsFeedArgs,
} from '../../../src/systems/news';
import { TEST_PLAYER_ID } from '../../support/builders/build-row';
import { aNews } from '../../support/builders/inbox';
import { testId } from '../../support/ids';
import { worldBuilder } from '../../support/world-builder';

const TODAY: GameDate = parseGameDate('2026-01-20');
const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
const ME: Viewer = { kind: 'controller', controller: HUMAN };
const OMNISCIENT: Viewer = { kind: 'omniscient' };
const TOPIC = 'test-queries';

let unregister: () => void = () => undefined;
beforeAll(() => {
  unregister = registerNewsTopic(TOPIC, { params: [] });
});
afterAll(() => {
  unregister();
});

type StoryKey = 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7';

interface FeedWorld {
  readonly engine: Engine;
  readonly world: GameWorld;
  readonly stories: Record<StoryKey, NewsId>;
  readonly people: readonly PersonId[];
}

function day(value: string): GameDate {
  return parseGameDate(value);
}

/**
 * Promotion A (the player's) with two workers, a title held by the first and a show; promotion B
 * (a rival) with one worker. Seven stories:
 *
 * | story | date  | kind        | imp | buzz | about                  | note                       |
 * | s1    | 01-20 | titleChange | 2   | 70   | A's champion, A        | front page by buzz         |
 * | s7    | 01-20 | result      | 0   | 20   | nobody                 | same day as s1, lower buzz |
 * | s2    | 01-19 | signing     | 1   | 40   | B's worker, B          |                            |
 * | s6    | 01-18 | injury      | 1   | 50   | ids that no longer exist in params               |
 * | s3    | 01-15 | season      | 3   | 30   | the season             | front page by importance   |
 * | s4    | 01-10 | rumour      | 0   | 10   |                        | expired today, not deleted |
 * | s5    | 01-02 | business    | 1   | 90   | A and A's show         | outside the 7-day window   |
 */
function feedWorld(): FeedWorld {
  const stored: Partial<Record<StoryKey, NewsId>> = {};
  const { world, ids } = worldBuilder({ currentDate: TODAY })
    .withGeography('mini')
    .withPromotion({ name: 'My Wrestling', controller: HUMAN }, (promotion) =>
      promotion.withRoster(2).withTitle({ name: 'My Title' }, { holder: 0 }),
    )
    .withPromotion({ name: 'Rival Wrestling' }, (promotion) => promotion.withRoster(1))
    .withEventInstance({ name: 'My Big Show' })
    .with('stories', (context) => {
      const [p0, , p2] = context.ids.people;
      const { A, B } = context.ids.promotions;
      const [titleId] = context.ids.titles;
      const [showId] = context.ids.eventInstances;
      const [seasonId] = context.ids.seasons;
      const [employmentId] = context.ids.employments;
      if (
        p0 === undefined ||
        p2 === undefined ||
        A === undefined ||
        B === undefined ||
        titleId === undefined ||
        showId === undefined ||
        seasonId === undefined ||
        employmentId === undefined
      ) {
        throw new Error('the feed world is missing rows');
      }
      const add = (key: StoryKey, fields: Parameters<typeof aNews>[0]) => {
        stored[key] = context.insert('news', aNews(fields, context.sequence)).id;
      };
      const refs = (fields: Partial<News['refs']>): News['refs'] => ({
        personIds: [],
        promotionIds: [],
        eventInstanceId: null,
        employmentId: null,
        ...fields,
      });
      add('s1', {
        date: TODAY,
        kind: 'titleChange',
        importance: 2,
        buzz: 70,
        refs: refs({ personIds: [p0], promotionIds: [A], employmentId }),
        headline: { key: 'news.test-headline', params: { titleId, winner: p0 } },
      });
      add('s7', { date: TODAY, kind: 'result', importance: 0, buzz: 20 });
      add('s2', {
        date: day('2026-01-19'),
        kind: 'signing',
        importance: 1,
        buzz: 40,
        refs: refs({ personIds: [p2], promotionIds: [B] }),
      });
      add('s6', {
        date: day('2026-01-18'),
        kind: 'injury',
        importance: 1,
        buzz: 50,
        body: {
          key: 'news.test-body',
          params: {
            gone: [testId('person', 9001), testId('promotion', 9002), testId('title', 9003)].join(
              ',',
            ),
            show: testId('eventInstance', 9004),
            season: testId('season', 9005),
            contract: testId('employment', 9006),
            words: 'not an id',
            count: 3,
          },
        },
      });
      add('s3', {
        date: day('2026-01-15'),
        kind: 'season',
        importance: 3,
        buzz: 30,
        body: { key: 'news.test-body', params: { season: seasonId } },
      });
      add('s4', {
        date: day('2026-01-10'),
        kind: 'rumour',
        importance: 0,
        buzz: 10,
        expiresOn: TODAY,
      });
      add('s5', {
        date: day('2026-01-02'),
        kind: 'business',
        importance: 1,
        buzz: 90,
        refs: refs({ promotionIds: [A], eventInstanceId: showId }),
      });
    })
    .build();
  const keys: StoryKey[] = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
  const stories: Partial<Record<StoryKey, NewsId>> = {};
  for (const key of keys) {
    const id = stored[key];
    if (id === undefined) {
      throw new Error(`story ${key} missing`);
    }
    stories[key] = id;
  }
  const engine = createEngine({
    state: initialEngineState(world),
    systems: [simSystem, newsSystem],
  });
  // Every key was checked above.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return { engine, world, stories: stories as Record<StoryKey, NewsId>, people: ids.people };
}

function feed(engine: Engine, args: NewsFeedArgs = {}, viewer: Viewer = OMNISCIENT) {
  const result = engine.query('news.feed', args, viewer);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  assertSerialisable(result.data, 'news.feed');
  return result.data;
}

function top(engine: Engine, args: { heroCount?: number; tickerCount?: number } = {}) {
  const result = engine.query('news.top', args, OMNISCIENT);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  assertSerialisable(result.data, 'news.top');
  return result.data;
}

function idsOf(items: readonly { id: NewsId }[]): NewsId[] {
  return items.map((item) => item.id);
}

describe('news.feed', () => {
  it('lists every story still shown, newest first, then by buzz, and leaves out expired ones', () => {
    const { engine, stories: story } = feedWorld();
    const data = feed(engine);
    expect(idsOf(data.items)).toEqual([story.s1, story.s7, story.s2, story.s6, story.s3, story.s5]);
    expect(data.total).toBe(6);
    // s4 expired today but news.expire has not run: it is still in the table, not on the feed.
    expect(engine.exportState().world.tables.news.some((row) => row.id === story.s4)).toBe(true);
  });

  it('builds the item view with the kind label, front-page flag and no trace for a direct row', () => {
    const { engine, stories: story } = feedWorld();
    const [first] = feed(engine).items;
    expect(first).toMatchObject({
      id: story.s1,
      date: TODAY,
      kind: 'titleChange',
      kindLabel: 'Title change',
      importance: 2,
      buzz: 70,
      frontPage: true,
      buzzTraceRef: null,
      expiresOn: null,
    });
  });

  it('filters by kind, person, promotion and importance', () => {
    const { engine, stories: story, people } = feedWorld();
    expect(idsOf(feed(engine, { kinds: ['signing', 'injury'] }).items)).toEqual([
      story.s2,
      story.s6,
    ]);
    expect(idsOf(feed(engine, { personId: people[2] }).items)).toEqual([story.s2]);
    const rival = engine
      .exportState()
      .world.tables.promotions.find((promotion) => promotion.name === 'Rival Wrestling');
    expect(idsOf(feed(engine, { promotionId: rival?.id }).items)).toEqual([story.s2]);
    expect(idsOf(feed(engine, { minImportance: 2 }).items)).toEqual([story.s1, story.s3]);
  });

  it('keeps only front-page stories: importance 3 or buzz from news.frontPage.minBuzz', () => {
    const { engine, stories: story } = feedWorld();
    expect(idsOf(feed(engine, { frontPageOnly: true }).items)).toEqual([
      story.s1,
      story.s3,
      story.s5,
    ]);
  });

  it("keeps the viewer's stories with mine: their promotion, directly or through a show", () => {
    const { engine, stories: story } = feedWorld();
    expect(idsOf(feed(engine, { mine: true }, ME).items)).toEqual([story.s1, story.s5]);
    // The omniscient viewer runs no promotion.
    expect(feed(engine, { mine: true }).items).toEqual([]);
  });

  it('walks a date range, both ends included', () => {
    const { engine, stories: story } = feedWorld();
    const data = feed(engine, { from: day('2026-01-15'), to: day('2026-01-19') });
    expect(idsOf(data.items)).toEqual([story.s2, story.s6, story.s3]);
    expect(data.total).toBe(3);
  });

  it('pages with limit and offset, and total counts every match', () => {
    const { engine, stories: story } = feedWorld();
    const data = feed(engine, { limit: 2, offset: 1 });
    expect(idsOf(data.items)).toEqual([story.s7, story.s2]);
    expect(data.total).toBe(6);
  });

  it('refuses unknown arguments and a limit over 500', () => {
    const { engine } = feedWorld();
    expect(engine.query('news.feed', { limit: 501 }, OMNISCIENT).ok).toBe(false);
    // @ts-expect-error -- not an argument of news.feed
    expect(engine.query('news.feed', { everything: true }, OMNISCIENT).ok).toBe(false);
  });

  it('names every id in refs and params, and the ones that no longer exist', () => {
    const { engine, world, people } = feedWorld();
    const { names } = feed(engine);
    const [p0] = people;
    if (p0 === undefined) {
      throw new Error('expected a worker');
    }
    const ringName = world.tables.employments.lookup('byPerson', p0)[0]?.ringName;
    expect(names[p0]).toEqual({ kind: 'person', name: ringName });
    const title = world.tables.titles.values()[0];
    expect(title === undefined ? undefined : names[title.id]).toEqual({
      kind: 'title',
      name: 'My Title',
    });
    const show = world.tables.eventInstances.values()[0];
    expect(show === undefined ? undefined : names[show.id]).toEqual({
      kind: 'eventInstance',
      name: 'My Big Show',
    });
    const season = world.tables.seasons.values()[0];
    expect(season === undefined ? undefined : names[season.id]).toEqual({
      kind: 'season',
      name: 'Season 1',
    });
    const employment = world.tables.employments.values()[0];
    expect(employment === undefined ? undefined : names[employment.id]).toEqual({
      kind: 'employment',
      name: employment?.ringName,
    });
    const mine = world.tables.promotions.values().find((row) => row.name === 'My Wrestling');
    expect(mine === undefined ? undefined : names[mine.id]).toEqual({
      kind: 'promotion',
      name: 'My Wrestling',
    });
    expect(names[testId('person', 9001)]).toEqual({ kind: 'person', name: NO_LONGER_IN_RECORDS });
    expect(names[testId('promotion', 9002)]).toEqual({
      kind: 'promotion',
      name: NO_LONGER_IN_RECORDS,
    });
    expect(names[testId('title', 9003)]).toEqual({ kind: 'title', name: NO_LONGER_IN_RECORDS });
    expect(names[testId('eventInstance', 9004)]).toEqual({
      kind: 'eventInstance',
      name: NO_LONGER_IN_RECORDS,
    });
    expect(names[testId('season', 9005)]).toEqual({ kind: 'season', name: NO_LONGER_IN_RECORDS });
    expect(names[testId('employment', 9006)]).toEqual({
      kind: 'employment',
      name: NO_LONGER_IN_RECORDS,
    });
    expect(Object.values(names).some((entry) => entry.name === 'not an id')).toBe(false);
  });

  it('gives buzzTraceRef for a story posted through postNews while its trace is stored', async () => {
    const { world } = worldBuilder({ currentDate: TODAY }).withGeography('mini').build();
    let posted = false;
    const poster = defineSystem({
      id: 'postOnce',
      phases: [
        definePhase({
          id: 'postOnce.run',
          group: 'housekeeping',
          order: 50,
          cadence: { kind: 'daily' },
          run: (ctx) => {
            if (!posted) {
              posted = true;
              postNews(ctx, { kind: 'rumour', topic: TOPIC, importance: 0 });
            }
          },
        }),
      ],
    });
    const engine = createEngine({
      state: initialEngineState(world),
      systems: [simSystem, newsSystem, poster],
    });
    await engine.advanceDays({ maxDays: 1 });
    const [item] = feed(engine).items;
    expect(item?.buzzTraceRef).toEqual({ kind: 'news.buzz', id: item?.id });
  });
});

describe('news.item', () => {
  it('returns one story with its names', () => {
    const { engine, stories: story, people } = feedWorld();
    const result = engine.query('news.item', { newsId: story.s1 }, OMNISCIENT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      assertSerialisable(result.data, 'news.item');
      expect(result.data.item.id).toBe(story.s1);
      const [p0] = people;
      expect(p0 === undefined ? undefined : result.data.names[p0]?.kind).toBe('person');
    }
  });

  it('refuses a story that is gone or expired with notFound', () => {
    const { engine, stories: story } = feedWorld();
    for (const newsId of [testId('news', 9999), story.s4]) {
      expect(engine.query('news.item', { newsId }, OMNISCIENT)).toEqual({
        ok: false,
        reasons: [{ code: 'notFound', message: NEWS_ITEM_NOT_FOUND }],
      });
    }
  });
});

describe('news.top', () => {
  it('ranks the window by buzz minus the age penalty; hero keeps the front-page ones', () => {
    const { engine, stories: story } = feedWorld();
    // Ranks on 01-20 (4 points a day): s1 70, s6 50 − 8 = 42, s2 40 − 4 = 36, s7 20, s3 30 − 20 = 10.
    // s5 (buzz 90) is older than the 7-day window.
    const data = top(engine);
    expect(idsOf(data.ticker)).toEqual([story.s1, story.s6, story.s2, story.s7, story.s3]);
    expect(idsOf(data.hero)).toEqual([story.s1, story.s3]);
    expect(top(engine, { heroCount: 1, tickerCount: 2 })).toMatchObject({
      hero: [{ id: story.s1 }],
      ticker: [{ id: story.s1 }, { id: story.s6 }],
    });
    expect(Object.keys(data.names).length).toBeGreaterThan(0);
  });

  it('fills a thin window with the latest stories, and is empty only with no news', () => {
    const { world } = worldBuilder({ currentDate: TODAY })
      .withGeography('mini')
      .with('stories', (context) => {
        context.insert('news', aNews({ date: day('2026-01-01'), buzz: 5 }, context.sequence));
        context.insert('news', aNews({ date: day('2026-01-03'), buzz: 5 }, context.sequence));
        context.insert('news', aNews({ date: TODAY, buzz: 5 }, context.sequence));
      })
      .build();
    const engine = createEngine({
      state: initialEngineState(world),
      systems: [simSystem, newsSystem],
    });
    const [oldest, older, today] = world.tables.news.ids();
    expect(idsOf(top(engine).ticker)).toEqual([today, older, oldest]);
    expect(top(engine).hero).toEqual([]);

    const empty = worldBuilder({ currentDate: TODAY }).withGeography('mini').build().world;
    const none = createEngine({
      state: initialEngineState(empty),
      systems: [simSystem, newsSystem],
    });
    expect(top(none)).toEqual({ hero: [], ticker: [], names: {} });
  });
});
