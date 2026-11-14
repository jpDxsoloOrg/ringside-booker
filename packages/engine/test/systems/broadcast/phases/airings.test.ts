// Airing settlement (ECO8-04) on a real show night: EVT3's shows, ECO1's money and the deals
// together. Design: docs/design/broadcast.md#settlement
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  initialEngineState,
  type Engine,
  type Viewer,
} from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import { defineSystem, type SystemBundle } from '../../../../src/core/api/system';
import { addDays, type GameDate } from '../../../../src/core/date';
import type { DealId, EventInstanceId, PromotionId } from '../../../../src/core/ids';
import type { DomainEventMap } from '../../../../src/core/events/types';
import { cents, negate } from '../../../../src/core/money';
import { definePhase } from '../../../../src/core/pipeline/phase';
import { isFullTrace } from '../../../../src/core/trace';
import type { Airing } from '../../../../src/model/entities/airing';
import type { DealTerms } from '../../../../src/model/entities/deal';
import type { LedgerEntry } from '../../../../src/model/entities/ledger-entry';
import type { NetworkKind } from '../../../../src/model/entities/network';
import type { GameWorld } from '../../../../src/model/tables';
import {
  AIRING_TRACE_KIND,
  airingOutcomeOf,
  airingsDueOn,
  broadcastSystem,
  RIVAL_AIRING_TRACE_KIND,
  settleAiringsPhase,
} from '../../../../src/systems/broadcast';
import { financeSystem } from '../../../../src/systems/finance';
import { matchSystem } from '../../../../src/systems/match';
import { showsSystem } from '../../../../src/systems/shows';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { withMyShowsRun } from '../../../support';
import { aDeal, aNetwork } from '../../../support/builders/media';
import { expectTraceReplays } from '../../../support/trace';
import { worldBuilder } from '../../../support/world-builder';
import {
  OMNISCIENT,
  PLAYER_ONE,
  runsAllButUnrun,
  showNightWorld,
  TODAY,
  type ShowNightWorld,
} from '../../shows/show-night-world';

const TUNABLES = createEngineTunables();

const AS_PLAYER: Viewer = { kind: 'controller', controller: PLAYER_ONE };

const TERMS: DealTerms = {
  feePerShow: cents(100_000),
  perThousandViewers: cents(5_000),
  costPerShow: cents(30_000),
};

function mustWrite(world: GameWorld, label: string, body: Parameters<GameWorld['transact']>[1]) {
  const result = world.transact(label, body);
  if (!result.ok) throw result.error;
}

function promotionId(world: GameWorld, name: string): PromotionId {
  const found = world.tables.promotions.values().find((row) => row.name === name);
  if (found === undefined) throw new Error(`No promotion ${name}`);
  return found.id;
}

interface DealWorld extends ShowNightWorld {
  readonly promotionA: PromotionId;
  readonly promotionB: PromotionId;
  readonly deals: Readonly<Record<'tv' | 'ppv' | 'streaming' | 'rival', DealId>>;
}

/**
 * The show night world with a TV channel, a pay-per-view provider and a streaming service covering
 * the whole map. Promotion A (the player) has a promotion-wide deal on each; its human show is a
 * major show, so all three air it. Promotion B (a rival) has a TV deal.
 */
function dealWorld(options: { readonly tapedDays?: number } = {}): DealWorld {
  const built = showNightWorld();
  const { world } = built;
  const promotionA = promotionId(world, 'Test Promotion A');
  const promotionB = promotionId(world, 'Test Promotion B');
  const regionIds = [...world.tables.regions.ids()];
  const deals: Partial<Record<keyof DealWorld['deals'], DealId>> = {};
  mustWrite(world, 'networks and deals', (tx) => {
    const network = (name: string, kind: NetworkKind) =>
      tx.insert(
        'networks',
        aNetwork({
          id: tx.mintId('networks'),
          name,
          kind,
          reachTier: 1,
          coverage: { continentIds: [], countryIds: [], regionIds },
        }),
      ).id;
    const deal = (networkId: ReturnType<typeof network>, promotion: PromotionId) =>
      tx.insert(
        'deals',
        aDeal({
          id: tx.mintId('deals'),
          networkId,
          promotionId: promotion,
          startsOn: addDays(TODAY, -30),
          endsOn: addDays(TODAY, 300),
          live: false,
          terms: TERMS,
        }),
      ).id;
    const tv = network('Test Channel', 'tv');
    deals.tv = deal(tv, promotionA);
    deals.ppv = deal(network('Test Pay-Per-View', 'ppv'), promotionA);
    deals.streaming = deal(network('Test Stream', 'streaming'), promotionA);
    deals.rival = deal(tv, promotionB);
    if (built.human !== null) {
      const human = built.human;
      tx.update('eventInstances', human, {
        importance: 'major',
        airDate: addDays(TODAY, options.tapedDays ?? 0),
      });
    }
  });
  const { tv, ppv, streaming, rival } = deals;
  if (tv === undefined || ppv === undefined || streaming === undefined || rival === undefined) {
    throw new Error('The deal world is missing a deal');
  }
  return { ...built, promotionA, promotionB, deals: { tv, ppv, streaming, rival } };
}

const SYSTEMS: SystemBundle[] = [
  simSystem,
  matchSystem,
  showsSystem,
  financeSystem,
  broadcastSystem,
];

function engineFor(world: GameWorld, extra: SystemBundle[] = []): Engine {
  return createEngine({
    state: initialEngineState(world),
    systems: withMyShowsRun([...SYSTEMS, ...extra], runsAllButUnrun),
  });
}

async function advance(engine: Engine, days = 1): Promise<void> {
  const advanced = await engine.advanceDays({ maxDays: days });
  expect(advanced.failures).toEqual([]);
  expect(advanced.daysAdvanced).toBe(days);
}

function tablesOf(engine: Engine) {
  return engine.exportState().world.tables;
}

function airingsOf(engine: Engine, eventInstanceId: EventInstanceId | null): Airing[] {
  return tablesOf(engine).airings.filter((row) => row.eventInstanceId === eventInstanceId);
}

function ledgerFor(engine: Engine, eventInstanceId: EventInstanceId): LedgerEntry[] {
  return tablesOf(engine).ledgerEntries.filter(
    (row) => row.refs.eventInstanceId === eventInstanceId && row.refs.dealId !== null,
  );
}

function recentEvents(engine: Engine, type: 'broadcast.aired' | 'broadcast.missed') {
  const result = engine.query('sim.recentEvents', { limit: 10_000, types: [type] }, OMNISCIENT);
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result.data;
}

function airedEvents(engine: Engine): DomainEventMap['broadcast.aired'][] {
  return recentEvents(engine, 'broadcast.aired').flatMap((event) =>
    event.type === 'broadcast.aired' ? [event.payload] : [],
  );
}

function missedEvents(engine: Engine): DomainEventMap['broadcast.missed'][] {
  return recentEvents(engine, 'broadcast.missed').flatMap((event) =>
    event.type === 'broadcast.missed' ? [event.payload] : [],
  );
}

function cashOf(engine: Engine, id: PromotionId): number {
  const promotion = tablesOf(engine).promotions.find((row) => row.id === id);
  if (promotion === undefined) throw new Error('No promotion');
  return promotion.cash;
}

function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${what}`);
  return value;
}

describe('broadcast.airings on show night', () => {
  it('settles each deal on a completed show once: viewers, income, airtime and the seam', async () => {
    const built = dealWorld();
    const human = need(built.human, 'human show');
    const engine = engineFor(built.world);
    const cashBefore = cashOf(engine, built.promotionA);
    await advance(engine);

    const show = need(
      tablesOf(engine).eventInstances.find((row) => row.id === human),
      'the show',
    );
    const airings = airingsOf(engine, human);
    expect(airings.map((row) => row.dealId).sort()).toEqual(
      [built.deals.tv, built.deals.ppv, built.deals.streaming].sort(),
    );
    const ledger = ledgerFor(engine, human);
    for (const airing of airings) {
      expect(airing.status).toBe('aired');
      expect(airing.quality).toEqual({ score: show.result?.score, source: 'show' });
      expect(airing.expectedViewers).toBeGreaterThan(0);
      // The per-thousand money uses the rolled viewers.
      expect(airing.income).toBe(
        TERMS.feePerShow + Math.floor((TERMS.perThousandViewers * airing.viewers) / 1_000),
      );
      expect(airing.sharesPaid).toBe(0);
      expect(airing.cost).toBe(TERMS.costPerShow);
      const rows = ledger.filter((row) => row.refs.dealId === airing.dealId);
      const network = tablesOf(engine).networks.find((row) => row.id === airing.networkId);
      const category = { tv: 'broadcast', ppv: 'ppv', streaming: 'streaming' }[
        need(network, 'network').kind
      ];
      expect(rows.map((row) => [row.category, row.amount]).sort()).toEqual(
        [
          [category, airing.income - airing.sharesPaid],
          ['production', negate(airing.cost)],
        ].sort(),
      );
      expect(airing.traceRef?.kind).toBe(AIRING_TRACE_KIND);
    }
    // Several deals on one show add up their viewers on its result.
    expect(show.result?.viewers).toBe(airings.reduce((sum, row) => sum + row.viewers, 0));
    // ECO1's seam: the cash moved by exactly the day's ledger rows.
    const today = tablesOf(engine).ledgerEntries.filter(
      (row) => row.promotionId === built.promotionA && row.date === TODAY,
    );
    expect(cashOf(engine, built.promotionA) - cashBefore).toBe(
      today.reduce((sum, row) => sum + row.amount, 0),
    );
    expect(airedEvents(engine).filter((event) => event.eventInstanceId === human)).toHaveLength(3);
  });

  it('records a show left unrun as a missed airing that pays nothing and counts against the deal', async () => {
    const built = dealWorld();
    const unrun = need(built.unrun, 'unrun show');
    const engine = engineFor(built.world);
    await advance(engine);
    // A regular show: the TV and streaming deals were due to air it, pay-per-view was not.
    const airings = airingsOf(engine, unrun);
    expect(airings.map((row) => row.dealId).sort()).toEqual(
      [built.deals.tv, built.deals.streaming].sort(),
    );
    for (const airing of airings) {
      expect(airing).toMatchObject({
        status: 'missed',
        missReason: 'notRun',
        quality: null,
        viewers: 0,
        income: 0,
        sharesPaid: 0,
        cost: 0,
      });
      expect(airing.expectedViewers).toBeGreaterThan(0);
    }
    expect(ledgerFor(engine, unrun)).toEqual([]);
    expect(
      missedEvents(engine)
        .filter((event) => event.eventInstanceId === unrun)
        .map((event) => event.reason),
    ).toEqual(['notRun', 'notRun']);
    const rows = engine.query('broadcast.airings', { promotionId: built.promotionA }, AS_PLAYER);
    if (!rows.ok) throw new Error('broadcast.airings refused');
    expect(rows.data.filter((row) => row.eventInstanceId === unrun).map((row) => row.note)).toEqual(
      ["The show didn't run: nothing aired", "The show didn't run: nothing aired"],
    );
    // Deal health counts it like a cancelled show: the TV deal is at least Watch.
    const deals = engine.query(
      'broadcast.deals',
      { promotionId: built.promotionA, include: 'active' },
      AS_PLAYER,
    );
    if (!deals.ok) throw new Error('broadcast.deals refused');
    const tv = need(
      deals.data.find((row) => row.dealId === built.deals.tv),
      'TV deal row',
    );
    expect(tv.risk).not.toBe('safe');
    expect(tv.riskReasons.join(' ')).toContain('missed airing');
  });

  it('records a cancelled show as a missed airing that pays nothing', async () => {
    const built = dealWorld();
    const cancelled = need(built.cancelled, 'cancelled show');
    const engine = engineFor(built.world);
    await advance(engine);
    const airings = airingsOf(engine, cancelled);
    expect(airings).toHaveLength(2);
    for (const airing of airings) {
      expect(airing).toMatchObject({
        status: 'missed',
        missReason: 'showCancelled',
        quality: null,
        viewers: 0,
        income: 0,
        cost: 0,
      });
      expect(airing.expectedViewers).toBeGreaterThan(0);
      const trace = engine.query('trace.get', { ref: need(airing.traceRef, 'ref') }, OMNISCIENT);
      expect(trace.ok && trace.data !== null && isFullTrace(trace.data)).toBe(true);
    }
    expect(ledgerFor(engine, cancelled)).toEqual([]);
    expect(
      missedEvents(engine)
        .filter((event) => event.eventInstanceId === cancelled)
        .map((event) => [event.eventInstanceId, event.reason]),
    ).toEqual([
      [cancelled, 'showCancelled'],
      [cancelled, 'showCancelled'],
    ]);
  });

  it('settles rivals under the same rules, with their own trace kind', async () => {
    const built = dealWorld();
    const engine = engineFor(built.world);
    await advance(engine);
    const rival = tablesOf(engine).airings.filter((row) => row.promotionId === built.promotionB);
    expect(rival.map((row) => row.eventInstanceId).sort()).toEqual(
      [...built.rivalBare, built.rivalCard].sort(),
    );
    for (const airing of rival) {
      expect(airing.status).toBe('aired');
      expect(airing.quality?.source).toBe('show');
      expect(airing.traceRef?.kind).toBe(RIVAL_AIRING_TRACE_KIND);
    }
    const ledger = tablesOf(engine).ledgerEntries.filter(
      (row) => row.promotionId === built.promotionB && row.refs.dealId === built.deals.rival,
    );
    expect(ledger.map((row) => row.category).sort()).toEqual([
      'broadcast',
      'broadcast',
      'production',
      'production',
    ]);
    // Viewers are public, money is not.
    const asPlayer = engine.query(
      'broadcast.airings',
      { promotionId: built.promotionB },
      AS_PLAYER,
    );
    if (!asPlayer.ok) throw new Error('broadcast.airings refused');
    expect(asPlayer.data).toHaveLength(2);
    expect(asPlayer.data.every((row) => row.income === null && row.cost === null)).toBe(true);
    expect(asPlayer.data.every((row) => row.traceRef === null && row.net === null)).toBe(true);
    expect(
      engine.query('broadcast.incomeSummary', { promotionId: built.promotionB }, AS_PLAYER).ok,
    ).toBe(false);
  });

  it('never pays twice when the phase runs again on the same day', async () => {
    const built = dealWorld();
    const again = defineSystem({
      id: 'testSecondPass',
      phases: [
        definePhase({
          id: 'testSecondPass.airings',
          group: 'settlement',
          order: 41,
          cadence: { kind: 'daily' },
          run: (ctx) => {
            settleAiringsPhase.run(ctx);
          },
        }),
      ],
    });
    const once = engineFor(dealWorld().world);
    const twice = engineFor(built.world, [again]);
    await advance(once);
    await advance(twice);
    expect(tablesOf(twice).airings).toEqual(tablesOf(once).airings);
    expect(tablesOf(twice).ledgerEntries).toEqual(tablesOf(once).ledgerEntries);
  });

  it('pays workers their broadcast shares, capped at the most shares can take', async () => {
    const built = dealWorld();
    const human = need(built.human, 'human show');
    // The first two workers on the card: one on 2%, one on 80%.
    mustWrite(built.world, 'shares', (tx) => {
      for (const [index, bp] of [
        [0, 200],
        [1, 8_000],
      ] as const) {
        const personId = need(built.roster[index], 'worker');
        const contract = tx.view.tables.employments
          .lookup('byPerson', personId)
          .find((row) => row.promotionId === built.promotionA);
        if (contract === undefined) throw new Error('No contract');
        tx.update('employments', contract.id, {
          terms: { ...contract.terms, shares: { ...contract.terms.shares, broadcastBp: bp } },
        });
      }
    });
    const engine = engineFor(built.world);
    await advance(engine);
    for (const airing of airingsOf(engine, human)) {
      const cap = Math.floor(airing.income * TUNABLES.get('broadcast.shares.maxTotal'));
      expect(airing.sharesPaid).toBe(cap);
      const income = ledgerFor(engine, human).find(
        (row) => row.refs.dealId === airing.dealId && row.amount > 0,
      );
      expect(income?.amount).toBe(airing.income - airing.sharesPaid);
    }
  });

  it('stores a Why? that replays, shows the viewers working and the deal terms', async () => {
    const built = dealWorld();
    const human = need(built.human, 'human show');
    const engine = engineFor(built.world);
    await advance(engine);
    const airing = need(
      airingsOf(engine, human).find((row) => row.dealId === built.deals.tv),
      'TV airing',
    );
    const stored = engine.query('trace.get', { ref: need(airing.traceRef, 'ref') }, AS_PLAYER);
    if (!stored.ok || stored.data === null || !isFullTrace(stored.data)) {
      throw new Error('No airing trace');
    }
    const traced = { value: Number(stored.data.value), trace: stored.data.trace };
    expectTraceReplays(traced);
    expect(traced.value).toBe(airing.income - airing.sharesPaid - airing.cost);
    const labels = JSON.stringify(stored.data.trace);
    expect(labels).toContain('Fee per show');
    expect(labels).toContain('Per 1,000 viewers');
    expect(labels).toContain('Viewers on Test Channel');
    expect(labels).toContain('Test Channel expected');
    // The quality line is EVT3's real show score (ECO8-07).
    const score = need(
      tablesOf(engine).eventInstances.find((row) => row.id === human)?.result?.score,
      'score',
    );
    expect(labels).toContain(`Show score ${String(score)} (slot-weighted)`);
    // Each ledger row's Why? replays to its amount too.
    for (const row of ledgerFor(engine, human)) {
      const rowTrace = engine.query('trace.get', { ref: need(row.traceRef, 'ref') }, AS_PLAYER);
      if (!rowTrace.ok || rowTrace.data === null || !isFullTrace(rowTrace.data)) {
        throw new Error('No ledger trace');
      }
      expectTraceReplays({ value: row.amount, trace: rowTrace.data.trace });
    }
  });

  it('pays a taped show on its air date, not its taping day', async () => {
    const built = dealWorld({ tapedDays: 2 });
    const human = need(built.human, 'human show');
    const engine = engineFor(built.world);
    await advance(engine);
    expect(airingsOf(engine, human)).toEqual([]);
    await advance(engine, 2);
    const airings = airingsOf(engine, human);
    expect(airings).toHaveLength(3);
    for (const airing of airings) {
      expect(airing.airDate).toBe(addDays(TODAY, 2));
      expect(airing.quality?.source).toBe('show');
    }
    expect(ledgerFor(engine, human).every((row) => row.date === addDays(TODAY, 2))).toBe(true);
  });
});

describe('the player running the show segment by segment (EVT10)', () => {
  it('settles the airings when the last segment completes, once', async () => {
    const built = dealWorld();
    const human = need(built.human, 'human show');
    // The stand-in player runs nothing: the show is run by commands, as on the live show screen.
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: withMyShowsRun(SYSTEMS, () => false),
    });
    for (let guard = 0; guard < 20; guard += 1) {
      const step = engine.command('shows.runNextSegment', { eventInstanceId: human }, PLAYER_ONE);
      if (!step.ok) throw new Error(JSON.stringify(step.reasons));
      if (step.data.finished) break;
      expect(airingsOf(engine, human)).toEqual([]);
    }
    const settled = airingsOf(engine, human);
    expect(settled).toHaveLength(3);
    const show = need(
      tablesOf(engine).eventInstances.find((row) => row.id === human),
      'show',
    );
    expect(show.result?.viewers).toBe(settled.reduce((sum, row) => sum + row.viewers, 0));
    const view = engine.query('broadcast.showAiring', { eventInstanceId: human }, AS_PLAYER);
    if (!view.ok) throw new Error('broadcast.showAiring refused');
    expect(view.data.airing?.status).toBe('aired');
    expect(view.data.deals).toHaveLength(3);
    // One row per deal, with the money and the Why? for the promotion's own player.
    expect(view.data.airings.map((row) => row.dealId).sort()).toEqual(
      settled.map((row) => row.dealId).sort(),
    );
    expect(view.data.airings.every((row) => row.income !== null && row.traceRef !== null)).toBe(
      true,
    );
    expect(view.data.airing?.expectedViewers).toBe(
      settled.reduce((sum, row) => sum + row.expectedViewers, 0),
    );
    // Anyone else sees the viewers, never the money.
    const asRival = engine.query(
      'broadcast.showAiring',
      { eventInstanceId: human },
      { kind: 'controller', controller: { kind: 'human', playerId: 'player-2' } },
    );
    if (!asRival.ok) throw new Error('broadcast.showAiring refused');
    expect(asRival.data.airing?.income).toBeNull();
    expect(asRival.data.airings.every((row) => row.income === null && row.traceRef === null)).toBe(
      true,
    );

    await advance(engine);
    expect(airingsOf(engine, human)).toEqual(settled);
    expect(ledgerFor(engine, human)).toHaveLength(6);
  });
});

describe('the definition fallback (no calendar)', () => {
  it('airs a weekly show on its recurrence dates with neutral quality', async () => {
    const { world, ids } = worldBuilder()
      .withGeography('mini')
      .withNetwork({ name: 'Test TV', kind: 'tv' })
      .withPromotion({}, (promotion) => {
        promotion.withWeeklyShow({ name: 'Test Weekly', weekdays: [0] });
        promotion.withDeal({ network: 0, show: 'Test Weekly', terms: TERMS });
      })
      .build();
    const engine = createEngine({
      state: initialEngineState(world),
      systems: [simSystem, financeSystem, broadcastSystem],
    });
    const start: GameDate = world.meta.currentDate;
    await advance(engine, 14);
    const airings = tablesOf(engine).airings;
    expect(airings.length).toBe(2);
    for (const airing of airings) {
      expect(airing.eventInstanceId).toBeNull();
      expect(airing.eventDefinitionId).toBe(ids.eventDefinitions[0]);
      expect(airing.quality?.source).toBe('neutral');
      expect(airing.airDate >= start).toBe(true);
    }
    const due = airingsDueOn(world, start);
    for (const item of due) {
      expect(airingOutcomeOf(item, TUNABLES)).toMatchObject({ status: 'aired' });
    }
  });
});
