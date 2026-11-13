/**
 * The venue commands (EVT6-03). The player chooses where one of their upcoming shows is held
 * (`booking.setVenue`) or asks the game to pick ("Pick for me", `booking.autoVenue`). Both are
 * refused for a show the issuer does not run, one that has run, been cancelled or is in the past,
 * and `booking.setVenue` for a venue that cannot be booked that night. Changing the venue to
 * another region moves the show there. Design: docs/design/box-office.md#venue-commands-and-queries.
 */

import { z } from 'zod';
import { defineCommand, type CommandDefinition } from '../../core/api/command';
import { INVALID_ARGS, type Reason } from '../../core/api/result';
import { isBefore } from '../../core/date';
import { InvariantError } from '../../core/errors';
import type { EventInstanceId } from '../../core/ids';
import { startDecision } from '../../core/trace/decision';
import type { Controller } from '../../model/controller';
import type { EventInstance } from '../../model/entities/event-instance';
import { zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { controlsShow } from '../calendar/control';
import { VenueChoiceSchema, type SetVenueResult } from './api';
import { applyVenueChoice } from './applyVenue';
import { PICK_VENUE_DOC_REF, type VenueOptionKey } from './formulas/pickVenue';
import { showVenueOf, venueAvailability } from './showVenue';
import { autoPickVenue, optionKeyOf, showVenueForChoice, summaryOf } from './venueChoice';

/** The reason codes the venue commands refuse with, besides `invalidArgs`. */
export const VENUE_COMMAND_REASON_CODES = [
  'boxOffice.notYourShow',
  'boxOffice.showNotEditable',
  'boxOffice.venueClosed',
  'boxOffice.venueExclusive',
  'boxOffice.venueTaken',
] as const;
export type VenueCommandReasonCode = (typeof VENUE_COMMAND_REASON_CODES)[number];

export const SHOW_NOT_EDITABLE_MESSAGE = "This show can't change venue any more";

/**
 * Why the issuer cannot change the venue of `eventInstanceId`, or the show when they can. The checks
 * both commands share: the show exists, the issuer runs it, and it is still to come.
 */
function editableShow(
  read: GameWorldView,
  eventInstanceId: EventInstanceId,
  issuedBy: Controller,
): { readonly show: DeepReadonly<EventInstance> } | { readonly refused: Reason } {
  const show = read.tables.eventInstances.get(eventInstanceId);
  if (show === undefined) {
    return {
      refused: {
        code: INVALID_ARGS,
        message: 'That show no longer exists',
        field: 'eventInstanceId',
      },
    };
  }
  const subject = { kind: 'eventInstance', id: show.id } as const;
  if (!controlsShow(read, show, issuedBy)) {
    return {
      refused: {
        code: 'boxOffice.notYourShow',
        message: 'Only the person running this show can choose its venue',
        subject,
      },
    };
  }
  if (
    show.status === 'completed' ||
    show.status === 'cancelled' ||
    isBefore(show.date, read.meta.currentDate)
  ) {
    return {
      refused: { code: 'boxOffice.showNotEditable', message: SHOW_NOT_EDITABLE_MESSAGE, subject },
    };
  }
  return { show };
}

/** What a command stored, as a summary. */
function resultOf(read: GameWorldView, eventInstanceId: EventInstanceId): SetVenueResult {
  const show = read.tables.eventInstances.require(eventInstanceId);
  const venue = showVenueOf(read, show);
  if (venue === null) {
    throw new InvariantError(`Show ${eventInstanceId} has no venue right after one was stored`);
  }
  return { eventInstanceId, venue: summaryOf(read, venue) };
}

/** `booking.setVenue`: the player's own choice of venue. */
export const setVenueCommand: CommandDefinition<'booking.setVenue'> = defineCommand(
  'booking.setVenue',
  {
    args: z.strictObject({ eventInstanceId: zId('eventInstance'), choice: VenueChoiceSchema }),
    validate: (read, args, issuedBy) => {
      const checked = editableShow(read, args.eventInstanceId, issuedBy);
      if ('refused' in checked) {
        return [checked.refused];
      }
      const { choice } = args;
      if (choice.kind === 'generic') {
        // The tier is checked by the arguments' schema.
        return [];
      }
      const venue = read.tables.venues.get(choice.venueId);
      if (venue === undefined) {
        return [
          { code: INVALID_ARGS, message: 'That venue does not exist', field: 'choice.venueId' },
        ];
      }
      const availability = venueAvailability(read, venue, {
        promotionId: checked.show.promotionId,
        date: checked.show.date,
        eventInstanceId: checked.show.id,
      });
      if (!availability.available) {
        return [
          {
            code: availability.code,
            message: availability.message,
            subject: { kind: 'venue', id: venue.id },
          },
        ];
      }
      return [];
    },
    apply: (ctx, args) => {
      const show = ctx.read.tables.eventInstances.require(args.eventInstanceId);
      const venue = showVenueForChoice(ctx.read, ctx.tunables, show, args.choice);
      const key: VenueOptionKey = optionKeyOf(args.choice);
      const name = venue?.name ?? key;
      const decision = startDecision<VenueOptionKey>('Venue', { docRef: PICK_VENUE_DOC_REF });
      decision.rule('Chosen by the booker', true);
      const trace = decision.choose(key, `${name} was chosen by the booker`);
      applyVenueChoice(ctx, show.id, key, { auto: false, trace });
      ctx.log(`${show.name} (${show.id}) will be held at ${name}`);
      return resultOf(ctx.read, show.id);
    },
  },
);

/** `booking.autoVenue`: "Pick for me", the same pick the game makes for a show without a venue. */
export const autoVenueCommand: CommandDefinition<'booking.autoVenue'> = defineCommand(
  'booking.autoVenue',
  {
    args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
    validate: (read, args, issuedBy) => {
      const checked = editableShow(read, args.eventInstanceId, issuedBy);
      return 'refused' in checked ? [checked.refused] : [];
    },
    apply: (ctx, args) => {
      const show = ctx.read.tables.eventInstances.require(args.eventInstanceId);
      autoPickVenue(ctx, show, { storeTrace: true });
      const result = resultOf(ctx.read, show.id);
      ctx.log(`${show.name} (${show.id}) will be held at ${result.venue.name}, picked by the game`);
      return result;
    },
  },
);

export const boxOfficeCommands: readonly CommandDefinition[] = [setVenueCommand, autoVenueCommand];
