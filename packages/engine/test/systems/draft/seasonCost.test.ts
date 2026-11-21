// DRF-10 draft picks paid up front: the season cost formula, the payment and prepaid contract at
// the pick, never going below zero, the Starting cash setting and rivals filling short rosters.
// Design: docs/design/draft.md#season-cost
import { describe, expect, it } from 'vitest';
import type { EngineState } from '../../../src/core/api';
import { addDays, parseGameDate } from '../../../src/core/date';
import { payrollLinesOf, showWorkersOf } from '../../../src/systems/finance';
import { previewSetup } from '../../../src/systems/draft/setupPreview';
import { seasonCost } from '../../../src/systems/draft/seasonCost';
import { createEngineTunables } from '../../../src/systems/tunables';
import { anEmployment, TEST_PLAYER_ID, worldBuilder } from '../../support';
import {
  DEFAULT_PACKS,
  engineOf,
  FLAGSHIP,
  PLAYER,
  PLAYER_VIEW,
  run,
  startDraftGame,
  worldOf,
} from './draft-game';

const BASE = {
  monthlyWage: 0,
  perAppearanceFee: 0,
  appearanceCap: null,
  days: 0,
  appearancesPerWeek: 1,
  wageMultiplier: 1,
};

describe('season cost formula', () => {
  it('pro-rates a monthly wage over the days, as payroll accrues it', () => {
    // $3,000 a month for 182 days: 3000 × 12 × 182 ÷ 365.25.
    const cost = seasonCost({ ...BASE, monthlyWage: 300_000, days: 182 });
    expect(cost.wages).toBe(Math.round((300_000 * 12 * 182) / 365.25));
    expect(cost.fees).toBe(0);
    expect(cost.appearances).toBe(0);
    expect(cost.total).toBe(cost.wages);
    expect(seasonCost({ ...BASE, monthlyWage: 300_000, days: 182, wageMultiplier: 2 }).wages).toBe(
      cost.wages * 2,
    );
  });

  it('prices a fee by the expected appearances, within the appearance cap', () => {
    const weekly = seasonCost({ ...BASE, perAppearanceFee: 150_000, days: 182 });
    expect(weekly.appearances).toBe(26);
    expect(weekly.fees).toBe(26 * 150_000);
    expect(weekly.total).toBe(weekly.fees);
    expect(
      seasonCost({ ...BASE, perAppearanceFee: 150_000, days: 182, appearancesPerWeek: 2 })
        .appearances,
    ).toBe(52);
    expect(
      seasonCost({ ...BASE, perAppearanceFee: 150_000, days: 182, appearanceCap: 10 }).appearances,
    ).toBe(10);
  });

  it('costs nothing for no days', () => {
    expect(seasonCost({ ...BASE, monthlyWage: 300_000, perAppearanceFee: 1, days: 0 }).total).toBe(
      0,
    );
  });
});

function cashOf(state: EngineState, promotionId: string): number {
  return state.world.tables.promotions.find((row) => row.id === promotionId)!.cash;
}

function flagshipOf(state: EngineState): string {
  return state.world.tables.promotions.find((row) => row.controller.kind === 'human')!.id;
}

describe('a pick is paid up front', () => {
  const engine = engineOf(startDraftGame());
  run(engine.command('draft.simToMyPick', {}, PLAYER));
  const before = engine.exportState();
  const mine = flagshipOf(before);
  const pool = run(engine.query('draft.pool', { limit: 5 }, PLAYER_VIEW));
  const best = pool.rows[0]!;
  run(engine.command('draft.pick', { personId: best.personId }, PLAYER));
  const after = engine.exportState();

  it('shows each candidate a season cost the viewer can afford, and the viewer cash', () => {
    expect(pool.paysUpFront).toBe(true);
    expect(pool.cash).toBe(cashOf(before, mine));
    for (const row of pool.rows) {
      expect(row.cost).toBeGreaterThan(0);
      expect(row.costParts!.wages + row.costParts!.fees).toBe(row.cost);
      expect(row.affordable).toBe(true);
    }
  });

  it('takes the whole season off cash at once, as one Wages row', () => {
    expect(cashOf(after, mine)).toBe(cashOf(before, mine) - best.cost!);
    const rows = after.world.tables.ledgerEntries.filter(
      (row) => row.promotionId === mine && row.refs.personId === best.personId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe('wages');
    expect(rows[0]!.amount).toBe(-best.cost!);
    expect(rows[0]!.memo).toMatch(/^Season contract: /);
    const pick = after.world.tables.draftPicks.find((row) => row.personId === best.personId);
    expect(pick?.cost).toBe(best.cost);
  });

  it('every rival pick paid too, and nobody went below zero', () => {
    const level = after.world.tables.drafts[0]!.level.cash;
    for (const pick of after.world.tables.draftPicks) {
      expect(pick.cost, pick.personId).toBeGreaterThan(0);
    }
    for (const promotionId of after.world.tables.drafts[0]!.order) {
      const spent = after.world.tables.draftPicks
        .filter((pick) => pick.promotionId === promotionId)
        .reduce((sum, pick) => sum + (pick.cost ?? 0), 0);
      expect(cashOf(after, promotionId)).toBe(level - spent);
      expect(cashOf(after, promotionId)).toBeGreaterThanOrEqual(0);
    }
  });

  it('marks the contract prepaid until it ends, keeping the real terms', () => {
    const contract = after.world.tables.employments.find(
      (row) => row.personId === best.personId && row.status === 'active',
    )!;
    expect(contract.prepaidUntil).toBe(contract.endsOn);
    expect(contract.terms.perAppearanceFee + contract.terms.monthlyWage).toBeGreaterThan(0);
  });

  it('charges no appearance fee for a prepaid worker on a show', () => {
    const world = worldOf(after);
    const show = [...world.tables.eventInstances.values()].find(
      (row) => row.promotionId === mine && row.status !== 'cancelled',
    )!;
    const workers = showWorkersOf(world, show, createEngineTunables()).workers;
    const drafted = workers.find((worker) => worker.personId === best.personId);
    expect(drafted).toBeDefined();
    expect(drafted!.perAppearanceFee).toBe(0);
  });
});

describe('payroll skips a prepaid contract', () => {
  it('pays no wage before prepaidUntil and the full wage from then on', () => {
    const start = parseGameDate('2026-01-05');
    const until = addDays(start, 30);
    const { world, ids } = worldBuilder({ startDate: start })
      .withGeography('mini')
      .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } }, (promotion) =>
        promotion.withRoster(2, {
          employment: (index) => (index === 0 ? { prepaidUntil: until } : {}),
        }),
      )
      .build();
    const promotion = world.tables.promotions.require(ids.promotions.A!);
    const tunables = createEngineTunables();
    const early = payrollLinesOf(world, promotion, addDays(until, -1), tunables);
    expect(early.map((line) => line.reason).sort()).toEqual(['paid', 'prepaid']);
    expect(early.filter((line) => line.paid)).toHaveLength(1);
    const later = payrollLinesOf(world, promotion, until, tunables);
    expect(later.every((line) => line.reason === 'paid')).toBe(true);
    expect(anEmployment().prepaidUntil).toBeNull();
  });
});

/** A draft where money runs out fast: $250k each and seven appearances a week priced. */
function tightDraft() {
  const engine = engineOf(startDraftGame({ settings: { draftStartingCash: '250k' } }));
  run(
    engine.command(
      'tunables.setOverride',
      { key: 'draft.cost.appearancesPerWeek', value: 7 },
      PLAYER,
    ),
  );
  return engine;
}

describe('never below zero in the draft', () => {
  it('refuses a pick you cannot afford, saying what it costs and what you have', () => {
    const engine = tightDraft();
    run(engine.command('draft.simToMyPick', {}, PLAYER));
    const pool = run(engine.query('draft.pool', { sort: 'cost', limit: 3 }, PLAYER_VIEW));
    const dear = pool.rows[0]!;
    expect(dear.affordable).toBe(false);
    expect(dear.cost).toBeGreaterThan(pool.cash!);
    const refused = engine.command('draft.pick', { personId: dear.personId }, PLAYER);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reasons[0]?.code).toBe('draft.cantAfford');
      expect(refused.reasons[0]?.message).toMatch(
        /^Their season contract costs \$[\d,]+; you have \$[\d,]+\.$/,
      );
    }
  });

  it('ends the turns of anyone who cannot afford more, and the draft still completes', () => {
    const engine = tightDraft();
    run(engine.command('draft.autoPickRest', {}, PLAYER));
    const state = engine.exportState();
    const draft = state.world.tables.drafts[0]!;
    expect(draft.status).toBe('complete');
    expect(draft.outOfMoney.length).toBeGreaterThan(0);
    expect(draft.outOfMoney).toContain(flagshipOf(state));
    for (const promotionId of draft.order) {
      expect(cashOf(state, promotionId), promotionId).toBeGreaterThanOrEqual(0);
    }
    const view = run(engine.query('draft.state', {}, PLAYER_VIEW)).draft!;
    expect(view.you?.outOfMoney).toBe(true);
    expect(view.you?.wrestlersShort).toBeGreaterThan(0);
    expect(view.rosters.filter((roster) => roster.outOfMoney).length).toBe(draft.outOfMoney.length);
  });

  it('holds for staff picks too', () => {
    const engine = engineOf(
      startDraftGame({ settings: { draftStartingCash: '250k', draftStaff: true } }),
    );
    run(
      engine.command(
        'tunables.setOverride',
        { key: 'draft.cost.appearancesPerWeek', value: 7 },
        PLAYER,
      ),
    );
    run(engine.command('draft.autoPickRest', {}, PLAYER));
    const state = engine.exportState();
    const draft = state.world.tables.drafts[0]!;
    expect(draft.status).toBe('complete');
    const staff = state.world.tables.draftPicks.filter((pick) => pick.category === 'staff');
    expect(staff.length).toBeGreaterThan(0);
    expect(staff.every((pick) => (pick.cost ?? 0) > 0)).toBe(true);
    for (const promotionId of draft.order) {
      expect(cashOf(state, promotionId), promotionId).toBeGreaterThanOrEqual(0);
    }
  });

  it('rivals fill short rosters with per-appearance free agents when the draft finishes', () => {
    const engine = tightDraft();
    run(engine.command('draft.autoPickRest', {}, PLAYER));
    const before = engine.exportState();
    const finish = run(engine.command('draft.finish', {}, PLAYER));
    const after = engine.exportState();
    const draft = after.world.tables.drafts[0]!;
    expect(finish.filled).toBeGreaterThan(0);
    const picked = new Set(after.world.tables.draftPicks.map((pick) => pick.personId));
    for (const promotionId of draft.order) {
      const rival =
        after.world.tables.promotions.find((row) => row.id === promotionId)!.controller.kind ===
        'computer';
      const wrestlers = after.world.tables.employments.filter(
        (row) =>
          row.promotionId === promotionId && row.status === 'active' && row.role === 'wrestler',
      );
      const signedAfter = wrestlers.filter((row) => !picked.has(row.personId));
      // Cash is untouched: nothing is paid up front for these.
      expect(cashOf(after, promotionId)).toBe(cashOf(before, promotionId));
      if (!rival) {
        expect(signedAfter).toHaveLength(0);
        continue;
      }
      expect(wrestlers.length, promotionId).toBe(draft.settings.rosterTarget);
      for (const row of signedAfter) {
        expect(row.terms.kind).toBe('perAppearance');
        expect(row.terms.monthlyWage).toBe(0);
        expect(row.terms.perAppearanceFee).toBeGreaterThan(0);
        expect(row.prepaidUntil).toBeNull();
      }
    }
  });
});

describe('under "Negotiate contracts after the draft"', () => {
  it('shows the estimated cost but takes nothing at the pick', () => {
    const engine = engineOf(startDraftGame({ settings: { draftNegotiateAfter: true } }));
    run(engine.command('draft.simToMyPick', {}, PLAYER));
    const before = engine.exportState();
    const pool = run(engine.query('draft.pool', { limit: 3 }, PLAYER_VIEW));
    expect(pool.paysUpFront).toBe(false);
    expect(pool.rows[0]!.cost).toBeGreaterThan(0);
    expect(pool.rows.every((row) => row.affordable)).toBe(true);
    run(engine.command('draft.pick', { personId: pool.rows[0]!.personId }, PLAYER));
    const after = engine.exportState();
    const mine = flagshipOf(after);
    expect(cashOf(after, mine)).toBe(cashOf(before, mine));
    expect(after.world.tables.draftPicks.every((pick) => pick.cost === null)).toBe(true);
  });
});

describe('the Starting cash setting', () => {
  it('defaults to $1M, with the world median still on offer (DRF-11)', () => {
    const preview = previewSetup(DEFAULT_PACKS, 'default-world', {
      playerPromotionKey: FLAGSHIP,
      settings: { draftStart: true },
    });
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.value.draft?.startingCash).toBe('1m');
      expect(preview.value.draft?.level.cash).toBe(100_000_000);
    }
    const median = previewSetup(DEFAULT_PACKS, 'default-world', {
      playerPromotionKey: FLAGSHIP,
      settings: { draftStart: true, draftStartingCash: 'median' },
    });
    expect(median.ok && median.value.draft?.level.cash).toBe(
      median.ok ? median.value.draft?.medianCash : -1,
    );
  });

  it('sets every active promotion cash in the game and the preview', () => {
    const state = startDraftGame({ settings: { draftStartingCash: '2m' } });
    const draft = state.world.tables.drafts[0]!;
    expect(draft.level.cash).toBe(200_000_000);
    for (const promotionId of draft.order) {
      expect(cashOf(state, promotionId)).toBe(200_000_000);
    }
    const preview = previewSetup(DEFAULT_PACKS, 'default-world', {
      playerPromotionKey: FLAGSHIP,
      settings: { draftStart: true, draftStartingCash: '2m' },
    });
    expect(preview.ok && preview.value.draft?.level.cash).toBe(200_000_000);
    expect(preview.ok && preview.value.draft?.medianCash).not.toBe(200_000_000);
  });
});
