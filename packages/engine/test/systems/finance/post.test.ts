// postMoney, the only way cash moves during play (ECO1-01). Design: docs/design/finances.md#postmoney
import { describe, expect, it } from 'vitest';
import { addDays, type GameDate } from '../../../src/core/date';
import { EntityNotFoundError, InvalidArgumentError } from '../../../src/core/errors';
import type { PromotionId } from '../../../src/core/ids';
import { cents, type Cents } from '../../../src/core/money';
import type { StepContext } from '../../../src/core/pipeline/context';
import { runStep } from '../../../src/core/pipeline/runStep';
import { createRuntime, type SimRuntime } from '../../../src/core/pipeline/runtime';
import { Sfc32, seedState } from '../../../src/core/rng/prng';
import { isFullTrace } from '../../../src/core/trace/store';
import { startCalc } from '../../../src/core/trace';
import {
  LEDGER_CATEGORIES,
  LEDGER_CATEGORY_SIGN,
  LedgerEntrySchema,
  ledgerMonthKey,
  type LedgerCategory,
  type LedgerEntry,
} from '../../../src/model/entities/ledger-entry';
import type { GameWorld } from '../../../src/model/tables';
import {
  LEDGER_ENTRY_TRACE_KIND,
  RIVAL_LEDGER_ENTRY_TRACE_KIND,
  postMoney,
  type PostMoneyInput,
} from '../../../src/systems/finance';
import { createEngineTunables } from '../../../src/systems/tunables';
import { TEST_PLAYER_ID, testId, worldBuilder } from '../../support';

interface FinanceWorld {
  readonly world: GameWorld;
  readonly runtime: SimRuntime;
  /** Human-controlled. */
  readonly human: PromotionId;
  /** Computer-controlled. */
  readonly rival: PromotionId;
  /** Computer-controlled. */
  readonly other: PromotionId;
  /** Closed. */
  readonly closed: PromotionId;
}

function financeWorld(): FinanceWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } })
    .withPromotion()
    .withPromotion()
    .withPromotion({ status: 'closed' })
    .build();
  const { A: human, B: rival, C: other, D: closed } = ids.promotions;
  if (human === undefined || rival === undefined || other === undefined || closed === undefined) {
    throw new Error('the finance world should have four promotions');
  }
  const runtime = createRuntime({ world, tunables: createEngineTunables() });
  return { world, runtime, human, rival, other, closed };
}

/** A promotion id no row has. */
const UNKNOWN_PROMOTION = testId('promotion', 9_999);

const SOURCE = { kind: 'phase', id: 'test.finance' } as const;

/** Runs `body` as one pipeline step; returns the step's status and error message. */
function step(
  runtime: SimRuntime,
  body: (ctx: StepContext) => void,
  date?: GameDate,
): { status: string; error: string | undefined; errorCode: string | undefined } {
  const report = runStep(runtime, 'test.finance', SOURCE, body, date === undefined ? {} : { date });
  return { status: report.status, error: report.error?.message, errorCode: report.error?.code };
}

function cashOf(world: GameWorld, promotionId: PromotionId): Cents {
  return world.tables.promotions.require(promotionId).cash;
}

function rowsOf(world: GameWorld, promotionId: PromotionId): LedgerEntry[] {
  return world.tables.ledgerEntries.values().filter((entry) => entry.promotionId === promotionId);
}

function moneyEvents(runtime: SimRuntime) {
  return runtime.bus.recent({ types: ['finance.moneyPosted'] });
}

describe('postMoney', () => {
  it('moves cash by exactly the amount and appends one row, for a cost and an income', () => {
    const { world, runtime, human } = financeWorld();
    const before = cashOf(world, human);
    const posted: LedgerEntry[] = [];

    const result = step(runtime, (ctx) => {
      posted.push(
        postMoney(ctx, {
          promotionId: human,
          category: 'wages',
          amount: cents(-250_000),
          memo: '  Weekly wages  ',
        }),
      );
      posted.push(
        postMoney(ctx, {
          promotionId: human,
          category: 'tickets',
          amount: cents(400_000),
          memo: 'Gate at the arena',
        }),
      );
    });

    expect(result.status).toBe('ok');
    expect(cashOf(world, human)).toBe(before - 250_000 + 400_000);
    expect(rowsOf(world, human)).toHaveLength(2);
    const [wages, tickets] = posted;
    expect(wages?.memo).toBe('Weekly wages');
    expect(wages?.amount).toBe(-250_000);
    expect(tickets?.refs).toEqual({ eventInstanceId: null, personId: null, dealId: null });
    const today = world.meta.currentDate;
    const month = world.tables.ledgerEntries.lookup(
      'byPromotionMonth',
      ledgerMonthKey(human, today.slice(0, 7)),
    );
    expect(month.map((entry) => entry.id).sort()).toEqual(posted.map((entry) => entry.id).sort());
  });

  it('accepts an earlier date and keeps the refs it is given', () => {
    const { world, runtime, human } = financeWorld();
    const yesterday = addDays(world.meta.currentDate, -1);
    let entry: LedgerEntry | undefined;
    const result = step(runtime, (ctx) => {
      entry = postMoney(ctx, {
        promotionId: human,
        category: 'medical',
        amount: cents(-1),
        date: yesterday,
        memo: 'Bandages',
        refs: { personId: null },
      });
    });
    expect(result.status).toBe('ok');
    expect(entry?.date).toBe(yesterday);
  });

  const refusals: readonly {
    name: string;
    input: (world: FinanceWorld) => PostMoneyInput;
    error: string;
  }[] = [
    {
      name: 'a zero amount',
      input: ({ human }) => ({
        promotionId: human,
        category: 'wages',
        amount: cents(0),
        memo: 'x',
      }),
      error: 'negative for the wages category',
    },
    {
      name: 'a cost with a positive amount',
      input: ({ human }) => ({
        promotionId: human,
        category: 'wages',
        amount: cents(5),
        memo: 'x',
      }),
      error: 'negative for the wages category',
    },
    {
      name: 'an income with a negative amount',
      input: ({ human }) => ({
        promotionId: human,
        category: 'subsidyIncome',
        amount: cents(-5),
        memo: 'x',
      }),
      error: 'positive for the subsidyIncome category',
    },
    {
      name: 'an unknown promotion',
      input: () => ({
        promotionId: UNKNOWN_PROMOTION,
        category: 'tickets',
        amount: cents(5),
        memo: 'x',
      }),
      error: 'No promotion with ID',
    },
    {
      name: 'a closed promotion',
      input: ({ closed }) => ({
        promotionId: closed,
        category: 'tickets',
        amount: cents(5),
        memo: 'x',
      }),
      error: 'an open promotion',
    },
    {
      name: 'a date after today',
      input: ({ human, world }) => ({
        promotionId: human,
        category: 'tickets',
        amount: cents(5),
        date: addDays(world.meta.currentDate, 1),
        memo: 'x',
      }),
      error: 'date must be on or before',
    },
    {
      name: 'an empty memo',
      input: ({ human }) => ({
        promotionId: human,
        category: 'tickets',
        amount: cents(5),
        memo: '  ',
      }),
      error: 'memo must be 1 to 120 characters',
    },
    {
      name: 'a memo over 120 characters',
      input: ({ human }) => ({
        promotionId: human,
        category: 'tickets',
        amount: cents(5),
        memo: 'x'.repeat(121),
      }),
      error: 'memo must be 1 to 120 characters',
    },
    {
      name: 'a trace whose value is not the amount',
      input: ({ human }) => ({
        promotionId: human,
        category: 'tickets',
        amount: cents(500),
        memo: 'Gate',
        trace: startCalc('Gate', 400, { unit: 'money' }).done(),
      }),
      error: 'a trace whose value is the amount posted (500)',
    },
  ];

  for (const refusal of refusals) {
    it(`refuses ${refusal.name} and rolls the step back`, () => {
      const finance = financeWorld();
      const { world, runtime, human } = finance;
      const cashBefore = world.tables.promotions.values().map((promotion) => promotion.cash);
      const result = step(runtime, (ctx) => {
        // A good post earlier in the same step is rolled back with the bad one.
        postMoney(ctx, { promotionId: human, category: 'tickets', amount: cents(10), memo: 'ok' });
        postMoney(ctx, refusal.input(finance));
      });
      expect(result.status).toBe('failed');
      expect(result.error).toContain(refusal.error);
      expect(world.tables.promotions.values().map((promotion) => promotion.cash)).toEqual(
        cashBefore,
      );
      expect(world.tables.ledgerEntries.size).toBe(0);
      expect(moneyEvents(runtime)).toEqual([]);
      expect(runtime.traces.toState().full).toEqual([]);
    });
  }

  it('throws the documented error classes', () => {
    const finance = financeWorld();
    const errors: unknown[] = [];
    step(finance.runtime, (ctx) => {
      for (const input of [
        { promotionId: finance.human, category: 'wages', amount: cents(0), memo: 'x' },
        {
          promotionId: UNKNOWN_PROMOTION,
          category: 'tickets',
          amount: cents(1),
          memo: 'x',
        },
      ] satisfies PostMoneyInput[]) {
        try {
          postMoney(ctx, input);
        } catch (error) {
          errors.push(error);
        }
      }
    });
    expect(errors[0]).toBeInstanceOf(InvalidArgumentError);
    expect(errors[1]).toBeInstanceOf(EntityNotFoundError);
  });

  it("stores each row's Why? under its traceRef: finance.entry for the player, finance.rivalEntry for rivals", () => {
    const { runtime, human, rival } = financeWorld();
    const entries: LedgerEntry[] = [];
    const given = startCalc('Wages for the week', -30_000, { unit: 'money' }).add('Bonus', -2_000);
    step(runtime, (ctx) => {
      entries.push(
        postMoney(ctx, {
          promotionId: human,
          category: 'wages',
          amount: cents(-32_000),
          memo: 'Payroll',
          trace: given.done(),
        }),
      );
      entries.push(
        postMoney(ctx, {
          promotionId: rival,
          category: 'travel',
          amount: cents(-700),
          memo: 'Bus',
        }),
      );
    });
    const [mine, theirs] = entries;
    if (mine === undefined || theirs === undefined) {
      throw new Error('both posts should have returned a row');
    }
    expect(mine.traceRef).toEqual({ kind: LEDGER_ENTRY_TRACE_KIND, id: mine.id });
    expect(theirs.traceRef).toEqual({ kind: RIVAL_LEDGER_ENTRY_TRACE_KIND, id: theirs.id });

    const mineTrace = mine.traceRef === null ? undefined : runtime.traces.get(mine.traceRef);
    const theirTrace = theirs.traceRef === null ? undefined : runtime.traces.get(theirs.traceRef);
    if (mineTrace === undefined || !isFullTrace(mineTrace)) {
      throw new Error("the player's row should have a full trace");
    }
    if (theirTrace === undefined || !isFullTrace(theirTrace)) {
      throw new Error("the rival's row should have a full trace");
    }
    expect(mineTrace.value).toBe(-32_000);
    expect(mineTrace.trace.label).toBe('Wages for the week');
    // An untraced caller still gets a one-line Why? naming the memo.
    expect(theirTrace.value).toBe(-700);
    expect(theirTrace.trace).toMatchObject({ kind: 'input', label: 'Amount posted: Bus' });
  });

  it("publishes finance.moneyPosted once per row of the player's promotion, and not for rivals", () => {
    const { runtime, human, rival } = financeWorld();
    let entry: LedgerEntry | undefined;
    step(runtime, (ctx) => {
      entry = postMoney(ctx, {
        promotionId: human,
        category: 'charity',
        amount: cents(-9_900),
        memo: 'Hospital visit',
      });
      postMoney(ctx, { promotionId: rival, category: 'wages', amount: cents(-1), memo: 'Payroll' });
    });
    const events = moneyEvents(runtime);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      promotionId: human,
      ledgerEntryId: entry?.id,
      category: 'charity',
      amount: -9_900,
      date: entry?.date,
    });
  });

  it('keeps cash and the ledger in step over 200 seeded random posts across three promotions', () => {
    const { world, runtime, human, rival, other } = financeWorld();
    const promotions = [human, rival, other] as const;
    const before = new Map(promotions.map((id) => [id, cashOf(world, id)]));
    const generator = new Sfc32(seedState('finance-post-property', '1'));
    const below = (count: number): number => generator.nextUint32() % count;
    const today = world.meta.currentDate;

    for (let index = 0; index < 200; index++) {
      const promotionId = promotions[below(promotions.length)] ?? human;
      const category: LedgerCategory =
        LEDGER_CATEGORIES[below(LEDGER_CATEGORIES.length)] ?? 'tickets';
      const size = 1 + below(5_000_000);
      const result = step(runtime, (ctx) => {
        postMoney(ctx, {
          promotionId,
          category,
          amount: cents(LEDGER_CATEGORY_SIGN[category] * size),
          date: addDays(today, -below(60)),
          memo: `Random post ${String(index)}`,
        });
      });
      expect(result.status, result.error).toBe('ok');
    }

    expect(world.tables.ledgerEntries.size).toBe(200);
    for (const promotionId of promotions) {
      const total = rowsOf(world, promotionId).reduce((sum, entry) => sum + entry.amount, 0);
      expect(cashOf(world, promotionId) - (before.get(promotionId) ?? 0)).toBe(total);
    }
    for (const entry of world.tables.ledgerEntries.values()) {
      expect(LedgerEntrySchema.safeParse(entry).success).toBe(true);
    }
  });
});
