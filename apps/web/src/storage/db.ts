/**
 * The save database: its schema, its upgrade path and the shared connection.
 *
 * Three object stores:
 * - `slots`: one `SlotRecord` per save slot, the metadata a slot list shows.
 * - `blobs`: the save bytes, one record per slot and kind (`current`, `autosave`, `backup-1..3`).
 * - `meta`: a few keyed values about the database itself, such as whether persistent storage was
 *   requested.
 *
 * The bytes are opaque here: the engine produces and checks them (see
 * `docs/design/save-format.md`). See `README.md` next to this file for rotation and callers.
 */

import type { GameDate, SaveHeader } from '@ringside/engine';
import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';
import type { BACKUP_KINDS } from './constants';
import { SAVE_DB_NAME, SAVE_DB_VERSION } from './constants';
import {
  storageFailure,
  storageSuccess,
  toStorageError,
  type StorageError,
  type StorageResult,
} from './errors';

export type BackupKind = (typeof BACKUP_KINDS)[number];

/** Every save a slot can hold. */
export type BlobKind = 'current' | 'autosave' | BackupKind;

/** Why a backup was written. */
export type BackupReason = 'manualSave' | 'monthly' | 'beforeImportOverwrite';

/** What a slot record says about one of its backups. */
export interface BackupMeta {
  readonly kind: BackupKind;
  /** Real-world ISO time the backed-up save was written. */
  readonly savedAt: string;
  readonly gameDate: GameDate;
  readonly sizeBytes: number;
  readonly reason: BackupReason;
}

/** A save slot as a slot list shows it. */
export interface SlotRecord {
  readonly slotId: string;
  /** The slot's own name, chosen by the player. */
  readonly label: string;
  /** The header of the newest save written to the slot (manual or autosave). */
  readonly header: SaveHeader;
  readonly createdAt: string;
  /** Real-world ISO time of the newest write; slot lists sort on it. */
  readonly updatedAt: string;
  readonly lastAutosaveAt: string | null;
  readonly formatVersion: number;
  readonly engineVersion: string;
  readonly sizes: { readonly current: number; readonly autosave: number | null };
  /** Newest first, at most `BACKUP_COUNT`. */
  readonly backups: readonly BackupMeta[];
}

/** One stored save. */
export interface BlobRecord {
  readonly slotId: string;
  readonly kind: BlobKind;
  /** Exactly the bytes the engine encoded (gzip). */
  readonly bytes: Uint8Array;
  readonly savedAt: string;
  readonly gameDate: GameDate;
}

/** Whether persistent storage was asked for, and what the browser said. */
export interface PersistenceRecord {
  readonly requestedAt: string;
  readonly granted: boolean;
}

export interface MetaValues {
  readonly persistence: PersistenceRecord;
}

export type MetaKey = keyof MetaValues;

export interface SaveDbSchema extends DBSchema {
  slots: {
    key: string;
    value: SlotRecord;
    indexes: { byUpdatedAt: string };
  };
  blobs: {
    key: [string, BlobKind];
    value: BlobRecord;
    indexes: { bySlot: string };
  };
  meta: {
    key: MetaKey;
    value: MetaValues[MetaKey];
  };
}

export type SaveDb = IDBPDatabase<SaveDbSchema>;

export type SaveDbStore = StoreNames<SaveDbSchema>;

/** Version 1: the slot, blob and meta stores and their indexes. */
function createVersionOneStores(database: SaveDb): void {
  const slots = database.createObjectStore('slots', { keyPath: 'slotId' });
  slots.createIndex('byUpdatedAt', 'updatedAt');
  const blobs = database.createObjectStore('blobs', { keyPath: ['slotId', 'kind'] });
  blobs.createIndex('bySlot', 'slotId');
  database.createObjectStore('meta');
}

/**
 * Brings a database at `oldVersion` up to `SAVE_DB_VERSION` one version at a time, so a database
 * at any older version runs every step after it in order. A new version adds a case for the
 * version it upgrades from; existing cases never change.
 */
function upgradeSaveDb(database: SaveDb, oldVersion: number): void {
  for (let fromVersion = oldVersion; fromVersion < SAVE_DB_VERSION; fromVersion += 1) {
    switch (fromVersion) {
      case 0:
        createVersionOneStores(database);
        break;
      default:
        throw new Error(`No upgrade step from save database version ${String(fromVersion)}.`);
    }
  }
}

type NoticeListener = (notice: StorageError) => void;

const noticeListeners = new Set<NoticeListener>();

/**
 * Listens for problems no call is waiting on, such as another tab asking this one to close the
 * database for an upgrade. Returns the function that stops listening.
 */
export function subscribeToStorageNotices(listener: NoticeListener): () => void {
  noticeListeners.add(listener);
  return () => {
    noticeListeners.delete(listener);
  };
}

function notify(notice: StorageError): void {
  for (const listener of noticeListeners) {
    listener(notice);
  }
}

const BLOCKED_BY_OTHER_TAB: StorageError = {
  code: 'blocked',
  message:
    'Another tab has the game open with an older save database. Close it to keep saving here.',
};

const BLOCKING_OTHER_TAB: StorageError = {
  code: 'blocked',
  message:
    'A newer version of the game opened in another tab, so this tab stopped using the save database. Reload the page.',
};

let connection: Promise<StorageResult<SaveDb>> | null = null;

/** Closes a connection whose open finished after the caller had already been told it was blocked. */
async function closeWhenOpened(opening: Promise<SaveDb>): Promise<void> {
  try {
    const database = await opening;
    database.close();
  } catch {
    // It never opened, so there is nothing to close.
  }
}

async function settleOpen(opening: Promise<SaveDb>): Promise<StorageResult<SaveDb>> {
  try {
    return storageSuccess(await opening);
  } catch (error: unknown) {
    return storageFailure(toStorageError(error, 'unavailable'));
  }
}

async function connect(): Promise<StorageResult<SaveDb>> {
  if (typeof indexedDB === 'undefined') {
    return storageFailure({
      code: 'unavailable',
      message: 'This browser has no IndexedDB, so the game cannot keep saves here.',
    });
  }
  let reportBlocked: () => void = () => undefined;
  const blockedSignal = new Promise<StorageResult<SaveDb>>((resolve) => {
    reportBlocked = () => {
      resolve(storageFailure(BLOCKED_BY_OTHER_TAB));
    };
  });

  let opening: Promise<SaveDb>;
  try {
    opening = openDB<SaveDbSchema>(SAVE_DB_NAME, SAVE_DB_VERSION, {
      upgrade: (database, oldVersion) => {
        upgradeSaveDb(database, oldVersion);
      },
      blocked: () => {
        reportBlocked();
      },
      blocking: () => {
        void closeSaveDb();
        notify(BLOCKING_OTHER_TAB);
      },
      terminated: () => {
        connection = null;
      },
    });
  } catch (error: unknown) {
    return storageFailure(toStorageError(error, 'unavailable'));
  }

  const outcome = await Promise.race([settleOpen(opening), blockedSignal]);
  if (!outcome.ok && outcome.error === BLOCKED_BY_OTHER_TAB) {
    void closeWhenOpened(opening);
  }
  return outcome;
}

/**
 * The save database, opened once and shared by every storage call. A failed open is not cached,
 * so the next call tries again.
 */
export async function openSaveDb(): Promise<StorageResult<SaveDb>> {
  const pending = connection ?? connect();
  connection = pending;
  const result = await pending;
  if (!result.ok && connection === pending) {
    connection = null;
  }
  return result;
}

/** Closes the shared connection. The next storage call opens it again. */
export async function closeSaveDb(): Promise<void> {
  const pending = connection;
  connection = null;
  if (pending === null) {
    return;
  }
  const result = await pending;
  if (result.ok) {
    result.value.close();
  }
}

/** How a transaction ended: null when it committed, or the error that aborted it. */
async function transactionOutcome(
  done: Promise<void>,
): Promise<{ readonly error: unknown } | null> {
  try {
    await done;
    return null;
  } catch (error: unknown) {
    return { error };
  }
}

/**
 * Runs `body` in one transaction over `stores` and reports the outcome. If `body` throws, the
 * transaction is aborted so none of its writes land, and the error comes back as a
 * `StorageError` (`fallback` for anything that is not a full disk or a `StorageErrorSignal`).
 *
 * `body` may only await requests of `transaction`: awaiting anything else lets IndexedDB commit
 * the transaction early.
 */
export async function runTransaction<
  Stores extends SaveDbStore[],
  Mode extends IDBTransactionMode,
  T,
>(
  stores: Stores,
  mode: Mode,
  body: (transaction: IDBPTransaction<SaveDbSchema, Stores, Mode>) => Promise<T>,
): Promise<StorageResult<T>> {
  const fallback = mode === 'readonly' ? 'readFailed' : 'writeFailed';
  const opened = await openSaveDb();
  if (!opened.ok) {
    return opened;
  }
  let transaction: IDBPTransaction<SaveDbSchema, Stores, Mode>;
  try {
    transaction = opened.value.transaction(stores, mode);
  } catch (error: unknown) {
    return storageFailure(toStorageError(error, fallback));
  }
  // Watch for the end straight away, so an abort while the body runs is never left unhandled.
  const finished = transactionOutcome(transaction.done);
  let value: T;
  try {
    value = await body(transaction);
  } catch (error: unknown) {
    try {
      transaction.abort();
    } catch {
      // The transaction already aborted on its own (a failed request aborts it).
    }
    await finished;
    return storageFailure(toStorageError(error, fallback));
  }
  const outcome = await finished;
  if (outcome !== null) {
    return storageFailure(toStorageError(outcome.error, fallback));
  }
  return storageSuccess(value);
}
