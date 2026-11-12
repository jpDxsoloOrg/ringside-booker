/**
 * Transactions: the World store's only write path.
 *
 * `world.transact(label, body)` hands `body` a `Tx`. Every insert, update, delete and metadata
 * change made through it is applied to the world straight away (so reads inside the transaction see
 * its own writes) and recorded in an undo journal. If `body` throws, the journal is walked backwards
 * and every change is undone through `MutableTable._put` / `_delete`, so rows, indexes and metadata
 * end up exactly as they were. A `savepoint` is a nested scope that rolls back only its own writes.
 *
 * Bodies are synchronous. The journal assumes nothing else writes between an op and its undo, and
 * the engine never needs to await (it does no I/O).
 *
 * A committed transaction returns a `ChangeSet`: which rows of which tables were inserted, updated
 * or deleted, and whether the metadata changed. It is plain JSON, so it crosses the worker boundary
 * and lets the UI refresh only the queries that read a changed table.
 *
 * See the "Transactions" section of `docs/design/data-model.md`.
 */

import {
  AppendOnlyError,
  DuplicateIdError,
  InvalidArgumentError,
  InvalidIdError,
  SchemaViolationError,
  TxStateError,
  describeValue,
  type EngineError,
} from '../core/errors';
import type { EntityKind, IdFactory, IdOf } from '../core/ids';
import { formatPath } from '../core/json';
import { compareIds, hasIdOfTable, isIdOfTable, type MutableTable } from './table';
import type { EntityRow, RowOf, TableName, TableRegistry } from './table-def';
import type { WorldData, WorldView } from './world';
import { WorldMetaSchema, type WorldMeta } from './world-meta';

/** Whether writes are parsed with their zod schema (and stored rows frozen). */
export type ValidateMode = 'always' | 'never';

export interface TransactOptions {
  /** Overrides the world's `validateWrites` setting for this transaction. */
  readonly validate?: ValidateMode;
}

/** An ID of any entity kind. */
export type AnyId = IdOf<EntityKind>;

/** The rows of one table a transaction touched, each list in ascending ID order. */
export interface TableChanges {
  readonly inserted: readonly AnyId[];
  readonly updated: readonly AnyId[];
  readonly deleted: readonly AnyId[];
}

/**
 * What a committed transaction changed. Tables it did not touch are absent. Plain JSON.
 *
 * Changes to one row collapse to their net effect: insert then update reports `inserted`, insert
 * then delete reports nothing, update then delete reports `deleted`, and delete then insert of the
 * same ID reports `updated`.
 */
export interface ChangeSet {
  readonly meta: boolean;
  readonly tables: Readonly<Partial<Record<TableName, TableChanges>>>;
}

export type TxResult<T> =
  | { readonly ok: true; readonly value: T; readonly changes: ChangeSet }
  | {
      readonly ok: false;
      readonly error: EngineError | Error;
      /** How many journal ops were undone. */
      readonly rolledBackOps: number;
      /** The label of the transaction or savepoint that failed. */
      readonly label: string;
    };

/** A table name of registry `R`. */
export type TableKey<R extends TableRegistry> = keyof R & string;

/** The fields `update` may shallow-merge into a row: anything but its ID. */
export type RowPatch<E> = Partial<Omit<E, 'id'>>;

/** Returns the next version of a row. Must return a new object, never mutate `previous`. */
export type RowUpdater<E> = (previous: E) => E;

export interface Tx<R extends TableRegistry = TableRegistry> {
  /** The label given to `transact` or `savepoint`, for error reports. */
  readonly label: string;
  /** The world as it stands, including this transaction's own writes so far. */
  readonly view: WorldView<R>;
  /**
   * Inserts `row`. Its ID must be a valid ID of the table's kind (`InvalidIdError`) and not in
   * the table yet (`DuplicateIdError`). Returns the stored row.
   */
  insert<Name extends TableKey<R>>(table: Name, row: RowOf<R[Name]>): RowOf<R[Name]>;
  /**
   * Mints a new ID with the world's ID factory, inserts `fields` under it and returns the full row.
   * Throws `TxStateError` when no ID factory is installed.
   */
  create<Name extends TableKey<R>>(table: Name, fields: Omit<RowOf<R[Name]>, 'id'>): RowOf<R[Name]>;
  /**
   * Mints a new ID for `table` with the world's ID factory without inserting anything, for a row
   * whose fields must name its own ID (a ledger row's trace ref, for example). Insert the row with
   * `insert`. Throws `TxStateError` when no ID factory is installed.
   */
  mintId<Name extends TableKey<R>>(table: Name): RowOf<R[Name]>['id'];
  /**
   * Shallow-merges `change` into the row, or replaces the row with what the updater returns.
   * Changing the ID throws `InvalidArgumentError`; a missing row throws `EntityNotFoundError`.
   * Returns the new row.
   */
  update<Name extends TableKey<R>>(
    table: Name,
    id: RowOf<R[Name]>['id'],
    change: RowPatch<RowOf<R[Name]>> | RowUpdater<RowOf<R[Name]>>,
  ): RowOf<R[Name]>;
  /** Deletes the row. A missing row throws `EntityNotFoundError`. */
  delete<Name extends TableKey<R>>(table: Name, id: RowOf<R[Name]>['id']): void;
  /** Shallow-merges `patch` into the world metadata. */
  setMeta(patch: Partial<WorldMeta>): void;
  /**
   * Runs `body` as a nested scope. If it throws, only its own writes are rolled back and the
   * failure comes back as the result; the enclosing transaction carries on.
   */
  savepoint<T>(label: string, body: (tx: Tx<R>) => T): TxResult<T>;
}

/** One undo record. `before` is the row (or metadata) as it was before the op. */
export type JournalOp =
  | { readonly op: 'insert'; readonly table: TableName; readonly id: AnyId }
  | {
      readonly op: 'update';
      readonly table: TableName;
      readonly id: AnyId;
      readonly before: EntityRow;
    }
  | {
      readonly op: 'delete';
      readonly table: TableName;
      readonly id: AnyId;
      readonly before: EntityRow;
    }
  | { readonly op: 'meta'; readonly before: WorldMeta };

/** The transaction methods `createWorld` adds to a world. */
export interface Transactor<R extends TableRegistry> {
  /**
   * Runs `body` in a transaction. Writes are kept when it returns and rolled back when it throws;
   * either way the outcome comes back as a `TxResult`. Only one top-level transaction may be open
   * at a time: calling `transact` inside one throws `TxStateError` (use `tx.savepoint`).
   */
  transact<T>(label: string, body: (tx: Tx<R>) => T, options?: TransactOptions): TxResult<T>;
  /**
   * Installs the ID factory `tx.create` mints from. Throws `TxStateError` while a transaction is
   * open.
   */
  setIdFactory(factory: IdFactory): void;
}

export interface TransactorOptions {
  readonly idFactory?: IdFactory;
  readonly validateWrites?: ValidateMode;
}

function isUpdater<E>(change: RowPatch<E> | RowUpdater<E>): change is RowUpdater<E> {
  return typeof change === 'function';
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  const isObjectLike = (typeof value === 'object' && value !== null) || typeof value === 'function';
  return isObjectLike && typeof Reflect.get(value, 'then') === 'function';
}

/**
 * Waits out an async body that was already rejected. Its failure has been reported as the
 * transaction's result; any write it attempts after its first `await` throws `TxStateError` inside
 * the promise, and that rejection is dropped here instead of surfacing as an unhandled one.
 */
async function settleQuietly(pending: PromiseLike<unknown>): Promise<void> {
  try {
    await pending;
  } catch {
    // Already reported: the transaction failed with "transaction bodies must be synchronous".
  }
}

function toError(thrown: unknown): Error {
  return thrown instanceof Error
    ? thrown
    : new Error(`Transaction body threw a non-error value: ${describeValue(thrown)}`);
}

/** Freezes `value` and everything inside it. Rows are plain JSON, so there are no cycles. */
function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }
  Object.freeze(value);
  const children: unknown[] = Object.values(value);
  for (const child of children) {
    deepFreeze(child);
  }
}

function schemaProblems(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
  return issues.map((issue) => ({ path: formatPath('$', issue.path), message: issue.message }));
}

interface RowFate {
  readonly existedBefore: boolean;
  existsAfter: boolean;
}

/** Collapses journal ops into their net effect per row. */
export function changesOf(ops: readonly JournalOp[]): ChangeSet {
  let meta = false;
  const fatesByTable = new Map<TableName, Map<AnyId, RowFate>>();
  for (const entry of ops) {
    if (entry.op === 'meta') {
      meta = true;
      continue;
    }
    let fates = fatesByTable.get(entry.table);
    if (fates === undefined) {
      fates = new Map();
      fatesByTable.set(entry.table, fates);
    }
    const existsAfter = entry.op !== 'delete';
    const fate = fates.get(entry.id);
    if (fate === undefined) {
      fates.set(entry.id, { existedBefore: entry.op !== 'insert', existsAfter });
    } else {
      fate.existsAfter = existsAfter;
    }
  }
  const tables: Record<TableName, TableChanges> = {};
  const tableNames = [...fatesByTable.keys()].sort(compareIds);
  for (const tableName of tableNames) {
    const inserted: AnyId[] = [];
    const updated: AnyId[] = [];
    const deleted: AnyId[] = [];
    for (const [id, fate] of fatesByTable.get(tableName) ?? []) {
      if (fate.existsAfter) {
        (fate.existedBefore ? updated : inserted).push(id);
      } else if (fate.existedBefore) {
        deleted.push(id);
      }
    }
    if (inserted.length + updated.length + deleted.length > 0) {
      tables[tableName] = {
        inserted: inserted.sort(compareIds),
        updated: updated.sort(compareIds),
        deleted: deleted.sort(compareIds),
      };
    }
  }
  return { meta, tables };
}

/** The state shared by a top-level transaction and its savepoints. */
class TxCore<R extends TableRegistry> {
  readonly journal: JournalOp[] = [];
  /** Open scopes, outermost first. Only the innermost one may write. */
  readonly scopes: TxScope<R>[] = [];
  private readonly tablesByName = new Map<TableName, MutableTable<EntityRow>>();

  constructor(
    readonly state: WorldData<R>,
    readonly validate: boolean,
    private readonly currentIdFactory: () => IdFactory | null,
  ) {
    const tables: Readonly<Record<TableName, MutableTable<EntityRow>>> = state.tables;
    for (const [name, table] of Object.entries(tables)) {
      this.tablesByName.set(name, table);
    }
  }

  /** Runs `body` in a new innermost scope; rolls back to where the scope started if it throws. */
  runScope<T>(label: string, body: (tx: Tx<R>) => T): TxResult<T> {
    const scope = new TxScope(this, label);
    const mark = this.journal.length;
    this.scopes.push(scope);
    try {
      const value = body(scope);
      if (isThenable(value)) {
        void settleQuietly(value);
        throw new TxStateError('transaction bodies must be synchronous');
      }
      return { ok: true, value, changes: changesOf(this.journal.slice(mark)) };
    } catch (thrown) {
      const rolledBackOps = this.rollbackTo(mark);
      return { ok: false, error: toError(thrown), rolledBackOps, label };
    } finally {
      scope.close();
      this.scopes.pop();
    }
  }

  insertRow<E extends EntityRow>(table: MutableTable<E>, row: E): E {
    if (!isIdOfTable(table, row.id)) {
      throw new InvalidIdError(table.kind, row.id);
    }
    if (table.has(row.id)) {
      throw new DuplicateIdError(table.name, row.id);
    }
    const stored = this.prepareRow(table, row);
    table._put(stored);
    this.journal.push({ op: 'insert', table: table.name, id: stored.id });
    return stored;
  }

  mintRowId<E extends EntityRow>(table: MutableTable<E>): E['id'] {
    const factory = this.currentIdFactory();
    if (factory === null) {
      throw new TxStateError('no IdFactory installed');
    }
    const id = factory.next(
      table.kind,
      (candidate) => isIdOfTable(table, candidate) && table.has(candidate),
    );
    if (!isIdOfTable(table, id)) {
      throw new InvalidIdError(table.kind, id);
    }
    return id;
  }

  createRow<E extends EntityRow>(table: MutableTable<E>, fields: Omit<E, 'id'>): E {
    const id = this.mintRowId(table);
    const row = { ...fields, id };
    if (!hasIdOfTable(table, row)) {
      throw new InvalidIdError(table.kind, id);
    }
    return this.insertRow(table, row);
  }

  updateRow<E extends EntityRow>(
    table: MutableTable<E>,
    id: E['id'],
    change: RowPatch<E> | RowUpdater<E>,
  ): E {
    if (table.def.appendOnly === true) {
      throw new AppendOnlyError(table.name, 'update', id);
    }
    const previous = table.require(id);
    const next = isUpdater(change) ? change(previous) : { ...previous, ...change };
    if (next.id !== id) {
      throw new InvalidArgumentError('Tx.update', 'the row ID', next.id, `unchanged (${id})`);
    }
    const stored = this.prepareRow(table, next);
    table._put(stored);
    this.journal.push({ op: 'update', table: table.name, id, before: previous });
    return stored;
  }

  deleteRow<E extends EntityRow>(table: MutableTable<E>, id: E['id']): void {
    if (table.def.appendOnly === true) {
      throw new AppendOnlyError(table.name, 'delete', id);
    }
    const before = table.require(id);
    table._delete(id);
    this.journal.push({ op: 'delete', table: table.name, id, before });
  }

  setMeta(patch: Partial<WorldMeta>): void {
    let next: WorldMeta = { ...this.state.meta, ...patch };
    if (this.validate) {
      const result = WorldMetaSchema.safeParse(next);
      if (!result.success) {
        throw new SchemaViolationError('world metadata', schemaProblems(result.error.issues));
      }
      next = result.data;
      deepFreeze(next);
    }
    this.journal.push({ op: 'meta', before: this.state.meta });
    this.state.meta = next;
  }

  /** Undoes journal ops, newest first, until the journal is `mark` long. Returns how many. */
  private rollbackTo(mark: number): number {
    let undone = 0;
    while (this.journal.length > mark) {
      const entry = this.journal.pop();
      if (entry === undefined) {
        break;
      }
      this.undo(entry);
      undone += 1;
    }
    return undone;
  }

  private undo(entry: JournalOp): void {
    if (entry.op === 'meta') {
      this.state.meta = entry.before;
      return;
    }
    const table = this.tablesByName.get(entry.table);
    if (table === undefined) {
      throw new TxStateError(`journal names unknown table ${JSON.stringify(entry.table)}`);
    }
    if (entry.op === 'insert') {
      table._delete(entry.id);
    } else {
      table._put(entry.before);
    }
  }

  /** Parses the row with its schema and freezes it in validate mode; returns it as is otherwise. */
  private prepareRow<E extends EntityRow>(table: MutableTable<E>, row: E): E {
    if (!this.validate) {
      return row;
    }
    const result = table.def.schema.safeParse(row);
    if (!result.success) {
      throw new SchemaViolationError(
        `${table.name} row ${JSON.stringify(row.id)}`,
        schemaProblems(result.error.issues),
      );
    }
    deepFreeze(result.data);
    return result.data;
  }
}

/** The `Tx` handle given to a transaction or savepoint body. Dead once its scope ends. */
class TxScope<R extends TableRegistry> implements Tx<R> {
  private open = true;

  constructor(
    private readonly core: TxCore<R>,
    readonly label: string,
  ) {}

  get view(): WorldView<R> {
    return this.core.state;
  }

  close(): void {
    this.open = false;
  }

  insert<Name extends TableKey<R>>(table: Name, row: RowOf<R[Name]>): RowOf<R[Name]> {
    const core = this.writableCore();
    return core.insertRow(core.state.tables[table], row);
  }

  create<Name extends TableKey<R>>(
    table: Name,
    fields: Omit<RowOf<R[Name]>, 'id'>,
  ): RowOf<R[Name]> {
    const core = this.writableCore();
    return core.createRow(core.state.tables[table], fields);
  }

  mintId<Name extends TableKey<R>>(table: Name): RowOf<R[Name]>['id'] {
    const core = this.writableCore();
    return core.mintRowId(core.state.tables[table]);
  }

  update<Name extends TableKey<R>>(
    table: Name,
    id: RowOf<R[Name]>['id'],
    change: RowPatch<RowOf<R[Name]>> | RowUpdater<RowOf<R[Name]>>,
  ): RowOf<R[Name]> {
    const core = this.writableCore();
    return core.updateRow(core.state.tables[table], id, change);
  }

  delete<Name extends TableKey<R>>(table: Name, id: RowOf<R[Name]>['id']): void {
    const core = this.writableCore();
    core.deleteRow(core.state.tables[table], id);
  }

  setMeta(patch: Partial<WorldMeta>): void {
    this.writableCore().setMeta(patch);
  }

  savepoint<T>(label: string, body: (tx: Tx<R>) => T): TxResult<T> {
    return this.writableCore().runScope(label, body);
  }

  private writableCore(): TxCore<R> {
    if (!this.open) {
      throw new TxStateError(`transaction "${this.label}" has already ended`);
    }
    const innermost = this.core.scopes.at(-1);
    if (innermost !== this) {
      throw new TxStateError(
        `"${this.label}" has an open savepoint "${innermost?.label ?? ''}"; write through its tx`,
      );
    }
    return this.core;
  }
}

/** Builds the `transact` and `setIdFactory` methods for a world's data. */
export function createTransactor<R extends TableRegistry>(
  state: WorldData<R>,
  options: TransactorOptions = {},
): Transactor<R> {
  let idFactory: IdFactory | null = options.idFactory ?? null;
  const defaultValidate: ValidateMode = options.validateWrites ?? 'never';
  let openLabel: string | null = null;

  return {
    transact<T>(label: string, body: (tx: Tx<R>) => T, txOptions?: TransactOptions): TxResult<T> {
      if (openLabel !== null) {
        throw new TxStateError(
          `transaction "${label}" was opened inside "${openLabel}"; use tx.savepoint instead`,
        );
      }
      const validate = (txOptions?.validate ?? defaultValidate) === 'always';
      const core = new TxCore(state, validate, () => idFactory);
      openLabel = label;
      try {
        return core.runScope(label, body);
      } finally {
        openLabel = null;
      }
    },
    setIdFactory(factory: IdFactory): void {
      if (openLabel !== null) {
        throw new TxStateError(`cannot change the ID factory while "${openLabel}" is open`);
      }
      idFactory = factory;
    },
  };
}
