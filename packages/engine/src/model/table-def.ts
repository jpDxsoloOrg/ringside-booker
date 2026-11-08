/**
 * Table definitions: what the World store needs to know about one entity table.
 *
 * A `TableDef` names the table, the entity kind its rows belong to, the zod schema of a row, the
 * fields that reference other rows, the secondary indexes to maintain and the cross-row rules that
 * `checkWorld` runs. A `TableRegistry` is a plain object of table definitions keyed by table name;
 * the World store is generic over it, so the store can be built and tested with toy tables while
 * the real entity schemas plug into `model/tables.ts`.
 */

import type { z } from 'zod';
import type { EntityKind, IdOf } from '../core/ids';
import type { IntegrityIssue } from './integrity';
import type { WorldView } from './world';

/** A table name such as `people` or `employments`. Equal to the table's key in its registry. */
export type TableName = string;

/** The minimum shape of a row: every row carries its own ID. */
export interface EntityRow<K extends EntityKind = EntityKind> {
  readonly id: IdOf<K>;
}

/**
 * The target of a reference. An entity kind points at the table registered for that kind.
 * `player` points at `meta.players`, for fields that name the human player controlling something
 * (for example a promotion's controller).
 */
export type RefTarget = EntityKind | 'player';

/** The pseudo-kind for references to `meta.players[].playerId`. */
export const PLAYER_REF_TARGET = 'player' satisfies RefTarget;

/**
 * One reference field to check.
 *
 * `path` uses the mini-syntax resolved by `model/ref-path.ts`: dot-separated field names, `[]`
 * after a field to fan out over an array, and `{}` after the last field to treat a record's keys
 * as the references. Examples: `promotionId`, `members[].personId`, `crew.announcerIds[]`,
 * `regionalPop{}`. Missing optional fields are skipped. A `null` value is fine when `nullable` is
 * true and reported otherwise.
 */
export interface RefSpec {
  readonly path: string;
  readonly target: RefTarget;
  readonly nullable: boolean;
}

/**
 * A secondary index. `key` returns the key a row is filed under, an array of keys to file the
 * row under each of them (for lookups from either side, such as relationships by person), or
 * null to leave the row out of the index. A unique index allows one row per key.
 */
export interface IndexSpec<E> {
  readonly name: string;
  /** Method syntax on purpose: a table of a specific row type still fits a generic registry. */
  key(row: E): string | readonly string[] | null;
  readonly unique?: boolean;
}

/**
 * A cross-row rule such as "at most one active reign per title". `check` reads the world and
 * returns the problems it finds; an empty array means the rule holds.
 */
export interface Invariant {
  readonly name: string;
  check(world: WorldView): IntegrityIssue[];
}

export interface TableDef<
  K extends EntityKind = EntityKind,
  E extends EntityRow<K> = EntityRow<K>,
> {
  readonly kind: K;
  readonly name: TableName;
  readonly schema: z.ZodType<E>;
  /** Reference fields to check. */
  readonly refs: readonly RefSpec[];
  readonly indexes: readonly IndexSpec<E>[];
  /** Cross-row rules run by `checkWorld`. */
  readonly invariants?: readonly Invariant[];
  /** Rows are only ever inserted (the ledger, for example). Enforced by transactions. */
  readonly appendOnly?: boolean;
}

/** Every table of a world, keyed by table name. Each key must equal its definition's `name`. */
export type TableRegistry = Readonly<Record<TableName, TableDef>>;

/** The row type of a table definition. */
export type RowOf<D> = D extends TableDef<EntityKind, infer E> ? E : never;

/**
 * Declares a table. The function only returns its argument; it exists so TypeScript infers the
 * kind and row type from the schema instead of every definition spelling them out.
 */
export function defineTable<K extends EntityKind, E extends EntityRow<K>>(
  def: TableDef<K, E>,
): TableDef<K, E> {
  return def;
}
