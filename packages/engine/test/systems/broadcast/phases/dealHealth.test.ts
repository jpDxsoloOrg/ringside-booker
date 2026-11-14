// Deal health in the day (ECO8-05): verdicts after airings, network cancellations, warnings,
// expiry and rival renewal. Design: docs/design/broadcast.md#deal-health
import { describe, expect, it } from 'vitest';
import { OMNISCIENT_VIEWER } from '../../../../src/core/api';
import { addDays, addMonths } from '../../../../src/core/date';
import { findTraceNodes, isFullTrace } from '../../../../src/core/trace';
import { dealHealthTraceRef } from '../../../../src/systems/broadcast';
import {
  addAirings,
  advanceOneDay,
  airedAt,
  dealOf,
  dealWorld,
  engineFor,
  endedEvents,
  renegotiatedEvents,
  warnedEvents,
  TODAY,
  YOU,
} from '../deal-world';

function tomorrow() {
  return addDays(TODAY, 1);
}

describe('missed airings', () => {
  it('cancels a deal with three missed airings in the window, with no roll', async () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, ['missed', ...airedAt(1, 2), 'missed', 'missed']);
    const engine = engineFor(built.world);
    await advanceOneDay(engine);
    const deal = dealOf(engine, built.yourDeal);
    expect(deal).toMatchObject({
      status: 'cancelled',
      endedOn: TODAY,
      endedReason: 'missedAirings',
    });
    expect(endedEvents(engine)).toEqual([
      {
        dealId: built.yourDeal,
        promotionId: built.you,
        networkId: built.network,
        reason: 'missedAirings',
      },
    ]);
    const stored = engine.exportState().traces;
    expect(JSON.stringify(stored)).toContain('3 missed airings: Local TV is pulling the deal');
  });

  it('warns at two missed airings that one more cancels', async () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, ['missed', ...airedAt(1, 3), 'missed']);
    const engine = engineFor(built.world);
    await advanceOneDay(engine);
    expect(dealOf(engine, built.yourDeal)).toMatchObject({ status: 'active', warnedOn: TODAY });
    expect(warnedEvents(engine)).toEqual([
      { dealId: built.yourDeal, promotionId: built.you, risk: 'atRisk' },
    ]);
    const listed = engine.query(
      'broadcast.deals',
      { promotionId: built.you, include: 'active' },
      YOU,
    );
    if (!listed.ok) throw new Error(JSON.stringify(listed.reasons));
    expect(listed.data[0]?.risk).toBe('atRisk');
    expect(listed.data[0]?.riskReasons[0]).toBe('One more missed airing and Local TV cancels');
    expect(listed.data[0]?.healthTraceRef).toEqual(dealHealthTraceRef(built.yourDeal));
  });

  it('never cancels for missed airings when missedToCancel is 0', async () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, ['missed', 'missed', 'missed', 'missed', ...airedAt(1, 2)]);
    const engine = engineFor(built.world, { 'broadcast.health.missedToCancel': 0 });
    await advanceOneDay(engine);
    expect(dealOf(engine, built.yourDeal).status).toBe('active');
    expect(endedEvents(engine)).toEqual([]);
  });
});

describe('low viewers', () => {
  it('cancels on a hit of the network patience roll', async () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, airedAt(0.3, 6));
    const engine = engineFor(built.world, { 'broadcast.health.cancelChance': 1 });
    await advanceOneDay(engine);
    expect(dealOf(engine, built.yourDeal)).toMatchObject({
      status: 'cancelled',
      endedReason: 'lowViewers',
    });
  });

  it('keeps the deal on a miss, and the stored Why? holds the roll', async () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, airedAt(0.3, 6));
    const engine = engineFor(built.world, { 'broadcast.health.cancelChance': 0 });
    await advanceOneDay(engine);
    expect(dealOf(engine, built.yourDeal).status).toBe('active');
    const stored = engine.query(
      'trace.get',
      { ref: dealHealthTraceRef(built.yourDeal) },
      OMNISCIENT_VIEWER,
    );
    if (!stored.ok || stored.data === null || !isFullTrace(stored.data)) {
      throw new Error('No health trace');
    }
    expect(findTraceNodes(stored.data.trace, 'roll')).toHaveLength(1);
    // It was warned: cancelling is the worst risk.
    expect(warnedEvents(engine)).toEqual([
      { dealId: built.yourDeal, promotionId: built.you, risk: 'cancelling' },
    ]);
  });

  it('a fixed seed pins the default chance: one seed cancels, another keeps', async () => {
    const outcomes = new Map<string, string>();
    // Tier 0: a 20% chance per airing. These seeds were picked to land on each side of it.
    for (const seed of ['patience-1', 'patience-0']) {
      const built = dealWorld({ seed });
      addAirings(built, built.yourDeal, airedAt(0.3, 6));
      const engine = engineFor(built.world);
      await advanceOneDay(engine);
      outcomes.set(seed, dealOf(engine, built.yourDeal).status);
    }
    expect(Object.fromEntries(outcomes)).toEqual({
      'patience-1': 'cancelled',
      'patience-0': 'active',
    });
  });

  it('gives a new deal its grace period', async () => {
    const built = dealWorld({ yourStartsOn: addDays(TODAY, -30) });
    addAirings(built, built.yourDeal, airedAt(0.1, 4));
    const engine = engineFor(built.world, { 'broadcast.health.cancelChance': 1 });
    await advanceOneDay(engine);
    expect(dealOf(engine, built.yourDeal).status).toBe('active');
  });

  it('does not judge viewers before minAirings', async () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, airedAt(0.1, 2));
    const engine = engineFor(built.world, { 'broadcast.health.cancelChance': 1 });
    await advanceOneDay(engine);
    expect(dealOf(engine, built.yourDeal).status).toBe('active');
  });

  it('never rolls on a day the deal did not air', async () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, airedAt(0.1, 6), addDays(TODAY, -1));
    const engine = engineFor(built.world, { 'broadcast.health.cancelChance': 1 });
    await advanceOneDay(engine);
    expect(dealOf(engine, built.yourDeal).status).toBe('active');
  });
});

describe('warnings', () => {
  it('warns once per warnEveryDays', async () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, airedAt(0.6, 6));
    addAirings(built, built.yourDeal, airedAt(0.6, 1), addDays(TODAY, 7));
    const engine = engineFor(built.world);
    await advanceOneDay(engine);
    expect(warnedEvents(engine)).toHaveLength(1);
    // A week later it airs again, still at risk: no second warning inside 30 days.
    for (let day = 0; day < 7; day += 1) {
      await advanceOneDay(engine);
    }
    expect(warnedEvents(engine)).toHaveLength(1);
    expect(dealOf(engine, built.yourDeal).warnedOn).toBe(TODAY);
  });

  it('warns that a deal ends soon', async () => {
    const built = dealWorld({ yourEndsOn: addDays(TODAY, 20) });
    const engine = engineFor(built.world);
    await advanceOneDay(engine);
    expect(warnedEvents(engine)).toEqual([
      { dealId: built.yourDeal, promotionId: built.you, risk: 'safe' },
    ]);
  });

  it('never warns a computer promotion', async () => {
    const built = dealWorld({ rivalEndsOn: addDays(TODAY, 20) });
    addAirings(built, built.rivalDeal, ['missed', 'missed', ...airedAt(1, 3)]);
    const engine = engineFor(built.world);
    await advanceOneDay(engine);
    expect(warnedEvents(engine)).toEqual([]);
  });
});

describe('expiry and renewal', () => {
  it("expires the player's deal on its end date", async () => {
    const built = dealWorld({ yourEndsOn: TODAY });
    const engine = engineFor(built.world);
    await advanceOneDay(engine);
    expect(dealOf(engine, built.yourDeal)).toMatchObject({
      status: 'expired',
      endedOn: TODAY,
      endedReason: 'expired',
    });
  });

  it("renews a rival's deal the network would still sign", async () => {
    const built = dealWorld({ rivalEndsOn: TODAY });
    const engine = engineFor(built.world);
    await advanceOneDay(engine);
    const deal = dealOf(engine, built.rivalDeal);
    expect(deal).toMatchObject({
      status: 'active',
      renegotiatedOn: TODAY,
      endsOn: addMonths(TODAY, 24),
      endedOn: null,
    });
    expect(renegotiatedEvents(engine)).toEqual([
      { dealId: built.rivalDeal, promotionId: built.rival },
    ]);
    // Renewed at today's valuation, not its shipped terms.
    expect(deal.terms).not.toEqual(built.world.tables.deals.require(built.rivalDeal).terms);
  });

  it("lets a rival's deal expire when the network would refuse it", async () => {
    const built = dealWorld({ rivalEndsOn: TODAY, rivalPopularity: 1 });
    const engine = engineFor(built.world);
    await advanceOneDay(engine);
    expect(dealOf(engine, built.rivalDeal)).toMatchObject({
      status: 'expired',
      endedReason: 'expired',
    });
  });

  it("lets a rival's deal expire when the network is pulling it", async () => {
    const built = dealWorld({ rivalEndsOn: TODAY });
    addAirings(built, built.rivalDeal, ['missed', 'missed', 'missed'], addDays(TODAY, -1));
    const engine = engineFor(built.world);
    await advanceOneDay(engine);
    expect(dealOf(engine, built.rivalDeal).status).toBe('expired');
  });

  it('lets every rival deal expire when autoRenew is off', async () => {
    const built = dealWorld({ rivalEndsOn: TODAY });
    const engine = engineFor(built.world, { 'broadcast.rivals.autoRenew': false });
    await advanceOneDay(engine);
    expect(dealOf(engine, built.rivalDeal).status).toBe('expired');
  });

  it('ends a deal on a closed network', async () => {
    const built = dealWorld();
    const result = built.world.transact('close', (tx) => {
      tx.update('networks', built.network, { status: 'closed', closedOn: TODAY });
    });
    if (!result.ok) throw result.error;
    const engine = engineFor(built.world);
    await advanceOneDay(engine);
    expect(dealOf(engine, built.yourDeal)).toMatchObject({
      status: 'cancelled',
      endedReason: 'networkClosed',
    });
    expect(tomorrow()).toBe(engine.exportState().world.meta.currentDate);
  });
});
