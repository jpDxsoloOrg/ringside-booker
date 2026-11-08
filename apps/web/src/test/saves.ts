/**
 * Helpers for the save storage tests: real save bytes from the engine's tiny test world, a fresh
 * database per test and direct reads of the stored blobs.
 */

import {
  CURRENT_FORMAT_VERSION,
  encodeSave,
  parseGameDate,
  type GameDate,
  type SaveDocument,
  type SaveHeader,
} from '@ringside/engine';
import { testSaveDocument, tinyWorld, TEST_ENGINE_VERSION } from '@ringside/engine/testing';
import { deleteDB } from 'idb';
import { SAVE_DB_NAME } from '@/storage/constants';
import { closeSaveDb, openSaveDb, type BlobKind, type BlobRecord } from '@/storage/db';
import type { SaveBytesMeta } from '@/storage/save-slots';

export interface TestSave {
  readonly doc: SaveDocument;
  readonly bytes: Uint8Array;
  readonly header: SaveHeader;
  readonly meta: SaveBytesMeta;
}

export interface TestSaveOptions {
  /** The save's label; it changes the document, so each label gives different bytes. */
  readonly label?: string;
  /** The game date the header (and the stored blob) records. */
  readonly gameDate?: string;
  /** The real-world save time. */
  readonly savedAt?: string;
}

/** A real encoded save of the tiny test world, with a header and the meta storage takes. */
export async function makeTestSave(options: TestSaveOptions = {}): Promise<TestSave> {
  const { world, ids } = tinyWorld();
  const savedAt = options.savedAt ?? '2026-11-08T12:00:00.000Z';
  const doc = testSaveDocument(world, {
    headerPromotionId: ids.promotions.A ?? null,
    label: options.label ?? 'Test save',
    savedAt,
  });
  const gameDate: GameDate =
    options.gameDate === undefined ? doc.header.gameDate : parseGameDate(options.gameDate);
  return {
    doc,
    bytes: await encodeSave(doc),
    header: { ...doc.header, gameDate },
    meta: { formatVersion: CURRENT_FORMAT_VERSION, engineVersion: TEST_ENGINE_VERSION, savedAt },
  };
}

/** Closes the shared connection and deletes the database, so each test starts empty. */
export async function resetSaveDb(): Promise<void> {
  await closeSaveDb();
  await deleteDB(SAVE_DB_NAME);
}

/** Every stored blob of a slot, keyed by kind. */
export async function readSlotBlobs(slotId: string): Promise<Map<BlobKind, BlobRecord>> {
  const opened = await openSaveDb();
  if (!opened.ok) {
    throw new Error(opened.error.message);
  }
  const records = await opened.value.getAllFromIndex('blobs', 'bySlot', slotId);
  return new Map(records.map((record) => [record.kind, record]));
}

/** How many blobs a slot has, counted through the `bySlot` index. */
export async function countSlotBlobs(slotId: string): Promise<number> {
  const opened = await openSaveDb();
  if (!opened.ok) {
    throw new Error(opened.error.message);
  }
  return opened.value.countFromIndex('blobs', 'bySlot', slotId);
}

/** How many blobs the database holds in all. */
export async function countAllBlobs(): Promise<number> {
  const opened = await openSaveDb();
  if (!opened.ok) {
    throw new Error(opened.error.message);
  }
  return opened.value.count('blobs');
}

/** Unwraps a successful result, failing the test with the storage error otherwise. */
export function expectOk<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: object },
): T {
  if (!result.ok) {
    throw new Error(`Expected success, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
