/**
 * Pack format migrations.
 *
 * When the pack format changes, `PACK_FORMAT_VERSION` goes up by one and a migration is added
 * here that rewrites a raw pack of the old format into the new one. The loader (WLD-02) runs every
 * migration from a pack's `formatVersion` up to the current version, in order, before checking the
 * pack against the schemas. Format 1 is the first, so the list starts empty.
 */

import type { JsonValue } from '../../core/json';
import { PACK_FORMAT_VERSION } from './manifest';

/** A raw pack as the migrations see it: the manifest and each record file, still untyped JSON. */
export interface RawPackJson {
  manifest: JsonValue;
  files: Readonly<Record<string, JsonValue>>;
}

export interface PackFormatMigration {
  /** The format this migration reads. */
  from: number;
  /** Always `from + 1`. */
  to: number;
  /** What changed, for the changelog and error messages. */
  description: string;
  migrate(pack: RawPackJson): RawPackJson;
}

export const PACK_FORMAT_MIGRATIONS: readonly PackFormatMigration[] = [];

/**
 * True when the migrations form one unbroken chain: each moves exactly one version up, each starts
 * where the previous one ended, and the last one ends at `currentVersion`. An empty list is a valid
 * chain while the current version is the first format.
 */
export function isMigrationChain(
  migrations: readonly PackFormatMigration[],
  currentVersion: number = PACK_FORMAT_VERSION,
): boolean {
  if (migrations.length === 0) {
    return currentVersion === 1;
  }
  const first = migrations[0];
  if (first?.from !== 1) {
    return false;
  }
  let expectedFrom = 1;
  for (const migration of migrations) {
    if (migration.from !== expectedFrom || migration.to !== migration.from + 1) {
      return false;
    }
    expectedFrom = migration.to;
  }
  return expectedFrom === currentVersion;
}
