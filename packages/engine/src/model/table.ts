/**
 * One entity table of the World store.
 *
 * Everyone reads through `ReadonlyTable`. Only transactions write, through the internal
 * `MutableTable` methods `_put` and `_delete`; `MutableTable` is not exported from the package.
 *
 * Canonical order: `ids()`, `values()`, `entries()` and `lookup()` always list rows in ascending ID
 * order (plain UTF-16 code-unit comparison), whatever order they were inserted in. Iteration is
 * then a pure function of the table's contents, so a reloaded save iterates exactly like the world
 * that kept running. The sorted ID list is cached and only rebuilt after an insert or a delete;
 * updating an existing row keeps the cache.
 */

import { isId, type EntityKind } from '../core/ids';
import { EntityNotFoundError, UniqueIndexError, UnknownIndexError } from '../core/errors';
import type { EntityRow, IndexSpec, TableDef, TableName } from './table-def';

export interface ReadonlyTable<E extends EntityRow = EntityRow> {
  readonly name: TableName;
  readonly kind: EntityKind;
  /** The definition this table was built from. */
  readonly def: TableDef<EntityKind, E>;
  /** Number of rows. */
  readonly size: number;
  get(id: E['id']): E | undefined;
  /** The row with `id`, or throws `EntityNotFoundError` naming the kind and the ID. */
  require(id: E['id']): E;
  has(id: E['id']): boolean;
  /** All IDs in ascending order. */
  ids(): readonly E['id'][];
  /** All rows in ascending ID order. */
  values(): readonly E[];
  /** Every stored key with its row, in ascending key order. A key always equals its row's ID. */
  entries(): readonly (readonly [E['id'], E])[];
  /** Rows filed under `key` in the named index, in ascending ID order. */
  lookup(indexName: string, key: string): readonly E[];
  /** The row filed under `key` in the named unique index, if any. Throws for a non-unique index. */
  lookupOne(indexName: string, key: string): E | undefined;
}

/** Plain UTF-16 code-unit order, the canonical order for IDs. */
export function compareIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/** True when `value` is a well-formed ID of the kind `table` holds. */
export function isIdOfTable<E extends EntityRow>(
  table: ReadonlyTable<E>,
  value: unknown,
): value is E['id'] {
  return isId(table.kind, value);
}

/**
 * True when `candidate` carries an ID of the kind `table` holds. Only the ID is checked here: the
 * other fields are guaranteed by the caller's static types, and checked against the table's schema
 * when write validation is on.
 */
export function hasIdOfTable<E extends EntityRow>(
  table: ReadonlyTable<E>,
  candidate: object,
): candidate is E {
  return isIdOfTable(table, Reflect.get(candidate, 'id'));
}

interface IndexState<E extends EntityRow> {
  readonly spec: IndexSpec<E>;
  /** Index key → storage keys of the rows filed under it. */
  readonly buckets: Map<string, Set<E['id']>>;
}

function indexKeysOf<E>(spec: IndexSpec<E>, row: E): readonly string[] {
  const key = spec.key(row);
  if (key === null) {
    return [];
  }
  if (typeof key === 'string') {
    return [key];
  }
  return [...new Set(key)];
}

/**
 * The writable table behind every `ReadonlyTable`. Internal to the model layer: transactions
 * (`model/tx.ts`) and save loading call the underscore methods; systems and the UI never see them.
 * Rolling a transaction back also goes through `_put` and `_delete`, so indexes are restored with
 * the rows.
 */
export class MutableTable<E extends EntityRow> implements ReadonlyTable<E> {
  readonly name: TableName;
  readonly kind: EntityKind;
  readonly def: TableDef<EntityKind, E>;

  private readonly rows = new Map<E['id'], E>();
  private readonly indexes = new Map<string, IndexState<E>>();
  private sortedIds: readonly E['id'][] | null = null;

  constructor(def: TableDef<EntityKind, E>) {
    this.def = def;
    this.name = def.name;
    this.kind = def.kind;
    for (const spec of def.indexes) {
      this.indexes.set(spec.name, { spec, buckets: new Map() });
    }
  }

  get size(): number {
    return this.rows.size;
  }

  get(id: E['id']): E | undefined {
    return this.rows.get(id);
  }

  require(id: E['id']): E {
    const row = this.rows.get(id);
    if (row === undefined) {
      throw new EntityNotFoundError(this.kind, id);
    }
    return row;
  }

  has(id: E['id']): boolean {
    return this.rows.has(id);
  }

  ids(): readonly E['id'][] {
    this.sortedIds ??= this._sortIds();
    return this.sortedIds;
  }

  values(): readonly E[] {
    return this.ids().map((id) => this.require(id));
  }

  entries(): readonly (readonly [E['id'], E])[] {
    return this.ids().map((id) => [id, this.require(id)] as const);
  }

  lookup(indexName: string, key: string): readonly E[] {
    const bucket = this.indexState(indexName).buckets.get(key);
    if (bucket === undefined) {
      return [];
    }
    return [...bucket].sort(compareIds).map((id) => this.require(id));
  }

  lookupOne(indexName: string, key: string): E | undefined {
    const state = this.indexState(indexName);
    if (state.spec.unique !== true) {
      throw new UnknownIndexError(this.name, indexName, 'is not unique; use lookup()');
    }
    const [onlyId] = state.buckets.get(key) ?? [];
    return onlyId === undefined ? undefined : this.require(onlyId);
  }

  /** Inserts `row`, or replaces the row with the same ID, and re-files it in every index. */
  _put(row: E): void {
    this._putAt(row.id, row);
  }

  /**
   * Stores `row` under `key`. Normally `key` is `row.id` (that is what `_put` does). Save loading
   * passes the key it read, so `checkWorld` can report a row stored under the wrong key instead of
   * the loader quietly fixing it.
   */
  _putAt(key: E['id'], row: E): void {
    const previous = this.rows.get(key);
    const newKeysByIndex = new Map<string, readonly string[]>();
    for (const [indexName, state] of this.indexes) {
      const newKeys = indexKeysOf(state.spec, row);
      if (state.spec.unique === true) {
        for (const indexKey of newKeys) {
          const holders = state.buckets.get(indexKey);
          const heldByOther = holders !== undefined && [...holders].some((held) => held !== key);
          if (heldByOther) {
            throw new UniqueIndexError(this.name, indexName, indexKey);
          }
        }
      }
      newKeysByIndex.set(indexName, newKeys);
    }
    if (previous !== undefined) {
      this.unfile(key, previous);
    }
    for (const [indexName, state] of this.indexes) {
      for (const indexKey of newKeysByIndex.get(indexName) ?? []) {
        let bucket = state.buckets.get(indexKey);
        if (bucket === undefined) {
          bucket = new Set();
          state.buckets.set(indexKey, bucket);
        }
        bucket.add(key);
      }
    }
    this.rows.set(key, row);
    if (previous === undefined) {
      this.sortedIds = null;
    }
  }

  /** Removes the row stored under `id` and returns it. Throws `EntityNotFoundError` if absent. */
  _delete(id: E['id']): E {
    const row = this.require(id);
    this.unfile(id, row);
    this.rows.delete(id);
    this.sortedIds = null;
    return row;
  }

  /** Builds the sorted ID list. Separate so tests can prove updates do not trigger a rebuild. */
  _sortIds(): readonly E['id'][] {
    return Object.freeze([...this.rows.keys()].sort(compareIds));
  }

  private indexState(indexName: string): IndexState<E> {
    const state = this.indexes.get(indexName);
    if (state === undefined) {
      throw new UnknownIndexError(this.name, indexName);
    }
    return state;
  }

  private unfile(key: E['id'], row: E): void {
    for (const state of this.indexes.values()) {
      for (const indexKey of indexKeysOf(state.spec, row)) {
        const bucket = state.buckets.get(indexKey);
        bucket?.delete(key);
        if (bucket?.size === 0) {
          state.buckets.delete(indexKey);
        }
      }
    }
  }
}
