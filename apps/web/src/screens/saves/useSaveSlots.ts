import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DeliveryOutcome,
  ImportResult,
  InspectSave,
  SlotRecord,
  StorageError,
} from '@/storage';
import { useSaveStorage } from './saveStorage';

/** The slot list and what is happening to it. */
export type SlotListState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly slots: readonly SlotRecord[] }
  | { readonly status: 'error'; readonly error: StorageError };

/** How an action on a slot ended: done, or the storage error that stopped it. */
export type SlotActionResult<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: StorageError };

export interface SaveSlots {
  readonly state: SlotListState;
  /** Every slot, newest `updatedAt` first, or an empty list while loading or after an error. */
  readonly slots: readonly SlotRecord[];
  /** Reads the slot list again. */
  readonly refresh: () => Promise<void>;
  /** Deletes a slot and its backups, then refreshes the list. */
  readonly deleteSlot: (slotId: string) => Promise<SlotActionResult>;
  /** Exports a slot's newest save as an `.rbsave` file and hands it to the player. */
  readonly exportSlot: (slotId: string) => Promise<SlotActionResult<DeliveryOutcome>>;
  /** Imports an `.rbsave` file as a new slot, checked by `inspect`, then refreshes the list. */
  readonly importFile: (file: File, inspect: InspectSave) => Promise<ImportResult>;
}

/**
 * The main-thread save storage calls (list, delete, export, import) with loading and error state.
 * `listSlots` already returns the newest `updatedAt` first. No call throws: storage problems come
 * back as typed `StorageError`s for the screen to show.
 */
export function useSaveSlots(): SaveSlots {
  const storage = useSaveStorage();
  const [state, setState] = useState<SlotListState>({ status: 'loading' });
  // A list read that finishes after a newer one started is dropped.
  const requestRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    requestRef.current += 1;
    const request = requestRef.current;
    const listed = await storage.listSlots();
    if (request !== requestRef.current) return;
    setState(
      listed.ok
        ? { status: 'ready', slots: listed.value }
        : { status: 'error', error: listed.error },
    );
  }, [storage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deleteSlot = useCallback(
    async (slotId: string): Promise<SlotActionResult> => {
      const deleted = await storage.deleteSlot(slotId);
      await refresh();
      return deleted.ok ? { ok: true, value: null } : deleted;
    },
    [storage, refresh],
  );

  const exportSlot = useCallback(
    async (slotId: string): Promise<SlotActionResult<DeliveryOutcome>> => {
      const exported = await storage.exportSlot(slotId);
      if (!exported.ok) return exported;
      const outcome = await storage.triggerDownload(exported.value.fileName, exported.value.blob);
      return { ok: true, value: outcome };
    },
    [storage],
  );

  const importFile = useCallback(
    async (file: File, inspect: InspectSave): Promise<ImportResult> => {
      const imported = await storage.importSaveFile(file, inspect);
      if (imported.ok) await refresh();
      return imported;
    },
    [storage, refresh],
  );

  return {
    state,
    slots: state.status === 'ready' ? state.slots : [],
    refresh,
    deleteSlot,
    exportSlot,
    importFile,
  };
}
