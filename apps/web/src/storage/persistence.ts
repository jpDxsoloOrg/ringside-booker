/**
 * Asking the browser to keep saves, and how much room they use.
 *
 * Browsers may clear a site's storage when space runs low or after a long time without a visit
 * (iOS Safari does). `navigator.storage.persist()` asks the browser not to. It is only available
 * on the main thread, so the UI calls `requestPersistentStorage()` after a save succeeds; the
 * function asks once and remembers the answer.
 */

import { runTransaction, type PersistenceRecord } from './db';
import type { StorageResult } from './errors';

export interface StorageUsage {
  readonly usedBytes: number;
  readonly quotaBytes: number;
}

function storageManager(): StorageManager | null {
  if (typeof navigator === 'undefined' || typeof navigator.storage === 'undefined') {
    return null;
  }
  return navigator.storage;
}

async function readPersistenceRecord(): Promise<
  StorageResult<{ readonly record: PersistenceRecord | null; readonly hasSlots: boolean }>
> {
  return runTransaction(['meta', 'slots'], 'readonly', async (transaction) => {
    const record = (await transaction.objectStore('meta').get('persistence')) ?? null;
    const slotCount = await transaction.objectStore('slots').count();
    return { record, hasSlots: slotCount > 0 };
  });
}

async function askBrowserToPersist(manager: StorageManager): Promise<boolean> {
  try {
    return await manager.persist();
  } catch {
    return false;
  }
}

/**
 * Asks the browser to keep this site's storage, once, after the first save exists. Returns
 * whether storage is persisted, or null when nothing was asked: there is no save yet, or this
 * context has no `navigator.storage.persist` (a Web Worker, an old browser). A later call asks
 * again in those cases; after an answer, it returns that answer without asking.
 */
export async function requestPersistentStorage(): Promise<StorageResult<boolean | null>> {
  const existing = await readPersistenceRecord();
  if (!existing.ok) {
    return existing;
  }
  const { record, hasSlots } = existing.value;
  if (record !== null) {
    return { ok: true, value: record.granted };
  }
  const manager = storageManager();
  if (!hasSlots || manager === null || typeof manager.persist !== 'function') {
    return { ok: true, value: null };
  }
  const granted = await askBrowserToPersist(manager);
  const answer: PersistenceRecord = { requestedAt: new Date().toISOString(), granted };
  const stored = await runTransaction(['meta'], 'readwrite', async (transaction) => {
    await transaction.objectStore('meta').put(answer, 'persistence');
    return granted;
  });
  return stored;
}

/** How much storage the site uses and may use, or null when the browser does not say. */
export async function getStorageUsage(): Promise<StorageUsage | null> {
  const manager = storageManager();
  if (manager === null || typeof manager.estimate !== 'function') {
    return null;
  }
  try {
    const estimate = await manager.estimate();
    if (estimate.usage === undefined || estimate.quota === undefined) {
      return null;
    }
    return { usedBytes: estimate.usage, quotaBytes: estimate.quota };
  } catch {
    return null;
  }
}
