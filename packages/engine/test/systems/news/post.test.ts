// postNews. Design: docs/design/news.md#posting and #expiry
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import type { NewsId, PromotionId, PersonId } from '../../../src/core/ids';
import { runStep } from '../../../src/core/pipeline/runStep';
import { createRuntime, type SimRuntime } from '../../../src/core/pipeline/runtime';
import { findTraceNodes } from '../../../src/core/trace';
import { isFullTrace } from '../../../src/core/trace/store';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { News } from '../../../src/model/entities/news';
import {
  NEWS_BUZZ_TRACE_KIND,
  postNews,
  registerNewsTopic,
  type PostNewsInput,
} from '../../../src/systems/news';
import { createEngineTunables } from '../../../src/systems/tunables';
import { testId, worldBuilder } from '../../support';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';

const TOPIC = 'test-signing';
let unregister: () => void = () => undefined;

beforeAll(() => {
  unregister = registerNewsTopic(TOPIC, { params: ['worker', 'promotion'] });
});

afterAll(() => {
  unregister();
});

/** Every mini region at the same value, so the worldwide figure is that value. */
function everywhere(value: number): Record<string, number> {
  return Object.fromEntries([1, 2, 3, 4].map((serial) => [testId('region', serial), value]));
}

interface PostWorld {
  readonly runtime: SimRuntime;
  readonly promotion: PromotionId;
  readonly star: PersonId;
}

function postWorld(overrides: TunableOverrides = {}): PostWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', regionalPop: everywhere(40) }, (promotion) =>
      promotion.withRoster(2, {
        person: (index) => (index === 0 ? { regionalPop: everywhere(70) } : {}),
        employment: (index) => (index === 0 ? { ringName: 'The Test Star' } : {}),
      }),
    )
    .build();
  const runtime = createRuntime({ world, tunables: createEngineTunables(overrides) });
  const star = ids.people[0];
  const promotion = ids.promotions.A;
  if (star === undefined || promotion === undefined) throw new Error('no roster');
  return { runtime, promotion, star };
}

function post(runtime: SimRuntime, input: PostNewsInput): { id: NewsId | null; ok: boolean } {
  let id: NewsId | null = null;
  const report = runStep(runtime, 'test.postNews', { kind: 'phase', id: 'test' }, (ctx) => {
    id = postNews(ctx, input);
  });
  return { id, ok: report.status === 'ok' };
}

function row(runtime: SimRuntime, id: NewsId | null): News {
  if (id === null) throw new Error('nothing posted');
  return runtime.world.tables.news.require(id);
}

const SIGNING: PostNewsInput = {
  kind: 'signing',
  topic: TOPIC,
  params: { worker: 'The Test Star', promotion: 'Test Promotion A' },
  importance: 1,
};

describe('postNews', () => {
  it('writes the story with its buzz, stores the buzz trace and publishes news.posted', () => {
    const { runtime, promotion, star } = postWorld();
    const { id, ok } = post(runtime, {
      ...SIGNING,
      refs: { personIds: [star], promotionIds: [promotion] },
    });
    expect(ok).toBe(true);
    const news = row(runtime, id);
    const today = runtime.world.meta.currentDate;
    expect(news).toMatchObject({
      date: today,
      kind: 'signing',
      headline: {
        key: 'news.test-signing.headline',
        params: { worker: 'The Test Star', promotion: 'Test Promotion A' },
      },
      body: { key: 'news.test-signing.body', params: SIGNING.params },
      refs: { personIds: [star], promotionIds: [promotion], eventInstanceId: null },
      importance: 1,
      expiresOn: addDays(today, 60),
      dedupeKey: null,
    });
    // Signing 20 + importance 12 + the star 40 × 70 / 100 + the promotion 0.25 × 40 × 40 / 70.
    expect(news.buzz).toBeCloseTo(20 + 12 + 28 + (0.25 * 1600) / 70, 9);

    const stored = runtime.traces.get({ kind: NEWS_BUZZ_TRACE_KIND, id: news.id });
    if (stored === undefined || !isFullTrace(stored)) throw new Error('no buzz trace');
    expect(stored.trace.value).toBe(news.buzz);
    expectTraceReplays({ value: news.buzz, trace: stored.trace });
    expectSerialisable(stored.trace);
    const labels: string[] = stored.trace.children?.map((node) => node.label) ?? [];
    expect(labels).toContain('Popularity of The Test Star');
    expect(labels).toContain('Popularity of Test Promotion A');

    expect(runtime.bus.recent({ types: ['news.posted'] }).map((event) => event.payload)).toEqual([
      { newsId: news.id, kind: 'signing', importance: 1, buzz: news.buzz },
    ]);
  });

  it('uses bodyParams for the body when given', () => {
    const { runtime } = postWorld();
    const { id } = post(runtime, { ...SIGNING, bodyParams: { worker: 'Someone Else' } });
    expect(row(runtime, id).body.params).toEqual({ worker: 'Someone Else' });
  });

  it('returns the first story for a repeated dedupe key and posts nothing again', () => {
    const { runtime } = postWorld();
    const first = post(runtime, { ...SIGNING, dedupeKey: 'signing:1' });
    const again = post(runtime, { ...SIGNING, importance: 2, dedupeKey: 'signing:1' });
    expect(again.id).toBe(first.id);
    expect(runtime.world.tables.news.values()).toHaveLength(1);
    expect(row(runtime, first.id).dedupeKey).toBe('signing:1');
    expect(runtime.bus.recent({ types: ['news.posted'] })).toHaveLength(1);
    const other = post(runtime, { ...SIGNING, dedupeKey: 'signing:2' });
    expect(other.id).not.toBe(first.id);
  });

  it('sets the expiry from each importance, its tunable and an explicit number of days', () => {
    const { runtime } = postWorld({ 'news.expiry.importance0Days': 0 });
    const today = runtime.world.meta.currentDate;
    const expiryOf = (input: Partial<PostNewsInput>): string | null =>
      row(runtime, post(runtime, { ...SIGNING, ...input }).id).expiresOn;
    expect(expiryOf({ importance: 0 })).toBe(today);
    expect(expiryOf({ importance: 1 })).toBe(addDays(today, 60));
    expect(expiryOf({ importance: 2 })).toBe(addDays(today, 180));
    expect(expiryOf({ importance: 3 })).toBeNull();
    expect(expiryOf({ importance: 3, expiresInDays: 5 })).toBeNull();
    expect(expiryOf({ importance: 1, expiresInDays: 7 })).toBe(addDays(today, 7));
    expect(expiryOf({ importance: 1, expiresInDays: 0 })).toBe(today);
    expect(expiryOf({ importance: 1, expiresInDays: null })).toBeNull();
  });

  it('refuses an unknown topic, an undeclared parameter and a bad expiry, and rolls back', () => {
    const { runtime } = postWorld();
    expect(post(runtime, { ...SIGNING, topic: 'no-such-topic' }).ok).toBe(false);
    expect(post(runtime, { ...SIGNING, params: { salary: 1000 } }).ok).toBe(false);
    expect(post(runtime, { ...SIGNING, bodyParams: { salary: 1000 } }).ok).toBe(false);
    expect(post(runtime, { ...SIGNING, expiresInDays: -1 }).ok).toBe(false);
    expect(post(runtime, { ...SIGNING, expiresInDays: 1.5 }).ok).toBe(false);
    expect(runtime.world.tables.news.values()).toEqual([]);
    expect(runtime.bus.recent({ types: ['news.posted'] })).toEqual([]);
    const failures = runtime.bus.recent({ types: ['pipeline.stepFailed'] });
    expect(failures.map((event) => event.payload.message)).toEqual([
      expect.stringContaining('a registered news topic'),
      expect.stringContaining('a parameter declared by news topic "test-signing"'),
      expect.stringContaining('a parameter declared by news topic "test-signing"'),
      expect.stringContaining('expiresInDays'),
      expect.stringContaining('expiresInDays'),
    ]);
  });

  it('skips a person who no longer exists, with a note', () => {
    const { runtime } = postWorld();
    const { id, ok } = post(runtime, {
      ...SIGNING,
      refs: { personIds: [testId('person', 99)] },
    });
    expect(ok).toBe(true);
    const news = row(runtime, id);
    expect(news.buzz).toBe(20 + 12);
    const stored = runtime.traces.get({ kind: NEWS_BUZZ_TRACE_KIND, id: news.id });
    if (stored === undefined || !isFullTrace(stored)) throw new Error('no buzz trace');
    expect(findTraceNodes(stored.trace, 'note').map((node) => node.label)).toEqual([
      'A person in this story no longer exists',
    ]);
  });
});
