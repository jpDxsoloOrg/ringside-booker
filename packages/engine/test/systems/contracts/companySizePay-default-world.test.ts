// Small promotions pay indie wages (ECO4-09), on the shipped default world.
//
// The fast checks read the shipped contracts: each is the roster spec's tier rate × the company
// size pay factor at its promotion's reach, so Hardpan's roster costs about $2,600 a show with
// everyone booked (it was $6,600) while Altura, Tessen and Cielo Alto keep their payroll; a star
// still asks a small company for more than it can comfortably pay.
//
// The year-long runs (RB_SLOW_TESTS=1, about a minute) play Hardpan: run frugally (Auto-fill cards,
// its own modest production) it ends the year a little up while its reach grows; overspending on
// production still loses money; no promotion goes into debt.
// Design: docs/design/contracts.md#company-size-pay
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngine } from '../../../src/core/api';
import { defineSystem } from '../../../src/core/api/system';
import type { PromotionId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import type { Push } from '../../../src/model/entities/employment';
import { TABLES, type GameWorldView } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { defaultSystems } from '../../../src/systems';
import { AUTOFILL_STREAM, planCard } from '../../../src/systems/aip/card';
import { cardSegments, writeSegment } from '../../../src/systems/booking';
import { reachOf } from '../../../src/systems/finance/reach';
import { askingTermsFor, companySizePay } from '../../../src/systems/negotiation';
import { myShowsOn } from '../../../src/systems/shows/tonight';
import { createEngineTunables } from '../../../src/systems/tunables';
import { withMyShowsRun } from '../../support';
import { cardEveryShowSystem } from '../../support/card-every-show';
import { SLOW_TESTS } from '../../support/slow';
import { startDefaultGame } from '../calendar/default-game';

const TUNABLES = createEngineTunables();
const HARDPAN_KEY = 'pro-us-texas-indie';
const FULL_RATE_KEYS = ['pro-flagship', 'pro-jp-major', 'pro-mx-major'] as const;
const YEAR_DAYS = 365;
/** $1 in cents. */
const DOLLAR = 100;

interface SpecTerms {
  readonly kind: 'written' | 'perAppearance';
  readonly pay: Readonly<Record<Push, number>>;
}

interface RosterSpec {
  readonly promotions: Readonly<Record<string, { readonly tier: string }>>;
  readonly contracts: { readonly terms: Readonly<Record<string, SpecTerms>> };
}

const SPEC = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../../content/worlds/default/roster.spec.json', import.meta.url),
    ),
    'utf8',
  ),
) as RosterSpec;

let read: GameWorldView;
let promotionKeys: ReadonlyMap<PromotionId, string>;

function promotionId(key: string): PromotionId {
  for (const [id, candidate] of promotionKeys) {
    if (candidate === key) return id;
  }
  throw new Error(`No promotion ${key}`);
}

/** A promotion's active contracts' pay: the fee on a per-appearance deal, else the monthly wage. */
function shippedPay(view: GameWorldView, id: PromotionId): number {
  return view.tables.employments
    .lookup('byPromotion', id)
    .filter((employment) => employment.status === 'active')
    .reduce(
      (sum, employment) =>
        sum +
        (employment.terms.kind === 'perAppearance'
          ? employment.terms.perAppearanceFee
          : employment.terms.monthlyWage),
      0,
    );
}

beforeAll(() => {
  const state = startDefaultGame({ player: { mode: 'existing', promotionKey: HARDPAN_KEY } });
  read = documentToWorld({ state: { world: state.world } }, TABLES);
  promotionKeys = new Map(
    Object.entries(read.meta.contentKeys['promotion'] ?? {}).map(([key, id]) => [
      id as PromotionId,
      key,
    ]),
  );
});

describe('shipped contracts', () => {
  it("pay the spec's tier rate × the company size pay factor at the promotion's reach", () => {
    for (const employment of read.tables.employments.values()) {
      if (employment.status !== 'active') continue;
      const key = promotionKeys.get(employment.promotionId);
      const tier = key === undefined ? undefined : SPEC.promotions[key]?.tier;
      const terms = tier === undefined ? undefined : SPEC.contracts.terms[tier];
      if (terms === undefined) throw new Error(`No spec terms for ${employment.ringName}`);
      const factor = companySizePay(reachOf(read, employment.promotionId, TUNABLES).reach.value, {
        tunables: TUNABLES,
      }).value;
      const step = terms.kind === 'written' ? 100 : 10;
      const expected = Math.round((terms.pay[employment.push] * factor) / step) * step * DOLLAR;
      const pay =
        terms.kind === 'written' ? employment.terms.monthlyWage : employment.terms.perAppearanceFee;
      expect(pay, `${employment.ringName} (${key ?? '?'})`).toBe(expected);
    }
  });

  it("put Hardpan's roster at $2,000-3,000 a show with everyone booked (it was $6,600)", () => {
    const total = shippedPay(read, promotionId(HARDPAN_KEY));
    expect(total).toBeGreaterThanOrEqual(2_000 * DOLLAR);
    expect(total).toBeLessThanOrEqual(3_000 * DOLLAR);
  });

  it('keep the big companies on full rates', () => {
    for (const key of FULL_RATE_KEYS) {
      const reach = reachOf(read, promotionId(key), TUNABLES).reach.value;
      expect(companySizePay(reach, { tunables: TUNABLES }).value, key).toBe(1);
    }
  });
});

describe('asks from a small company', () => {
  it("still put a star beyond what Hardpan can comfortably pay: about its whole roster's fees", () => {
    const hardpan = promotionId(HARDPAN_KEY);
    const roster = shippedPay(read, hardpan);
    const stars = read.tables.employments
      .lookup('byPromotion', promotionId('pro-flagship'))
      .filter((employment) => employment.status === 'active' && employment.push === 'mainEvent');
    expect(stars.length).toBeGreaterThan(0);
    for (const star of stars) {
      const ask = askingTermsFor(read, TUNABLES, {
        personId: star.personId,
        promotionId: hardpan,
        date: read.meta.currentDate,
        kind: 'perAppearance',
        exclusive: false,
      });
      expect(ask.perAppearanceFee.value, star.ringName).toBeGreaterThanOrEqual(0.75 * roster);
      expect(JSON.stringify(ask.monthlyWage.trace)).toContain('Company size: Local');
    }
  });
});

/** Auto-fill for the player's empty cards: sensible booking. */
const autofillSystem = defineSystem({
  id: 'testAutofillMyCards',
  phases: [
    definePhase({
      id: 'testAutofillMyCards.fill',
      group: 'shows',
      order: 4,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        for (const show of myShowsOn(ctx.read, ctx.date)) {
          if (cardSegments(ctx.read, show.id).length > 0) continue;
          const plan = planCard(
            ctx.read,
            { instance: show, today: ctx.date, mode: 'fresh' },
            { tunables: ctx.tunables, rng: ctx.rng(AUTOFILL_STREAM) },
          );
          if (plan.kind === 'cancel') continue;
          for (const placement of plan.placements) {
            const draft =
              placement.draft.kind === 'match'
                ? { ...placement.draft, outcome: null }
                : placement.draft;
            writeSegment(ctx.tx, {
              eventInstanceId: show.id,
              preShow: placement.preShow,
              slot: placement.slot,
              draft,
            });
          }
        }
      },
    }),
  ],
});

/** Overspending: the player raises every production area a level or two on the first day. */
const overspendSystem = defineSystem({
  id: 'testOverspend',
  phases: [
    definePhase({
      id: 'testOverspend.raise',
      group: 'shows',
      order: 3,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        for (const promotion of ctx.read.tables.promotions.values()) {
          if (promotion.controller.kind !== 'human' || promotion.production.stage >= 3) continue;
          ctx.tx.update('promotions', promotion.id, (previous) => ({
            ...previous,
            production: {
              stage: 3,
              camera: 3,
              editing: 2,
              pyro: 2,
              music: 2,
              writing: 3,
              marketing: 2,
              backOffice: 2,
            },
          }));
        }
      },
    }),
  ],
});

interface YearResult {
  readonly world: GameWorldView;
  readonly lowestCash: ReadonlyMap<PromotionId, number>;
}

async function playHardpanYear(overspend: boolean): Promise<YearResult> {
  const lowestCash = new Map<PromotionId, number>();
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
          }
        },
      }),
    ],
  });
  const extra = overspend
    ? [overspendSystem, autofillSystem, cardEveryShowSystem]
    : [autofillSystem, cardEveryShowSystem];
  const engine = createEngine({
    state: startDefaultGame({ player: { mode: 'existing', promotionKey: HARDPAN_KEY } }),
    systems: withMyShowsRun([...defaultSystems, ...extra, watcher]),
  });
  const advanced = await engine.advanceDays({ maxDays: YEAR_DAYS });
  expect(advanced.failures).toEqual([]);
  const world = documentToWorld({ state: { world: engine.exportState().world } }, TABLES);
  return { world, lowestCash };
}

describe.runIf(SLOW_TESTS)('a year as Hardpan (slow)', () => {
  const TIMEOUT_MS = 600_000;

  it(
    'run frugally, ends a little up while its reach grows, and no promotion goes into debt',
    async () => {
      const { world, lowestCash } = await playHardpanYear(false);
      const hardpan = promotionId(HARDPAN_KEY);
      const start = read.tables.promotions.require(hardpan).cash;
      const end = world.tables.promotions.require(hardpan).cash;
      // A little money: up, by less than half the starting cash (+8% when calibrated).
      expect(end).toBeGreaterThan(start);
      expect(end - start).toBeLessThan(0.5 * start);
      expect(reachOf(world, hardpan, TUNABLES).reach.value).toBeGreaterThan(
        reachOf(read, hardpan, TUNABLES).reach.value,
      );
      for (const promotion of world.tables.promotions.values()) {
        expect(lowestCash.get(promotion.id) ?? 0, promotion.name).toBeGreaterThanOrEqual(0);
      }
    },
    TIMEOUT_MS,
  );

  it(
    'overspending on production still loses money',
    async () => {
      const { world } = await playHardpanYear(true);
      const hardpan = promotionId(HARDPAN_KEY);
      expect(world.tables.promotions.require(hardpan).cash).toBeLessThan(
        read.tables.promotions.require(hardpan).cash,
      );
    },
    TIMEOUT_MS,
  );
});
