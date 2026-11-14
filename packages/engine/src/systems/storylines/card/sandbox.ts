/**
 * A Sandbox game's test aid (CRTV4-05): `storylines.setHeat { storylineId, heat }` puts one of
 * your own active storylines at a chosen heat, so the warm and hot steps of the story shield and
 * the payoff can be tried without playing weeks of shows.
 *
 * It only works in a Sandbox game (`meta.settings.sandbox`, "the player may edit the world
 * freely"); anywhere else it refuses with `sandboxOnly`. The new heat gets a `storylines.heat`
 * Why? that says it was set by hand. It is not progress: `lastProgressOn` and the progress log are
 * left alone, so cooling carries on as before.
 *
 * Design: docs/design/storylines.md#sandbox-heat.
 */

import { z } from 'zod';
import { defineCommand } from '../../../core/api/command';
import type { Reason } from '../../../core/api/result';
import type { StorylineId } from '../../../core/ids';
import { startCalc } from '../../../core/trace/calc';
import { zId, zStat } from '../../../model/primitives';
import type { GameWorldView } from '../../../model/tables';
import { keepsFullStorylineTraces } from '../lifecycle';
import { storylineHeatTraceRef } from '../traceKinds';
import { ownStorylineReasons } from '../validation';

export const STORYLINE_SANDBOX_REASONS = { sandboxOnly: 'sandboxOnly' } as const;

export const SANDBOX_ONLY_MESSAGE = 'Only in Sandbox games';

/** The heat Why?'s only line. */
export const SET_BY_HAND_TEXT = 'Set by hand in a Sandbox game';

export interface StorylineSetHeatArgs {
  storylineId: StorylineId;
  /** 0 to 100. */
  heat: number;
}

declare module '../../../core/api/maps' {
  interface CommandMap {
    'storylines.setHeat': { args: StorylineSetHeatArgs; result: { heat: number } };
  }
}

/** True in a Sandbox game, where the player may edit the world freely. */
export function isSandboxGame(read: GameWorldView): boolean {
  return read.meta.settings.sandbox;
}

function sandboxOnlyReason(): Reason {
  return { code: STORYLINE_SANDBOX_REASONS.sandboxOnly, message: SANDBOX_ONLY_MESSAGE };
}

export const setHeatCommand = defineCommand('storylines.setHeat', {
  args: z.strictObject({ storylineId: zId('storyline'), heat: zStat }),
  validate: (read, args, issuedBy) => {
    if (!isSandboxGame(read)) {
      return [sandboxOnlyReason()];
    }
    return ownStorylineReasons(read, args.storylineId, issuedBy);
  },
  apply: (ctx, args) => {
    const storyline = ctx.read.tables.storylines.require(args.storylineId);
    const traced = startCalc('Heat', args.heat, {
      unit: 'points',
      startLabel: SET_BY_HAND_TEXT,
    }).done();
    ctx.tx.update('storylines', storyline.id, { heat: traced.value });
    ctx.recordTrace(storylineHeatTraceRef(storyline.id), ctx.date, traced, {
      summaryOnly: !keepsFullStorylineTraces(ctx.read, storyline.promotionId),
    });
    return { heat: traced.value };
  },
});
