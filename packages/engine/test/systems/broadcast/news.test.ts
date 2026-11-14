// A signed TV deal on the news wire (ECO8-07, the ECO8 part of DAY1-06): one `business` story per
// deal, for the player and rivals alike, importance 2 in prime time, and never any money.
// Design: docs/design/broadcast.md#seams, docs/design/news.md#integration
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { defineSystem } from '../../../src/core/api/system';
import { definePhase } from '../../../src/core/pipeline/phase';
import type { News } from '../../../src/model/entities/news';
import { broadcastSystem, DEAL_SIGNED_TOPIC } from '../../../src/systems/broadcast';
import { financeSystem } from '../../../src/systems/finance';
import { newsSystem } from '../../../src/systems/news';
import { dealWorld, TODAY, YOU_ISSUING, type DealWorld } from './deal-world';

function engineFor(built: DealWorld, extra: ReturnType<typeof defineSystem>[] = []): Engine {
  return createEngine({
    state: initialEngineState(built.world),
    systems: [simSystem, financeSystem, broadcastSystem, newsSystem, ...extra],
  });
}

function dealStories(engine: Engine): News[] {
  return engine
    .exportState()
    .world.tables.news.filter((row) => row.headline.key === `news.${DEAL_SIGNED_TOPIC}.headline`);
}

/** Every param value of a story, as text. */
function paramValues(story: News): string[] {
  return [...Object.values(story.headline.params), ...Object.values(story.body.params)].map(String);
}

describe('broadcast.dealSigned on the news wire', () => {
  it('posts one business story naming the promotion, network and show, with no money', () => {
    const built = dealWorld();
    const engine = engineFor(built);
    const signed = engine.command(
      'broadcast.proposeDeal',
      {
        promotionId: built.you,
        networkId: built.network,
        eventDefinitionId: built.yourThursday,
        timeslot: 'evening',
        live: false,
        months: 24,
      },
      YOU_ISSUING,
    );
    if (!signed.ok) throw new Error(JSON.stringify(signed.reasons));
    const stories = dealStories(engine);
    expect(stories).toHaveLength(1);
    const [story] = stories;
    expect(story).toMatchObject({
      kind: 'business',
      importance: 1,
      date: TODAY,
      dedupeKey: `deal-signed:${signed.data.dealId}`,
      refs: { promotionIds: [built.you] },
    });
    expect(story?.headline.params).toEqual({
      promotionId: built.you,
      network: 'Local TV',
      show: 'Your Thursday',
    });
    // No fee, rate or airtime anywhere in the story: only the three named params.
    expect(Object.keys(story?.body.params ?? {}).sort()).toEqual([
      'network',
      'promotionId',
      'show',
    ]);
    const deal = engine
      .exportState()
      .world.tables.deals.find((row) => row.id === signed.data.dealId);
    const money = Object.values(deal?.terms ?? {}).map(String);
    for (const value of paramValues(story ?? expect.fail('no story'))) {
      expect(money).not.toContain(value);
      expect(value).not.toContain('$');
    }
  });

  it("posts a rival's prime-time deal at importance 2, once", async () => {
    const built = dealWorld();
    const result = built.world.transact('prime time', (tx) => {
      tx.update('deals', built.rivalDeal, { timeslot: 'primeTime', eventDefinitionId: null });
    });
    if (!result.ok) throw result.error;
    // Stands in for ECO10's rival deal-making, which publishes the same event (twice here).
    const announce = defineSystem({
      id: 'testAnnounce',
      phases: [
        definePhase({
          id: 'testAnnounce.signed',
          group: 'periodic',
          order: 1,
          cadence: { kind: 'daily' },
          run: (ctx) => {
            ctx.publish('broadcast.dealSigned', {
              dealId: built.rivalDeal,
              promotionId: built.rival,
              networkId: built.network,
            });
          },
        }),
      ],
    });
    const engine = engineFor(built, [announce]);
    const advanced = await engine.advanceDays({ maxDays: 2 });
    expect(advanced.failures).toEqual([]);
    const stories = dealStories(engine);
    expect(stories).toHaveLength(1);
    expect(stories[0]).toMatchObject({ kind: 'business', importance: 2 });
    expect(stories[0]?.headline.params).toMatchObject({
      promotionId: built.rival,
      show: 'every televised show',
    });
  });
});
