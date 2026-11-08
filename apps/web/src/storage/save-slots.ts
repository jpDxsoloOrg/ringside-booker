/**
 * Save slots: create, list, save, autosave, load, rename, duplicate and delete.
 *
 * Every write that touches more than one record runs in one readwrite transaction over both
 * stores, so a failure part-way (a full disk, a closed tab) leaves the slot exactly as it was. The
 * bytes are stored as given and never re-encoded.
 */

import type { SaveHeader } from '@ringside/engine';
import { BACKUP_KINDS } from './constants';
import { notFoundError, StorageErrorSignal, type StorageResult } from './errors';
import {
  runTransaction,
  type BackupKind,
  type BackupMeta,
  type BackupReason,
  type BlobKind,
  type BlobRecord,
  type SaveDbSchema,
  type SlotRecord,
} from './db';
import type { IDBPTransaction } from 'idb';

/** What the caller knows about the bytes it hands over, besides the header. */
export interface SaveBytesMeta {
  /** The save document's format version. */
  readonly formatVersion: number;
  /** The engine build that wrote the save. */
  readonly engineVersion: string;
  /** Real-world ISO time of the save: the document's `savedAt`. */
  readonly savedAt: string;
}

export interface AutosaveOptions {
  /**
   * Copy the newest of `current` and `autosave` into the backups before writing, so each game
   * month leaves a restore point. `shouldAutosave` decides it.
   */
  readonly monthlyBackup: boolean;
}

/** Which save to load: one kind, or `latest` for the newer of `current` and `autosave`. */
export type LoadWhich = 'latest' | 'current' | 'autosave' | BackupKind;

export interface LoadedSave {
  readonly bytes: Uint8Array;
  readonly kind: BlobKind;
  readonly savedAt: string;
}

type SlotWriteTransaction = IDBPTransaction<SaveDbSchema, ['slots', 'blobs'], 'readwrite'>;

type SlotReadTransaction = IDBPTransaction<SaveDbSchema, ['slots', 'blobs']>;

function newSlotId(): string {
  return crypto.randomUUID();
}

/** Orders two ISO times; a time that does not parse sorts as the oldest. */
function timeOf(isoTime: string): number {
  const parsed = Date.parse(isoTime);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** The newer of two saves by `savedAt`; on a tie the first one (the manual save) wins. */
function newerOf(first: BlobRecord | undefined, second: BlobRecord | undefined): BlobRecord | null {
  if (first === undefined) {
    return second ?? null;
  }
  if (second === undefined) {
    return first;
  }
  return timeOf(second.savedAt) > timeOf(first.savedAt) ? second : first;
}

async function requireSlot(
  transaction: SlotWriteTransaction | SlotReadTransaction,
  slotId: string,
): Promise<SlotRecord> {
  const slot = await transaction.objectStore('slots').get(slotId);
  if (slot === undefined) {
    throw new StorageErrorSignal(notFoundError(slotId));
  }
  return slot;
}

function backupMetaOf(record: BlobRecord, kind: BackupKind, reason: BackupReason): BackupMeta {
  return {
    kind,
    savedAt: record.savedAt,
    gameDate: record.gameDate,
    sizeBytes: record.bytes.byteLength,
    reason,
  };
}

/**
 * Shifts the backups one place (`backup-2 → backup-3`, `backup-1 → backup-2`, dropping the old
 * `backup-3`) and writes `source` as `backup-1`. Returns the slot's new backup list. Runs inside
 * the caller's transaction, so the shift and the caller's own writes land together or not at all.
 */
async function rotateIntoBackups(
  transaction: SlotWriteTransaction,
  slot: SlotRecord,
  source: BlobRecord,
  reason: BackupReason,
): Promise<BackupMeta[]> {
  const blobs = transaction.objectStore('blobs');
  const rotated: BackupMeta[] = [];
  // Oldest first, so each backup moves into a place already emptied or overwritten.
  for (let index = BACKUP_KINDS.length - 1; index >= 1; index -= 1) {
    const fromKind = BACKUP_KINDS[index - 1];
    const toKind = BACKUP_KINDS[index];
    if (fromKind === undefined || toKind === undefined) {
      continue;
    }
    const older = await blobs.get([slot.slotId, fromKind]);
    if (older === undefined) {
      continue;
    }
    await blobs.put({ ...older, kind: toKind });
    const previousMeta = slot.backups.find((meta) => meta.kind === fromKind);
    rotated.unshift(
      previousMeta === undefined
        ? backupMetaOf(older, toKind, reason)
        : { ...previousMeta, kind: toKind },
    );
  }
  const newest: BackupKind = BACKUP_KINDS[0];
  await blobs.put({ ...source, kind: newest });
  return [backupMetaOf(source, newest, reason), ...rotated];
}

/** Every slot, the most recently written first. */
export async function listSlots(): Promise<StorageResult<SlotRecord[]>> {
  return runTransaction(['slots'], 'readonly', async (transaction) => {
    const oldestFirst = await transaction.objectStore('slots').index('byUpdatedAt').getAll();
    return oldestFirst.reverse();
  });
}

/** One slot's record. */
export async function getSlot(slotId: string): Promise<StorageResult<SlotRecord>> {
  return runTransaction(['slots'], 'readonly', async (transaction) => {
    const slot = await transaction.objectStore('slots').get(slotId);
    if (slot === undefined) {
      throw new StorageErrorSignal(notFoundError(slotId));
    }
    return slot;
  });
}

/** Creates a new slot holding `bytes` as its current save. */
export async function createSlot(
  label: string,
  bytes: Uint8Array,
  header: SaveHeader,
  meta: SaveBytesMeta,
): Promise<StorageResult<SlotRecord>> {
  const slot: SlotRecord = {
    slotId: newSlotId(),
    label,
    header,
    createdAt: meta.savedAt,
    updatedAt: meta.savedAt,
    lastAutosaveAt: null,
    formatVersion: meta.formatVersion,
    engineVersion: meta.engineVersion,
    sizes: { current: bytes.byteLength, autosave: null },
    backups: [],
  };
  return runTransaction(['slots', 'blobs'], 'readwrite', async (transaction) => {
    await transaction.objectStore('blobs').put({
      slotId: slot.slotId,
      kind: 'current',
      bytes,
      savedAt: meta.savedAt,
      gameDate: header.gameDate,
    });
    await transaction.objectStore('slots').add(slot);
    return slot;
  });
}

/**
 * A manual save into an existing slot. In one transaction: the backups shift a place, the old
 * `current` becomes `backup-1` (reason `manualSave`), the new bytes become `current`, and the slot
 * record is updated.
 */
export async function saveToSlot(
  slotId: string,
  bytes: Uint8Array,
  header: SaveHeader,
  meta: SaveBytesMeta,
): Promise<StorageResult<SlotRecord>> {
  return runTransaction(['slots', 'blobs'], 'readwrite', async (transaction) => {
    const slot = await requireSlot(transaction, slotId);
    const blobs = transaction.objectStore('blobs');
    const previous = await blobs.get([slotId, 'current']);
    const backups =
      previous === undefined
        ? slot.backups
        : await rotateIntoBackups(transaction, slot, previous, 'manualSave');
    await blobs.put({
      slotId,
      kind: 'current',
      bytes,
      savedAt: meta.savedAt,
      gameDate: header.gameDate,
    });
    const updated: SlotRecord = {
      ...slot,
      header,
      updatedAt: meta.savedAt,
      formatVersion: meta.formatVersion,
      engineVersion: meta.engineVersion,
      sizes: { ...slot.sizes, current: bytes.byteLength },
      backups,
    };
    await transaction.objectStore('slots').put(updated);
    return updated;
  });
}

/**
 * Writes the slot's autosave. With `monthlyBackup`, the newest of `current` and `autosave` is
 * first rotated into the backups (reason `monthly`), in the same transaction.
 */
export async function writeAutosave(
  slotId: string,
  bytes: Uint8Array,
  header: SaveHeader,
  meta: SaveBytesMeta,
  options: AutosaveOptions,
): Promise<StorageResult<SlotRecord>> {
  return runTransaction(['slots', 'blobs'], 'readwrite', async (transaction) => {
    const slot = await requireSlot(transaction, slotId);
    const blobs = transaction.objectStore('blobs');
    let backups = slot.backups;
    if (options.monthlyBackup) {
      const current = await blobs.get([slotId, 'current']);
      const autosave = await blobs.get([slotId, 'autosave']);
      const newest = newerOf(current, autosave);
      if (newest !== null) {
        backups = await rotateIntoBackups(transaction, slot, newest, 'monthly');
      }
    }
    await blobs.put({
      slotId,
      kind: 'autosave',
      bytes,
      savedAt: meta.savedAt,
      gameDate: header.gameDate,
    });
    const updated: SlotRecord = {
      ...slot,
      header,
      updatedAt: meta.savedAt,
      lastAutosaveAt: meta.savedAt,
      formatVersion: meta.formatVersion,
      engineVersion: meta.engineVersion,
      sizes: { ...slot.sizes, autosave: bytes.byteLength },
      backups,
    };
    await transaction.objectStore('slots').put(updated);
    return updated;
  });
}

/** Reads one save of a slot, inside an open transaction. */
export async function readSlotBlob(
  transaction: SlotReadTransaction,
  slotId: string,
  which: LoadWhich,
): Promise<BlobRecord> {
  await requireSlot(transaction, slotId);
  const blobs = transaction.objectStore('blobs');
  if (which === 'latest') {
    const current = await blobs.get([slotId, 'current']);
    const autosave = await blobs.get([slotId, 'autosave']);
    const newest = newerOf(current, autosave);
    if (newest === null) {
      throw new StorageErrorSignal(notFoundError(slotId, 'current'));
    }
    return newest;
  }
  const record = await blobs.get([slotId, which]);
  if (record === undefined) {
    throw new StorageErrorSignal(notFoundError(slotId, which));
  }
  return record;
}

/**
 * Loads a save from a slot. `latest` is the newer of `current` and `autosave` by `savedAt`; the
 * manual save wins a tie.
 */
export async function loadFromSlot(
  slotId: string,
  which: LoadWhich = 'latest',
): Promise<StorageResult<LoadedSave>> {
  return runTransaction(['slots', 'blobs'], 'readonly', async (transaction) => {
    const record = await readSlotBlob(transaction, slotId, which);
    return { bytes: record.bytes, kind: record.kind, savedAt: record.savedAt };
  });
}

/** Renames a slot. The saves inside it are not touched and its place in the list stays. */
export async function renameSlot(
  slotId: string,
  label: string,
): Promise<StorageResult<SlotRecord>> {
  return runTransaction(['slots'], 'readwrite', async (transaction) => {
    const slots = transaction.objectStore('slots');
    const slot = await slots.get(slotId);
    if (slot === undefined) {
      throw new StorageErrorSignal(notFoundError(slotId));
    }
    const renamed: SlotRecord = { ...slot, label };
    await slots.put(renamed);
    return renamed;
  });
}

/**
 * Copies a slot, with every save in it, under a new slot ID. The copy is labelled `label`, or the
 * original's label with " (copy)" after it.
 */
export async function duplicateSlot(
  slotId: string,
  label?: string,
): Promise<StorageResult<SlotRecord>> {
  const copyId = newSlotId();
  return runTransaction(['slots', 'blobs'], 'readwrite', async (transaction) => {
    const slot = await requireSlot(transaction, slotId);
    const blobs = transaction.objectStore('blobs');
    const records = await blobs.index('bySlot').getAll(slotId);
    for (const record of records) {
      await blobs.put({ ...record, slotId: copyId });
    }
    const copy: SlotRecord = { ...slot, slotId: copyId, label: label ?? `${slot.label} (copy)` };
    await transaction.objectStore('slots').add(copy);
    return copy;
  });
}

/** Deletes a slot and every save in it, in one transaction. */
export async function deleteSlot(slotId: string): Promise<StorageResult<null>> {
  return runTransaction(['slots', 'blobs'], 'readwrite', async (transaction) => {
    await requireSlot(transaction, slotId);
    const blobs = transaction.objectStore('blobs');
    const keys = await blobs.index('bySlot').getAllKeys(slotId);
    for (const key of keys) {
      await blobs.delete(key);
    }
    await transaction.objectStore('slots').delete(slotId);
    return null;
  });
}
