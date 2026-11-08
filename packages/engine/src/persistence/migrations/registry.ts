/**
 * The save migration registry.
 *
 * Each migration upgrades a save document by exactly one format version, working on plain JSON.
 * Migrations never import the current schemas or entity types: a v3 → v4 step has to keep working
 * after the v4 schema changes again in v5, and a migration that leans on live types rots the day
 * they move on. See "Writing a migration" in `docs/design/save-format.md`.
 *
 * Format v1 is not frozen yet: until the first public build is tagged, schema changes edit v1 in
 * place and regenerate the golden fixture, so this list stays empty.
 */

import { RegistryError } from '../../core/errors';
import type { JsonObject } from '../../core/json';

/** One upgrade step, from format version `from` to `from + 1`. */
export interface Migration {
  readonly from: number;
  readonly to: number;
  /** A short description for load reports, for example "Rename mic to talking". */
  readonly title: string;
  /**
   * Returns the upgraded document. It gets its own deep copy of the document, so it may build the
   * result from scratch or reuse parts of its input; it never sees the caller's copy. It does not
   * need to set `formatVersion`: the runner stamps `to` on the result.
   */
  up(doc: JsonObject): JsonObject;
}

/** The format version this build writes, and the newest it can read. */
export const CURRENT_FORMAT_VERSION = 1;

/** Every migration this build ships, in order. Empty while format v1 is unfrozen. */
export const MIGRATIONS: readonly Migration[] = [];

/**
 * Checks that `migrations` is one contiguous chain from v1 up to `current`: the step at position
 * `i` goes from `i + 1` to `i + 2`, and the last one ends at `current`. An empty list is valid only
 * when `current` is 1. Throws `RegistryError` naming the first broken link.
 */
export function assertMigrationChain(migrations: readonly Migration[], current: number): void {
  if (!Number.isInteger(current) || current < 1) {
    throw new RegistryError(`The current format version must be a whole number of 1 or more`, {
      current,
    });
  }
  migrations.forEach((migration, index) => {
    const expectedFrom = index + 1;
    if (migration.from !== expectedFrom || migration.to !== expectedFrom + 1) {
      throw new RegistryError(
        `Migration ${String(index)} "${migration.title}" goes from v${String(migration.from)} to v${String(migration.to)}; expected v${String(expectedFrom)} to v${String(expectedFrom + 1)}`,
        { index, title: migration.title, from: migration.from, to: migration.to },
      );
    }
  });
  const reached = migrations.length + 1;
  if (reached !== current) {
    throw new RegistryError(
      `The migrations reach v${String(reached)} but the current format version is v${String(current)}`,
      { reached, current },
    );
  }
}

// Checked when the module loads, in every build: the list is short and a broken chain must never
// reach a player's save.
assertMigrationChain(MIGRATIONS, CURRENT_FORMAT_VERSION);
