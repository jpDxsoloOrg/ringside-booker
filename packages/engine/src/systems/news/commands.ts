/**
 * The news commands: a player's alert rules and clearing their pending alert.
 *
 * `news.setAlertRules` writes only the rules (and `stopSkip`) it is given, for the issuing player.
 * `news.ackAlerts` clears the issuing player's pending alert so the `news.alert` gate lets the day
 * move again; it is idempotent, so a screen can run it every time a story opens.
 *
 * Design: docs/design/news.md#alerts.
 */

import { z } from 'zod';
import { defineCommand } from '../../core/api/command';
import type { Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import { INVALID_ARGS } from '../../core/api/result';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { newsAlertRule, pendingAlertOf, withAlertSettings } from './alerts';

declare module '../../core/api/maps' {
  interface CommandMap {
    'news.setAlertRules': {
      args: { rules: Record<string, boolean>; stopSkip?: boolean | undefined };
      result: null;
    };
    'news.ackAlerts': {
      args: Record<string, never>;
      result: { cleared: boolean };
    };
  }
}

/** The refusal code for a command issued by someone who is not a listed human player. */
export const NOT_A_PLAYER = 'notAPlayer';

/** The issuing human's player id when they are listed in `meta.players`, else null. */
export function issuingPlayerId(
  read: GameWorldView,
  issuedBy: DeepReadonly<Controller>,
): string | null {
  if (issuedBy.kind !== 'human') {
    return null;
  }
  const { playerId } = issuedBy;
  return read.meta.players.some((player) => player.playerId === playerId) ? playerId : null;
}

function notAPlayer(): Reason {
  return { code: NOT_A_PLAYER, message: 'Only a player can set news alerts' };
}

export const setAlertRulesCommand = defineCommand('news.setAlertRules', {
  args: z.strictObject({
    rules: z.record(z.string(), z.boolean()),
    stopSkip: z.boolean().optional(),
  }),
  validate: (read, args, issuedBy) => {
    if (issuingPlayerId(read, issuedBy) === null) {
      return [notAPlayer()];
    }
    return Object.keys(args.rules)
      .filter((ruleId) => newsAlertRule(ruleId) === undefined)
      .map(
        (ruleId): Reason => ({
          code: INVALID_ARGS,
          message: `There is no news alert called "${ruleId}"`,
          field: `rules.${ruleId}`,
        }),
      );
  },
  apply: (ctx, args, issuedBy) => {
    const playerId = issuingPlayerId(ctx.read, issuedBy);
    if (playerId === null) {
      return null;
    }
    ctx.tx.setMeta({
      settings: withAlertSettings(ctx.read.meta, playerId, {
        rules: args.rules,
        ...(args.stopSkip === undefined ? {} : { stopSkip: args.stopSkip }),
      }),
    });
    return null;
  },
});

export const ackAlertsCommand = defineCommand('news.ackAlerts', {
  args: z.strictObject({}),
  validate: (read, _args, issuedBy) =>
    issuingPlayerId(read, issuedBy) === null
      ? [{ code: NOT_A_PLAYER, message: 'Only a player can clear news alerts' }]
      : [],
  apply: (ctx, _args, issuedBy) => {
    const playerId = issuingPlayerId(ctx.read, issuedBy);
    if (playerId === null || pendingAlertOf(ctx.read.meta, playerId) === null) {
      return { cleared: false };
    }
    ctx.tx.setMeta({ settings: withAlertSettings(ctx.read.meta, playerId, { pending: null }) });
    return { cleared: true };
  },
});

export const newsCommands = [setAlertRulesCommand, ackAlertsCommand] as const;
