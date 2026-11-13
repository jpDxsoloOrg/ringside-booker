/**
 * The venue and forecast queries (EVT6-03).
 *
 * - `boxOffice.forecast`: one show's crowd forecast at its venue, at the venue the game would pick
 *   when none is chosen, or at a `choice` the player is looking at. Own shows only.
 * - `boxOffice.venues`: the venues the player can choose from, each with its expected crowd, fit
 *   and why it cannot be booked. Own shows only.
 * - `boxOffice.showVenue`: where any show is held. Public: a show's venue is not secret.
 *
 * "Own" is the calendar's `viewerControlsShow`; the omniscient viewer (tools, tests) reads every
 * show. Queries cannot store traces, so the forecast's Why? comes back inline.
 * Design: docs/design/box-office.md#venue-commands-and-queries.
 */

import { z } from 'zod';
import type { Viewer } from '../../core/api/controller';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import { INVALID_ARGS, refuseQuery } from '../../core/api/result';
import type { EventInstanceId, RegionId } from '../../core/ids';
import type { Traced } from '../../core/trace/types';
import type { EventInstance } from '../../model/entities/event-instance';
import type { Venue } from '../../model/entities/venue';
import { zId } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { viewerControlsShow } from '../calendar/control';
import type { EngineTunables } from '../tunables';
import { geographyOf } from '../world/geography';
import {
  VENUE_OPTION_GROUPS,
  VENUE_SCOPES,
  VenueChoiceSchema,
  type ShowForecast,
  type ShowVenueOptions,
  type VenueChoice,
  type VenueOption,
  type VenueOptionGroup,
  type VenueSummary,
} from './api';
import { forecastAttendance, type AttendanceForecast } from './forecast';
import { genericOptionKey, type VenueOptionKey } from './formulas/pickVenue';
import { GENERIC_VENUE_TIERS, genericVenueSizes } from './genericVenues';
import { pickVenueFor } from './pickVenueFor';
import { showVenueOf, venueAvailability, type ShowVenue } from './showVenue';
import { venueFit, venueFitLabel, type VenueFit } from './venueFit';
import {
  choiceOfVenue,
  sameChoice,
  showVenueForChoice,
  summaryOf,
  summaryOfKey,
} from './venueChoice';

type Show = DeepReadonly<EventInstance>;

export const NOT_YOUR_SHOW_FORECAST_MESSAGE = 'Only your own shows have a crowd forecast';
const SHOW_NOT_FOUND_MESSAGE = 'That show no longer exists';

function showOrRefuse(read: GameWorldView, eventInstanceId: EventInstanceId): Show {
  const show = read.tables.eventInstances.get(eventInstanceId);
  if (show === undefined) {
    return refuseQuery({
      code: INVALID_ARGS,
      message: SHOW_NOT_FOUND_MESSAGE,
      field: 'eventInstanceId',
    });
  }
  return show;
}

/** The viewer's own show, or a refusal. The omniscient viewer sees every show. */
function ownShowOrRefuse(ctx: QueryContext, eventInstanceId: EventInstanceId): Show {
  const show = showOrRefuse(ctx.read, eventInstanceId);
  if (!canForecast(ctx.read, show, ctx.viewer)) {
    return refuseQuery({
      code: 'boxOffice.notYourShow',
      message: NOT_YOUR_SHOW_FORECAST_MESSAGE,
      subject: { kind: 'eventInstance', id: show.id },
    });
  }
  return show;
}

function canForecast(read: GameWorldView, show: Show, viewer: DeepReadonly<Viewer>): boolean {
  return viewer.kind === 'omniscient' || viewerControlsShow(read, show, viewer);
}

/** The pick preview when the show has no venue yet, with its Why?. */
function suggestionOf(
  read: GameWorldView,
  tunables: EngineTunables,
  show: Show,
  current: ShowVenue | null,
): { readonly summary: VenueSummary | null; readonly pick: Traced<VenueOptionKey> | null } {
  if (current !== null) {
    return { summary: null, pick: null };
  }
  const pick = pickVenueFor(read, tunables, show);
  return { summary: summaryOfKey(read, tunables, show, pick.value), pick };
}

interface CappedNumbers {
  readonly expected: number;
  readonly low: number;
  readonly high: number;
  readonly fit: VenueFit;
  readonly fitLabel: string;
  readonly cappedByCapacity: boolean;
}

/** The forecast's numbers at a venue holding `capacity`. */
function cappedAt(
  forecast: AttendanceForecast,
  capacity: number,
  tunables: EngineTunables,
): CappedNumbers {
  const demand = forecast.expected.value;
  const fit = venueFit(demand, capacity, tunables);
  return {
    expected: Math.min(demand, capacity),
    low: Math.min(forecast.low, capacity),
    high: Math.min(forecast.high, capacity),
    fit,
    fitLabel: venueFitLabel(fit),
    cappedByCapacity: forecast.high > capacity,
  };
}

/** Forecasts per region, so a list of venues forecasts each region once. */
function forecastCache(
  read: GameWorldView,
  tunables: EngineTunables,
  show: Show,
): (regionId: RegionId) => AttendanceForecast {
  const cache = new Map<RegionId, AttendanceForecast>();
  return (regionId) => {
    let forecast = cache.get(regionId);
    if (forecast === undefined) {
      forecast = forecastAttendance(read, tunables, show, { regionId });
      cache.set(regionId, forecast);
    }
    return forecast;
  };
}

/** `boxOffice.forecast`. */
export const forecastQuery: QueryDefinition<'boxOffice.forecast'> = defineQuery(
  'boxOffice.forecast',
  {
    args: z.strictObject({
      eventInstanceId: zId('eventInstance'),
      choice: VenueChoiceSchema.optional(),
    }),
    run: (ctx, args): ShowForecast => {
      const show = ownShowOrRefuse(ctx, args.eventInstanceId);
      const currentVenue = showVenueOf(ctx.read, show);
      const current = currentVenue === null ? null : summaryOf(ctx.read, currentVenue);
      const suggestion = suggestionOf(ctx.read, ctx.tunables, show, currentVenue);
      let shown: VenueSummary | null;
      if (args.choice === undefined) {
        shown = current ?? suggestion.summary;
      } else {
        const chosen = showVenueForChoice(ctx.read, ctx.tunables, show, args.choice);
        if (chosen === null) {
          return refuseQuery({
            code: INVALID_ARGS,
            message: 'That venue does not exist',
            field: 'choice.venueId',
          });
        }
        shown = summaryOf(ctx.read, chosen);
      }
      if (shown === null) {
        return refuseQuery({
          code: INVALID_ARGS,
          message: 'This show has no venue to forecast',
          subject: { kind: 'eventInstance', id: show.id },
        });
      }
      const forecast = forecastAttendance(ctx.read, ctx.tunables, show, {
        regionId: shown.regionId,
      });
      return {
        eventInstanceId: show.id,
        current,
        suggested: suggestion.summary,
        shown,
        demand: forecast.expected.value,
        capacity: shown.capacity,
        ...cappedAt(forecast, shown.capacity, ctx.tunables),
        trace: forecast.expected.trace,
        pickTrace: suggestion.pick?.trace ?? null,
      };
    },
  },
);

interface SortableOption {
  readonly option: VenueOption;
  /** The venue id or generic option key, the last tie-breaker. */
  readonly key: string;
}

/** By group (region, country, abroad, generic), then capacity, then id. */
function compareOptions(left: SortableOption, right: SortableOption): number {
  return (
    VENUE_OPTION_GROUPS.indexOf(left.option.group) -
      VENUE_OPTION_GROUPS.indexOf(right.option.group) ||
    left.option.capacity - right.option.capacity ||
    compareIds(left.key, right.key)
  );
}

/** `boxOffice.venues`. */
export const venuesQuery: QueryDefinition<'boxOffice.venues'> = defineQuery('boxOffice.venues', {
  args: z.strictObject({ eventInstanceId: zId('eventInstance'), scope: z.enum(VENUE_SCOPES) }),
  run: (ctx, args): ShowVenueOptions => {
    const { read, tunables } = ctx;
    const show = ownShowOrRefuse(ctx, args.eventInstanceId);
    const currentVenue = showVenueOf(read, show);
    const current = currentVenue === null ? null : summaryOf(read, currentVenue);
    const currentChoice: VenueChoice | null =
      currentVenue === null ? null : choiceOfVenue(currentVenue);
    const suggestion = suggestionOf(read, tunables, show, currentVenue);
    const forecastIn = forecastCache(read, tunables, show);

    const geography = geographyOf(read);
    const showCountryId = geography.countryOf(show.regionId).id;
    const definition =
      show.eventDefinitionId === null
        ? undefined
        : read.tables.eventDefinitions.get(show.eventDefinitionId);
    const preferredId = definition?.preferredVenueId ?? null;

    // Real venues: the show's country, or the world; the current and preferred venues always.
    const venues = new Map<string, DeepReadonly<Venue>>();
    const add = (venue: DeepReadonly<Venue> | undefined): void => {
      if (venue !== undefined) {
        venues.set(venue.id, venue);
      }
    };
    if (args.scope === 'world') {
      for (const venue of read.tables.venues.values()) {
        add(venue);
      }
    } else {
      for (const region of geography.regionsOf(showCountryId)) {
        for (const venue of read.tables.venues.lookup('byRegion', region.id)) {
          add(venue);
        }
      }
    }
    if (currentVenue?.kind === 'venue') {
      add(read.tables.venues.get(currentVenue.venueId));
    }
    if (preferredId !== null) {
      add(read.tables.venues.get(preferredId));
    }

    const booking = { promotionId: show.promotionId, date: show.date, eventInstanceId: show.id };
    const options: SortableOption[] = [];
    for (const venue of venues.values()) {
      const place = showVenueOf(read, {
        venueId: venue.id,
        genericVenue: null,
        regionId: venue.regionId,
      });
      if (place === null) {
        continue;
      }
      const summary = summaryOf(read, place);
      const availability = venueAvailability(read, venue, booking);
      const numbers = cappedAt(forecastIn(venue.regionId), venue.capacity, tunables);
      const group: VenueOptionGroup =
        venue.regionId === show.regionId
          ? 'region'
          : geography.countryOf(venue.regionId).id === showCountryId
            ? 'country'
            : 'abroad';
      const option: VenueOption = {
        choice: summary.choice,
        name: summary.name,
        regionName: summary.regionName,
        countryName: summary.countryName,
        group,
        capacity: venue.capacity,
        venueKind: venue.kind,
        imageRef: venue.imageRef,
        expected: numbers.expected,
        low: numbers.low,
        high: numbers.high,
        fit: numbers.fit,
        fitLabel: numbers.fitLabel,
        preferred: venue.id === preferredId,
        current: currentChoice !== null && sameChoice(currentChoice, summary.choice),
        disabled: availability.available
          ? null
          : { code: availability.code, message: availability.message },
      };
      options.push({ option, key: venue.id });
    }

    // Generic local venues, in the show's region.
    const sizes = genericVenueSizes(tunables);
    for (const tier of GENERIC_VENUE_TIERS) {
      const choice: VenueChoice = { kind: 'generic', tier };
      const place = showVenueForChoice(read, tunables, show, choice);
      const size = sizes.find((entry) => entry.tier === tier);
      if (place === null || size === undefined) {
        continue;
      }
      const summary = summaryOf(read, place);
      const numbers = cappedAt(forecastIn(show.regionId), size.capacity, tunables);
      const option: VenueOption = {
        choice,
        name: summary.name,
        regionName: summary.regionName,
        countryName: summary.countryName,
        group: 'generic',
        capacity: size.capacity,
        venueKind: place.venueKind,
        imageRef: place.imageRef,
        expected: numbers.expected,
        low: numbers.low,
        high: numbers.high,
        fit: numbers.fit,
        fitLabel: numbers.fitLabel,
        preferred: false,
        current: currentChoice !== null && sameChoice(currentChoice, choice),
        disabled: null,
      };
      options.push({ option, key: genericOptionKey(tier) });
    }

    return {
      current,
      suggested: suggestion.summary,
      options: options.sort(compareOptions).map((entry) => entry.option),
    };
  },
});

/** `boxOffice.showVenue`: where any show is held, or null while no venue is chosen. */
export const showVenueQuery: QueryDefinition<'boxOffice.showVenue'> = defineQuery(
  'boxOffice.showVenue',
  {
    args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
    run: (ctx, args) => {
      const show = showOrRefuse(ctx.read, args.eventInstanceId);
      const venue = showVenueOf(ctx.read, show);
      return { venue: venue === null ? null : summaryOf(ctx.read, venue) };
    },
  },
);

export const boxOfficeQueries: readonly QueryDefinition[] = [
  forecastQuery,
  venuesQuery,
  showVenueQuery,
];
