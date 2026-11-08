/**
 * The World store: all game state in one object.
 *
 * A world is its metadata plus one table per registry entry. `World<R>` is the writable form that
 * only the model layer and the pipeline hold; `WorldView<R>` is the deep read-only form handed to
 * queries, formulas and invariants. Entities reference each other only by ID. All writes go
 * through `world.transact` (see `model/tx.ts`).
 */

import { RegistryError } from '../core/errors';
import type { EntityKind, IdFactory } from '../core/ids';
import { MutableTable, type ReadonlyTable } from './table';
import type { EntityRow, RowOf, TableDef, TableName, TableRegistry } from './table-def';
import { createTransactor, type Transactor, type ValidateMode } from './tx';
import type { WorldMeta } from './world-meta';

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/** A read-only version of `T` all the way down. Branded strings stay branded. */
export type DeepReadonly<T> = T extends Primitive
  ? T
  : T extends readonly (infer Element)[]
    ? readonly DeepReadonly<Element>[]
    : { readonly [Key in keyof T]: DeepReadonly<T[Key]> };

/**
 * The data of a world: its metadata and its tables. Transactions write here; nothing else does
 * (save loading fills a fresh world's tables before anyone reads them).
 */
export interface WorldData<R extends TableRegistry> {
  /** Replaced as a whole by transactions, never edited in place. */
  meta: WorldMeta;
  readonly tables: { readonly [Name in keyof R]: MutableTable<RowOf<R[Name]>> };
}

/** The writable world: its data plus `transact` and `setIdFactory`. Not exported from the package. */
export interface World<R extends TableRegistry> extends WorldData<R>, Transactor<R> {}

export interface CreateWorldOptions {
  /**
   * The factory `tx.create` mints IDs from. The runtime installs the seeded minter; tests install
   * one over `sequentialIdEntropy`. Without one, `tx.create` throws. See `world.setIdFactory`.
   */
  readonly idFactory?: IdFactory;
  /**
   * `always` parses every written row and metadata patch with its schema and freezes stored rows.
   * Test setup and the test builders turn it on; the default is `never`, for speed. A single
   * `transact` call can override it.
   */
  readonly validateWrites?: ValidateMode;
}

/** The read-only world handed to queries, formulas and invariants. */
export interface WorldView<R extends TableRegistry = TableRegistry> {
  readonly meta: DeepReadonly<WorldMeta>;
  readonly tables: { readonly [Name in keyof R]: ReadonlyTable<RowOf<R[Name]>> };
}

/**
 * Checks that every registry key equals its table's name and that no two tables share a kind.
 * Throws `RegistryError` on the first problem.
 */
export function assertValidRegistry(registry: TableRegistry): void {
  const tableByKind = new Map<EntityKind, TableName>();
  for (const [key, def] of Object.entries(registry)) {
    if (def.name !== key) {
      throw new RegistryError(
        `Registry key ${JSON.stringify(key)} holds table ${JSON.stringify(def.name)}; they must match`,
        { key, table: def.name },
      );
    }
    const existing = tableByKind.get(def.kind);
    if (existing !== undefined) {
      throw new RegistryError(
        `Tables ${JSON.stringify(existing)} and ${JSON.stringify(def.name)} share kind ${def.kind}`,
        { kind: def.kind, first: existing, second: def.name },
      );
    }
    tableByKind.set(def.kind, def.name);
  }
}

/** True when `tables` holds a table built from each registry entry, under the entry's key. */
function isTablesOf<R extends TableRegistry>(
  registry: R,
  tables: unknown,
): tables is World<R>['tables'] {
  if (typeof tables !== 'object' || tables === null) {
    return false;
  }
  return Object.entries(registry).every(([name, def]) => {
    const table: unknown = Reflect.get(tables, name);
    return table instanceof MutableTable && table.def === def;
  });
}

/**
 * Builds an empty world with one table per registry entry. Throws `RegistryError` when two entries
 * share a table name or a kind.
 */
export function createWorld<R extends TableRegistry>(
  registry: R,
  meta: WorldMeta,
  options: CreateWorldOptions = {},
): World<R> {
  assertValidRegistry(registry);
  const tables: Record<TableName, MutableTable<EntityRow>> = {};
  for (const [name, def] of Object.entries(registry)) {
    tables[name] = new MutableTable(def);
  }
  if (!isTablesOf(registry, tables)) {
    throw new RegistryError('Could not build a table for every registry entry');
  }
  const data: WorldData<R> = { meta, tables };
  return Object.assign(data, createTransactor(data, options));
}

function isTableOf<K extends EntityKind, E extends EntityRow<K>>(
  table: ReadonlyTable,
  def: TableDef<K, E>,
): table is ReadonlyTable<E> {
  return table.def === def;
}

/**
 * The table built from `def`, typed with its row type. Invariants receive a registry-agnostic
 * `WorldView`, so they use this to read their own table (and any other) with full types. Throws
 * `RegistryError` when the world has no table built from `def`.
 */
export function tableOf<K extends EntityKind, E extends EntityRow<K>>(
  view: WorldView,
  def: TableDef<K, E>,
): ReadonlyTable<E> {
  const table = view.tables[def.name];
  if (table === undefined || !isTableOf(table, def)) {
    throw new RegistryError(`The world has no table built from the ${def.name} definition`, {
      table: def.name,
    });
  }
  return table;
}
