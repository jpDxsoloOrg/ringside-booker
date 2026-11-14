// An angle's aftermath on show night (MTCH5-06): momentum and popularity by each person's share of
// the beats, written through the doors from MTCH3's aftermath applier, accumulating over a card, and
// never morale (D-09). Design: docs/design/angle-rating.md#angle-aftermath
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import { parseContentKey } from '../../../../src/core/content-key';
import { parseGameDate } from '../../../../src/core/date';
import type { EventInstanceId, PersonId, RegionId, SegmentId } from '../../../../src/core/ids';
import type { GameWorld } from '../../../../src/model/tables';
import type { SerializedTables } from '../../../../src/persistence/save-document';
import { AngleDraftSchema, type AngleDraft } from '../../../../src/systems/booking';
import { matchSystem } from '../../../../src/systems/match';
import { showsSystem } from '../../../../src/systems/shows';
import { workersSystem } from '../../../../src/systems/workers';
import {
  angleMomentumGain,
  anglePopularityGain,
  beatsInByPerson,
  computeAngleAftermath,
} from '../../../../src';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { geographyOf } from '../../../../src/systems/world/geography';
import { anEventInstance, withMyShowsRun, worldBuilder } from '../../../support';
import { seed } from '../../booking/command-world';
import { PLAYER_ONE } from '../../calendar/lifecycle-world';
import { NORTH_2, REGIONS } from '../aftermath/fixtures';

const START = '2026-01-05';
const TODAY = parseGameDate('2026-01-06');
const PROMO = parseContentKey('beat.promo');
const WAR_OF_WORDS = parseContentKey('beat.war-of-words');

function everywhere(value: number): Record<RegionId, number> {
  return Object.fromEntries(REGIONS.map((region) => [region, value]));
}

function angle(beats: readonly (readonly PersonId[])[]): AngleDraft {
  const speakers = [...new Set(beats.flat())];
  return AngleDraftSchema.parse({
    kind: 'angle',
    label: null,
    angle: {
      angleTypeKey: parseContentKey('angle.promo'),
      beats: beats.map((personIds, index) => ({
        beatKey: index === 0 ? PROMO : WAR_OF_WORDS,
        personIds: [...personIds],
      })),
    },
    participants: speakers.map((personId) => ({
      personId,
      side: 0,
      role: 'speaker',
      teamId: null,
    })),
  });
}

interface AngleNight {
  readonly world: GameWorld;
  readonly show: EventInstanceId;
  readonly first: SegmentId;
  readonly second: SegmentId;
  readonly people: readonly PersonId[];
}

/**
 * A human show in North 2 with two angles: the first has Kai (0) in both beats and Rex (1) in the
 * second; the second has Kai and Jo (2) in its one beat. Everyone has charisma 90 (no taper below
 * 90), mic 90, popularity 40 everywhere, momentum 0 and morale -20.
 */
function angleNight(): AngleNight {
  let show: EventInstanceId | undefined;
  const { world, ids } = worldBuilder({
    startDate: START,
    currentDate: TODAY,
    players: [{ playerId: 'player-1', displayName: 'Test Player 1' }],
  })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion.withRoster(4, {
        person: () => ({
          attributes: { charisma: 90, mic: 90 },
          regionalPop: everywhere(40),
        }),
        employment: () => ({ momentum: 0, morale: -20 }),
      }),
    )
    .with('show', (context) => {
      const promotionId = context.ids.promotions.A;
      if (promotionId === undefined) {
        throw new Error('missing promotion');
      }
      show = context.insert(
        'eventInstances',
        anEventInstance(
          {
            promotionId,
            regionId: NORTH_2,
            date: TODAY,
            name: 'Test Angle Show',
            format: { slots: 3, preShowSlots: 0 },
          },
          context.sequence,
        ),
      ).id;
    })
    .build();
  if (show === undefined) {
    throw new Error('built without a show');
  }
  const people = ids.people.slice(0, 4);
  const [kai, rex, jo] = people;
  if (kai === undefined || rex === undefined || jo === undefined) {
    throw new Error('missing people');
  }
  const first = seed(world, show, 1, angle([[kai], [kai, rex]]));
  const second = seed(world, show, 2, angle([[kai, jo]]));
  return { world, show, first, second, people };
}

function engineOn(world: GameWorld): Engine {
  return createEngine({
    state: initialEngineState(world),
    systems: withMyShowsRun([simSystem, workersSystem, matchSystem, showsSystem]),
  });
}

function employmentOf(tables: SerializedTables, personId: PersonId) {
  const row = tables.employments.find((entry) => entry.personId === personId);
  if (row === undefined) {
    throw new Error(`no employment for ${personId}`);
  }
  return row;
}

function scoreOf(tables: SerializedTables, segmentId: SegmentId): number {
  const score = tables.segments.find((entry) => entry.id === segmentId)?.rating?.score;
  if (score === undefined) {
    throw new Error(`segment ${segmentId} was not rated`);
  }
  return score;
}

const TUNABLES = createEngineTunables();

function momentumFor(score: number, beatsIn: number, totalBeats: number): number {
  return angleMomentumGain({ personName: 'x', score, beatsIn, totalBeats }, { tunables: TUNABLES })
    .value;
}

describe('an angle on show night', () => {
  it('moves the momentum of everyone in its beats by exactly the formula, over both angles', async () => {
    const built = angleNight();
    const engine = engineOn(built.world);
    const advanced = await engine.advanceDays({ maxDays: 1 });
    expect(advanced.failures).toEqual([]);
    const tables = engine.exportState().world.tables;
    const first = scoreOf(tables, built.first);
    const second = scoreOf(tables, built.second);
    const [kai, rex, jo, nobody] = built.people;
    if (kai === undefined || rex === undefined || jo === undefined || nobody === undefined) {
      throw new Error('missing people');
    }
    const expectMomentum = (personId: PersonId, expected: number) => {
      expect(employmentOf(tables, personId).momentum).toBeCloseTo(expected, 6);
    };
    const kaiExpected = momentumFor(first, 2, 2) + momentumFor(second, 1, 1);
    // The angles were rated away from the pivot, so the change is not an untouched 0.
    expect(kaiExpected).not.toBe(0);
    expectMomentum(kai, kaiExpected);
    expectMomentum(rex, momentumFor(first, 1, 2));
    expectMomentum(jo, momentumFor(second, 1, 1));
    expect(employmentOf(tables, nobody).momentum).toBe(0);
  });

  it("never changes anyone's morale", async () => {
    const built = angleNight();
    const before = built.world.tables.employments.values().map((row) => [row.id, row.morale]);
    const engine = engineOn(built.world);
    await engine.advanceDays({ maxDays: 1 });
    const after = engine.exportState().world.tables.employments.map((row) => [row.id, row.morale]);
    expect(after).toEqual([...before]);
  });
});

describe('computeAngleAftermath', () => {
  it('gives a person in two of two beats the full gain and one in one of two half', () => {
    const built = angleNight();
    const [kai, rex] = built.people;
    if (kai === undefined || rex === undefined) {
      throw new Error('missing people');
    }
    const beats = [[kai], [kai, rex]];
    expect([...beatsInByPerson(beats)]).toEqual([
      [kai, 2],
      [rex, 1],
    ]);
    const aftermath = computeAngleAftermath(
      built.world,
      {
        segmentId: null,
        eventInstanceId: null,
        promotionId: built.world.tables.promotions.values()[0]?.id ?? null,
        date: TODAY,
        regionId: NORTH_2,
        televised: false,
        importance: 'regular',
        beats,
        score: 80,
      },
      TUNABLES,
      geographyOf(built.world),
    );
    const [kaiRow, rexRow] = aftermath.workers;
    expect(kaiRow?.shareText).toBe('In 2 of 2 beats');
    expect(kaiRow?.popularity.delta.value).toBeCloseTo(
      anglePopularityGain(
        { personName: 'x', score: 80, beatsIn: 2, totalBeats: 2 },
        { tunables: TUNABLES },
      ).value,
      10,
    );
    expect(rexRow?.popularity.delta.value).toBeCloseTo(0.5, 10);
    // The show region gets the gain; its neighbours their spill.
    const showRow = kaiRow?.popularity.regions.find((row) => row.regionId === NORTH_2);
    expect(showRow?.change).toBeGreaterThan(0);
    expect(kaiRow?.popularity.regions.length).toBeGreaterThan(1);
  });
});
