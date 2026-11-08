// @vitest-environment node
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectOk, makeTestSave, resetSaveDb } from '@/test/saves';
import { SAVE_DB_NAME } from './constants';
import { closeSaveDb, subscribeToStorageNotices } from './db';
import { StorageErrorSignal, notFoundError, toStorageError, type StorageError } from './errors';
import { createSlot, listSlots, saveToSlot } from './save-slots';

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await resetSaveDb();
});

describe('storage errors', () => {
  it('maps a QuotaExceededError from put to quota and writes nothing', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const save = await makeTestSave();

    const result = await createSlot('Career', save.bytes, save.header, save.meta);
    vi.restoreAllMocks();

    expect(result).toMatchObject({ ok: false, error: { code: 'quota' } });
    expect(expectOk(await listSlots())).toEqual([]);
  });

  it('maps a quota failure on a manual save to quota', async () => {
    const save = await makeTestSave();
    const slot = expectOk(await createSlot('Career', save.bytes, save.header, save.meta));
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const result = await saveToSlot(slot.slotId, save.bytes, save.header, save.meta);
    expect(result).toMatchObject({ ok: false, error: { code: 'quota' } });
  });

  it('maps error names to codes, with the caller choosing the fallback', () => {
    expect(toStorageError(new DOMException('full', 'QuotaExceededError'), 'readFailed').code).toBe(
      'quota',
    );
    expect(toStorageError(new DOMException('old', 'VersionError'), 'unavailable').code).toBe(
      'blocked',
    );
    expect(toStorageError(new DOMException('gone', 'UnknownError'), 'writeFailed').code).toBe(
      'writeFailed',
    );
    expect(toStorageError(new Error('broken'), 'readFailed').code).toBe('readFailed');
    expect(toStorageError('private mode', 'unavailable').code).toBe('unavailable');
    const signal = new StorageErrorSignal(notFoundError('slot-1', 'autosave'));
    expect(toStorageError(signal, 'writeFailed')).toEqual(notFoundError('slot-1', 'autosave'));
  });

  it('reports unavailable when the browser has no IndexedDB', async () => {
    await closeSaveDb();
    vi.stubGlobal('indexedDB', undefined);
    expect(await listSlots()).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });

  it('closes the connection and reports blocked when another tab upgrades the database', async () => {
    const notices: StorageError[] = [];
    const unsubscribe = subscribeToStorageNotices((notice) => {
      notices.push(notice);
    });
    expectOk(await listSlots());

    // Another tab with a newer build opens the database at the next version. It only succeeds
    // because this tab closes its connection when asked.
    const newerTab = await openDB(SAVE_DB_NAME, 2);
    expect(notices.map((notice) => notice.code)).toEqual(['blocked']);
    unsubscribe();

    // This build cannot open a database a newer build upgraded.
    expect(await listSlots()).toMatchObject({ ok: false, error: { code: 'blocked' } });
    newerTab.close();
  });
});
