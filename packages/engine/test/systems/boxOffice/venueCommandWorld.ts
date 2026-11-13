// The world the venue command, query and phase tests share (EVT6-03): the mini geography,
// promotion A run by `player-1` and promotion B run by the computer, a set of venues and a show
// for every case. The expected crowd is set exactly through the tunables (no popularity draw, no
// marketing), so every show expects `CROWD` people.
//
// Today is 2026-06-01. Regions: 0 = North 1 (every show's region), 1 = North 2 (same country),
// 2 = South 1 (another country).
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import type { SystemBundle } from '../../../src/core/api/system';
import { addDays, parseGameDate, type GameDate } from '../../../src/core/date';
import type { EventInstanceId, PromotionId, RegionId, VenueId } from '../../../src/core/ids';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { Controller } from '../../../src/model/controller';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import { createEngineTunables, type EngineTunables } from '../../../src/systems/tunables';
import { worldBuilder, type DeepPartial } from '../../support';
import { anEventDefinition, anEventInstance } from '../../support/builders/creative';
import { aVenue } from '../../support/builders/geography';

export const TODAY = parseGameDate('2026-06-01');
export const NEXT_WEEK = addDays(TODAY, 7);
export const CROWD = 1000;

export const PLAYER: Controller = { kind: 'human', playerId: 'player-1' };
export const COMPUTER: Controller = { kind: 'computer' };

export const VENUE_NAMES = [
  'smallClub',
  'civicHall',
  'bigArena',
  'rivalDojo',
  'oldBarn',
  'northTwoHall',
  'southDome',
] as const;
export type VenueName = (typeof VENUE_NAMES)[number];

interface PlannedVenue {
  readonly name: string;
  readonly capacity: number;
  /** 0 = North 1, 1 = North 2, 2 = South 1. */
  readonly region: 0 | 1 | 2;
  /** Exclusive to promotion B. */
  readonly exclusiveToB?: true;
  readonly closedOn?: string;
}

/** The venues: name, capacity, region index and what makes them special. */
export const VENUES: Readonly<Record<VenueName, PlannedVenue>> = {
  smallClub: { name: 'Small Club', capacity: 300, region: 0 },
  civicHall: { name: 'Civic Hall', capacity: 1500, region: 0 },
  bigArena: { name: 'Big Arena', capacity: 15000, region: 0 },
  rivalDojo: { name: 'Rival Dojo', capacity: 1200, region: 0, exclusiveToB: true },
  oldBarn: { name: 'Old Barn', capacity: 1300, region: 0, closedOn: '2026-01-01' },
  northTwoHall: { name: 'North Two Hall', capacity: 2000, region: 1 },
  southDome: { name: 'South Dome', capacity: 5000, region: 2 },
};

/**
 * The shows. `rivalAtArena` is B's show at Big Arena on the same night as `mine`; only `mine` has a
 * definition, which prefers the `preferred` venue when one is given.
 */
export const SHOW_NAMES = [
  'mine',
  'myToday',
  'myTomorrow',
  'myPast',
  'myCompleted',
  'myCancelled',
  'myFar',
  'rival',
  'rivalAtArena',
  'rivalFar',
] as const;
export type ShowName = (typeof SHOW_NAMES)[number];

export interface VenueCommandWorld {
  readonly world: GameWorld;
  readonly tunables: EngineTunables;
  readonly overrides: TunableOverrides;
  readonly shows: Readonly<Record<ShowName, EventInstanceId>>;
  readonly venues: Readonly<Record<VenueName, VenueId>>;
  readonly promotions: { readonly A: PromotionId; readonly B: PromotionId };
  readonly regions: readonly RegionId[];
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`venueCommandWorld: missing ${what}`);
  }
  return value;
}

export function venueCommandWorld(
  options: { readonly tunables?: TunableOverrides; readonly preferred?: VenueName } = {},
): VenueCommandWorld {
  const overrides: TunableOverrides = {
    'boxOffice.draw.atFullPopularity': 0,
    'boxOffice.draw.walkUp': CROWD,
    'boxOffice.marketing.perLevel': 0,
    ...options.tunables,
  };
  let shows: Record<ShowName, EventInstanceId> | undefined;
  let venues: Record<VenueName, VenueId> | undefined;
  const { world, ids } = worldBuilder({
    startDate: addDays(TODAY, -30),
    currentDate: TODAY,
    players: [{ playerId: 'player-1', displayName: 'Test Player 1' }],
  })
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER })
    .withPromotion({ name: 'Test Promotion B' })
    .with('venues and shows', (context) => {
      const promotionA = required(context.ids.promotions.A, 'promotion A');
      const promotionB = required(context.ids.promotions.B, 'promotion B');
      const regionId = required(context.ids.regions[0], 'region');
      const venueIds = new Map<VenueName, VenueId>();
      for (const key of VENUE_NAMES) {
        const planned = VENUES[key];
        const venue = context.insert(
          'venues',
          aVenue(
            {
              name: planned.name,
              capacity: planned.capacity,
              regionId: required(context.ids.regions[planned.region], 'venue region'),
              exclusivePromotionId: planned.exclusiveToB === true ? promotionB : null,
              closedOn: planned.closedOn === undefined ? null : parseGameDate(planned.closedOn),
            },
            context.sequence,
          ),
        );
        venueIds.set(key, venue.id);
      }
      const venueId = (key: VenueName): VenueId => required(venueIds.get(key), key);
      venues = {
        smallClub: venueId('smallClub'),
        civicHall: venueId('civicHall'),
        bigArena: venueId('bigArena'),
        rivalDojo: venueId('rivalDojo'),
        oldBarn: venueId('oldBarn'),
        northTwoHall: venueId('northTwoHall'),
        southDome: venueId('southDome'),
      };
      const definition =
        options.preferred === undefined
          ? null
          : context.insert(
              'eventDefinitions',
              anEventDefinition(
                { promotionId: promotionA, preferredVenueId: venueId(options.preferred) },
                context.sequence,
              ),
            );
      const add = (overridesForShow: DeepPartial<EventInstance>): EventInstanceId =>
        context.insert(
          'eventInstances',
          anEventInstance(
            {
              promotionId: promotionA,
              eventDefinitionId: null,
              regionId,
              date: NEXT_WEEK,
              importance: 'regular',
              ...overridesForShow,
            },
            context.sequence,
          ),
        ).id;
      const on = (days: number): GameDate => addDays(TODAY, days);
      shows = {
        mine: add({ name: 'My Show', eventDefinitionId: definition?.id ?? null }),
        myToday: add({ name: 'My Show Tonight', date: TODAY }),
        myTomorrow: add({ name: 'My Show Tomorrow', date: on(1) }),
        myPast: add({ name: 'My Past Show', date: on(-1) }),
        myCompleted: add({ name: 'My Completed Show', date: on(-3), status: 'completed' }),
        myCancelled: add({ name: 'My Cancelled Show', status: 'cancelled' }),
        myFar: add({ name: 'My Far Show', date: on(30) }),
        rival: add({ name: 'Rival Show', promotionId: promotionB }),
        rivalAtArena: add({
          name: 'Rival Arena Night',
          promotionId: promotionB,
          venueId: venueId('bigArena'),
        }),
        rivalFar: add({
          name: 'Rival Far Show',
          promotionId: promotionB,
          date: on(30),
        }),
      };
    })
    .build();
  return {
    world,
    tunables: createEngineTunables(overrides),
    overrides,
    shows: required(shows, 'shows'),
    venues: required(venues, 'venues'),
    promotions: {
      A: required(ids.promotions.A, 'promotion A'),
      B: required(ids.promotions.B, 'promotion B'),
    },
    regions: ids.regions,
  };
}

/** An engine on the world, with the world's tunable overrides in its state. */
export function engineOn(
  built: VenueCommandWorld,
  systems: readonly SystemBundle[] = defaultSystems,
): Engine {
  const sorted = Object.fromEntries(
    Object.entries(built.overrides).sort(([left], [right]) => (left < right ? -1 : 1)),
  );
  return createEngine({
    state: { ...initialEngineState(built.world), tunableOverrides: sorted },
    systems,
  });
}

/** A show's row as the engine holds it now. */
export function showIn(engine: Engine, id: EventInstanceId): EventInstance {
  const row = engine
    .exportState()
    .world.tables.eventInstances.find((instance) => instance.id === id);
  return required<EventInstance>(row, `show ${id}`);
}
