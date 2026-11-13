// MTCH4 on show night (MTCH4-04): `shows.runShows` applies every run match's physical toll through
// the `match.physicalToll` result applier (order 40), on the player's shows and on rival shows, and
// `match.physicalForSegment` reads it back. The player's full traces are demoted after
// `history.keepDetailDays`. Design: docs/design/physical-toll.md#show-night
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import { parseContentKey } from '../../../../src/core/content-key';
import { parseGameDate } from '../../../../src/core/date';
import type { EventInstanceId, PersonId, SegmentId } from '../../../../src/core/ids';
import { refKey } from '../../../../src/core/trace/store';
import type { EventInstance } from '../../../../src/model/entities/event-instance';
import type { GameWorld } from '../../../../src/model/tables';
import {
  MatchDraftSchema,
  type MatchDraft,
  type ParticipantDraft,
} from '../../../../src/systems/booking';
import { healthSystem } from '../../../../src/systems/health';
import {
  PHYSICAL_TOLL_APPLIER_ID,
  PHYSICAL_TOLL_APPLIER_ORDER,
  SEGMENT_INJURIES_NOT_FOUND,
  fatigueTraceRef,
  injuryChanceTraceRef,
  matchSystem,
  registerRiskModifier,
  weeksOutOf,
  type PhysicalForSegmentResult,
  type SegmentInjuriesResult,
} from '../../../../src/systems/match';
import { listSegmentResultAppliers, showsSystem } from '../../../../src/systems/shows';
import { workersSystem } from '../../../../src/systems/workers';
import { anEventInstance, withMyShowsRun, worldBuilder } from '../../../support';
import type { DeepPartial } from '../../../support/builders/build-row';
import { seed } from '../../booking/command-world';
import { OMNISCIENT, PLAYER_ONE } from '../../calendar/lifecycle-world';

const START = '2026-01-05';
const TODAY = parseGameDate('2026-01-06');

function competitor(personId: PersonId, side: number): ParticipantDraft {
  return { personId, side, role: 'competitor', teamId: null };
}

function singles(left: PersonId, right: PersonId): MatchDraft {
  return MatchDraftSchema.parse({
    kind: 'match',
    label: null,
    match: { matchTypeKey: parseContentKey('match.singles') },
    participants: [competitor(left, 0), competitor(right, 1)],
    outcome: { kind: 'win', winningSide: 0, methodKey: parseContentKey('method.pinfall') },
  });
}

interface NightWorld {
  readonly world: GameWorld;
  readonly opener: SegmentId;
  readonly rematch: SegmentId;
  readonly rivalMatch: SegmentId;
  readonly roster: readonly PersonId[];
  readonly rivals: readonly PersonId[];
}

/**
 * Promotion A (human) runs one show today: 0 v 1 in slot 1 and 1 v 2 in slot 2, so 1 works twice.
 * Promotion B (computer) runs one with 0 v 1 of its own.
 */
function nightWorld(options: { injuryCatalog?: boolean } = {}): NightWorld {
  let shows: { show: EventInstanceId; rival: EventInstanceId } | undefined;
  const fresh = { fatigue: 0, development: { potential: 900, ceilings: {} } };
  const builder = worldBuilder({
    startDate: START,
    currentDate: TODAY,
    players: [{ playerId: 'player-1', displayName: 'Test Player 1' }],
  }).withCatalogs();
  if (options.injuryCatalog === true) builder.withInjuryCatalog();
  const { world, ids } = builder
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion.withRoster(3, { person: () => fresh }),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) =>
      promotion.withRoster(2, { person: () => fresh }),
    )
    .with('shows', (context) => {
      const promotionA = context.ids.promotions.A;
      const promotionB = context.ids.promotions.B;
      const [regionId] = context.ids.regions;
      if (promotionA === undefined || promotionB === undefined || regionId === undefined) {
        throw new Error('missing a promotion');
      }
      const add = (overrides: DeepPartial<EventInstance>): EventInstanceId =>
        context.insert(
          'eventInstances',
          anEventInstance(
            { promotionId: promotionA, regionId, date: TODAY, ...overrides },
            context.sequence,
          ),
        ).id;
      shows = {
        show: add({ name: 'Test Human Show', format: { slots: 3, preShowSlots: 0 } }),
        rival: add({ name: 'Test Rival Show', promotionId: promotionB }),
      };
    })
    .build();
  if (shows === undefined) throw new Error('built without shows');
  const at = (list: readonly PersonId[], index: number): PersonId => {
    const id = list[index];
    if (id === undefined) throw new Error(`no person ${String(index)}`);
    return id;
  };
  const roster = ids.people.slice(0, 3);
  const rivals = ids.people.slice(3, 5);
  return {
    world,
    opener: seed(world, shows.show, 0, singles(at(roster, 0), at(roster, 1))),
    rematch: seed(world, shows.show, 1, singles(at(roster, 1), at(roster, 2))),
    rivalMatch: seed(world, shows.rival, 0, singles(at(rivals, 0), at(rivals, 1))),
    roster,
    rivals,
  };
}

function engineOn(
  world: GameWorld,
  options: { health?: boolean; tunableOverrides?: Record<string, number> } = {},
): Engine {
  const systems = [simSystem, workersSystem, matchSystem, showsSystem];
  return createEngine({
    state: { ...initialEngineState(world), tunableOverrides: options.tunableOverrides ?? {} },
    systems: withMyShowsRun(options.health === true ? [...systems, healthSystem] : systems),
  });
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function physicalFor(engine: Engine, segmentId: SegmentId): PhysicalForSegmentResult {
  const result = engine.query('match.physicalForSegment', { segmentId }, OMNISCIENT);
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result.data;
}

function fatigueOf(engine: Engine, personId: PersonId): number {
  const row = engine.exportState().world.tables.people.find((person) => person.id === personId);
  if (row === undefined) throw new Error(`no person ${personId}`);
  return row.fatigue;
}

describe('the physical toll on show night', () => {
  it('is registered at order 40, after the aftermath', () => {
    const applier = listSegmentResultAppliers().find(
      (entry) => entry.id === PHYSICAL_TOLL_APPLIER_ID,
    );
    expect(applier?.order).toBe(PHYSICAL_TOLL_APPLIER_ORDER);
    expect(PHYSICAL_TOLL_APPLIER_ORDER).toBe(40);
  });

  it("tires every competitor on the player's show and on a rival's, with refs to each Why?", async () => {
    const built = nightWorld();
    const engine = engineOn(built.world);
    const advanced = await engine.advanceDays({ maxDays: 1 });
    expect(advanced.failures).toEqual([]);

    for (const personId of [...built.roster, ...built.rivals]) {
      expect(fatigueOf(engine, personId), personId).toBeGreaterThan(0);
    }

    const opener = physicalFor(engine, built.opener);
    expect(opener.applied).toBe(true);
    expect(opener.workers.map((worker) => worker.personId)).toEqual(built.roster.slice(0, 2));
    for (const worker of opener.workers) {
      for (const value of [
        worker.fatigueGain,
        worker.fatigueAfter,
        worker.wearTotal,
        worker.learning,
        worker.injuryChance,
      ]) {
        expect(value.traceRef).not.toBeNull();
        expect(value.value).not.toBeNull();
      }
      expect(worker.fatigueGain.value).toBeGreaterThan(0);
    }

    // The worker in both matches ends where the second match's trace says.
    const twice = built.roster[1];
    if (twice === undefined) throw new Error('no worker 1');
    const rematch = physicalFor(engine, built.rematch).workers.find(
      (worker) => worker.personId === twice,
    );
    expect(rematch?.fatigueAfter.value).toBe(fatigueOf(engine, twice));

    // A rival show keeps a summary of fatigue only: no wear, no learning (MTCH4-06, save size).
    const rival = physicalFor(engine, built.rivalMatch);
    for (const worker of rival.workers) {
      expect(worker.fatigueAfter.traceRef).not.toBeNull();
      expect(worker.fatigueGain.value).toBeGreaterThan(0);
      expect(worker.wearTotal).toEqual({ value: null, traceRef: null });
      expect(worker.learning).toEqual({ value: null, traceRef: null });
    }
  });

  it("demotes the player's full traces once they are older than history.keepDetailDays", async () => {
    const built = nightWorld();
    const engine = engineOn(built.world);
    await engine.advanceDays({ maxDays: 1 });
    const personId = built.roster[0];
    if (personId === undefined) throw new Error('no worker 0');
    const key = refKey(fatigueTraceRef(built.opener, personId));
    const isFull = (): boolean =>
      engine.exportState().traces.full.some((entry) => refKey(entry.ref) === key);
    expect(isFull()).toBe(true);

    // The day 28 days after the show demotes it (the same window as rival card detail).
    await engine.advanceDays({ maxDays: 27 });
    expect(isFull()).toBe(true);
    await engine.advanceDays({ maxDays: 1 });
    expect(isFull()).toBe(false);
    expect(physicalFor(engine, built.opener).workers[0]?.fatigueAfter.traceRef).not.toBeNull();
  });

  it('lists the injuries a show caused, with weeks out and both Why? refs (match.segmentInjuries)', async () => {
    cleanups.push(
      registerRiskModifier({
        id: 'test.certainInjury',
        order: 0,
        contribute: () => [{ source: 'Test: certain injury', personIds: null, injuryAdd: 1 }],
      }),
    );
    const built = nightWorld({ injuryCatalog: true });
    const engine = engineOn(built.world, {
      health: true,
      tunableOverrides: { 'match.injury.maxChance': 1 },
    });
    const advanced = await engine.advanceDays({ maxDays: 1 });
    expect(advanced.failures).toEqual([]);

    const show = engine
      .exportState()
      .world.tables.segments.find((segment) => segment.id === built.opener)?.eventInstanceId;
    if (show === undefined) throw new Error('no show');
    const result = engine.query('match.segmentInjuries', { eventInstanceId: show }, OMNISCIENT);
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    const { injuries }: SegmentInjuriesResult = result.data;
    const rows = engine.exportState().world.tables.injuries;
    expect(injuries.length).toBeGreaterThan(0);
    expect(injuries.length).toBe(
      rows.filter(
        (row) =>
          row.source === 'segment' &&
          [built.opener, built.rematch].includes(row.segmentId ?? ('' as SegmentId)),
      ).length,
    );
    // The opener comes first: card order.
    expect(injuries[0]?.segmentId).toBe(built.opener);
    for (const injury of injuries) {
      const row = rows.find((entry) => entry.id === injury.injuryId);
      expect(row?.personId).toBe(injury.personId);
      expect(injury.weeksOut).toBe(weeksOutOf(TODAY, injury.expectedReturn));
      expect(injury.weeksOut).toBeGreaterThanOrEqual(1);
      expect(injury.kindLabel).not.toMatch(/^injury\./u);
      expect(injury.chance).toBeGreaterThan(0);
      expect(injury.chanceTraceRef).toEqual(
        injuryChanceTraceRef(injury.segmentId, injury.personId),
      );
      expect(injury.injuryTraceRef).not.toBeNull();
    }

    const missing = engine.query(
      'match.segmentInjuries',
      { eventInstanceId: 'evi_zzzzzzzzzz' as EventInstanceId },
      OMNISCIENT,
    );
    expect(missing.ok ? null : missing.reasons[0]?.message).toBe(SEGMENT_INJURIES_NOT_FOUND);
  });

  it('works out weeks out from the show date, rounding up and never below one', () => {
    expect(weeksOutOf(TODAY, TODAY)).toBe(1);
    expect(weeksOutOf(TODAY, parseGameDate('2026-01-13'))).toBe(1);
    expect(weeksOutOf(TODAY, parseGameDate('2026-01-14'))).toBe(2);
  });
});
