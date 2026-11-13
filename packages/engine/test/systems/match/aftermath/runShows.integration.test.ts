// MTCH3 on show night (MTCH3-05): `shows.runShows` applies every run match's aftermath through the
// `match.aftermath` result applier, in card order, so a worker in two matches gets both changes.
// Design: docs/design/match-aftermath.md#integrations and show-night.md#segment-result-appliers
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import { parseContentKey } from '../../../../src/core/content-key';
import { parseGameDate } from '../../../../src/core/date';
import type { EventInstanceId, PersonId, RegionId, SegmentId } from '../../../../src/core/ids';
import type { Aftermath } from '../../../../src/model/entities/aftermath';
import type { MatchOutcome } from '../../../../src/model/entities/segment';
import type { GameWorld } from '../../../../src/model/tables';
import type { SerializedTables } from '../../../../src/persistence/save-document';
import {
  MatchDraftSchema,
  type MatchDraft,
  type ParticipantDraft,
} from '../../../../src/systems/booking';
import { AFTERMATH_APPLIER_ID, matchSystem } from '../../../../src/systems/match';
import {
  listSegmentResultAppliers,
  registerSegmentResultApplier,
  showsSystem,
  unregisterSegmentResultApplier,
} from '../../../../src/systems/shows';
import { workersSystem } from '../../../../src/systems/workers';
import {
  anEventInstance,
  RUN_MY_SHOWS_PHASE_ID,
  withMyShowsRun,
  worldBuilder,
} from '../../../support';
import type { DeepPartial } from '../../../support/builders/build-row';
import type { EventInstance } from '../../../../src/model/entities/event-instance';
import { seed } from '../../booking/command-world';
import { OMNISCIENT, PLAYER_ONE } from '../../calendar/lifecycle-world';
import { NORTH_1, NORTH_2, REGIONS, SOUTH_1, SOUTH_2 } from './fixtures';

const START = '2026-01-05';
const TODAY = parseGameDate('2026-01-06');
const PINFALL = parseContentKey('method.pinfall');
const THROWING_APPLIER_ID = 'test.throwAfterAftermath';

afterEach(() => {
  unregisterSegmentResultApplier(THROWING_APPLIER_ID);
});

function competitor(personId: PersonId, side: number): ParticipantDraft {
  return { personId, side, role: 'competitor', teamId: null };
}

function match(
  matchType: string,
  sides: readonly (readonly PersonId[])[],
  outcome: MatchOutcome | null,
): MatchDraft {
  return MatchDraftSchema.parse({
    kind: 'match',
    label: null,
    match: { matchTypeKey: parseContentKey(matchType) },
    participants: sides.flatMap((people, side) =>
      people.map((personId) => competitor(personId, side)),
    ),
    outcome,
  });
}

const winFor = (side: number): MatchOutcome => ({
  kind: 'win',
  winningSide: side,
  methodKey: PINFALL,
});

function everywhere(value: number): Record<RegionId, number> {
  return Object.fromEntries(REGIONS.map((region) => [region, value]));
}

interface IntegrationWorld {
  readonly world: GameWorld;
  readonly show: EventInstanceId;
  readonly rivalCard: EventInstanceId;
  readonly rivalBare: EventInstanceId;
  /** Promotion A's card in running order: singles, no contest, tag. */
  readonly singles: SegmentId;
  readonly noContest: SegmentId;
  readonly tag: SegmentId;
  readonly rivalMatch: SegmentId;
  readonly roster: readonly PersonId[];
  readonly rivals: readonly PersonId[];
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`no entry ${String(index)}`);
  }
  return value;
}

/**
 * Promotion A (human) books one show in North 2 today: slot 1 a singles match (0 beats 1), slot 2
 * a no contest (2 and 3), slot 3 a tag match (0 and 4 beat 1 and 5), so 0 and 1 work twice.
 * Promotion B (computer) has a show with a real card (no planned result) and one with no card.
 * Every wrestler has charisma 90 (no taper below 90) and popularity 40 everywhere.
 */
function integrationWorld(): IntegrationWorld {
  let shows:
    { show: EventInstanceId; rivalCard: EventInstanceId; rivalBare: EventInstanceId } | undefined;
  const person = { attributes: { charisma: 90 }, regionalPop: everywhere(40) };
  const { world, ids } = worldBuilder({
    startDate: START,
    currentDate: TODAY,
    players: [{ playerId: 'player-1', displayName: 'Test Player 1' }],
  })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion.withRoster(6, { person: () => person, employment: () => ({ momentum: 0 }) }),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) =>
      promotion.withRoster(2, { person: () => person, employment: () => ({ momentum: 0 }) }),
    )
    .with('shows', (context) => {
      const promotionA = context.ids.promotions.A;
      const promotionB = context.ids.promotions.B;
      if (promotionA === undefined || promotionB === undefined) {
        throw new Error('missing a promotion');
      }
      const add = (overrides: DeepPartial<EventInstance>): EventInstanceId =>
        context.insert(
          'eventInstances',
          anEventInstance(
            { promotionId: promotionA, regionId: NORTH_2, date: TODAY, ...overrides },
            context.sequence,
          ),
        ).id;
      shows = {
        show: add({ name: 'Test Human Show', format: { slots: 3, preShowSlots: 0 } }),
        rivalCard: add({ name: 'Test Rival Card', promotionId: promotionB }),
        rivalBare: add({ name: 'Test Rival Bare', promotionId: promotionB }),
      };
    })
    .build();
  if (shows === undefined) {
    throw new Error('built without shows');
  }
  const roster = ids.people.slice(0, 6);
  const rivals = ids.people.slice(6, 8);
  const member = (index: number): PersonId => at(roster, index);
  const singles = seed(
    world,
    shows.show,
    0,
    match('match.singles', [[member(0)], [member(1)]], winFor(0)),
  );
  const noContest = seed(
    world,
    shows.show,
    1,
    match('match.singles', [[member(2)], [member(3)]], { kind: 'noContest' }),
  );
  const tag = seed(
    world,
    shows.show,
    2,
    match(
      'match.tag-team',
      [
        [member(0), member(4)],
        [member(1), member(5)],
      ],
      winFor(0),
    ),
  );
  const rivalMatch = seed(
    world,
    shows.rivalCard,
    0,
    match('match.singles', [[at(rivals, 0)], [at(rivals, 1)]], null),
  );
  return { world, ...shows, singles, noContest, tag, rivalMatch, roster, rivals };
}

function engineOn(world: GameWorld): Engine {
  return createEngine({
    state: initialEngineState(world),
    systems: withMyShowsRun([simSystem, workersSystem, matchSystem, showsSystem]),
  });
}

interface NightResult {
  readonly engine: Engine;
  readonly tables: SerializedTables;
  readonly failures: readonly { readonly stepId: string }[];
}

async function runNight(built: IntegrationWorld): Promise<NightResult> {
  const engine = engineOn(built.world);
  const advanced = await engine.advanceDays({ maxDays: 1 });
  return { engine, tables: engine.exportState().world.tables, failures: advanced.failures };
}

function personIn(tables: SerializedTables, personId: PersonId) {
  const row = tables.people.find((entry) => entry.id === personId);
  if (row === undefined) {
    throw new Error(`no person ${personId}`);
  }
  return row;
}

function momentumOf(tables: SerializedTables, personId: PersonId): number | null {
  return tables.employments.find((entry) => entry.personId === personId)?.momentum ?? null;
}

function moraleOf(tables: SerializedTables, personId: PersonId): number | null {
  return tables.employments.find((entry) => entry.personId === personId)?.morale ?? null;
}

/** A person's stored aftermaths in card order. */
function rowsOf(
  tables: SerializedTables,
  personId: PersonId,
  order: readonly SegmentId[],
): Aftermath[] {
  return tables.aftermaths
    .filter((row) => row.personId === personId)
    .sort((left, right) => order.indexOf(left.segmentId) - order.indexOf(right.segmentId));
}

function showRegionOf(row: Aftermath): { before: number; after: number } {
  const values = row.popularity.byRegion[NORTH_2];
  if (values === undefined) {
    throw new Error(`row ${row.id} has no show region`);
  }
  return values;
}

describe('the aftermath applier on show night', () => {
  it('is registered at order 30, after the title outcome', () => {
    const order = listSegmentResultAppliers().map((applier) => [applier.id, applier.order]);
    expect(order).toEqual([
      ['shows.titleOutcome', 10],
      [AFTERMATH_APPLIER_ID, 30],
    ]);
  });

  it('moves popularity and momentum by exactly the stored amounts, both matches in card order', async () => {
    const built = integrationWorld();
    const { tables, failures } = await runNight(built);
    expect(failures).toEqual([]);
    const card = [built.singles, built.noContest, built.tag];

    // Rows for the singles (2) and the tag match (4); none for the no contest.
    const ownRows = tables.aftermaths.filter((row) => row.eventInstanceId === built.show);
    expect(ownRows.filter((row) => row.segmentId === built.singles)).toHaveLength(2);
    expect(ownRows.filter((row) => row.segmentId === built.tag)).toHaveLength(4);
    expect(ownRows.filter((row) => row.segmentId === built.noContest)).toEqual([]);

    for (const personId of built.roster) {
      const rows = rowsOf(tables, personId, card);
      const stored = personIn(tables, personId).regionalPop;
      for (const regionId of REGIONS) {
        // Each row starts where the previous one ended, and the last one is what is stored.
        let value = 40;
        for (const row of rows) {
          const region = row.popularity.byRegion[regionId];
          if (region === undefined) continue;
          expect(region.before).toBe(value);
          value = region.after;
        }
        expect(stored[regionId] ?? 0).toBe(value);
      }
      let momentum = 0;
      for (const row of rows) {
        expect(row.momentum?.before).toBe(momentum);
        momentum = row.momentum?.after ?? momentum;
      }
      expect(momentumOf(tables, personId)).toBe(momentum);
    }

    // The worker in both matches got both: the tag win on top of the singles win.
    const twice = rowsOf(tables, at(built.roster, 0), card);
    expect(twice.map((row) => row.segmentId)).toEqual([built.singles, built.tag]);
    const [first, second] = twice;
    if (first === undefined || second === undefined) throw new Error('expected two rows');
    expect(showRegionOf(first).after).toBeGreaterThan(40);
    expect(showRegionOf(second).before).toBe(showRegionOf(first).after);
    expect(showRegionOf(second).after).toBeGreaterThan(showRegionOf(second).before);
    expect(second.momentum?.before).toBe(first.momentum?.after);

    // The no contest moved nobody.
    for (const index of [2, 3]) {
      const personId = at(built.roster, index);
      expect(personIn(tables, personId).regionalPop).toEqual(everywhere(40));
      expect(momentumOf(tables, personId)).toBe(0);
    }
  });

  it("publishes one popularity.changed per worker per match from WRK1's door", async () => {
    const built = integrationWorld();
    const { engine } = await runNight(built);
    const events = engine.query(
      'sim.recentEvents',
      { limit: 500, types: ['popularity.changed'] },
      OMNISCIENT,
    );
    if (!events.ok) throw new Error(JSON.stringify(events.reasons));
    const counts = new Map<string, number>();
    for (const event of events.data) {
      if (event.type !== 'popularity.changed' || event.payload.subjectKind !== 'person') continue;
      counts.set(event.payload.subjectId, (counts.get(event.payload.subjectId) ?? 0) + 1);
      expect(event.payload.reasonKey).toMatch(/^match\.(win|loss|draw)$/);
    }
    const [w0, w1, w2, w3, w4, w5] = built.roster;
    expect(Object.fromEntries(counts)).toMatchObject({
      [w0 ?? '']: 2,
      [w1 ?? '']: 2,
      [w4 ?? '']: 1,
      [w5 ?? '']: 1,
    });
    expect(counts.has(w2 ?? '')).toBe(false);
    expect(counts.has(w3 ?? '')).toBe(false);
  });

  it('never changes morale, for winners or losers', async () => {
    const built = integrationWorld();
    const before = engineOn(built.world).exportState().world.tables;
    const moraleBefore = [...built.roster, ...built.rivals].map((id) => moraleOf(before, id));
    const { engine, tables } = await runNight(built);
    expect([...built.roster, ...built.rivals].map((id) => moraleOf(tables, id))).toEqual(
      moraleBefore,
    );
    const morale = engine.query(
      'sim.recentEvents',
      { limit: 50, types: ['morale.changed'] },
      OMNISCIENT,
    );
    expect(morale.ok && morale.data).toEqual([]);
  });

  it("gives a rival show's real card the same treatment, and an off-screen show nothing", async () => {
    const built = integrationWorld();
    const { tables } = await runNight(built);
    const rivalRows = tables.aftermaths.filter((row) => row.eventInstanceId === built.rivalCard);
    // MTCH2 decides the unplanned rival match on the night, so it has a winner and a loser.
    expect(rivalRows.map((row) => row.outcome).sort()).toEqual(['loss', 'win']);
    for (const row of rivalRows) {
      expect(personIn(tables, row.personId).regionalPop[NORTH_2]).toBe(showRegionOf(row).after);
    }
    expect(tables.aftermaths.filter((row) => row.eventInstanceId === built.rivalBare)).toEqual([]);
  });

  it("rolls back the day's shows, aftermaths included, when a later applier throws", async () => {
    registerSegmentResultApplier({
      id: THROWING_APPLIER_ID,
      order: 99,
      apply: () => {
        throw new Error('Test applier failure');
      },
    });
    const built = integrationWorld();
    const { tables, failures } = await runNight(built);
    expect(failures.map((failure) => failure.stepId)).toEqual([
      RUN_MY_SHOWS_PHASE_ID,
      'shows.runShows',
    ]);
    expect(tables.aftermaths).toEqual([]);
    for (const personId of built.roster) {
      expect(personIn(tables, personId).regionalPop).toEqual(everywhere(40));
      expect(momentumOf(tables, personId)).toBe(0);
    }
  });
});

describe('neighbours on show night', () => {
  it('spreads a show in North 2 to North 1 and South 1, and not to South 2', async () => {
    const built = integrationWorld();
    const { tables } = await runNight(built);
    const winner = personIn(tables, at(built.roster, 0)).regionalPop;
    expect(winner[NORTH_1]).toBeGreaterThan(40);
    expect(winner[SOUTH_1]).toBeGreaterThan(40);
    expect(winner[SOUTH_2]).toBe(40);
  });
});
