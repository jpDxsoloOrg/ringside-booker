// A small world for the venue tests (EVT6-02): the mini geography, promotions A and B, a set of
// venues and one show of A in Test Region North 1. The expected crowd is set exactly through the
// tunables: no popularity draw and no marketing, so it is the walk-up crowd.
import { parseGameDate } from '../../../src/core/date';
import type { EventInstanceId, PromotionId, RegionId, VenueId } from '../../../src/core/ids';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import type { Venue } from '../../../src/model/entities/venue';
import type { GameWorld } from '../../../src/model/tables';
import { createEngineTunables, type EngineTunables } from '../../../src/systems/tunables';
import { worldBuilder, type DeepPartial } from '../../support';
import { anEventDefinition, anEventInstance } from '../../support/builders/creative';
import { aVenue } from '../../support/builders/geography';

export const SHOW_DATE = parseGameDate('2026-06-01');

/** Where a planned venue is: 0 = North 1 (the show's region), 1 = North 2, 2 = South 1. */
export type RegionIndex = 0 | 1 | 2 | 3;

export interface PlannedVenue {
  readonly name: string;
  readonly capacity: number;
  readonly region?: RegionIndex;
  /** 'A' or 'B': the promotion the venue is exclusive to. */
  readonly exclusiveTo?: 'A' | 'B';
  readonly closedOn?: string;
}

export interface VenueWorldOptions {
  /** The expected crowd of the show. */
  readonly crowd: number;
  readonly venues?: readonly PlannedVenue[];
  /** The name of the venue the show's definition prefers. */
  readonly preferred?: string;
  /** Names of venues where promotion B runs a show on the same night. */
  readonly rivalShowsAt?: readonly string[];
  /** True to make those rival shows cancelled ones. */
  readonly rivalShowsCancelled?: boolean;
  readonly tunables?: TunableOverrides;
  readonly show?: DeepPartial<EventInstance>;
}

export interface VenueWorld {
  readonly world: GameWorld;
  readonly tunables: EngineTunables;
  readonly show: EventInstance;
  readonly promotions: { readonly A: PromotionId; readonly B: PromotionId };
  readonly regions: readonly RegionId[];
  readonly venue: (name: string) => Venue;
  readonly venueId: (name: string) => VenueId;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`venueWorld: missing ${what}`);
  }
  return value;
}

export function venueWorld(options: VenueWorldOptions): VenueWorld {
  const tunables = createEngineTunables({
    'boxOffice.draw.atFullPopularity': 0,
    'boxOffice.marketing.perLevel': 0,
    'boxOffice.draw.walkUp': options.crowd,
    ...options.tunables,
  });
  const { world, ids } = worldBuilder({ startDate: SHOW_DATE })
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A' })
    .withPromotion({ name: 'Test Promotion B' })
    .with('venues and shows', (context) => {
      const promotionA = required(context.ids.promotions.A, 'promotion A');
      const promotionB = required(context.ids.promotions.B, 'promotion B');
      const venueIds = new Map<string, VenueId>();
      for (const planned of options.venues ?? []) {
        const exclusive =
          planned.exclusiveTo === undefined
            ? null
            : planned.exclusiveTo === 'A'
              ? promotionA
              : promotionB;
        const venue = context.insert(
          'venues',
          aVenue(
            {
              name: planned.name,
              capacity: planned.capacity,
              regionId: required(context.ids.regions[planned.region ?? 0], 'region'),
              exclusivePromotionId: exclusive,
              closedOn: planned.closedOn === undefined ? null : parseGameDate(planned.closedOn),
            },
            context.sequence,
          ),
        );
        venueIds.set(planned.name, venue.id);
      }
      const regionId = required(context.ids.regions[0], 'region');
      const definition =
        options.preferred === undefined
          ? null
          : context.insert(
              'eventDefinitions',
              anEventDefinition(
                {
                  promotionId: promotionA,
                  preferredVenueId: required(venueIds.get(options.preferred), 'preferred venue'),
                },
                context.sequence,
              ),
            );
      context.insert(
        'eventInstances',
        anEventInstance(
          {
            promotionId: promotionA,
            eventDefinitionId: definition?.id ?? null,
            regionId,
            date: SHOW_DATE,
            name: 'Test Show A',
            ...options.show,
          },
          context.sequence,
        ),
      );
      for (const name of options.rivalShowsAt ?? []) {
        context.insert(
          'eventInstances',
          anEventInstance(
            {
              promotionId: promotionB,
              regionId,
              date: SHOW_DATE,
              name: 'Rival Night',
              venueId: required(venueIds.get(name), name),
              status: options.rivalShowsCancelled === true ? 'cancelled' : 'scheduled',
            },
            context.sequence,
          ),
        );
      }
    })
    .build();
  const showId: EventInstanceId = required(ids.eventInstances[0], 'show');
  const venue = (name: string): Venue =>
    required(
      world.tables.venues.values().find((row) => row.name === name),
      `venue ${name}`,
    );
  return {
    world,
    tunables,
    show: world.tables.eventInstances.require(showId),
    promotions: {
      A: required(ids.promotions.A, 'promotion A'),
      B: required(ids.promotions.B, 'promotion B'),
    },
    regions: ids.regions,
    venue,
    venueId: (name) => venue(name).id,
  };
}
