/**
 * The engine's fast paths (POL4-09), and the switch that turns them off so a test can prove they
 * change nothing.
 *
 * A long skip spends most of its time on work only the player sees: traces a Why? may open, region
 * previews, roll-ups of every country on the map. The fast paths skip or shorten that work where
 * the result is known to be the same: the same world, the same stored traces, the same save. With
 * the fast paths off the engine takes the full path everywhere, which is what the equivalence test
 * (`test/core/fastPaths.test.ts`) runs side by side with the default.
 *
 * Module state, on purpose: it is only ever turned off by tests, around one run, and put back.
 *
 * Design: docs/design/day-pipeline.md#fast-paths.
 */

let enabled = true;

/** True unless a test turned the fast paths off. */
export function fastPathsEnabled(): boolean {
  return enabled;
}

/** Turns the fast paths on or off and returns what they were, so a test can put it back. */
export function setFastPaths(on: boolean): boolean {
  const was = enabled;
  enabled = on;
  return was;
}
