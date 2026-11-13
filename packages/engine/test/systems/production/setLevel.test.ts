// production.setLevel and the changeProductionLevel door (ECO7-02).
// Design: docs/design/production.md#changing-a-level
import { describe, expect, it } from 'vitest';
import type { Controller } from '../../../src/model/controller';
import type { Engine } from '../../../src/core/api';
import { assertSerialisable } from '../../../src/core/api/serialisable';
import type { PromotionId } from '../../../src/core/ids';
import type { TraceNode } from '../../../src/core/trace/types';
import type { ProductionArea } from '../../../src/model/entities/promotion';
import { cents } from '../../../src/core/money';
import { LEDGER_ENTRY_TRACE_KIND } from '../../../src/systems/finance';
import {
  COMPUTER,
  OTHER_PLAYER,
  PLAYER,
  productionEngine,
  productionWorld,
} from './production-world';

function setLevel(
  engine: Engine,
  promotionId: PromotionId,
  area: ProductionArea,
  level: number,
  issuedBy: Controller = PLAYER,
) {
  return engine.command('production.setLevel', { promotionId, area, level }, issuedBy);
}

function promotionOf(engine: Engine, promotionId: PromotionId) {
  const promotion = engine
    .exportState()
    .world.tables.promotions.find((row) => row.id === promotionId);
  if (promotion === undefined) {
    throw new Error('no such promotion');
  }
  return promotion;
}

function ledgerOf(engine: Engine, promotionId: PromotionId) {
  return engine
    .exportState()
    .world.tables.ledgerEntries.filter((row) => row.promotionId === promotionId);
}

function levelChangedEvents(engine: Engine) {
  const events = engine.query(
    'sim.recentEvents',
    { limit: 20, types: ['production.levelChanged'] },
    { kind: 'omniscient' },
  );
  if (!events.ok) {
    throw new Error('sim.recentEvents failed');
  }
  return events.data.map((event) => event.payload);
}

function expectRefused(
  engine: Engine,
  promotionId: PromotionId,
  area: ProductionArea,
  level: number,
  code: string,
  issuedBy: Controller = PLAYER,
): string {
  const before = engine.exportState().world;
  const result = setLevel(engine, promotionId, area, level, issuedBy);
  if (result.ok) {
    throw new Error(`expected ${code}, the change was applied`);
  }
  expect(result.reasons.map((reason) => reason.code)).toContain(code);
  expect(engine.exportState().world).toEqual(before);
  return result.reasons.find((reason) => reason.code === code)?.message ?? '';
}

/** Every label in the trace, the root's and every nested node's. */
function labels(node: TraceNode): string[] {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'label' && typeof inner === 'string') {
          found.push(inner);
        } else {
          walk(inner);
        }
      }
    }
  };
  walk(node);
  return found;
}

describe('production.setLevel', () => {
  it('raises camera 2 → 4 for $28,000 through postMoney, with the fee in the Why?', () => {
    const built = productionWorld();
    const engine = productionEngine(built.world);
    const result = setLevel(engine, built.human, 'camera', 4);
    expect(result).toMatchObject({
      ok: true,
      data: { area: 'camera', from: 2, to: 4, fee: 2_800_000 },
    });
    if (result.ok) {
      assertSerialisable(result.data, 'setLevel');
    }
    const promotion = promotionOf(engine, built.human);
    expect(promotion.production.camera).toBe(4);
    expect(promotion.cash).toBe(10_000_000 - 2_800_000);

    const rows = ledgerOf(engine, built.human);
    expect(rows).toEqual([
      expect.objectContaining({
        category: 'production',
        amount: -2_800_000,
        memo: 'Camera upgrade: level 2 to 4',
      }),
    ]);
    const row = rows[0];
    expect(row?.traceRef?.kind).toBe(LEDGER_ENTRY_TRACE_KIND);
    const stored = engine.query(
      'trace.get',
      { ref: row?.traceRef ?? { kind: 'none', id: 'none' } },
      { kind: 'omniscient' },
    );
    expect(stored.ok).toBe(true);
    const entry = stored.ok ? stored.data : null;
    if (entry === null || !('trace' in entry)) {
      throw new Error('the ledger row should keep its full Why?');
    }
    expect(entry.trace.value).toBe(-2_800_000);
    expect(labels(entry.trace)).toContain('Camera 2 → 4');

    expect(levelChangedEvents(engine)).toEqual([
      {
        promotionId: built.human,
        area: 'camera',
        from: 2,
        to: 4,
        fee: 2_800_000,
        source: 'command',
      },
    ]);
  });

  it('lowers for free: the level changes and nothing is posted', () => {
    const built = productionWorld();
    const engine = productionEngine(built.world);
    expect(setLevel(engine, built.human, 'writing', 0)).toMatchObject({
      ok: true,
      data: { from: 2, to: 0, fee: 0 },
    });
    expect(promotionOf(engine, built.human).production.writing).toBe(0);
    expect(promotionOf(engine, built.human).cash).toBe(10_000_000);
    expect(ledgerOf(engine, built.human)).toEqual([]);
    expect(levelChangedEvents(engine)).toEqual([
      expect.objectContaining({ area: 'writing', from: 2, to: 0, fee: 0 }),
    ]);
  });

  it('refuses the same level, a level out of range and a promotion the issuer does not run', () => {
    const built = productionWorld();
    const engine = productionEngine(built.world);
    expect(expectRefused(engine, built.human, 'camera', 2, 'production.sameLevel')).toBe(
      'Camera is already at level 2',
    );
    expectRefused(engine, built.human, 'camera', 11, 'production.outOfRange');
    expectRefused(engine, built.human, 'camera', -1, 'production.outOfRange');
    expectRefused(engine, built.rival, 'camera', 9, 'production.notYourPromotion');
    expectRefused(engine, built.human, 'camera', 3, 'production.notYourPromotion', OTHER_PLAYER);
    expectRefused(engine, built.human, 'camera', 3, 'production.notYourPromotion', COMPUTER);
  });

  it('lets the computer change a promotion it runs (one controller rule, AIP1-07)', () => {
    const built = productionWorld();
    const engine = productionEngine(built.world);
    expect(setLevel(engine, built.rival, 'pyro', 4, COMPUTER)).toMatchObject({ ok: true });
    expect(promotionOf(engine, built.rival).production.pyro).toBe(4);
  });

  it('refuses a closed promotion', () => {
    const built = productionWorld({ human: { status: 'closed' } });
    const engine = productionEngine(built.world);
    expectRefused(engine, built.human, 'camera', 3, 'production.promotionClosed');
  });

  it('keeps camera at 1 or higher while a TV deal runs, naming the network', () => {
    const built = productionWorld({ dealDays: 28 });
    const engine = productionEngine(built.world);
    const message = expectRefused(engine, built.human, 'camera', 0, 'production.tvDealCamera');
    expect(message).toBe(
      "You have an active TV deal with Channel 9 until Sun 1 Feb: camera can't go below level 1",
    );
    const result = setLevel(engine, built.human, 'camera', 0);
    expect(!result.ok && result.reasons[0]?.subject).toEqual({ kind: 'deal', id: built.deal });
    // Lowering to the minimum itself is fine.
    expect(setLevel(engine, built.human, 'camera', 1)).toMatchObject({ ok: true });
  });

  it("allows camera 0 once the deal's last day has passed", () => {
    const built = productionWorld({ dealDays: 28, today: '2026-02-02' });
    const engine = productionEngine(built.world);
    expect(setLevel(engine, built.human, 'camera', 0)).toMatchObject({ ok: true });
  });

  it('allows camera 0 with a deal when production.tvDealMinCamera is 0', () => {
    const built = productionWorld({ dealDays: 28 });
    const engine = productionEngine(built.world, { 'production.tvDealMinCamera': 0 });
    expect(setLevel(engine, built.human, 'camera', 0)).toMatchObject({ ok: true });
  });

  it('refuses a fee above cash in hand, and lets cash go negative when feeNeedsCash is off', () => {
    const built = productionWorld({ human: { cash: cents(2_000_000) } });
    const message = expectRefused(
      productionEngine(built.world),
      built.human,
      'camera',
      4,
      'production.cannotAfford',
    );
    expect(message).toBe('The fee is $28,000 and you have $20,000');

    const engine = productionEngine(built.world, { 'production.feeNeedsCash': false });
    expect(setLevel(engine, built.human, 'camera', 4)).toMatchObject({ ok: true });
    expect(promotionOf(engine, built.human).cash).toBe(2_000_000 - 2_800_000);
  });

  it('does what the preview says it will', () => {
    const built = productionWorld();
    const engine = productionEngine(built.world);
    for (const [area, level] of [
      ['camera', 4],
      ['marketing', 3],
      ['stage', 0],
    ] as const) {
      const preview = engine.query(
        'production.changePreview',
        { promotionId: built.human, area, level },
        { kind: 'controller', controller: PLAYER },
      );
      if (!preview.ok) {
        throw new Error('the preview should run');
      }
      assertSerialisable(preview.data, 'preview');
      const cashBefore = promotionOf(engine, built.human).cash;
      const result = setLevel(engine, built.human, area, level);
      expect(result).toMatchObject({ ok: true, data: { fee: preview.data.fee } });
      expect(promotionOf(engine, built.human).cash).toBe(cashBefore - preview.data.fee);
      const overview = engine.query(
        'production.overview',
        { promotionId: built.human },
        { kind: 'controller', controller: PLAYER },
      );
      if (!overview.ok) {
        throw new Error('the overview should run');
      }
      const after = preview.data.rows.find((row) => row.id === 'areaCost')?.after;
      expect(overview.data.rows.find((row) => row.area === area)?.cost).toBe(after);
      const overhead = preview.data.rows.find((row) => row.id === 'monthlyOverhead');
      if (overhead !== undefined) {
        expect(overview.data.monthlyOverhead?.total).toBe(overhead.after);
      }
      const coming = preview.data.rows.find((row) => row.id === 'upcomingShows');
      if (coming !== undefined) {
        expect(overview.data.upcomingShows?.total).toBe(coming.after);
      }
      const ceiling = preview.data.rows.find((row) => row.id === 'popularityCeiling');
      if (ceiling !== undefined) {
        expect(overview.data.popularityCeiling.value).toBe(ceiling.after);
      }
    }
  });

  it('shows the same refusals in the preview as the command gives', () => {
    const built = productionWorld({ dealDays: 28, human: { cash: cents(100) } });
    const engine = productionEngine(built.world);
    for (const [area, level] of [
      ['camera', 0],
      ['camera', 2],
      ['camera', 9],
      ['camera', 12],
    ] as const) {
      const preview = engine.query(
        'production.changePreview',
        { promotionId: built.human, area, level },
        { kind: 'controller', controller: PLAYER },
      );
      const result = setLevel(engine, built.human, area, level);
      expect(preview.ok && preview.data.canApply).toBe(false);
      expect(result.ok).toBe(false);
      expect(preview.ok && preview.data.reasons).toEqual(!result.ok && result.reasons);
    }
  });
});
