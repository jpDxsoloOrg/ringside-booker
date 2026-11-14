// The daily news.expire phase (DAY1-02). Design: docs/design/news.md#expiry
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, parseGameDate, type GameDate } from '../../../src/core/date';
import type { NewsId } from '../../../src/core/ids';
import { runStep } from '../../../src/core/pipeline/runStep';
import { createRuntime, type SimRuntime } from '../../../src/core/pipeline/runtime';
import { expireNewsPhase, postNews, registerNewsTopic } from '../../../src/systems/news';
import { createEngineTunables } from '../../../src/systems/tunables';
import { aNews, worldBuilder } from '../../support';

const TODAY: GameDate = parseGameDate('2026-01-20');
const TOPIC = 'test-expire';
let unregister: () => void = () => undefined;

beforeAll(() => {
  unregister = registerNewsTopic(TOPIC, { params: [] });
});

afterAll(() => {
  unregister();
});

interface ExpireWorld {
  readonly runtime: SimRuntime;
  readonly ids: Record<'today' | 'overdue' | 'tomorrow' | 'kept', NewsId>;
}

function expireWorld(): ExpireWorld {
  const stored: Partial<Record<keyof ExpireWorld['ids'], NewsId>> = {};
  const { world } = worldBuilder({ currentDate: TODAY })
    .withGeography('mini')
    .with('stories', (context) => {
      const story = (expiresOn: GameDate | null): NewsId =>
        context.insert('news', aNews({ date: addDays(TODAY, -10), expiresOn }, context.sequence))
          .id;
      stored.tomorrow = story(addDays(TODAY, 1));
      stored.kept = story(null);
      stored.overdue = story(addDays(TODAY, -3));
      stored.today = story(TODAY);
    })
    .build();
  const { today, overdue, tomorrow, kept } = stored;
  if (today === undefined || overdue === undefined || tomorrow === undefined || kept === undefined)
    throw new Error('stories missing');
  return {
    runtime: createRuntime({ world, tunables: createEngineTunables() }),
    ids: { today, overdue, tomorrow, kept },
  };
}

function runExpire(runtime: SimRuntime, date: GameDate = TODAY) {
  const report = runStep(
    runtime,
    expireNewsPhase.id,
    { kind: 'phase', id: expireNewsPhase.id },
    expireNewsPhase.run,
    { date },
  );
  expect(report.status).toBe('ok');
  return report;
}

describe('news.expire', () => {
  it('sits in housekeeping at order 24 and runs daily', () => {
    expect(expireNewsPhase).toMatchObject({
      id: 'news.expire',
      group: 'housekeeping',
      order: 24,
      cadence: { kind: 'daily' },
    });
  });

  it('deletes stories due today and overdue ones, and keeps tomorrow and never-expiring ones', () => {
    const { runtime, ids } = expireWorld();
    const report = runExpire(runtime);
    const news = runtime.world.tables.news;
    expect(news.has(ids.today)).toBe(false);
    expect(news.has(ids.overdue)).toBe(false);
    expect(news.has(ids.tomorrow)).toBe(true);
    expect(news.has(ids.kept)).toBe(true);
    expect(report.logs).toContain('Expired 2 stories');
    expect(news.indexKeys('byExpiresOn')).toEqual([addDays(TODAY, 1)]);
  });

  it('takes tomorrow’s story the next day, and logs nothing when nothing is due', () => {
    const { runtime, ids } = expireWorld();
    runExpire(runtime);
    const quiet = runExpire(runtime);
    expect(quiet.logs.some((line) => line.startsWith('Expired'))).toBe(false);
    runExpire(runtime, addDays(TODAY, 1));
    expect(runtime.world.tables.news.has(ids.tomorrow)).toBe(false);
    expect(runtime.world.tables.news.ids()).toEqual([ids.kept]);
  });

  it('removes a 0-day story the day it is posted, and keeps a front-page story', () => {
    const { runtime } = expireWorld();
    const posted: NewsId[] = [];
    runStep(
      runtime,
      'test.post',
      { kind: 'phase', id: 'test' },
      (ctx) => {
        posted.push(
          postNews(ctx, { kind: 'rumour', topic: TOPIC, importance: 0, expiresInDays: 0 }),
          postNews(ctx, { kind: 'season', topic: TOPIC, importance: 3 }),
        );
      },
      { date: TODAY },
    );
    const [zeroDay, frontPage] = posted;
    if (zeroDay === undefined || frontPage === undefined) throw new Error('nothing posted');
    expect(runtime.world.tables.news.require(zeroDay).expiresOn).toBe(TODAY);
    runExpire(runtime);
    expect(runtime.world.tables.news.has(zeroDay)).toBe(false);
    runExpire(runtime, addDays(TODAY, 3650));
    expect(runtime.world.tables.news.has(frontPage)).toBe(true);
  });
});
