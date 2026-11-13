import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { SlotRecord, StorageResult } from '@/storage';
import { createFakeStorage } from '@/test/fakeStorage';
import { SaveStorageProvider } from './saveStorage';
import { useSaveSlots } from './useSaveSlots';

/** A storage whose slot list arrives only when the test says so. */
function storageWithHeldList() {
  const fake = createFakeStorage();
  let release: () => void = () => undefined;
  const storage = {
    ...fake,
    listSlots: (): Promise<StorageResult<SlotRecord[]>> =>
      new Promise((resolve) => {
        release = () => {
          resolve({ ok: true, value: [] });
        };
      }),
  };
  return {
    storage,
    release: () => {
      release();
    },
  };
}

/** Lets the pending promise callbacks and the next macrotask run. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

describe('useSaveSlots', () => {
  it('drops a slot list that arrives after unmount, even once the window is gone', async () => {
    // Vitest tears the jsdom window down when a test file ends. A list read still in flight then
    // used to set state, React read `window.event`, and the run failed with "window is not defined".
    const { storage, release } = storageWithHeldList();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <SaveStorageProvider storage={storage}>{children}</SaveStorageProvider>
    );
    const { result, unmount } = renderHook(() => useSaveSlots(), { wrapper });
    expect(result.current.state).toEqual({ status: 'loading' });
    unmount();

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    Reflect.deleteProperty(globalThis, 'window');
    try {
      release();
      await settle();
      await settle();
    } finally {
      process.off('unhandledRejection', onRejection);
      if (windowDescriptor !== undefined) {
        Object.defineProperty(globalThis, 'window', windowDescriptor);
      }
    }

    expect(rejections).toEqual([]);
    expect(result.current.state).toEqual({ status: 'loading' });
  });
});
