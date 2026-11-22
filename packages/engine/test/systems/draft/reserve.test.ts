// DRF-11 draft money balance: rivals keep a reserve of running costs while drafting (the player
// does not), the same reserve when they settle picks under negotiate-after, no contract offers to
// the draft pool while the draft runs, and the draft's weekly show held where its crowd fits.
// Design: docs/design/draft.md#rival-reserve
import { describe, expect, it } from 'vitest';
import type { Engine, EngineState } from '../../../src/core/api';
import { promotionStatusKey } from '../../../src/model/entities/employment';
import { draftReserve, runningCostsOf } from '../../../src/systems/draft/reserve';
import { createEngineTunables } from '../../../src/systems/tunables';
import { anOffer } from '../../support';
import { engineOf, PLAYER, PLAYER_VIEW, run, startDraftGame, worldOf } from './draft-game';

function cashOf(state: EngineState, promotionId: string): number {
  return state.world.tables.promotions.find((row) => row.id === promotionId)!.cash;
}

function isRival(state: EngineState, promotionId: string): boolean {
  return (
    state.world.tables.promotions.find((row) => row.id === promotionId)!.controller.kind ===
    'computer'
  );
}

function setReserveMonths(engine: Engine, value: number): void {
  run(engine.command('tunables.setOverride', { key: 'draft.ai.reserveMonths', value }, PLAYER));
}

/**
 * Five years of running costs, with venue rent made dear: more than any rival has from $250k, now
 * that brand-new companies (DRF-13) pay no medical or staff.
 */
function holdEveryRivalBack(engine: Engine): void {
  setReserveMonths(engine, 60);
  run(
    engine.command(
      'tunables.setOverride',
      { key: 'boxOffice.rent.base', value: 5_000_000 },
      PLAYER,
    ),
  );
}

describe('running costs', () => {
  it('prices a month of a promotion: nothing for production at level 0, its shows and medical', () => {
    const state = startDraftGame();
    const world = worldOf(state);
    const tunables = createEngineTunables();
    const draft = state.world.tables.drafts[0]!;
    for (const promotionId of draft.order) {
      const costs = runningCostsOf(world, tunables, promotionId, world.meta.currentDate, 20);
      expect(costs.overhead).toBe(0);
      expect(costs.showProduction).toBe(0);
      expect(costs.showsPerMonth).toBeGreaterThan(3);
      expect(costs.venueRent).toBeGreaterThan(0);
      expect(costs.total).toBe(
        costs.overhead +
          costs.medical +
          costs.venueRent +
          costs.travel +
          costs.catering +
          costs.showProduction,
      );
      expect(draftReserve(world, tunables, promotionId, world.meta.currentDate, 20)).toBe(
        Math.round(3 * costs.total),
      );
    }
  });
});

describe('the rival reserve', () => {
  it('rivals keep 3 months of running costs; the default draft fills from $1M', () => {
    const start = startDraftGame();
    const world = worldOf(start);
    const tunables = createEngineTunables();
    const draft = start.world.tables.drafts[0]!;
    const engine = engineOf(start);
    run(engine.command('draft.autoPickRest', {}, PLAYER));
    const after = engine.exportState();
    for (const promotionId of draft.order.filter((id) => isRival(start, id))) {
      const kept = world.tables.employments.lookup(
        'byPromotionStatus',
        promotionStatusKey(promotionId, 'active'),
      ).length;
      const reserve = draftReserve(
        world,
        tunables,
        promotionId,
        world.meta.currentDate,
        kept + draft.settings.rosterTarget + draft.settings.staffTarget,
      );
      expect(cashOf(after, promotionId), promotionId).toBeGreaterThanOrEqual(reserve);
    }
  });

  it('holds rivals back but not the player, who may spend down to zero', () => {
    // Five years of running costs is more than any rival has from $250k: none of them picks.
    const engine = engineOf(startDraftGame({ settings: { draftStartingCash: '250k' } }));
    holdEveryRivalBack(engine);
    run(engine.command('draft.autoPickRest', {}, PLAYER));
    const state = engine.exportState();
    const draft = state.world.tables.drafts[0]!;
    const rivals = draft.order.filter((id) => isRival(state, id));
    const mine = draft.order.find((id) => !isRival(state, id))!;
    for (const promotionId of rivals) {
      expect(state.world.tables.draftPicks.some((pick) => pick.promotionId === promotionId)).toBe(
        false,
      );
      expect(draft.outOfMoney).toContain(promotionId);
    }
    const picks = state.world.tables.draftPicks.filter((pick) => pick.promotionId === mine);
    expect(picks.length).toBeGreaterThan(0);
    expect(cashOf(state, mine)).toBeGreaterThanOrEqual(0);
    expect(cashOf(state, mine)).toBe(
      25_000_000 - picks.reduce((sum, pick) => sum + (pick.cost ?? 0), 0),
    );
  });

  it('applies to rivals settling their picks under negotiate-after', () => {
    const engine = engineOf(
      startDraftGame({ settings: { draftNegotiateAfter: true, draftStartingCash: '250k' } }),
    );
    run(engine.command('draft.autoPickRest', {}, PLAYER));
    holdEveryRivalBack(engine);
    const finish = run(engine.command('draft.finish', {}, PLAYER));
    expect(finish.signed).toBe(0);
    expect(finish.released).toBeGreaterThan(0);
    // Released picks are back in the pool, and short rivals fill up per appearance.
    expect(finish.filled).toBeGreaterThan(0);
  });

  it('tells the player their running costs a month in the pool view', () => {
    const engine = engineOf(startDraftGame());
    run(engine.command('draft.simToMyPick', {}, PLAYER));
    const pool = run(engine.query('draft.pool', { limit: 1 }, PLAYER_VIEW));
    expect(pool.runningCostMonthly).toBeGreaterThan(0);
    expect(pool.reserveMonths).toBe(3);
  });
});

describe('no contract offers to the draft pool while it runs', () => {
  it('refuses an offer to a pool member with draft.inPool, and allows it once the draft is finished', () => {
    const engine = engineOf(startDraftGame({ settings: { draftNegotiateAfter: true } }));
    const mine = engine
      .exportState()
      .world.tables.promotions.find((row) => row.controller.kind === 'human')!.id;
    const pool = run(engine.query('draft.pool', { limit: 200 }, PLAYER_VIEW));
    const last = pool.rows[pool.rows.length - 1]!;
    const offer = { promotionId: mine, personId: last.personId, offer: anOffer() };
    const refused = engine.command('contracts.makeOffer', offer, PLAYER);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reasons.map((reason) => reason.code)).toContain('draft.inPool');
    }
    run(engine.command('draft.finish', {}, PLAYER));
    const state = engine.exportState();
    const taken = new Set(state.world.tables.draftPicks.map((pick) => pick.personId));
    const free = state.world.tables.employments.some(
      (row) => row.personId === last.personId && row.status === 'active',
    );
    if (!taken.has(last.personId) && !free) {
      const later = engine.command('contracts.makeOffer', offer, PLAYER);
      if (!later.ok) {
        expect(later.reasons.map((reason) => reason.code)).not.toContain('draft.inPool');
      }
    }
  });
});

describe("the draft's weekly show", () => {
  it('has no preferred venue, so it is held where its crowd fits', () => {
    const state = startDraftGame();
    const draft = state.world.tables.drafts[0]!;
    const running = new Set(
      state.world.tables.eventInstances
        .filter((row) => row.status === 'scheduled')
        .map((row) => row.eventDefinitionId),
    );
    const weekly = state.world.tables.eventDefinitions.filter(
      (row) => draft.order.includes(row.promotionId) && running.has(row.id),
    );
    expect(weekly.length).toBeGreaterThan(0);
    for (const definition of weekly) {
      expect(definition.preferredVenueId, definition.name).toBeNull();
    }
  });
});
