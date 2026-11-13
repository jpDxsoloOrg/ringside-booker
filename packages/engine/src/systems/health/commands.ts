/**
 * The health system's commands.
 *
 * `health.acknowledgeInjuries` marks the player's workers' new injuries as seen, so the own-injury
 * gate (`health.ownWorkerInjured`) lets the day move again. The screens that show an injury (the
 * roster's injuries tab, a worker's health profile) run it when they open. The player's own ids
 * already seen are skipped without a reason, so a screen can send everything it shows; another
 * promotion's workers' injuries are refused (`notYourWorker`). Design:
 * docs/design/health.md#own-injury-gate.
 */

import { z } from 'zod';
import { defineCommand } from '../../core/api/command';
import { sameController, type Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import type { InjuryId } from '../../core/ids';
import type { InjuryRecord } from '../../model/entities/injury';
import { zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { ringNameOn } from './gate';
import { employerControllersOf } from './notice';

declare module '../../core/api/maps' {
  interface CommandMap {
    'health.acknowledgeInjuries': {
      args: { injuryIds: InjuryId[] };
      result: null;
    };
  }
}

/** The most injuries one call may mark as seen. */
export const ACKNOWLEDGE_MAX_INJURIES = 50;

/** The refusal codes `health.acknowledgeInjuries` adds to the built-in `invalidArgs`. */
export const ACKNOWLEDGE_REASON_CODES = ['unknownInjury', 'notYourWorker'] as const;
export type AcknowledgeReasonCode = (typeof ACKNOWLEDGE_REASON_CODES)[number];

/**
 * True when `issuedBy` may mark this injury as seen: a human who runs one of the worker's employers
 * (or their brand). An injury still waiting whose worker no human employs any more (their contract
 * ended, or they moved to a rival, while it waited) may be marked by any human, so a waiting injury
 * can never block the day for good.
 */
export function mayAcknowledge(
  read: GameWorldView,
  injury: DeepReadonly<InjuryRecord>,
  issuedBy: DeepReadonly<Controller>,
): boolean {
  if (issuedBy.kind !== 'human') {
    return false;
  }
  const humans = employerControllersOf(read, injury.personId, read.meta.currentDate).filter(
    (controller) => controller.kind === 'human',
  );
  if (humans.some((controller) => sameController(controller, issuedBy))) {
    return true;
  }
  return injury.noticedOn === null && humans.length === 0;
}

/** The injuries that are waiting and will be marked, in the order given, without repeats. */
function waitingIds(read: GameWorldView, injuryIds: readonly InjuryId[]): InjuryId[] {
  const seen = new Set<InjuryId>();
  const waiting: InjuryId[] = [];
  for (const id of injuryIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    if (read.tables.injuries.get(id)?.noticedOn === null) {
      waiting.push(id);
    }
  }
  return waiting;
}

export const acknowledgeInjuriesCommand = defineCommand('health.acknowledgeInjuries', {
  args: z.strictObject({
    injuryIds: z.array(zId('injury')).min(1).max(ACKNOWLEDGE_MAX_INJURIES),
  }),
  validate: (read, args, issuedBy) => {
    const reasons: Reason[] = [];
    for (const id of args.injuryIds) {
      const injury = read.tables.injuries.get(id);
      if (injury === undefined) {
        reasons.push({
          code: 'unknownInjury',
          message: 'That injury is not in this game any more. Refresh the page and try again.',
        });
        continue;
      }
      if (mayAcknowledge(read, injury, issuedBy)) {
        continue;
      }
      reasons.push({
        code: 'notYourWorker',
        message: `${ringNameOn(read, injury.personId, read.meta.currentDate)} does not work for you, so this injury is not yours to mark as seen.`,
        subject: { kind: 'person', id: injury.personId },
      });
    }
    return reasons;
  },
  apply: (ctx, args) => {
    const waiting = waitingIds(ctx.read, args.injuryIds);
    if (waiting.length === 0) {
      return null;
    }
    for (const id of waiting) {
      ctx.tx.update('injuries', id, { noticedOn: ctx.date });
    }
    ctx.publish('injury.noticed', { injuryIds: waiting });
    return null;
  },
});

export const healthCommands = [acknowledgeInjuriesCommand] as const;
