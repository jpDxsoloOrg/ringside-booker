// Skip alerts: rules, per-player settings, the news.matchAlerts reaction and the news.alert gate
// (DAY1-03). Design: docs/design/news.md#alerts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createEngine,
  defineSystem,
  engineLoadOptions,
  engineSaveState,
  engineStateFromSave,
  initialEngineState,
  type Engine,
  type EngineState,
} from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { Controller, Viewer } from '../../../src/core/api/controller';
import { addDays } from '../../../src/core/date';
import type { NewsId, PersonId, PromotionId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import type { News } from '../../../src/model/entities/news';
import { TABLES, type GameWorld } from '../../../src/model/tables';
import { encodeSave } from '../../../src/persistence/codec';
import { loadSave } from '../../../src/persistence/load';
import { createSaveDocument } from '../../../src/persistence/world-document';
import {
  alertPendingKey,
  alertRuleKey,
  alertStopSkipKey,
  BUILT_IN_NEWS_ALERT_RULES,
  displayNameOf,
  NEWS_ACTION_HINT,
  NEWS_ALERT_GATE_ID,
  NEWS_ALERT_STOP_SKIP_DEFAULT,
  newsAlertReason,
  newsAlertRules,
  newsSystem,
  postNews,
  registerNewsAlertRule,
  registerNewsTopic,
  type NewsAlertRuleContext,
  type PostNewsInput,
} from '../../../src/systems/news';
import { createEngineTunables } from '../../../src/systems/tunables';
import { TEST_PLAYER_ID } from '../../support/builders/build-row';
import { aNews } from '../../support/builders/inbox';
import { TEST_ENGINE_VERSION, TEST_SAVED_AT } from '../../support/saves';
import { worldBuilder } from '../../support/world-builder';

const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
const ME: Viewer = { kind: 'controller', controller: HUMAN };
const OMNISCIENT: Viewer = { kind: 'omniscient' };
const COMPUTER: Controller = { kind: 'computer' };
const TOPIC = 'test-alerts';

let unregister: () => void = () => undefined;
beforeAll(() => {
  unregister = registerNewsTopic(TOPIC, { params: [] });
});
afterAll(() => {
  unregister();
});

interface AlertWorld {
  readonly world: GameWorld;
  readonly mine: PromotionId;
  readonly rival: PromotionId;
  /** My champion, my other worker, the rival's champion, the rival's other worker. */
  readonly people: readonly [PersonId, PersonId, PersonId, PersonId];
}

/** Two promotions, each with two workers and a title held by the first. */
function alertWorld(): AlertWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({ name: 'My Wrestling', controller: HUMAN }, (promotion) =>
      promotion.withRoster(2).withTitle({ name: 'My Title' }, { holder: 0 }),
    )
    .withPromotion({ name: 'Rival Wrestling' }, (promotion) =>
      promotion.withRoster(2).withTitle({ name: 'Rival Title' }, { holder: 0 }),
    )
    .build();
  const [p0, p1, p2, p3] = ids.people;
  const { A, B } = ids.promotions;
  if (
    p0 === undefined ||
    p1 === undefined ||
    p2 === undefined ||
    p3 === undefined ||
    A === undefined ||
    B === undefined
  ) {
    throw new Error('the alert world is missing rows');
  }
  return { world, mine: A, rival: B, people: [p0, p1, p2, p3] };
}

/** An engine whose test phase posts whatever is queued, once, on the next day it runs. */
function alertEngine(state: EngineState): {
  engine: Engine;
  queue: PostNewsInput[];
  posted: NewsId[];
} {
  const queue: PostNewsInput[] = [];
  const posted: NewsId[] = [];
  const poster = defineSystem({
    id: 'postQueued',
    phases: [
      definePhase({
        id: 'postQueued.run',
        group: 'housekeeping',
        order: 50,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          for (const input of queue.splice(0)) {
            posted.push(postNews(ctx, input));
          }
        },
      }),
    ],
  });
  const engine = createEngine({ state, systems: [simSystem, newsSystem, poster] });
  return { engine, queue, posted };
}

function story(personIds: PersonId[], kind: News['kind'] = 'signing'): PostNewsInput {
  return { kind, topic: TOPIC, importance: 0, refs: { personIds } };
}

function extraOf(engine: Engine): Record<string, boolean | number | string> {
  return engine.exportState().world.meta.settings.extra;
}

function rulesView(engine: Engine, viewer: Viewer = ME) {
  const result = engine.query('news.alertRules', {}, viewer);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.data;
}

function setRules(engine: Engine, rules: Record<string, boolean>, stopSkip?: boolean) {
  const result = engine.command(
    'news.setAlertRules',
    stopSkip === undefined ? { rules } : { rules, stopSkip },
    HUMAN,
  );
  expect(result.ok).toBe(true);
}

function newsIds(engine: Engine): NewsId[] {
  return engine.exportState().world.tables.news.map((row) => row.id);
}

function nameOn(world: GameWorld, personId: PersonId): string {
  return displayNameOf(world, personId, world.meta.currentDate);
}

describe('news alert rules', () => {
  function ruleContext(built: AlertWorld): NewsAlertRuleContext {
    return {
      read: built.world,
      promotionIds: [built.mine],
      date: built.world.meta.currentDate,
      tunables: createEngineTunables(),
    };
  }

  function matching(built: AlertWorld, fields: Parameters<typeof aNews>[0]): string[] {
    const news = aNews(fields);
    const ctx = ruleContext(built);
    return BUILT_IN_NEWS_ALERT_RULES.filter((rule) => rule.matches(news, ctx)).map(
      (rule) => rule.id,
    );
  }

  const refs = (fields: Partial<News['refs']>): News['refs'] => ({
    personIds: [],
    promotionIds: [],
    eventInstanceId: null,
    employmentId: null,
    ...fields,
  });

  it('lists the built-ins in order, front page on by default', () => {
    expect(newsAlertRules().map((rule) => [rule.id, rule.defaultOn])).toEqual([
      ['frontPage', true],
      ['myPromotion', false],
      ['myRoster', false],
      ['myChampions', false],
      ['titleChanges', false],
    ]);
  });

  it('frontPage: importance 3 or buzz from news.frontPage.minBuzz', () => {
    const built = alertWorld();
    expect(matching(built, { importance: 3, buzz: 0 })).toEqual(['frontPage']);
    expect(matching(built, { importance: 1, buzz: 65 })).toEqual(['frontPage']);
    expect(matching(built, { importance: 2, buzz: 64 })).toEqual([]);
  });

  it("myPromotion: the player's promotion, not the rival's", () => {
    const built = alertWorld();
    expect(matching(built, { refs: refs({ promotionIds: [built.mine] }) })).toEqual([
      'myPromotion',
    ]);
    expect(matching(built, { refs: refs({ promotionIds: [built.rival] }) })).toEqual([]);
  });

  it("myRoster and myChampions: the player's champion versus the rival's", () => {
    const built = alertWorld();
    const [myChamp, myWorker, rivalChamp, rivalWorker] = built.people;
    expect(matching(built, { refs: refs({ personIds: [myChamp] }) })).toEqual([
      'myRoster',
      'myChampions',
    ]);
    expect(matching(built, { refs: refs({ personIds: [myWorker] }) })).toEqual(['myRoster']);
    expect(matching(built, { refs: refs({ personIds: [rivalChamp] }) })).toEqual([]);
    expect(matching(built, { refs: refs({ personIds: [rivalWorker] }) })).toEqual([]);
  });

  it('titleChanges: any title change, in any promotion', () => {
    const built = alertWorld();
    const [, , rivalChamp] = built.people;
    expect(
      matching(built, { kind: 'titleChange', refs: refs({ personIds: [rivalChamp] }) }),
    ).toEqual(['titleChanges']);
    expect(matching(built, { kind: 'signing' })).toEqual([]);
  });

  it('takes new rules through registerNewsAlertRule and refuses a taken id', () => {
    const remove = registerNewsAlertRule({
      id: 'testShortlist',
      label: 'Shortlisted workers',
      description: 'Stories about workers on my shortlist.',
      order: 60,
      defaultOn: false,
      matches: () => true,
    });
    try {
      expect(newsAlertRules().at(-1)?.id).toBe('testShortlist');
      expect(() =>
        registerNewsAlertRule({
          id: 'frontPage',
          label: 'Again',
          description: 'A second rule with a taken id.',
          order: 1,
          defaultOn: false,
          matches: () => false,
        }),
      ).toThrow(/already registered/);
    } finally {
      remove();
    }
    expect(newsAlertRules().some((rule) => rule.id === 'testShortlist')).toBe(false);
  });
});

describe('news.alertRules and news.setAlertRules', () => {
  it('gives the defaults: front page on, stops a skip, nothing pending', () => {
    const { engine } = alertEngine(initialEngineState(alertWorld().world));
    const view = rulesView(engine);
    expect(view.rules.map((rule) => [rule.id, rule.enabled])).toEqual([
      ['frontPage', true],
      ['myPromotion', false],
      ['myRoster', false],
      ['myChampions', false],
      ['titleChanges', false],
    ]);
    expect(view.rules[0]).toMatchObject({ label: 'Front-page stories', defaultOn: true });
    expect(view).toMatchObject({ stopSkip: true, pending: null });
    expect(rulesView(engine, OMNISCIENT)).toEqual(view);
    expect(rulesView(engine, { kind: 'controller', controller: COMPUTER })).toEqual(view);
  });

  it('refuses a computer and an unlisted human, and names an unknown rule', () => {
    const { engine } = alertEngine(initialEngineState(alertWorld().world));
    const notPlayer = {
      ok: false,
      reasons: [{ code: 'notAPlayer', message: 'Only a player can set news alerts' }],
    };
    expect(engine.command('news.setAlertRules', { rules: {} }, COMPUTER)).toEqual(notPlayer);
    expect(
      engine.command('news.setAlertRules', { rules: {} }, { kind: 'human', playerId: 'nobody' }),
    ).toEqual(notPlayer);
    const unknown = engine.command(
      'news.setAlertRules',
      { rules: { myRoster: true, nope: true } },
      HUMAN,
    );
    expect(unknown).toEqual({
      ok: false,
      reasons: [
        {
          code: 'invalidArgs',
          message: 'There is no news alert called "nope"',
          field: 'rules.nope',
        },
      ],
    });
    expect(extraOf(engine)).toEqual({});
  });

  it('writes only the keys given, and they survive a save and a load', async () => {
    const { engine } = alertEngine(initialEngineState(alertWorld().world));
    setRules(engine, { myRoster: true, frontPage: false }, true);
    expect(extraOf(engine)).toEqual({
      [alertRuleKey(TEST_PLAYER_ID, 'frontPage')]: false,
      [alertRuleKey(TEST_PLAYER_ID, 'myRoster')]: true,
      [alertStopSkipKey(TEST_PLAYER_ID)]: true,
    });
    expect(Object.keys(extraOf(engine))).toEqual(Object.keys(extraOf(engine)).sort());

    const doc = createSaveDocument(engineSaveState(engine.exportState()), {
      headerPromotionId: null,
      savedAt: TEST_SAVED_AT,
      label: 'Alerts set',
      engineVersion: TEST_ENGINE_VERSION,
    });
    const report = await loadSave(await encodeSave(doc), TABLES, engineLoadOptions());
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    const reloaded = alertEngine(engineStateFromSave(report.doc)).engine;
    const view = rulesView(reloaded);
    expect(view.rules.filter((rule) => rule.enabled).map((rule) => rule.id)).toEqual(['myRoster']);
    expect(view.stopSkip).toBe(true);
  });
});

describe('news.matchAlerts and the news.alert gate', () => {
  it('keeps one pending alert at a time, the first matching story', async () => {
    const built = alertWorld();
    const { engine, queue, posted } = alertEngine(initialEngineState(built.world));
    setRules(engine, { myRoster: true });
    const [, myWorker, , rivalWorker] = built.people;
    queue.push(story([rivalWorker]), story([myWorker]), story([myWorker]));
    await engine.advanceDays({ maxDays: 1 });
    const [, first] = posted;
    expect(extraOf(engine)[alertPendingKey(TEST_PLAYER_ID)]).toBe(first);
    expect(rulesView(engine).pending).toBe(first);
    const raised = engine.query(
      'sim.recentEvents',
      { limit: 50, types: ['news.alertRaised'] },
      OMNISCIENT,
    );
    expect(raised.ok && raised.data.map((event) => event.payload)).toEqual([
      { playerId: TEST_PLAYER_ID, newsId: first, ruleId: 'myRoster' },
    ]);
  });

  it('keeps the pending alert but never stops a skip while stopSkip is off', async () => {
    const built = alertWorld();
    const { engine, queue } = alertEngine(initialEngineState(built.world));
    setRules(engine, { myRoster: true }, false);
    queue.push(story([built.people[1]]));
    const result = await engine.advanceDays({ maxDays: 3 });
    expect(result.stoppedBy).toEqual({ kind: 'completed' });
    expect(result.daysAdvanced).toBe(3);
    expect(rulesView(engine).pending).not.toBeNull();
  });

  it('stops a skip by default, for a player who never set stopSkip', async () => {
    expect(NEWS_ALERT_STOP_SKIP_DEFAULT).toBe(true);
    const built = alertWorld();
    const { engine, queue } = alertEngine(initialEngineState(built.world));
    setRules(engine, { myRoster: true });
    expect(extraOf(engine)[alertStopSkipKey(TEST_PLAYER_ID)]).toBeUndefined();
    queue.push(story([built.people[1]]));
    const result = await engine.advanceDays({ maxDays: 3 });
    expect(result.daysAdvanced).toBe(1);
    expect(result.stoppedBy).toMatchObject({
      kind: 'gate',
      hits: [{ gateId: NEWS_ALERT_GATE_ID }],
    });
  });

  it('always finishes a skip when every stop is cleared, even with a story every day', async () => {
    const built = alertWorld();
    const { engine, queue } = alertEngine(initialEngineState(built.world));
    setRules(engine, { myRoster: true, titleChanges: true });
    const skipDays = 30;
    const start = engine.exportState().world.meta.currentDate;
    // A matching story is queued before every day the skip could run, so every day stops it.
    const queueStory = () => {
      queue.push(story([built.people[1]]), story([built.people[0]], 'titleChange'));
    };
    let daysLeft = skipDays;
    let stops = 0;
    while (daysLeft > 0) {
      queueStory();
      const result = await engine.advanceDays({ maxDays: daysLeft });
      // Each run after a cleared stop moves at least one day, so the loop cannot spin.
      expect(result.daysAdvanced).toBeGreaterThanOrEqual(1);
      daysLeft -= result.daysAdvanced;
      if (result.stoppedBy.kind === 'gate') {
        expect(result.stoppedBy.hits.map((hit) => hit.gateId)).toEqual([NEWS_ALERT_GATE_ID]);
        stops += 1;
        expect(engine.command('news.ackAlerts', {}, HUMAN)).toMatchObject({
          ok: true,
          data: { cleared: true },
        });
        expect(engine.query('sim.pendingGates', {}, ME)).toMatchObject({
          ok: true,
          data: { hits: [] },
        });
      } else {
        expect(result.stoppedBy).toEqual({ kind: 'completed' });
      }
    }
    // The last day's story waits for the next skip: a skip ends on its last day without a check.
    expect(stops).toBe(skipDays - 1);
    expect(engine.exportState().world.meta.currentDate).toBe(addDays(start, skipDays));
  });

  it('never stops for a listed player who runs no promotion, who could not clear it', async () => {
    const built = alertWorld();
    const state = initialEngineState(built.world);
    // The player stays in meta.players, but the computer now runs what was their promotion.
    const withoutPromotion: EngineState = {
      ...state,
      world: {
        ...state.world,
        tables: {
          ...state.world.tables,
          promotions: state.world.tables.promotions.map((promotion) =>
            promotion.id === built.mine ? { ...promotion, controller: COMPUTER } : promotion,
          ),
        },
      },
    };
    expect(withoutPromotion.world.meta.players.map((player) => player.playerId)).toEqual([
      TEST_PLAYER_ID,
    ]);
    const { engine, queue } = alertEngine(withoutPromotion);
    queue.push({ ...story([built.people[1]]), importance: 3 });
    const result = await engine.advanceDays({ maxDays: 3 });
    expect(result).toMatchObject({ stoppedBy: { kind: 'completed' }, daysAdvanced: 3 });
    expect(rulesView(engine).pending).not.toBeNull();
  });

  it('stops before the next day with the reason and the News hint, until the alert is cleared', async () => {
    const built = alertWorld();
    const { engine, queue, posted } = alertEngine(initialEngineState(built.world));
    setRules(engine, { myRoster: true }, true);
    const [myChamp, myWorker] = built.people;
    queue.push(story([myWorker, myChamp]));
    const result = await engine.advanceDays({ maxDays: 5 });
    expect(result.daysAdvanced).toBe(1);
    const [newsId] = posted;
    const expected = {
      gateId: NEWS_ALERT_GATE_ID,
      reason: `News: Signing – ${nameOn(built.world, myWorker)} and ${nameOn(built.world, myChamp)}`,
      subject: { kind: 'news', id: newsId },
      actionHint: NEWS_ACTION_HINT,
    };
    expect(result.stoppedBy).toEqual({ kind: 'gate', hits: [expected] });
    expect((await engine.advanceDays({ maxDays: 5 })).daysAdvanced).toBe(0);

    expect(engine.command('news.ackAlerts', {}, HUMAN)).toMatchObject({
      ok: true,
      data: { cleared: true },
    });
    expect(engine.command('news.ackAlerts', {}, HUMAN)).toMatchObject({
      ok: true,
      data: { cleared: false },
    });
    expect(extraOf(engine)[alertPendingKey(TEST_PLAYER_ID)]).toBeUndefined();
    const after = await engine.advanceDays({ maxDays: 5 });
    expect(after).toMatchObject({ stoppedBy: { kind: 'completed' }, daysAdvanced: 5 });
  });

  it('does not stop for a pending story that was deleted, and a new story takes its place', async () => {
    const built = alertWorld();
    const { engine, queue, posted } = alertEngine(initialEngineState(built.world));
    setRules(engine, { myRoster: true }, false);
    // Expires the day after it is posted: news.expire deletes it then.
    queue.push({ ...story([built.people[1]]), expiresInDays: 0 });
    await engine.advanceDays({ maxDays: 2 });
    const pending = rulesView(engine).pending;
    expect(pending).toBe(posted[0]);
    expect(newsIds(engine)).not.toContain(pending);
    setRules(engine, {}, true);
    expect(engine.query('sim.pendingGates', {}, OMNISCIENT)).toMatchObject({
      ok: true,
      data: { hits: [] },
    });
    queue.push(story([built.people[1]]));
    const result = await engine.advanceDays({ maxDays: 3 });
    expect(result.daysAdvanced).toBe(1);
    expect(rulesView(engine).pending).not.toBe(pending);
  });

  it('never alerts a rule the player switched off', async () => {
    const built = alertWorld();
    const { engine, queue } = alertEngine(initialEngineState(built.world));
    setRules(engine, { frontPage: false }, true);
    queue.push({ ...story([built.people[1]]), importance: 3 });
    const result = await engine.advanceDays({ maxDays: 2 });
    expect(result.stoppedBy).toEqual({ kind: 'completed' });
    expect(rulesView(engine).pending).toBeNull();
  });
});

describe('newsAlertReason', () => {
  it('names up to two subjects, then counts the rest; people first, then promotions', () => {
    const built = alertWorld();
    const [p0, p1, p2] = built.people;
    const name = (id: PersonId) => nameOn(built.world, id);
    const reason = (fields: Partial<News['refs']>, kind: News['kind'] = 'injury') =>
      newsAlertReason(
        built.world,
        aNews({
          kind,
          refs: {
            personIds: [],
            promotionIds: [],
            eventInstanceId: null,
            employmentId: null,
            ...fields,
          },
        }),
      );
    expect(reason({ personIds: [p0] })).toBe(`News: Injury – ${name(p0)}`);
    expect(reason({ personIds: [p0], promotionIds: [built.mine] })).toBe(
      `News: Injury – ${name(p0)} and My Wrestling`,
    );
    expect(reason({ personIds: [p0, p1, p2], promotionIds: [built.rival] })).toBe(
      `News: Injury – ${name(p0)}, ${name(p1)} and 2 more`,
    );
    expect(reason({}, 'season')).toBe('News: a front-page season story');
  });
});
