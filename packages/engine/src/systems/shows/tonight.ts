/**
 * Show night for the player's own shows (EVT2-09): the day stops on every open show of theirs, and
 * the show runs only when they press Run the show.
 *
 * - The gate `shows.tonight` stops Next Day and every skip before a day with an open show a human
 *   runs: "Tonight: <Show>", or "Your show '<Show>' has no card yet" when nothing is booked.
 * - The command `shows.runTonight { eventInstanceId }` runs that show at once through the same
 *   code the shows phase uses for every other show (`runShowNow`: before-run hooks, then
 *   `runShowCard` with its segments, appliers, traces, `segment.completed` and `show.completed`).
 *   It is refused while the card has any booking error (`cardNotRunnable`); warnings never block.
 * - The shows phase never runs a show a human runs.
 *
 * There is no Lock card any more. A card stays editable until its show has run. EVT10 (live show
 * night) adds running one segment at a time next to this command, on the same screen.
 *
 * Design: docs/design/show-night.md#the-players-shows and docs/design/booking.md#show-day.
 */

import { z } from 'zod';
import { defineCommand, type CommandValidateEnv } from '../../core/api/command';
import type { Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import { isBefore, type GameDate } from '../../core/date';
import type { EventInstanceId } from '../../core/ids';
import type { GateHit, GateSpec } from '../../core/pipeline/gates';
import type { EventInstance } from '../../model/entities/event-instance';
import { zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { hasCard } from '../booking/card';
import { runnerName } from '../booking/commands';
import type { BookingIssue } from '../booking/validate/types';
import { validateCard } from '../booking/validate/validateCard';
import { controlsShow, showControllerOf } from '../calendar/control';
import { compareShows, isOpenShow } from './phases';
import { runRestOfShowNow } from './live';

declare module '../../core/api/maps' {
  interface CommandMap {
    'shows.runTonight': {
      args: { eventInstanceId: EventInstanceId };
      result: { eventInstanceId: EventInstanceId };
    };
  }
}

/** The gate id. Tests that skip through the player's show days take this gate out. */
export const SHOWS_TONIGHT_GATE_ID = 'shows.tonight';

/** The web shell's route key for the show screen ("Go to the show"). */
export const SHOW_NIGHT_ACTION_HINT = 'showNight';

/** The stop's reason while one of the player's shows is part-way through (EVT10-01). */
export const FINISH_TONIGHT_FIRST = "Finish tonight's show first";

/** The most `cardNotRunnable` reasons a refused run lists; the checklist has the rest. */
export const MAX_RUN_REASONS = 10;

/** The reason codes `shows.runTonight` can refuse with, besides `invalidArgs` and `busy`. */
export const RUN_TONIGHT_REASON_CODES = [
  'showNotFound',
  'notYourShow',
  'showCompleted',
  'showCancelled',
  'notTonight',
  'cardNotRunnable',
] as const;
export type RunTonightReasonCode = (typeof RUN_TONIGHT_REASON_CODES)[number];

type Show = DeepReadonly<EventInstance>;

/**
 * The open shows a human runs on `date`, in the order the shows phase would run them (air date,
 * then id). A `booked` show from a save made before EVT2-09 counts as open.
 */
export function myShowsOn(view: GameWorldView, date: GameDate): Show[] {
  return view.tables.eventInstances
    .lookup('byDate', date)
    .filter((instance) => isOpenShow(instance) && showControllerOf(view, instance).kind === 'human')
    .sort(compareShows);
}

/** The stop's words: a show part-way through comes first, then a show with no card. */
function gateReason(view: GameWorldView, show: Show): string {
  if (show.liveRun !== undefined) {
    return `${FINISH_TONIGHT_FIRST}: ${show.name}`;
  }
  return hasCard(view, show.id)
    ? `Tonight: ${show.name}`
    : `Your show '${show.name}' has no card yet`;
}

/**
 * Stops the skip before a day with an open show a human runs. With several on one day the first in
 * running order leads; once it has run the gate names the next. Cancelled and completed shows never
 * stop the clock.
 */
export const showsTonightGate: GateSpec = {
  id: SHOWS_TONIGHT_GATE_ID,
  label: 'Show night',
  check: (view, date): GateHit | null => {
    const [show] = myShowsOn(view, date);
    if (show === undefined) {
      return null;
    }
    return {
      gateId: SHOWS_TONIGHT_GATE_ID,
      reason: gateReason(view, show),
      subject: { kind: 'eventInstance', id: show.id },
      actionHint: SHOW_NIGHT_ACTION_HINT,
    };
  },
};

function notRunnable(show: Show, issue: BookingIssue): Reason {
  return {
    code: 'cardNotRunnable',
    message: issue.message,
    subject:
      issue.segmentId === undefined
        ? { kind: 'eventInstance', id: show.id }
        : { kind: 'segment', id: issue.segmentId },
  };
}

/** Why the show cannot run tonight before its card is even checked, or null. */
function showRefusal(read: GameWorldView, show: Show): Reason | null {
  const subject = { kind: 'eventInstance', id: show.id } as const;
  if (show.status === 'completed') {
    return { code: 'showCompleted', message: 'This show has already run', subject };
  }
  if (show.status === 'cancelled') {
    return { code: 'showCancelled', message: 'This show was cancelled', subject };
  }
  if (show.date !== read.meta.currentDate) {
    return {
      code: 'notTonight',
      message: isBefore(show.date, read.meta.currentDate)
        ? 'This show has already happened'
        : `This show is on ${show.date}, not tonight`,
      subject,
    };
  }
  return null;
}

/**
 * Why the issuer cannot run (any part of) this show now, or no reasons. Shared by
 * `shows.runTonight` and the live commands (EVT10-01): the show must exist, be the issuer's, be
 * dated today and still be open; and, until its first segment has run, its card must have no
 * booking error. Once a show is under way its card is not checked again: a segment may have hurt
 * someone booked later, and the show must still be able to finish.
 */
export function runShowRefusals(
  read: GameWorldView,
  eventInstanceId: EventInstanceId,
  issuedBy: Controller,
  env: CommandValidateEnv,
): Reason[] {
  const show = read.tables.eventInstances.get(eventInstanceId);
  if (show === undefined) {
    return [{ code: 'showNotFound', message: 'That show no longer exists' }];
  }
  if (!controlsShow(read, show, issuedBy)) {
    return [
      {
        code: 'notYourShow',
        message: `Only the person running ${runnerName(read, show)} can run this show`,
        subject: { kind: 'eventInstance', id: show.id },
      },
    ];
  }
  const refused = showRefusal(read, show);
  if (refused !== null) {
    return [refused];
  }
  if (show.liveRun !== undefined) {
    return [];
  }
  const validation = validateCard(read, show.id, {
    tunables: env.tunables,
    today: read.meta.currentDate,
  });
  return validation.errors.slice(0, MAX_RUN_REASONS).map((issue) => notRunnable(show, issue));
}

/**
 * Runs the issuer's show tonight, all at once, through the same code the shows phase uses (or, for a
 * show already under way, its remaining segments). Refused as {@link runShowRefusals} says. Returns the show's id, for the results page.
 */
export const runTonightCommand = defineCommand('shows.runTonight', {
  args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
  validate: (read, args, issuedBy, env) =>
    runShowRefusals(read, args.eventInstanceId, issuedBy, env),
  apply: (ctx, args) => {
    const show = ctx.read.tables.eventInstances.require(args.eventInstanceId);
    // Run the show comes before the day's phases (the gate stopped the day before it started). A
    // show already under way (EVT10-01) runs its remaining segments instead.
    runRestOfShowNow(ctx, show.id);
    ctx.log(`Ran ${show.name} (${show.id}) from the show screen`);
    return { eventInstanceId: show.id };
  },
});
