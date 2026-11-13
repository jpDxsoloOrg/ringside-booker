// The box office settlement (EVT6-05) on a real show night: EVT3's shows, ECO1's money and the
// box office together. Design: docs/design/box-office.md#settlement
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine, type Viewer } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { defineSystem } from '../../../src/core/api/system';
import type { DomainEventMap } from '../../../src/core/events/types';
import { addDays } from '../../../src/core/date';
import type { EventInstanceId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import { TABLES, type GameWorld } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import {
  BOX_OFFICE_CATEGORIES,
  boxOfficeSystem,
  recentFormOf,
  settleShow,
  showsToSettle,
} from '../../../src/systems/boxOffice';
import { financeSystem } from '../../../src/systems/finance';
import { matchSystem } from '../../../src/systems/match';
import { showsSystem } from '../../../src/systems/shows';
import { createEngineTunables } from '../../../src/systems/tunables';
import { anEventInstance, TEST_PLAYER_ID, withMyShowsRun } from '../../support';
import { OMNISCIENT, showNightWorld, TODAY, type ShowNightWorld } from '../shows/show-night-world';

const HUMAN_VIEWER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: TEST_PLAYER_ID },
};

const SYSTEMS = [simSystem, matchSystem, showsSystem, financeSystem, boxOfficeSystem];

function mustWrite(world: GameWorld, label: string, body: Parameters<GameWorld['transact']>[1]) {
  const result = world.transact(label, body);
  if (!result.ok) throw result.error;
}

/**
 * The show night world with two bare rival shows in different local venues, one worker on the
 * player's card on a 10% gate share and a second show of the player's tomorrow.
 */
function settleWorld(): ShowNightWorld & { readonly tomorrow: EventInstanceId } {
  const built = showNightWorld({ bareRivalShows: 2 });
  const [first, second] = built.rivalBare;
  if (built.human === null || first === undefined || second === undefined) {
    throw new Error('The show night world is missing a show');
  }
  const human = built.world.tables.eventInstances.require(built.human);
  mustWrite(built.world, 'venues and shares', (tx) => {
    tx.update('eventInstances', first, { genericVenue: { tier: 'hall', capacity: 1_200 } });
    tx.update('eventInstances', second, { genericVenue: { tier: 'room', capacity: 150 } });
    const worker = tx.view.tables.participants
      .values()
      .find((participant) =>
        tx.view.tables.segments
          .lookup('byEventInstance', human.id)
          .some((segment) => segment.id === participant.segmentId),
      );
    const contract = tx.view.tables.employments
      .values()
      .find(
        (employment) =>
          employment.personId === worker?.personId && employment.promotionId === human.promotionId,
      );
    if (contract === undefined) throw new Error('No contract on the card');
    tx.update('employments', contract.id, {
      terms: { ...contract.terms, shares: { ...contract.terms.shares, gateBp: 1_000 } },
    });
  });
  let tomorrow: EventInstanceId | undefined;
  mustWrite(built.world, 'tomorrow', (tx) => {
    tomorrow = tx.insert(
      'eventInstances',
      anEventInstance({
        id: tx.mintId('eventInstances'),
        name: 'Test Tomorrow Show',
        promotionId: human.promotionId,
        regionId: human.regionId,
        date: addDays(TODAY, 1),
        airDate: addDays(TODAY, 1),
      }),
    ).id;
  });
  if (tomorrow === undefined) throw new Error('No show tomorrow');
  return { ...built, tomorrow };
}

/** Records what a second settlement pass on the same day finds. */
function secondPassSystem(settledAgain: (EventInstanceId | null)[]) {
  return defineSystem({
    id: 'testSecondPass',
    phases: [
      definePhase({
        id: 'testSecondPass.settleAgain',
        group: 'settlement',
        order: 50,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          for (const show of ctx.read.tables.eventInstances.lookup('byDate', ctx.date)) {
            settledAgain.push(settleShow(ctx, show.id)?.eventInstanceId ?? null);
          }
        },
      }),
    ],
  });
}

/** The engine's world as a read-only view. */
function viewOf(engine: Engine) {
  return documentToWorld({ state: { world: engine.exportState().world } }, TABLES);
}

function settledEvents(engine: Engine): DomainEventMap['show.settled'][] {
  const result = engine.query(
    'sim.recentEvents',
    { limit: 10_000, types: ['show.settled'] },
    OMNISCIENT,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result.data.flatMap((event) => (event.type === 'show.settled' ? [event.payload] : []));
}

async function settledDay() {
  const built = settleWorld();
  const settledAgain: (EventInstanceId | null)[] = [];
  const cashBefore = new Map(
    built.world.tables.promotions.values().map((promotion) => [promotion.id, promotion.cash]),
  );
  const engine = createEngine({
    state: initialEngineState(built.world),
    systems: withMyShowsRun(
      [...SYSTEMS, secondPassSystem(settledAgain)],
      (show) => show.id === built.human,
    ),
  });
  const advanced = await engine.advanceDays({ maxDays: 1 });
  expect(advanced.failures).toEqual([]);
  const { world } = engine.exportState();
  return { built, engine, world, cashBefore, settledAgain };
}

describe('boxOffice.settleShows', () => {
  it('settles every show that ran today, never above its capacity', async () => {
    const { built, engine, world } = await settledDay();
    if (built.human === null) throw new Error('No player show');
    const ran = [built.human, built.rivalCard, ...built.rivalBare];
    for (const id of ran) {
      const show = world.tables.eventInstances.find((instance) => instance.id === id);
      expect(show?.status).toBe('completed');
      const crowd = engine.query('boxOffice.showCrowd', { eventInstanceId: id }, OMNISCIENT);
      if (!crowd.ok) throw new Error(JSON.stringify(crowd.reasons));
      expect(crowd.data.status).toBe('settled');
      expect(crowd.data.attendance).toBe(show?.result?.attendance);
      expect(crowd.data.capacity).not.toBeNull();
      expect(crowd.data.attendance ?? Infinity).toBeLessThanOrEqual(crowd.data.capacity ?? 0);
      expect(show?.result?.gate).toBe(
        (show?.result?.ticketPrice ?? NaN) * (show?.result?.attendance ?? NaN),
      );
    }
  });

  it("posts the player's three rows dated today, summing to the net and the cash they moved", async () => {
    const { built, engine, world, cashBefore } = await settledDay();
    const human = built.human;
    if (human === null) throw new Error('No player show');
    const promotionId = built.world.tables.eventInstances.require(human).promotionId;
    const rows = world.tables.ledgerEntries.filter(
      (row) =>
        row.refs.eventInstanceId === human &&
        BOX_OFFICE_CATEGORIES.some((category) => category === row.category),
    );
    expect(rows.map((row) => row.category).sort()).toEqual(['liveMerch', 'tickets', 'venueRent']);
    for (const row of rows) expect(row.date).toBe(TODAY);
    const sum = rows.reduce((total, row) => total + row.amount, 0);

    const money = engine.query('boxOffice.showMoney', { eventInstanceId: human }, HUMAN_VIEWER);
    if (!money.ok) throw new Error(JSON.stringify(money.reasons));
    expect(money.data.net.amount).toBe(sum);
    expect(
      money.data.tickets.amount + money.data.venueRent.amount + money.data.liveMerch.amount,
    ).toBe(sum);
    // The 10% gate share came off the tickets.
    expect(money.data.grossGate.amount).toBeGreaterThan(0);
    expect(money.data.gateShare.amount).toBe(Math.floor(money.data.grossGate.amount / 10));
    expect(money.data.tickets.amount).toBe(
      money.data.grossGate.amount - money.data.gateShare.amount,
    );
    const { data } = money;
    const lines = [
      data.ticketPrice,
      data.grossGate,
      data.gateShare,
      data.tickets,
      data.venueRent,
      data.grossMerch,
      data.merchShare,
      data.liveMerch,
      data.net,
    ];
    for (const line of lines) expect(line.traceRef).not.toBeNull();

    // ECO1's check: the cash moved by exactly the sum of every new row.
    const allRows = world.tables.ledgerEntries.filter((row) => row.promotionId === promotionId);
    const cashAfter = world.tables.promotions.find(
      (promotion) => promotion.id === promotionId,
    )?.cash;
    expect((cashAfter ?? 0) - (cashBefore.get(promotionId) ?? 0)).toBe(
      allRows.reduce((total, row) => total + row.amount, 0),
    );
    const settled = settledEvents(engine).find((event) => event.eventInstanceId === human);
    expect(settled?.net).toBe(sum);
  });

  it('publishes show.settled once per show, and a second pass settles nothing', async () => {
    const { built, engine, settledAgain } = await settledDay();
    const events = settledEvents(engine);
    const ids = events.map((event) => event.eventInstanceId).sort();
    expect(ids).toEqual([built.human, built.rivalCard, ...built.rivalBare].sort());
    expect(settledAgain.length).toBeGreaterThan(0);
    expect(settledAgain.every((id) => id === null)).toBe(true);
  });

  it('never settles a cancelled show or one still waiting to run', async () => {
    const { built, world, engine } = await settledDay();
    for (const id of [built.unrun, built.cancelled]) {
      if (id === null) throw new Error('Missing show');
      const show = world.tables.eventInstances.find((instance) => instance.id === id);
      expect(show?.result?.attendance ?? null).toBeNull();
      expect(world.tables.ledgerEntries.some((row) => row.refs.eventInstanceId === id)).toBe(false);
      expect(settledEvents(engine).some((event) => event.eventInstanceId === id)).toBe(false);
    }
    expect(showsToSettle(viewOf(engine))).toEqual([]);
  });

  it('settles two shows of one promotion on one day each in its own venue', async () => {
    const { built, engine } = await settledDay();
    const capacities = built.rivalBare.map(
      (id) => settledEvents(engine).find((event) => event.eventInstanceId === id)?.capacity,
    );
    expect(capacities).toEqual([1_200, 150]);
  });

  it("keeps a rival's money private but its crowd public, and moves the rival's own ledger", async () => {
    const { built, engine, world } = await settledDay();
    const rival = built.rivalCard;
    const money = engine.query('boxOffice.showMoney', { eventInstanceId: rival }, HUMAN_VIEWER);
    expect(money.ok).toBe(false);
    if (!money.ok)
      expect(money.reasons.map((reason) => reason.code)).toEqual(['boxOffice.privateMoney']);
    const crowd = engine.query('boxOffice.showCrowd', { eventInstanceId: rival }, HUMAN_VIEWER);
    expect(crowd.ok && crowd.data.status).toBe('settled');
    expect(crowd.ok && crowd.data.attendanceTraceRef?.kind).toBe('boxOffice.rivalAttendance');
    const rivalPromotion = built.world.tables.eventInstances.require(rival).promotionId;
    const rows = world.tables.ledgerEntries.filter((row) => row.refs.eventInstanceId === rival);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.promotionId === rivalPromotion)).toBe(true);
    // The omniscient viewer of tools and tests sees it.
    expect(engine.query('boxOffice.showMoney', { eventInstanceId: rival }, OMNISCIENT).ok).toBe(
      true,
    );
  });

  it("counts today's show in tomorrow's recent form, never in its own", async () => {
    const { built, engine } = await settledDay();
    const human = built.human;
    if (human === null) throw new Error('No player show');
    const view = viewOf(engine);
    const tunables = createEngineTunables();
    const promotionId = view.tables.eventInstances.require(human).promotionId;
    const own = recentFormOf(view, {
      promotionId,
      beforeDate: TODAY,
      excludeEventInstanceId: human,
      tunables,
    });
    expect(own.eventInstanceIds).not.toContain(human);
    const next = recentFormOf(view, {
      promotionId,
      beforeDate: addDays(TODAY, 1),
      excludeEventInstanceId: built.tomorrow,
      tunables,
    });
    expect(next.eventInstanceIds).toContain(human);
  });
});

describe("the player's show is settled the moment it runs", () => {
  it('has its crowd and money straight after Run the show, and once only', () => {
    const built = settleWorld();
    const human = built.human;
    if (human === null) throw new Error('No player show');
    const engine = createEngine({ state: initialEngineState(built.world), systems: SYSTEMS });
    const ran = engine.command(
      'shows.runTonight',
      { eventInstanceId: human },
      HUMAN_VIEWER.controller,
    );
    expect(ran.ok).toBe(true);
    const crowd = engine.query('boxOffice.showCrowd', { eventInstanceId: human }, HUMAN_VIEWER);
    expect(crowd.ok && crowd.data.status).toBe('settled');
    expect(crowd.ok && crowd.data.attendanceTraceRef?.kind).toBe('boxOffice.attendance');
    const money = engine.query('boxOffice.showMoney', { eventInstanceId: human }, HUMAN_VIEWER);
    expect(money.ok).toBe(true);
    expect(settledEvents(engine).map((event) => event.eventInstanceId)).toEqual([human]);
  });
});
