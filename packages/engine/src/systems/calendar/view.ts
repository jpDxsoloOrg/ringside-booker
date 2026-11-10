/**
 * The calendar's row: one show as a screen reads it.
 *
 * Every calendar query returns the same plain shape, {@link CalendarShow}, whether the show is
 * stored or only projected past the horizon. Schedules are public, so a rival's row carries
 * everything about where and when. What it never carries is money: a show's `result` (gate,
 * attendance, viewers) is not copied, and nothing here reads a promotion's cash.
 *
 * A show has slots, not a clock: no field is a length or a time (design decision D-10).
 *
 * Design notes: docs/design/calendar.md#queries.
 */

import type { Viewer } from '../../core/api/controller';
import type { GameDate } from '../../core/date';
import { EntityNotFoundError } from '../../core/errors';
import type {
  BrandId,
  EventDefinitionId,
  EventInstanceId,
  PromotionId,
  RegionId,
  VenueId,
} from '../../core/ids';
import type { TraceNode } from '../../core/trace/types';
import type { EventDefinition, EventImportance } from '../../model/entities/event-definition';
import {
  definitionAirDateKey,
  type CancellationReason,
  type EventInstance,
  type EventInstanceStatus,
} from '../../model/entities/event-instance';
import type { VenueKind } from '../../model/entities/venue';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { geographyOf, type Geography } from '../world/geography';
import { cancelRefusal } from './cancel';
import { viewerControlsShow, type ShowOwnership } from './control';
import { placeShow } from './placement';

/** A stored show's status, or `projected` for a date past the horizon that is not stored yet. */
export type CalendarShowStatus = EventInstanceStatus | 'projected';

/** One show on the calendar, stored or projected. Plain JSON. */
export interface CalendarShow {
  /** The instance id, or `<definitionId>|<date>` for a projected show. Unique within a result. */
  key: string;
  /** Null for a projected show: it has no row yet, so nothing can act on it. */
  eventInstanceId: EventInstanceId | null;
  /** The definition the show comes from, or null for a one-off. */
  definitionId: EventDefinitionId | null;
  promotion: { id: PromotionId; name: string; shortName: string; color: string };
  /** True when the viewer is the human player who runs this show. */
  isOwn: boolean;
  brand: { id: BrandId; name: string } | null;
  name: string;
  importance: EventImportance;
  format: { slots: number; preShowSlots: number };
  /** From the definition as it stands now; null for a one-off. */
  televised: boolean | null;
  date: GameDate;
  airDate: GameDate;
  status: CalendarShowStatus;
  cancellation: { reason: CancellationReason; on: GameDate } | null;
  region: { id: RegionId; name: string; countryName: string };
  /** Null while the venue is not chosen yet. */
  venue: { id: VenueId; name: string; capacity: number; kind: VenueKind } | null;
  /** How many segments are on the show's card. 0 for a projected show. */
  segmentCount: number;
  /** True when the viewer could cancel the show right now. */
  canCancel: boolean;
}

/** `calendar.show`: one stored show with the reasoning behind where it is held. */
export interface CalendarShowDetail extends CalendarShow {
  /**
   * Why the show is where it is, or null when its venue or region no longer match what the
   * placement rule picks (something set them since) and for a one-off.
   */
  placementTrace: TraceNode | null;
  /** What the show's definition says about it, or null for a one-off. */
  definition: { recurrenceText: string } | null;
}

/**
 * True when the viewer is a human player who runs `show`. The omniscient viewer runs nothing, and
 * the computer's seat has no shows of its own to look after on a screen, so both get false.
 */
export function viewerOwnsShow(
  read: GameWorldView,
  show: ShowOwnership,
  viewer: DeepReadonly<Viewer>,
): boolean {
  return (
    viewer.kind === 'controller' &&
    viewer.controller.kind === 'human' &&
    viewerControlsShow(read, show, viewer)
  );
}

/** Builds calendar rows for one viewer on one day. Make one per query and reuse it for every row. */
export interface CalendarRowBuilder {
  /** The row for a stored show. */
  stored(instance: DeepReadonly<EventInstance>): CalendarShow;
  /**
   * The row for a show `definition` would have on `date`, which has no stored row. The region and
   * venue are what the placement rule picks today.
   */
  projected(definition: DeepReadonly<EventDefinition>, date: GameDate): CalendarShow;
}

/** The parts of a row a stored show and a projected one are both built from. */
interface RowSource {
  readonly promotionId: PromotionId;
  readonly brandId: BrandId | null;
  readonly regionId: RegionId;
  readonly venueId: VenueId | null;
}

export function calendarRowBuilder(
  read: GameWorldView,
  viewer: DeepReadonly<Viewer>,
  today: GameDate,
): CalendarRowBuilder {
  // Built on first use and kept: a 42-day world view has a few hundred rows over one map.
  let geography: Geography | null = null;
  const mapOf = (): Geography => {
    geography ??= geographyOf(read);
    return geography;
  };

  function promotionOf(promotionId: PromotionId): CalendarShow['promotion'] {
    const promotion = read.tables.promotions.get(promotionId);
    if (promotion === undefined) {
      throw new EntityNotFoundError('promotions', promotionId);
    }
    return {
      id: promotion.id,
      name: promotion.name,
      shortName: promotion.shortName,
      color: promotion.color,
    };
  }

  function brandOf(brandId: BrandId | null): CalendarShow['brand'] {
    const brand = brandId === null ? undefined : read.tables.brands.get(brandId);
    return brand === undefined ? null : { id: brand.id, name: brand.name };
  }

  function regionOf(regionId: RegionId): CalendarShow['region'] {
    const map = mapOf();
    return {
      id: regionId,
      name: map.region(regionId).name,
      countryName: map.countryOf(regionId).name,
    };
  }

  function venueOf(venueId: VenueId | null): CalendarShow['venue'] {
    const venue = venueId === null ? undefined : read.tables.venues.get(venueId);
    return venue === undefined
      ? null
      : { id: venue.id, name: venue.name, capacity: venue.capacity, kind: venue.kind };
  }

  function placeOf(
    source: RowSource,
  ): Pick<CalendarShow, 'promotion' | 'brand' | 'region' | 'venue'> {
    return {
      promotion: promotionOf(source.promotionId),
      brand: brandOf(source.brandId),
      region: regionOf(source.regionId),
      venue: venueOf(source.venueId),
    };
  }

  return {
    stored(instance) {
      const definition =
        instance.eventDefinitionId === null
          ? undefined
          : read.tables.eventDefinitions.get(instance.eventDefinitionId);
      const isOwn = viewerOwnsShow(read, instance, viewer);
      const { promotion, brand, region, venue } = placeOf(instance);
      return {
        key: instance.id,
        eventInstanceId: instance.id,
        definitionId: instance.eventDefinitionId,
        promotion,
        isOwn,
        brand,
        name: instance.name,
        importance: instance.importance,
        format: { slots: instance.format.slots, preShowSlots: instance.format.preShowSlots },
        televised: definition?.televised ?? null,
        date: instance.date,
        airDate: instance.airDate,
        status: instance.status,
        cancellation:
          instance.cancellation === null
            ? null
            : { reason: instance.cancellation.reason, on: instance.cancellation.on },
        region,
        venue,
        segmentCount: read.tables.segments.lookup('byEventInstance', instance.id).length,
        canCancel:
          isOwn &&
          viewer.kind === 'controller' &&
          cancelRefusal(read, instance, viewer.controller, today) === null,
      };
    },
    projected(definition, date) {
      const placement = placeShow(read, definition, date).value;
      const { promotion, brand, region, venue } = placeOf({
        promotionId: definition.promotionId,
        brandId: definition.brandId,
        regionId: placement.regionId,
        venueId: placement.venueId,
      });
      return {
        key: definitionAirDateKey(definition.id, date),
        eventInstanceId: null,
        definitionId: definition.id,
        promotion,
        isOwn: viewerOwnsShow(read, definition, viewer),
        brand,
        name: definition.name,
        importance: definition.importance,
        format: { slots: definition.format.slots, preShowSlots: definition.format.preShowSlots },
        televised: definition.televised,
        date,
        airDate: date,
        status: 'projected',
        cancellation: null,
        region,
        venue,
        segmentCount: 0,
        canCancel: false,
      };
    },
  };
}

/**
 * The calendar row for one stored show, as `viewer` sees it on `today`. A query that builds many
 * rows makes one {@link calendarRowBuilder} instead, so the map is only read once.
 */
export function toCalendarShow(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  viewer: DeepReadonly<Viewer>,
  today: GameDate,
): CalendarShow {
  return calendarRowBuilder(read, viewer, today).stored(instance);
}
