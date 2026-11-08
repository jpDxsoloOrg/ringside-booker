/**
 * Pack keys to entity IDs, through `WorldMeta.contentKeys` (filled by the pack loader).
 */

import { isId, type EntityKind, type IdOf } from '../../core/ids';
import type { DeepReadonly } from '../../model/world';
import type { WorldMeta } from '../../model/world-meta';

/** The ID minted for the pack record `key` of `kind`, or null when no such record was loaded. */
export function contentIdOf<K extends EntityKind>(
  meta: DeepReadonly<WorldMeta>,
  kind: K,
  key: string,
): IdOf<K> | null {
  const byKey = meta.contentKeys[kind];
  if (byKey === undefined || !Object.hasOwn(byKey, key)) {
    return null;
  }
  const id = byKey[key];
  return isId(kind, id) ? id : null;
}

/** The pack key each entity of `kind` was loaded from, by ID. */
export function contentKeysById(
  meta: DeepReadonly<WorldMeta>,
  kind: EntityKind,
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [key, id] of Object.entries(meta.contentKeys[kind] ?? {})) {
    keys.set(id, key);
  }
  return keys;
}
