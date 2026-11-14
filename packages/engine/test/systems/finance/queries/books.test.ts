// The books queries and the cash Why? (ECO1-03). Design: docs/design/finances.md#queries
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  initialEngineState,
  OMNISCIENT_VIEWER,
  type Engine,
  type Viewer,
} from '../../../../src/core/api';
import {
  addDays,
  isYearMonth,
  parseGameDate,
  yearMonthOf,
  type YearMonth,
} from '../../../../src/core/date';
import type { EventInstanceId, LedgerEntryId, PromotionId } from '../../../../src/core/ids';
import { cents } from '../../../../src/core/money';
import { isFullTrace } from '../../../../src/core/trace/store';
import { walkTrace } from '../../../../src/core/trace';
import { defaultSystems } from '../../../../src/systems';
import { createNewGame } from '../../../../src/systems/newgame';
import { NOT_YOUR_BOOKS, type FinanceLedgerArgs } from '../../../../src/systems/finance';
import {
  aLedgerEntry,
  SYSTEMS_WITHOUT_SHOW_DAY_GATE,
  TEST_PLAYER_ID,
  worldBuilder,
} from '../../../support';
import { miniWorldPacks } from '../../../support/fixture-packs';

const HUMAN_VIEWER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: TEST_PLAYER_ID },
};
const COMPUTER_VIEWER: Viewer = { kind: 'controller', controller: { kind: 'computer' } };

const DECEMBER_SHOW = parseGameDate('2025-12-15');

interface BooksWorld {
  readonly engine: Engine;
  readonly human: PromotionId;
  readonly rival: PromotionId;
  readonly show: EventInstanceId;
}

/**
 * A human promotion with two paid wrestlers and a rival, started on 20 January with three older
 * rows already in the human's ledger (a show's tickets and production in December, and tickets in
 * January), then run for `days` days through the real engine.
 */
async function booksWorld(days: number): Promise<BooksWorld> {
  const { world, ids } = worldBuilder({ startDate: '2026-01-20' })
    .withGeography('mini')
    .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } }, (promotion) =>
      promotion.withRoster(2),
    )
    .withPromotion({}, (promotion) => promotion.withRoster(2))
    .withEventInstance({ date: DECEMBER_SHOW, status: 'completed' }, 'A')
    .with('older rows', (context) => {
      const promotionId = context.ids.promotions.A;
      const [show] = context.ids.eventInstances;
      if (promotionId === undefined || show === undefined) throw new Error('setup');
      const refs = { eventInstanceId: show, personId: null, dealId: null };
      for (const row of [
        { date: DECEMBER_SHOW, category: 'tickets', amount: cents(800_000), refs },
        { date: DECEMBER_SHOW, category: 'production', amount: cents(-300_000), refs },
        { date: parseGameDate('2026-01-10'), category: 'tickets', amount: cents(200_000) },
      ] as const) {
        context.insert('ledgerEntries', aLedgerEntry({ promotionId, ...row }, context.sequence));
      }
    })
    .build();
  const human = ids.promotions.A;
  const rival = ids.promotions.B;
  const [show] = ids.eventInstances;
  if (human === undefined || rival === undefined || show === undefined) throw new Error('setup');
  const engine = createEngine({
    state: initialEngineState(world),
    systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE,
  });
  if (days > 0) {
    const advanced = await engine.advanceDays({ maxDays: days });
    expect(advanced.failures).toEqual([]);
  }
  return { engine, human, rival, show };
}

/** `{ before }` for a cursor, or nothing for the first page. */
function cursorOf(cursor: LedgerEntryId | null): { before?: LedgerEntryId } {
  return cursor === null ? {} : { before: cursor };
}

function parseYearMonth(text: string): YearMonth {
  if (!isYearMonth(text)) throw new Error(`not a month: ${text}`);
  return text;
}

function data<T>(result: { ok: true; data: T } | { ok: false; reasons: unknown[] }): T {
  if (!result.ok) {
    throw new Error(`Query refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

describe('the books access rule', () => {
  it("refuses a rival's books from overview, monthly and ledger", async () => {
    const { engine, rival } = await booksWorld(0);
    for (const viewer of [HUMAN_VIEWER, COMPUTER_VIEWER]) {
      for (const result of [
        engine.query('finance.overview', { promotionId: rival }, viewer),
        engine.query('finance.monthly', { promotionId: rival }, viewer),
        engine.query('finance.ledger', { promotionId: rival }, viewer),
      ]) {
        expect(result).toEqual({
          ok: false,
          reasons: [
            expect.objectContaining({
              code: NOT_YOUR_BOOKS,
              message: "Another promotion's finances are private",
            }),
          ],
        });
      }
    }
  });

  it('lets the omniscient viewer and the owner read the books', async () => {
    const { engine, human, rival } = await booksWorld(0);
    expect(engine.query('finance.overview', { promotionId: rival }, OMNISCIENT_VIEWER).ok).toBe(
      true,
    );
    expect(engine.query('finance.ledger', { promotionId: human }, HUMAN_VIEWER).ok).toBe(true);
  });
});

describe('finance.overview', () => {
  it('shows the cash, the month totals, the payroll the next row will post and the policies', async () => {
    const { engine, human } = await booksWorld(5);
    const overview = data(engine.query('finance.overview', { promotionId: human }, HUMAN_VIEWER));
    const status = data(engine.query('sim.status', {}, HUMAN_VIEWER));
    expect(overview.cash).toBe(status.promotion?.cash);
    expect(overview.date).toBe('2026-01-25');
    expect(overview.paidContracts).toBe(2);
    expect(overview.monthlyPayroll).toBe(1_000_000);
    expect(overview.dailyWages).toBe(Math.round((1_000_000 * 12) / 365.25));
    expect(overview.dailyWagesTrace.value).toBe(overview.dailyWages);
    expect(overview.policies).toEqual({ catering: 1, travel: 1, medical: 1 });
    // January: 200,000 of tickets and five days of wages; December was before the game started.
    expect(overview.thisMonth).toEqual({
      month: '2026-01',
      income: 200_000,
      costs: -5 * overview.dailyWages,
      net: 200_000 - 5 * overview.dailyWages,
    });
    expect(overview.lastMonth).toBeNull();
    expect(overview.cashTraceRef).not.toBeNull();

    // The next Wages row posts exactly what the overview promised.
    await engine.advanceDays({ maxDays: 1 });
    const [latest] = data(
      engine.query(
        'finance.ledger',
        { promotionId: human, category: 'wages', limit: 1 },
        HUMAN_VIEWER,
      ),
    ).rows;
    expect(latest?.amount).toBe(-overview.dailyWages);
  });

  it('lists twelve month-end balances, oldest first, ending at the cash now', async () => {
    const { engine, human } = await booksWorld(20);
    const overview = data(engine.query('finance.overview', { promotionId: human }, HUMAN_VIEWER));
    expect(overview.monthEndCash).toHaveLength(12);
    expect(overview.monthEndCash.at(-1)).toEqual({ month: '2026-02', cash: overview.cash });
    const january = overview.monthEndCash.at(-2);
    expect(january?.month).toBe('2026-01');
    expect(january?.cash).toBe(overview.cash - overview.thisMonth.net);
    expect(overview.lastMonth?.month).toBe('2026-01');
  });
});

describe('finance.monthly', () => {
  it('breaks the last months down by category with closing cash, empty months as zeros', async () => {
    const { engine, human } = await booksWorld(20);
    const monthly = data(
      engine.query('finance.monthly', { promotionId: human, months: 4 }, HUMAN_VIEWER),
    );
    expect(monthly.months.map((month) => month.month)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    const [november, december, january, february] = monthly.months;
    expect(november).toMatchObject({ byCategory: {}, income: 0, costs: 0, net: 0 });
    expect(december).toMatchObject({
      byCategory: { tickets: 800_000, production: -300_000 },
      income: 800_000,
      costs: -300_000,
      net: 500_000,
    });
    expect(january?.byCategory.tickets).toBe(200_000);
    expect(february?.byCategory.medical).toBe(-30_000);
    // The production overhead on 1 February (ECO7-03) adds Marketing and Back office rows.
    expect(monthly.categories).toEqual([
      'tickets',
      'wages',
      'production',
      'marketing',
      'backOffice',
      'medical',
    ]);
    expect(monthly.startMonth).toBe('2026-01');
    const cash = data(engine.query('finance.overview', { promotionId: human }, HUMAN_VIEWER)).cash;
    expect(february?.closingCash).toBe(cash);
    expect(january?.closingCash).toBe(cash - (february?.net ?? 0));
    expect(november?.closingCash).toBe(
      december === undefined ? 0 : december.closingCash - december.net,
    );
  });

  it('lists twelve months by default and refuses more than 24', async () => {
    const { engine, human } = await booksWorld(0);
    expect(
      data(engine.query('finance.monthly', { promotionId: human }, HUMAN_VIEWER)).months,
    ).toHaveLength(12);
    expect(
      engine.query('finance.monthly', { promotionId: human, months: 25 }, HUMAN_VIEWER).ok,
    ).toBe(false);
  });
});

describe('finance.ledger', () => {
  it('lists rows newest first and pages with before', async () => {
    const { engine, human } = await booksWorld(10);
    const all = data(
      engine.query('finance.ledger', { promotionId: human, limit: 500 }, HUMAN_VIEWER),
    );
    // The 10 January row, ten Wages rows, and February's medical is not due yet. December's two
    // rows are older than the history window (POL4-08): Monday 26 January rolled them into
    // December's totals, which `finance.monthly` still reports.
    expect(all.rows).toHaveLength(11);
    expect(all.nextCursor).toBeNull();
    expect(all.rolledUp).toEqual({
      through: DECEMBER_SHOW,
      note: 'Details are kept for the last 4 weeks. Older money is shown as monthly totals.',
    });
    const dates = all.rows.map((row) => row.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(all.rows[0]).toMatchObject({
      category: 'wages',
      label: 'Wages',
      kind: 'cost',
      memo: 'Wages',
    });
    expect(all.rows[0]?.traceRef).not.toBeNull();
    // Rows written before the finance system have no Why?.
    expect(all.rows.at(-1)?.traceRef).toBeNull();

    const first = data(
      engine.query('finance.ledger', { promotionId: human, limit: 5 }, HUMAN_VIEWER),
    );
    expect(first.rows.map((row) => row.id)).toEqual(all.rows.slice(0, 5).map((row) => row.id));
    expect(first.nextCursor).toBe(all.rows[4]?.id);
    const second = data(
      engine.query(
        'finance.ledger',
        { promotionId: human, limit: 5, ...cursorOf(first.nextCursor) },
        HUMAN_VIEWER,
      ),
    );
    expect(second.rows.map((row) => row.id)).toEqual(all.rows.slice(5, 10).map((row) => row.id));
    const last = data(
      engine.query(
        'finance.ledger',
        { promotionId: human, limit: 5, ...cursorOf(second.nextCursor) },
        HUMAN_VIEWER,
      ),
    );
    expect(last.rows.map((row) => row.id)).toEqual(all.rows.slice(10).map((row) => row.id));
    expect(last.nextCursor).toBeNull();
  });

  it('filters by month, category and show', async () => {
    const { engine, human, show } = await booksWorld(3);
    const ledger = (args: Omit<FinanceLedgerArgs, 'promotionId'>) =>
      data(engine.query('finance.ledger', { promotionId: human, ...args }, HUMAN_VIEWER)).rows;
    expect(
      ledger({ month: parseYearMonth('2025-12') })
        .map((row) => row.category)
        .sort(),
    ).toEqual(['production', 'tickets']);
    expect(ledger({ category: 'tickets' }).map((row) => row.amount)).toEqual([200_000, 800_000]);
    expect(ledger({ eventInstanceId: show })).toHaveLength(2);
    expect(ledger({ month: parseYearMonth('2026-01'), category: 'wages' })).toHaveLength(3);
  });

  it("refuses a cursor from another promotion's ledger", async () => {
    const { engine, human, rival } = await booksWorld(2);
    const [rivalRow] = data(
      engine.query('finance.ledger', { promotionId: rival }, OMNISCIENT_VIEWER),
    ).rows;
    if (rivalRow === undefined) throw new Error('expected a rival row');
    const result = engine.query(
      'finance.ledger',
      { promotionId: human, before: rivalRow.id },
      HUMAN_VIEWER,
    );
    expect(result.ok).toBe(false);
  });
});

describe('sim.status cash Why?', () => {
  it('has a cash trace from the start of a new game that ends at the cash', () => {
    const result = createNewGame(miniWorldPacks(), {
      rootPackId: 'mini-world',
      seed: 'cash-trace-test',
      playerId: 'local-player',
      playerName: 'Alex Booker',
      saveName: 'Cash',
      seasonLength: { preset: '12m' },
      player: { mode: 'existing', promotionKey: 'harbour-city-wrestling' },
      settings: {},
    });
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    const engine = createEngine({ state: result.state, systems: defaultSystems });
    const viewer: Viewer = {
      kind: 'controller',
      controller: { kind: 'human', playerId: 'local-player' },
    };
    const status = data(engine.query('sim.status', {}, viewer));
    const ref = status.promotion?.cashTraceRef;
    if (ref === null || ref === undefined) throw new Error('expected a cash trace');
    const stored = data(engine.query('trace.get', { ref }, viewer));
    if (stored === null || !isFullTrace(stored)) throw new Error('expected a full trace');
    expect(stored.trace.value).toBe(status.promotion?.cash);
    const labels: string[] = [];
    walkTrace(stored.trace, (node) => {
      labels.push(node.label);
    });
    expect(labels).toContain('Opening balance');
  });

  it('hands out no cash Why? that no longer ends at the cash', async () => {
    // A promotion run by the computer for a while (as the played e2e save is) never has its cash
    // Why? rewritten, so the stored one is left behind by the cash.
    const { engine, human } = await booksWorld(1);
    const state = engine.exportState();
    const stale = createEngine({
      state: {
        ...state,
        world: {
          ...state.world,
          tables: {
            ...state.world.tables,
            promotions: state.world.tables.promotions.map((row) =>
              row.id === human ? { ...row, cash: cents(row.cash - 1) } : row,
            ),
          },
        },
      },
      systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE,
    });
    expect(
      data(engine.query('sim.status', {}, HUMAN_VIEWER)).promotion?.cashTraceRef,
    ).not.toBeNull();
    expect(data(stale.query('sim.status', {}, HUMAN_VIEWER)).promotion?.cashTraceRef).toBeNull();
    expect(
      data(stale.query('finance.overview', { promotionId: human }, HUMAN_VIEWER)).cashTraceRef,
    ).toBeNull();
  });

  it('follows every posted row, from the opening balance to the cash now', async () => {
    const { engine, human } = await booksWorld(45);
    const status = data(engine.query('sim.status', {}, HUMAN_VIEWER));
    const ref = status.promotion?.cashTraceRef;
    if (ref === null || ref === undefined) throw new Error('expected a cash trace');
    const stored = data(engine.query('trace.get', { ref }, HUMAN_VIEWER));
    if (stored === null || !isFullTrace(stored)) throw new Error('expected a full trace');
    expect(stored.trace.value).toBe(status.promotion?.cash);
    // The start plus every step adds up to the cash.
    let total = 0;
    const labels: string[] = [];
    for (const step of stored.trace.children ?? []) {
      labels.push(step.label);
      if (step.kind === 'add') total += step.operand;
      else if (step.kind === 'subtract') total -= step.operand;
      else if (typeof step.value === 'number') total += step.value;
    }
    expect(total).toBe(status.promotion?.cash);
    // 45 days from 20 January ends on 5 March: January and February are one line each.
    expect(yearMonthOf(addDays(status.date, -1))).toBe('2026-03');
    expect(labels.slice(0, 3)).toEqual(['Opening balance', 'January 2026', 'February 2026']);
    expect(labels).toEqual(expect.arrayContaining(['Wages', 'Medical']));
    // The opening balance is the cash less every row since the game's first month, counting the
    // rows the history roll-up (POL4-08) already turned into monthly totals.
    const promotion = engine.exportState().world.tables.promotions.find((row) => row.id === human);
    const rolledUp = (promotion?.ledgerMonths ?? [])
      .filter((month) => month.month >= '2026-01')
      .flatMap((month) => Object.values(month.byCategory))
      .reduce((sum, amount) => sum + amount, 0);
    expect(rolledUp).not.toBe(0);
    const sinceStart =
      rolledUp +
      engine
        .exportState()
        .world.tables.ledgerEntries.filter(
          (row) => row.promotionId === human && row.date >= '2026-01',
        )
        .reduce((sum, row) => sum + row.amount, 0);
    expect(stored.trace.children?.[0]?.value).toBe((promotion?.cash ?? 0) - sinceStart);
  });
});
