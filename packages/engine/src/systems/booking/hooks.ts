/**
 * Segment hooks: other systems keep their own rows right when the card writer removes a segment or
 * rewrites one, inside the same transaction, without booking knowing about them.
 *
 * The writer (`writer.ts`) is the one way segments are written, by the player's commands and the
 * rival booker alike, so a hook here sees every change. `beforeRemove` runs before the segment and
 * its participants are deleted; `afterWrite` runs after a segment is created or replaced in place
 * (its kind or its storyline links may have changed). Hooks run in id order. A hook that throws
 * rolls the whole write back.
 *
 * First user: the storylines system clears a finale whose segment goes, stops being a match or no
 * longer links the storyline (CRTV4-01, `storylines.clearFinaleOnRemove`), so the
 * `finaleIsLinkedMatch` invariant holds after every booking change.
 *
 * Design notes: docs/design/booking.md#integration.
 */

import { RegistryError } from '../../core/errors';
import type { SegmentId } from '../../core/ids';
import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';

/** What a system registers to hear about segment writes. */
export interface SegmentHook {
  /** `system.camelName`, such as `storylines.clearFinaleOnRemove`. */
  readonly id: string;
  /** Before the segment and its participants are deleted; the segment is still readable. */
  beforeRemove?(tx: Tx<GameTables>, segmentId: SegmentId): void;
  /** After the segment was created or replaced in place; `tx.view` shows the new row. */
  afterWrite?(tx: Tx<GameTables>, segmentId: SegmentId): void;
}

const HOOK_ID_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

const hooks = new Map<string, SegmentHook>();

/**
 * Adds a segment hook. Throws `RegistryError` for an id that is not `system.camelName` or is
 * already registered. Returns a function that removes it again (for tests).
 */
export function registerSegmentHook(hook: SegmentHook): () => void {
  if (!HOOK_ID_PATTERN.test(hook.id)) {
    throw new RegistryError(
      `Segment hook id ${JSON.stringify(hook.id)} must look like "system.camelName"`,
      { hook: hook.id },
    );
  }
  if (hooks.has(hook.id)) {
    throw new RegistryError(`Segment hook ${hook.id} is already registered`, { hook: hook.id });
  }
  hooks.set(hook.id, hook);
  return () => {
    if (hooks.get(hook.id) === hook) {
      hooks.delete(hook.id);
    }
  };
}

/** Every registered hook, in id order. */
export function registeredSegmentHooks(): readonly SegmentHook[] {
  return [...hooks.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

/** Removes every hook and returns a function that puts them back (for tests). */
export function clearSegmentHooksForTests(): () => void {
  const saved = [...hooks.values()];
  hooks.clear();
  return () => {
    hooks.clear();
    for (const hook of saved) {
      hooks.set(hook.id, hook);
    }
  };
}

/** Runs every `beforeRemove` hook for `segmentId`. */
export function runBeforeRemoveHooks(tx: Tx<GameTables>, segmentId: SegmentId): void {
  for (const hook of registeredSegmentHooks()) {
    hook.beforeRemove?.(tx, segmentId);
  }
}

/** Runs every `afterWrite` hook for `segmentId`. */
export function runAfterWriteHooks(tx: Tx<GameTables>, segmentId: SegmentId): void {
  for (const hook of registeredSegmentHooks()) {
    hook.afterWrite?.(tx, segmentId);
  }
}
