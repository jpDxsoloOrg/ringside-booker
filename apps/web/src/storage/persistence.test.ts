// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectOk, makeTestSave, resetSaveDb } from '@/test/saves';
import { getStorageUsage, requestPersistentStorage } from './persistence';
import { createSlot } from './save-slots';

afterEach(async () => {
  vi.unstubAllGlobals();
  await resetSaveDb();
});

interface StorageStub {
  readonly persist?: () => Promise<boolean>;
  readonly estimate?: () => Promise<StorageEstimate>;
}

function stubStorage(storage: StorageStub | undefined): void {
  vi.stubGlobal('navigator', { storage });
}

async function createAnySlot(): Promise<void> {
  const save = await makeTestSave();
  expectOk(await createSlot('Career', save.bytes, save.header, save.meta));
}

describe('requestPersistentStorage', () => {
  it('asks nothing before the first save exists', async () => {
    const persist = vi.fn(async () => {
      await Promise.resolve();
      return true;
    });
    stubStorage({ persist });

    expect(expectOk(await requestPersistentStorage())).toBeNull();
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks once after a save and remembers the answer', async () => {
    const persist = vi.fn(async () => {
      await Promise.resolve();
      return false;
    });
    stubStorage({ persist });
    await createAnySlot();

    expect(expectOk(await requestPersistentStorage())).toBe(false);
    expect(expectOk(await requestPersistentStorage())).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('asks nothing where persist() is not exposed, so a later call can still ask', async () => {
    stubStorage({});
    await createAnySlot();
    expect(expectOk(await requestPersistentStorage())).toBeNull();

    const persist = vi.fn(async () => {
      await Promise.resolve();
      return true;
    });
    stubStorage({ persist });
    expect(expectOk(await requestPersistentStorage())).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('records a refusal when persist() rejects', async () => {
    stubStorage({
      persist: async () => {
        await Promise.resolve();
        throw new DOMException('Not allowed.', 'NotAllowedError');
      },
    });
    await createAnySlot();
    expect(expectOk(await requestPersistentStorage())).toBe(false);
  });
});

describe('getStorageUsage', () => {
  it('reports usage and quota from the estimate', async () => {
    stubStorage({
      estimate: async () => {
        await Promise.resolve();
        return { usage: 1_500, quota: 2_000_000 };
      },
    });
    expect(await getStorageUsage()).toEqual({ usedBytes: 1_500, quotaBytes: 2_000_000 });
  });

  it('returns null when the browser does not say', async () => {
    stubStorage(undefined);
    expect(await getStorageUsage()).toBeNull();

    stubStorage({
      estimate: async () => {
        await Promise.resolve();
        return {};
      },
    });
    expect(await getStorageUsage()).toBeNull();

    stubStorage({
      estimate: async () => {
        await Promise.resolve();
        throw new Error('estimate failed');
      },
    });
    expect(await getStorageUsage()).toBeNull();
  });
});
