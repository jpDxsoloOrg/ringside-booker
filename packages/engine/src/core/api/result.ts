/**
 * What crosses the engine boundary: query and command results, and the reasons a call was refused.
 *
 * Nothing the caller sends makes the engine throw. Bad arguments, a malformed viewer or controller,
 * a rule that says no, or a bug inside a command all come back as `{ ok: false, reasons }`.
 */

import type { z } from 'zod';
import type { EntityRef } from '../trace/types';
import { serializeError } from '../errors';

/** Why a query or command was refused. `message` is written for the player. */
export interface Reason {
  /** Stable machine-readable code: `invalidArgs`, `notAllowed`, `internal`, or a system's own. */
  code: string;
  /** Shown to the player as it is. */
  message: string;
  /** The argument the reason is about, as a path such as `value` or `types[2]`. */
  field?: string;
  /** The entity the reason is about, so the UI can link to it. */
  subject?: EntityRef;
}

/** A query's outcome. */
export type QueryResult<R> = { ok: true; data: R } | { ok: false; reasons: Reason[] };

/** One event a command committed. */
export interface CommandEvent {
  type: string;
  seq: number;
}

/** A command's outcome. `events` lists the events the command itself committed, in order. */
export type CommandResult<R> =
  { ok: true; data: R; events: CommandEvent[] } | { ok: false; reasons: Reason[] };

/** The reason code for arguments, a viewer or a controller that do not match their schema. */
export const INVALID_ARGS = 'invalidArgs';

/** The reason code for a bug: a query or command threw. */
export const INTERNAL = 'internal';

/** A zod issue path as a field path, such as `types[2]` or `controller.playerId`. */
function fieldPath(prefix: string | null, segments: readonly PropertyKey[]): string {
  let path = prefix ?? '';
  for (const segment of segments) {
    if (typeof segment === 'number') {
      path += `[${String(segment)}]`;
    } else {
      path += path === '' ? String(segment) : `.${String(segment)}`;
    }
  }
  return path;
}

/**
 * One `invalidArgs` reason per zod issue. `prefix` names what was checked when it is not the
 * arguments themselves (`viewer`, `issuedBy`). An issue at the root of the arguments has no field.
 */
export function invalidArgsReasons(error: z.ZodError, prefix: string | null = null): Reason[] {
  return error.issues.map((issue) => {
    const field = fieldPath(prefix, issue.path);
    if (field === '') {
      return { code: INVALID_ARGS, message: `Invalid arguments: ${issue.message}` };
    }
    return { code: INVALID_ARGS, message: `${field}: ${issue.message}`, field };
  });
}

/** The reason returned when a query or command threw. */
export function internalReason(error: unknown): Reason {
  return {
    code: INTERNAL,
    message: `Something went wrong inside the game: ${serializeError(error).message}`,
  };
}

/**
 * Thrown by a query's `run` to refuse the call with reasons of its own, such as `notFound`. The
 * engine hands the reasons back as `{ ok: false, reasons }` instead of reporting a bug. Throw it
 * through {@link refuseQuery}.
 */
export class QueryRefusal extends Error {
  readonly reasons: readonly Reason[];

  constructor(reasons: readonly Reason[]) {
    super(reasons.map((reason) => reason.message).join(' '));
    this.name = 'QueryRefusal';
    this.reasons = reasons;
  }
}

/**
 * Refuses the query that is running. The caller gets `{ ok: false, reasons }` with exactly these
 * reasons, so a screen can show "No such worker" instead of an internal error.
 *
 * ```ts
 * const person = ctx.read.tables.people.get(args.personId);
 * if (person === undefined) {
 *   return refuseQuery({ code: 'notFound', message: 'No such worker' });
 * }
 * ```
 */
export function refuseQuery(reasons: Reason | readonly Reason[]): never {
  throw new QueryRefusal(isReasonList(reasons) ? reasons : [reasons]);
}

function isReasonList(reasons: Reason | readonly Reason[]): reasons is readonly Reason[] {
  return Array.isArray(reasons);
}
