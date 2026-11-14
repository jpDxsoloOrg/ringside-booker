/**
 * The live show night commands (EVT10-01), next to `shows.runTonight` on the show screen:
 *
 * - `shows.runNextSegment { eventInstanceId }` runs the next segment in running order (pre-show
 *   first). The last one completes the show.
 * - `shows.runRestOfShow { eventInstanceId }` runs every segment left and completes the show.
 * - `shows.finishShow { eventInstanceId }` completes a show with nothing left to run (a card whose
 *   segments were all rated before the night). Refused while a segment is still to run.
 * - `shows.setShowNight { mode }` changes the Show night setting (Live or Auto) mid-game.
 *
 * Every run command is refused as `shows.runTonight` is (`runShowRefusals`): only the show's
 * runner, only tonight, only an open show, and, before the first segment, only a card with no
 * booking error.
 *
 * Design: docs/design/show-night.md#live-show-night.
 */

import { z } from 'zod';
import { defineCommand } from '../../core/api/command';
import type { Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import type { EventInstanceId, SegmentId } from '../../core/ids';
import { zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import { segmentsLeftOn, runNextLiveSegment, runRestOfShowNow } from './live';
import { SHOW_NIGHT_MODES, type ShowNightMode } from './settings';
import { runShowRefusals } from './tonight';
import { completeShowCard } from './runShow';
import { runBeforeShowRunsHooks } from './beforeRun';

declare module '../../core/api/maps' {
  interface CommandMap {
    'shows.runNextSegment': {
      args: { eventInstanceId: EventInstanceId };
      result: { eventInstanceId: EventInstanceId; segmentId: SegmentId; finished: boolean };
    };
    'shows.runRestOfShow': {
      args: { eventInstanceId: EventInstanceId };
      result: { eventInstanceId: EventInstanceId; segmentIds: SegmentId[] };
    };
    'shows.finishShow': {
      args: { eventInstanceId: EventInstanceId };
      result: { eventInstanceId: EventInstanceId };
    };
    'shows.setShowNight': {
      args: { mode: ShowNightMode };
      result: { mode: ShowNightMode };
    };
  }
}

/** The reason codes the live commands add to `shows.runTonight`'s. */
export const LIVE_SHOW_REASON_CODES = ['noSegmentLeft', 'segmentsLeft', 'notAllowed'] as const;
export type LiveShowReasonCode = (typeof LIVE_SHOW_REASON_CODES)[number];

const showArgs = z.strictObject({ eventInstanceId: zId('eventInstance') });

/** How many segments of the show are still to run (0 for an unknown show). */
function leftCount(read: GameWorldView, eventInstanceId: EventInstanceId): number {
  const show = read.tables.eventInstances.get(eventInstanceId);
  return show === undefined ? 0 : segmentsLeftOn(read, show).length;
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`;
}

export const runNextSegmentCommand = defineCommand('shows.runNextSegment', {
  args: showArgs,
  validate: (read, args, issuedBy, env) => {
    const refused = runShowRefusals(read, args.eventInstanceId, issuedBy, env);
    if (refused.length > 0) {
      return refused;
    }
    if (leftCount(read, args.eventInstanceId) === 0) {
      return [
        {
          code: 'noSegmentLeft',
          message: 'Every segment has run. Finish the show to see how it went.',
          subject: { kind: 'eventInstance', id: args.eventInstanceId },
        },
      ];
    }
    return [];
  },
  apply: (ctx, args) => {
    const step = runNextLiveSegment(ctx, args.eventInstanceId);
    if (step.segmentId === null) {
      // validate checked there was one; reaching here means the world changed under the command.
      throw new Error(`shows.runNextSegment: ${args.eventInstanceId} had no segment left to run`);
    }
    ctx.log(`Ran segment ${step.segmentId} of ${args.eventInstanceId} live`);
    return {
      eventInstanceId: args.eventInstanceId,
      segmentId: step.segmentId,
      finished: step.finished,
    };
  },
});

export const runRestOfShowCommand = defineCommand('shows.runRestOfShow', {
  args: showArgs,
  validate: (read, args, issuedBy, env) =>
    runShowRefusals(read, args.eventInstanceId, issuedBy, env),
  apply: (ctx, args) => {
    const segmentIds = runRestOfShowNow(ctx, args.eventInstanceId);
    ctx.log(`Ran the rest of ${args.eventInstanceId} (${plural(segmentIds.length, 'segment')})`);
    return { eventInstanceId: args.eventInstanceId, segmentIds };
  },
});

export const finishShowCommand = defineCommand('shows.finishShow', {
  args: showArgs,
  validate: (read, args, issuedBy, env) => {
    const refused = runShowRefusals(read, args.eventInstanceId, issuedBy, env);
    if (refused.length > 0) {
      return refused;
    }
    const left = leftCount(read, args.eventInstanceId);
    if (left > 0) {
      return [
        {
          code: 'segmentsLeft',
          message: `${plural(left, 'segment')} still to run before the show can finish`,
          subject: { kind: 'eventInstance', id: args.eventInstanceId },
        },
      ];
    }
    return [];
  },
  apply: (ctx, args) => {
    const show = ctx.read.tables.eventInstances.require(args.eventInstanceId);
    if (show.liveRun === undefined) {
      // Nothing ran tonight: the hooks still come first, as for any show that runs.
      runBeforeShowRunsHooks(ctx, { show, human: true, beforeTheDay: true });
    }
    completeShowCard(ctx, args.eventInstanceId);
    return { eventInstanceId: args.eventInstanceId };
  },
});

/**
 * Who may change the Show night setting: a human listed in `meta.players`, or anyone in a world
 * with no players (the same rule as the tunables).
 */
function settingPermission(read: GameWorldView, issuedBy: Controller): Reason[] {
  if (read.meta.players.length === 0) {
    return [];
  }
  if (
    issuedBy.kind === 'human' &&
    read.meta.players.some((player) => player.playerId === issuedBy.playerId)
  ) {
    return [];
  }
  return [{ code: 'notAllowed', message: 'Only a player in this game can change this setting.' }];
}

export const setShowNightCommand = defineCommand('shows.setShowNight', {
  args: z.strictObject({ mode: z.enum(SHOW_NIGHT_MODES) }),
  validate: (read, _args, issuedBy) => settingPermission(read, issuedBy),
  apply: (ctx, args) => {
    const { settings } = ctx.read.meta;
    // Kept sorted by key, as a new game writes them.
    const extra = Object.fromEntries(
      Object.entries({ ...settings.extra, showNight: args.mode }).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );
    ctx.tx.setMeta({ settings: { ...settings, season: { ...settings.season }, extra } });
    ctx.log(`Show night is now ${args.mode}`);
    return { mode: args.mode };
  },
});

export const liveShowCommands = [
  runNextSegmentCommand,
  runRestOfShowCommand,
  finishShowCommand,
  setShowNightCommand,
] as const;
