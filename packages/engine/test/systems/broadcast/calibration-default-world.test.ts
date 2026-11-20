// TV pay calibration on the shipped default world (ECO8-09, owner decision: scale TV pay down so
// money stays a challenge). TV covers about a big promotion's monthly overhead, not all of its
// costs; every shipped TV or streaming deal pays what its network would offer today.
//
// The fast checks project a year of Altura's shipped deals at the audience of a neutral show. The
// year-long runs (RB_SLOW_TESTS=1, about a minute) check the same band against real settlement,
// that Altura loses money over the year with poor shows and makes a modest profit with decent
// ones, and that no promotion with a deal goes into debt.
//
// ECO8-10 adds the ratings bonus: the projection includes the bonus each deal would earn at a
// neutral show, and the year-long runs check that the bonus stays capped and TV, bonus and all,
// stays within the same band (owner rule: money stays a challenge).
// Design: docs/design/broadcast.md#tv-pay-calibration
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngine } from '../../../src/core/api';
import { defineSystem } from '../../../src/core/api/system';
import { parseContentKey } from '../../../src/core/content-key';
import { addDays, addYearMonths, yearMonthOf } from '../../../src/core/date';
import type { PromotionId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import { promotionStatusKey } from '../../../src/model/entities/employment';
import { ledgerMonthKey, type LedgerCategory } from '../../../src/model/entities/ledger-entry';
import { TABLES, type GameWorldView } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { defaultSystems } from '../../../src/systems';
import { cardSegments, MatchDraftSchema, writeSegment } from '../../../src/systems/booking';
import {
  benchmarkFor,
  dealCoversShow,
  dealInForce,
  dealValuation,
  projectedAudience,
  ratingsBonusShare,
} from '../../../src/systems/broadcast';
import { constantOf } from '../../../src/core/trace';
import { occurrencesBetween } from '../../../src/systems/calendar';
import { monthBreakdownOf } from '../../../src/systems/finance/months';
import { productionMonthlyCost } from '../../../src/systems/production';
import { myShowsOn } from '../../../src/systems/shows/tonight';
import { createEngineTunables } from '../../../src/systems/tunables';
import { withMyShowsRun } from '../../support';
import { cardEveryShowSystem } from '../../support/card-every-show';
import { SLOW_TESTS } from '../../support/slow';
import { startDefaultGame } from '../calendar/default-game';

const TUNABLES = createEngineTunables();
const YEAR_DAYS = 365;

/**
 * Altura's TV, pay-per-view and streaming money in a month, as a share of its monthly production
 * overhead. Calibrated at 0.93 (projected) and 0.89 (a year of decent shows); before ECO8-09
 * it was about 8.
 */
const OVERHEAD_SHARE = { min: 0.6, max: 1.3 } as const;

const TV_CATEGORIES: readonly LedgerCategory[] = ['broadcast', 'ppv', 'streaming'];

let read: GameWorldView;
let altura: PromotionId;

function promotionNamed(view: GameWorldView, prefix: string): PromotionId {
  const found = view.tables.promotions.values().find((row) => row.name.startsWith(prefix));
  if (found === undefined) throw new Error(`No promotion named ${prefix}`);
  return found.id;
}

/** A promotion's production overhead for one month, in cents, at its starting levels. */
function monthlyOverhead(view: GameWorldView, promotionId: PromotionId): number {
  const promotion = view.tables.promotions.require(promotionId);
  return productionMonthlyCost(
    { promotionName: promotion.name, levels: promotion.production },
    { tunables: TUNABLES },
  ).total.value;
}

beforeAll(() => {
  const state = startDefaultGame();
  read = documentToWorld({ state: { world: state.world } }, TABLES);
  altura = promotionNamed(read, 'Szn League');
});

/**
 * What a promotion's deals pay over the year from the start date, net of airtime, at the
 * audience its shows are projected to draw (neutral quality, no night-to-night swing), with the
 * ratings bonus (ECO8-10) each airing would earn at that audience. Read from the shows'
 * recurrences, so it does not depend on how far ahead the calendar is filled.
 */
function projectedYear(promotionId: PromotionId): {
  readonly income: number;
  readonly bonus: number;
} {
  const from = read.meta.currentDate;
  const to = addDays(from, YEAR_DAYS - 1);
  const deals = read.tables.deals.lookup('byPromotion', promotionId);
  let total = 0;
  let bonus = 0;
  for (const definition of read.tables.eventDefinitions.lookup('byPromotion', promotionId)) {
    if (definition.importance === 'house') continue;
    for (const airDate of occurrencesBetween(definition, from, to)) {
      for (const deal of deals) {
        const network = read.tables.networks.require(deal.networkId);
        const show = { definition, airDate };
        if (!dealInForce(deal, network, airDate) || !dealCoversShow(read, deal, network, show)) {
          continue;
        }
        const viewers = projectedAudience(read, TUNABLES, {
          promotionId,
          networkId: network.id,
          timeslot: deal.timeslot,
          live: deal.live,
          importance: definition.importance,
        }).value;
        const { feePerShow, perThousandViewers, costPerShow } = deal.terms;
        const perThousand = (perThousandViewers * viewers) / 1_000;
        total += feePerShow + perThousand - costPerShow;
        const expected = benchmarkFor(read, TUNABLES, {
          networkId: network.id,
          timeslot: deal.timeslot,
          importance: definition.importance,
        }).value;
        const share =
          expected <= 0
            ? null
            : ratingsBonusShare(
                constantOf('Viewers against expected', viewers / expected, 'Projected'),
                { networkName: network.name },
                { tunables: TUNABLES },
              );
        bonus += (share?.value ?? 0) * (network.kind === 'ppv' ? perThousand : feePerShow);
      }
    }
  }
  return { income: total + bonus, bonus };
}

describe("Altura's TV pay", () => {
  it('pays about its monthly overhead over a projected year, not all of its costs', () => {
    const share = projectedYear(altura).income / 12 / monthlyOverhead(read, altura);
    expect(share).toBeGreaterThanOrEqual(OVERHEAD_SHARE.min);
    expect(share).toBeLessThanOrEqual(OVERHEAD_SHARE.max);
  });
});

describe("Altura's ratings bonus (ECO8-10)", () => {
  it('is paid, but stays a small capped part of its TV money', () => {
    const { income, bonus } = projectedYear(altura);
    expect(bonus).toBeGreaterThan(0);
    // At most the cap on every airing, so well under a fifth of the year's TV money.
    expect(bonus / income).toBeLessThanOrEqual(TUNABLES.get('broadcast.bonus.max'));
    expect(bonus / income).toBeLessThan(0.2);
  });
});

describe('shipped TV and streaming deals', () => {
  it('pay close to what their network would offer today', () => {
    for (const deal of read.tables.deals.values()) {
      const network = read.tables.networks.require(deal.networkId);
      if (network.kind === 'ppv') continue;
      const valuation = dealValuation(read, TUNABLES, {
        promotionId: deal.promotionId,
        networkId: deal.networkId,
        eventDefinitionId: deal.eventDefinitionId,
        timeslot: deal.timeslot,
        live: deal.live,
        months: 24,
        excludeDealId: deal.id,
      });
      expect(valuation.verdict, network.name).toBe('accept');
      const ratio = deal.terms.feePerShow / valuation.terms.feePerShow.value;
      expect(ratio, network.name).toBeGreaterThanOrEqual(0.95);
      expect(ratio, network.name).toBeLessThanOrEqual(1.05);
    }
  });
});

/**
 * Poor shows for the player: every main-card slot a singles match between the least popular
 * wrestlers on the roster (an average show score in the high 30s on Altura).
 */
const poorCardsSystem = defineSystem({
  id: 'testPoorCards',
  phases: [
    definePhase({
      id: 'testPoorCards.fill',
      group: 'shows',
      order: 4,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        for (const show of myShowsOn(ctx.read, ctx.date)) {
          if (cardSegments(ctx.read, show.id).length > 0) continue;
          const popularity = new Map<string, number>();
          const roster = ctx.read.tables.employments
            .lookup('byPromotionStatus', promotionStatusKey(show.promotionId, 'active'))
            .filter((employment) => employment.role === 'wrestler')
            .map((employment) => {
              const values = Object.values(
                ctx.read.tables.people.require(employment.personId).regionalPop,
              );
              const total = values.reduce((sum, value) => sum + value, 0);
              popularity.set(employment.personId, total / Math.max(1, values.length));
              return employment.personId;
            })
            .sort(
              (left, right) =>
                (popularity.get(left) ?? 0) - (popularity.get(right) ?? 0) ||
                left.localeCompare(right),
            );
          for (let slot = 0; slot < show.format.slots; slot += 1) {
            const left = roster[slot * 2];
            const right = roster[slot * 2 + 1];
            if (left === undefined || right === undefined) break;
            const draft = MatchDraftSchema.parse({
              kind: 'match',
              label: null,
              match: { matchTypeKey: parseContentKey('match.singles') },
              participants: [
                { personId: left, side: 0, role: 'competitor', teamId: null },
                { personId: right, side: 1, role: 'competitor', teamId: null },
              ],
              outcome: null,
            });
            writeSegment(ctx.tx, { eventInstanceId: show.id, preShow: false, slot, draft });
          }
        }
      },
    }),
  ],
});

interface YearResult {
  readonly world: GameWorldView;
  /** Each promotion's lowest cash at the end of any day, in cents. */
  readonly lowestCash: ReadonlyMap<PromotionId, number>;
  /** Each promotion's ratings bonuses over the year (ECO8-10), in cents. */
  readonly bonuses: ReadonlyMap<PromotionId, number>;
}

/** A year as Altura; decent shows are `cardEveryShowSystem`'s random singles cards. */
async function playYear(shows: 'decent' | 'poor'): Promise<YearResult> {
  const lowestCash = new Map<PromotionId, number>();
  const bonuses = new Map<PromotionId, number>();
  const watcher = defineSystem({
    id: 'testCashWatch',
    phases: [
      definePhase({
        id: 'testCashWatch.lowest',
        group: 'periodic',
        order: 99,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          for (const promotion of ctx.read.tables.promotions.values()) {
            const lowest = lowestCash.get(promotion.id) ?? promotion.cash;
            lowestCash.set(promotion.id, Math.min(lowest, promotion.cash));
            const month = ledgerMonthKey(promotion.id, ctx.date.slice(0, 7));
            for (const entry of ctx.read.tables.ledgerEntries.lookup('byPromotionMonth', month)) {
              if (entry.date === ctx.date && entry.memo?.startsWith('Ratings bonus: ') === true) {
                bonuses.set(promotion.id, (bonuses.get(promotion.id) ?? 0) + entry.amount);
              }
            }
          }
        },
      }),
    ],
  });
  const extra = shows === 'poor' ? [poorCardsSystem, cardEveryShowSystem] : [cardEveryShowSystem];
  const engine = createEngine({
    state: startDefaultGame(),
    systems: withMyShowsRun([...defaultSystems, ...extra, watcher]),
  });
  const advanced = await engine.advanceDays({ maxDays: YEAR_DAYS });
  expect(advanced.failures).toEqual([]);
  const world = documentToWorld({ state: { world: engine.exportState().world } }, TABLES);
  return { world, lowestCash, bonuses };
}

/** Altura's money in `categories` over the 12 months from the start, rolled up or not. */
function yearTotal(world: GameWorldView, categories: readonly LedgerCategory[]): number {
  let total = 0;
  const first = yearMonthOf(read.meta.currentDate);
  for (let month = 0; month < 12; month += 1) {
    const breakdown = monthBreakdownOf(world, altura, addYearMonths(first, month));
    for (const category of categories) {
      total += breakdown.byCategory[category] ?? 0;
    }
  }
  return total;
}

describe.runIf(SLOW_TESTS)('a year as Altura (slow)', () => {
  const TIMEOUT_MS = 600_000;

  it(
    'TV pays about the overhead, decent shows make a modest profit and no dealing promotion goes into debt',
    async () => {
      const { world, lowestCash, bonuses } = await playYear('decent');
      const share = yearTotal(world, TV_CATEGORIES) / 12 / monthlyOverhead(read, altura);
      expect(share).toBeGreaterThanOrEqual(OVERHEAD_SHARE.min);
      expect(share).toBeLessThanOrEqual(OVERHEAD_SHARE.max);

      // Roughly break even to a modest profit: between -5% and +25% of the starting cash.
      const start = read.tables.promotions.require(altura).cash;
      const end = world.tables.promotions.require(altura).cash;
      expect(end - start).toBeGreaterThanOrEqual(-0.05 * start);
      expect(end - start).toBeLessThanOrEqual(0.25 * start);

      for (const deal of world.tables.deals.values()) {
        const promotion = world.tables.promotions.require(deal.promotionId);
        expect(lowestCash.get(promotion.id) ?? 0, promotion.name).toBeGreaterThanOrEqual(0);
      }

      // ECO8-10: the ratings bonus is paid with decent shows, and stays a small part of TV money.
      const bonus = bonuses.get(altura) ?? 0;
      expect(bonus).toBeGreaterThan(0);
      expect(bonus / yearTotal(world, TV_CATEGORIES)).toBeLessThan(0.2);
    },
    TIMEOUT_MS,
  );

  it(
    'loses money over the year with poor shows, TV and all',
    async () => {
      const { world } = await playYear('poor');
      const start = read.tables.promotions.require(altura).cash;
      expect(world.tables.promotions.require(altura).cash).toBeLessThan(start);
    },
    TIMEOUT_MS,
  );
});
