/**
 * The roster's commands.
 *
 * `roster.setPush` moves one or many of the issuer's wrestlers to one card position. It is all or
 * nothing: every row is checked first, any refused row refuses the whole call, and the accepted
 * rows change in one transaction through the workers system's push door, which records the trace
 * and publishes `employment.pushChanged`. The command changes nothing else: how a worker feels
 * about a push change is for the features that listen to the event (WRK8), never for this one.
 *
 * Design: docs/design/roster.md#set-push.
 */

import { z } from 'zod';
import { defineCommand, type CommandContext } from '../../core/api/command';
import type { Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import type { EmploymentId } from '../../core/ids';
import {
  PushSchema,
  type EmploymentRole,
  type EmploymentStatus,
  type Push,
} from '../../model/entities/employment';
import { zId } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { sameController } from '../calendar/control';
import { setPush, type DoorContext, type DoorReason, type DoorSource } from '../workers/doors';
import { roleHasPush } from './roleGroups';

declare module '../../core/api/maps' {
  interface CommandMap {
    'roster.setPush': {
      args: { employmentIds: EmploymentId[]; push: Push };
      result: { changed: EmploymentId[]; unchanged: EmploymentId[] };
    };
  }
}

/** The most rows one call may change: the largest roster the DataTable is built for. */
export const SET_PUSH_MAX_ROWS = 300;

/** The refusal codes `roster.setPush` adds to the built-in `invalidArgs` and `notAllowed`. */
export const SET_PUSH_REASON_CODES = [
  'employmentNotFound',
  'notAllowed',
  'contractNotActive',
  'pushNotForRole',
] as const;
export type SetPushReasonCode = (typeof SET_PUSH_REASON_CODES)[number];

/** The `reasonKey` the push door's event carries for a change made through this command. */
export const SET_PUSH_REASON_KEY = 'roster.setPush';

const SET_PUSH_REASON: DoorReason = {
  key: SET_PUSH_REASON_KEY,
  label: 'The booker changed their place on the card',
};

export const DUPLICATE_EMPLOYMENT_MESSAGE =
  'The same contract was picked twice. Pick each worker once.';

/** A contract's status as it reads after "it is". Only statuses other than `active` are shown. */
const STATUS_WORDS: Readonly<Record<EmploymentStatus, string>> = {
  offered: 'still an offer',
  declined: 'declined',
  withdrawn: 'withdrawn',
  signed: 'signed but has not started',
  active: 'active',
  expired: 'expired',
  released: 'released',
  quit: 'over because they quit',
};

/** A role with its article, as it reads after "is". */
const ROLE_WORDS: Readonly<Record<EmploymentRole, string>> = {
  wrestler: 'a wrestler',
  manager: 'a manager',
  presenter: 'a presenter',
  announcer: 'an announcer',
  referee: 'a referee',
  producer: 'a producer',
  booker: 'a booker',
};

export interface RosterSetPushArgs {
  employmentIds: EmploymentId[];
  push: Push;
}

const SetPushArgsSchema = z
  .strictObject({
    employmentIds: z.array(zId('employment')).min(1).max(SET_PUSH_MAX_ROWS),
    push: PushSchema,
  })
  .refine((args) => new Set(args.employmentIds).size === args.employmentIds.length, {
    message: DUPLICATE_EMPLOYMENT_MESSAGE,
    path: ['employmentIds'],
  });

/** The IDs with the place each had in the arguments, in ascending ID order. */
function inIdOrder(employmentIds: readonly EmploymentId[]): { id: EmploymentId; index: number }[] {
  return employmentIds
    .map((id, index) => ({ id, index }))
    .sort((left, right) => compareIds(left.id, right.id));
}

/** Why one row may not move to `push`, or null when it may. */
function rowRefusal(
  read: GameWorldView,
  employmentId: EmploymentId,
  push: Push,
  issuedBy: DeepReadonly<Controller>,
): { code: SetPushReasonCode; message: string } | null {
  const employment = read.tables.employments.get(employmentId);
  if (employment === undefined) {
    return {
      code: 'employmentNotFound',
      message: 'That contract no longer exists. Refresh the roster and try again.',
    };
  }
  const name = employment.ringName;
  const promotion = read.tables.promotions.get(employment.promotionId);
  // Brand controllers (D-06 brand wars) are not consulted yet: a push is the promotion's call.
  if (promotion === undefined || !sameController(promotion.controller, issuedBy)) {
    const employer = promotion?.name ?? 'another promotion';
    return {
      code: 'notAllowed',
      message: `${name} works for ${employer}. You can only change pushes on your own roster.`,
    };
  }
  if (employment.status !== 'active') {
    return {
      code: 'contractNotActive',
      message: `${name}'s contract isn't active (it is ${STATUS_WORDS[employment.status]}), so their push can't change.`,
    };
  }
  if (!roleHasPush(employment.role) && push !== 'none') {
    return {
      code: 'pushNotForRole',
      message: `${name} is ${ROLE_WORDS[employment.role]}. Only wrestlers have a place on the card.`,
    };
  }
  if (roleHasPush(employment.role) && push === 'none') {
    return {
      code: 'pushNotForRole',
      message: `Pick a card position for ${name}, from Main event to Enhancement.`,
    };
  }
  return null;
}

/**
 * Every reason the call is refused, one per offending row, in ascending ID order. Each names the
 * row's place in the arguments (`employmentIds[2]`) and the employment.
 */
export function setPushRefusals(
  read: GameWorldView,
  args: RosterSetPushArgs,
  issuedBy: DeepReadonly<Controller>,
): Reason[] {
  const reasons: Reason[] = [];
  for (const { id, index } of inIdOrder(args.employmentIds)) {
    const refusal = rowRefusal(read, id, args.push, issuedBy);
    if (refusal !== null) {
      reasons.push({
        ...refusal,
        field: `employmentIds[${String(index)}]`,
        subject: { kind: 'employment', id },
      });
    }
  }
  return reasons;
}

/** The push door, as `applySetPush` calls it. Tests pass one that fails to check the rollback. */
export type SetPushDoor = typeof setPush;

/** Who the door names as making the change: a human's call is the player's, the computer's the AI's. */
export function doorSourceOf(issuedBy: DeepReadonly<Controller>): DoorSource {
  return issuedBy.kind === 'human' ? 'player' : 'ai';
}

/**
 * Applies an accepted `roster.setPush`: in ascending ID order, rows already at the push are left
 * alone (no event) and every other row goes through the push door. Writes nothing else.
 */
export function applySetPush(
  ctx: DoorContext,
  args: RosterSetPushArgs,
  issuedBy: DeepReadonly<Controller>,
  door: SetPushDoor = setPush,
): { changed: EmploymentId[]; unchanged: EmploymentId[] } {
  const changed: EmploymentId[] = [];
  const unchanged: EmploymentId[] = [];
  const source = doorSourceOf(issuedBy);
  for (const { id } of inIdOrder(args.employmentIds)) {
    if (ctx.read.tables.employments.require(id).push === args.push) {
      unchanged.push(id);
      continue;
    }
    door(ctx, { employmentId: id, push: args.push, source, reason: SET_PUSH_REASON });
    changed.push(id);
  }
  return { changed, unchanged };
}

/** One or many card positions in one call, all or nothing. */
export const setPushCommand = defineCommand('roster.setPush', {
  args: SetPushArgsSchema,
  validate: (read, args, issuedBy) => setPushRefusals(read, args, issuedBy),
  apply: (ctx: CommandContext, args, issuedBy) => applySetPush(ctx, args, issuedBy),
});

export const rosterCommands = [setPushCommand] as const;
