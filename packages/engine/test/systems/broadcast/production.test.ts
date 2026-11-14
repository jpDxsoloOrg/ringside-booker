// ECO7 and ECO8 together (ECO8-07): the audience reads the live marketing level, the camera
// refusal clears once the camera is raised in Production, and ECO7's camera floor holds exactly
// while a deal is in force. Design: docs/design/broadcast.md#seams
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { addDays } from '../../../src/core/date';
import type { NetworkId } from '../../../src/core/ids';
import type { DealValuation } from '../../../src/systems/broadcast';
import { broadcastSystem, hasActiveBroadcastDeal } from '../../../src/systems/broadcast';
import { financeSystem } from '../../../src/systems/finance';
import { activeBroadcastDeal, productionSystem } from '../../../src/systems/production';
import { createEngineTunables } from '../../../src/systems/tunables';
import { aNetwork } from '../../support/builders/media';
import { dealWorld, TODAY, YOU, YOU_ISSUING, type DealWorld } from './deal-world';

const TUNABLES = createEngineTunables();

/** The deal world plus a tier-2 channel over the whole map, with your camera and marketing at 0. */
function worldWithBigChannel(): DealWorld & { readonly bigChannel: NetworkId } {
  const built = dealWorld();
  let bigChannel: NetworkId | null = null;
  const regionIds = [...built.world.tables.regions.ids()];
  const result = built.world.transact('big channel', (tx) => {
    bigChannel = tx.insert(
      'networks',
      aNetwork({
        id: tx.mintId('networks'),
        name: 'Test Big Channel',
        reachTier: 2,
        coverage: { continentIds: [], countryIds: [], regionIds },
      }),
    ).id;
    const promotion = tx.view.tables.promotions.require(built.you);
    tx.update('promotions', built.you, {
      production: { ...promotion.production, camera: 0, marketing: 0 },
    });
  });
  if (!result.ok) throw result.error;
  if (bigChannel === null) throw new Error('No big channel');
  return { ...built, bigChannel };
}

function engineFor(built: DealWorld): Engine {
  return createEngine({
    state: initialEngineState(built.world),
    systems: [simSystem, financeSystem, broadcastSystem, productionSystem],
  });
}

function valuation(engine: Engine, built: DealWorld, networkId: NetworkId): DealValuation {
  const result = engine.query(
    'broadcast.valuation',
    {
      promotionId: built.you,
      networkId,
      eventDefinitionId: built.yourThursday,
      timeslot: 'evening',
      live: false,
      months: 12,
    },
    YOU,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result.data;
}

function setLevel(engine: Engine, built: DealWorld, area: 'marketing' | 'camera', level: number) {
  const result = engine.command(
    'production.setLevel',
    { promotionId: built.you, area, level },
    YOU_ISSUING,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
}

describe('marketing (ECO7) in the audience', () => {
  it('moves the next valuation by the documented factor when the level changes', () => {
    const built = worldWithBigChannel();
    const engine = engineFor(built);
    const before = valuation(engine, built, built.network).projectedViewers.value;
    setLevel(engine, built, 'marketing', 10);
    const after = valuation(engine, built, built.network).projectedViewers.value;
    const factor = 1 + 10 * TUNABLES.get('broadcast.audience.marketingPerLevel');
    // Both are rounded down to whole viewers.
    expect(after).toBeGreaterThan(before);
    expect(Math.abs(after - before * factor)).toBeLessThanOrEqual(factor + 1);
  });
});

describe('the camera refusal and Production (ECO7)', () => {
  it('names Production in the refusal and clears once the camera is raised', () => {
    const built = worldWithBigChannel();
    const engine = engineFor(built);
    const refused = valuation(engine, built, built.bigChannel).refusals.find(
      (refusal) => refusal.code === 'cameraTooLow',
    );
    expect(refused?.message).toBe(
      'Test Big Channel needs camera level 2; yours is 0. Raise your camera level in Production',
    );
    setLevel(engine, built, 'camera', 2);
    expect(
      valuation(engine, built, built.bigChannel).refusals.map((refusal) => refusal.code),
    ).not.toContain('cameraTooLow');
  });
});

describe("ECO7's camera floor reads ECO8's deals in force", () => {
  it('holds while a deal airs shows and lets go the day it ends or its network closes', () => {
    const built = dealWorld();
    const read = built.world;
    const deal = read.tables.deals.require(built.yourDeal);
    expect(activeBroadcastDeal(read, built.you, TODAY)?.id).toBe(built.yourDeal);
    expect(hasActiveBroadcastDeal(read, built.you, TODAY)).toBe(true);
    expect(activeBroadcastDeal(read, built.you, deal.endsOn)).toBeNull();
    expect(hasActiveBroadcastDeal(read, built.you, deal.endsOn)).toBe(false);
    const closed = read.transact('network closes', (tx) => {
      tx.update('networks', built.network, { closedOn: addDays(TODAY, 1) });
    });
    if (!closed.ok) throw closed.error;
    expect(activeBroadcastDeal(read, built.you, addDays(TODAY, 1))).toBeNull();
    expect(hasActiveBroadcastDeal(read, built.you, addDays(TODAY, 1))).toBe(false);
  });
});
