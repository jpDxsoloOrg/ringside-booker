/**
 * The "before a show runs" seam: hooks that run once, just before a show's first segment, in the
 * same step as the show itself.
 *
 * The player's show runs when they press Run the show (`shows.runTonight`); every other show runs
 * in the `shows.runShows` phase. Both paths call {@link runBeforeShowRunsHooks} first, then re-read
 * the show, so a hook's writes (EVT6-03 picking a venue for a show that has none) are what the
 * show runs with. A hook is the place for "do this when the show runs": there is no lock any more
 * (EVT2-09), so nothing like `card.locked` announces it in advance, and an event published in the
 * same step would only be delivered after the show had already run.
 *
 * Module-level, like the other show night seams: a system registers at module load and tests
 * unregister what they added. Design: docs/design/show-night.md#before-a-show-runs.
 */

import { RegistryError } from '../../core/errors';
import type { PhaseContext } from '../../core/pipeline/context';
import { PHASE_ID_PATTERN } from '../../core/pipeline/phase';
import type { EventInstance } from '../../model/entities/event-instance';
import type { DeepReadonly } from '../../model/world';

/** What a hook is told about the show that is about to run. */
export interface BeforeShowRunsInput {
  /** The show as it stands before any hook ran. Read the world through `ctx.read` for later writes. */
  readonly show: DeepReadonly<EventInstance>;
  /** True when a human runs the show (it runs from `shows.runTonight`). */
  readonly human: boolean;
  /**
   * True when the show runs before its day's phases: the player pressed Run the show
   * (`shows.runTonight`), so nothing of the day, not even its housekeeping, has run yet. False for
   * a show the shows phase runs inside the day. WRK6-07: the health system runs the day's morning
   * first (`health.morningBeforeShow`).
   */
  readonly beforeTheDay: boolean;
}

/** A hook that runs just before a show runs. */
export interface BeforeShowRunsHook {
  /** `system.camelName`, like a phase id, for example `venues.pickOnShowNight`. */
  readonly id: string;
  /** Lower runs first; equal orders run by id. */
  readonly order: number;
  /**
   * Writes through `ctx.tx`. A throw rolls back the show with it (the whole day's shows on the
   * phase path), so bad data should be logged with `ctx.log` and skipped, never thrown.
   */
  readonly run: (ctx: PhaseContext, input: BeforeShowRunsInput) => void;
}

const hooks = new Map<string, BeforeShowRunsHook>();

/**
 * Adds a before-a-show-runs hook.
 *
 * @throws RegistryError for a malformed id, an order that is not a finite number or an id that is
 *   already registered.
 */
export function registerBeforeShowRuns(def: BeforeShowRunsHook): void {
  if (!PHASE_ID_PATTERN.test(def.id)) {
    throw new RegistryError(
      `Before-show hook "${def.id}": the id must look like "system.camelName", for example "venues.pickOnShowNight"`,
      { id: def.id },
    );
  }
  if (!Number.isFinite(def.order)) {
    throw new RegistryError(`Before-show hook "${def.id}": the order must be a finite number`, {
      id: def.id,
    });
  }
  if (hooks.has(def.id)) {
    throw new RegistryError(
      `Before-show hook "${def.id}": a hook with this id is already registered`,
      { id: def.id },
    );
  }
  hooks.set(def.id, { ...def });
}

/** Every registered hook, in the order they run: by `order`, then id. */
export function listBeforeShowRuns(): BeforeShowRunsHook[] {
  return [...hooks.values()].sort(
    (left, right) =>
      left.order - right.order || (left.id === right.id ? 0 : left.id < right.id ? -1 : 1),
  );
}

/** Removes a hook. Returns false when none had that id. */
export function unregisterBeforeShowRuns(id: string): boolean {
  return hooks.delete(id);
}

/** Runs every registered hook for `show`, in order. */
export function runBeforeShowRunsHooks(ctx: PhaseContext, input: BeforeShowRunsInput): void {
  for (const hook of listBeforeShowRuns()) {
    hook.run(ctx, input);
  }
}
