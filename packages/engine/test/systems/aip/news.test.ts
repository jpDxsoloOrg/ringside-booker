// Rival decisions on the news wire (DAY1-06): only on the reveal day, only for kinds that opt in,
// only importance 1 and up. Design: docs/design/news.md#integration
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../src/core/content-key';
import { addDays, parseGameDate, type GameDate } from '../../../src/core/date';
import type { PromotionId } from '../../../src/core/ids';
import type { GameWorld } from '../../../src/model/tables';
import {
  AIP_NEWS_FROM_DECISIONS_PHASE_ID,
  AIP_NEWS_FROM_DECISIONS_PHASE_ORDER,
  aipSystem,
  decisionNewsDedupeKey,
  decisionNewsKinds,
  registerDecisionKind,
  registerDecisionNews,
  writeAiDecision,
} from '../../../src/systems/aip';
// ECO4's refused releases register their news writer when contracts loads.
import '../../../src/systems/contracts';
import { registerNewsTopic } from '../../../src/systems/news';
import { worldBuilder } from '../../support';
import { allStories, newsWire, storiesWithTopic } from '../../support/news-wire';

const KIND = 'testPlan';
const QUIET_KIND = 'testQuietPlan';
const TOPIC = 'test-rival-plan';
const START: GameDate = parseGameDate('2026-01-06');
const cleanups: (() => void)[] = [];

beforeAll(() => {
  cleanups.push(
    registerDecisionKind({ kind: KIND, chip: 'Test plans' }),
    registerDecisionKind({ kind: QUIET_KIND, chip: 'Test quiet plans' }),
    registerNewsTopic(TOPIC, { params: ['promotionId'] }),
    registerDecisionNews({
      decisionKind: KIND,
      story: (decision) => ({
        kind: 'business',
        topic: TOPIC,
        params: { promotionId: decision.promotionId },
        refs: { promotionIds: [decision.promotionId] },
      }),
    }),
  );
});

afterAll(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function rivalWorld(): { world: GameWorld; rival: PromotionId } {
  const { world, ids } = worldBuilder({ startDate: START, currentDate: START })
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A' })
    .build();
  const rival = ids.promotions.A;
  if (rival === undefined) throw new Error('no promotion');
  return { world, rival };
}

describe('rival decisions on the news wire', () => {
  it('runs after the shows and before the decision log prune', () => {
    const phase = aipSystem.phases.find((each) => each.id === AIP_NEWS_FROM_DECISIONS_PHASE_ID);
    expect(phase).toMatchObject({ group: 'periodic', order: AIP_NEWS_FROM_DECISIONS_PHASE_ORDER });
    const prune = aipSystem.phases.find((each) => each.id === 'aip.pruneDecisionLog');
    expect(AIP_NEWS_FROM_DECISIONS_PHASE_ORDER).toBeLessThan(prune?.order ?? 0);
  });

  it('posts an importance-2 plan on its reveal day, three days on, and never before', async () => {
    const built = rivalWorld();
    const wire = newsWire(built.world, [aipSystem]);
    const revealOn = addDays(START, 3);
    let decisionId = '';
    wire.steps.push((ctx) => {
      const unit = { promotionId: built.rival, brandId: null, key: built.rival };
      const summary = { key: parseContentKey('aip.decision.test'), params: {} };
      decisionId = writeAiDecision(ctx.tx, ctx, unit, {
        kind: KIND,
        summary,
        revealOn,
        importance: 2,
      });
      // Routine (importance 0) and a kind with no news writer: never news.
      writeAiDecision(ctx.tx, ctx, unit, { kind: KIND, summary, revealOn, importance: 0 });
      writeAiDecision(ctx.tx, ctx, unit, { kind: QUIET_KIND, summary, revealOn, importance: 3 });
    });

    for (let day = 0; day < 3; day += 1) {
      await wire.engine.advanceDays({ maxDays: 1 });
      expect(storiesWithTopic(wire.engine, TOPIC)).toEqual([]);
    }
    await wire.engine.advanceDays({ maxDays: 1 });
    const stories = storiesWithTopic(wire.engine, TOPIC);
    expect(stories).toHaveLength(1);
    expect(stories[0]).toMatchObject({
      date: revealOn,
      kind: 'business',
      importance: 2,
      dedupeKey: decisionNewsDedupeKey(decisionId),
      refs: { promotionIds: [built.rival] },
    });
    expect(allStories(wire.engine)).toHaveLength(1);
  });

  it('lists the kinds that become news, with ECO4 refused releases among them', () => {
    expect(decisionNewsKinds()).toEqual(expect.arrayContaining([KIND, 'release']));
    expect(decisionNewsKinds()).not.toContain(QUIET_KIND);
  });
});
