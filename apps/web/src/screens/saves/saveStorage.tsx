import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { deleteSlot, exportSlot, importSaveFile, listSlots, triggerDownload } from '@/storage';

/**
 * The save storage calls the slot screens make on the main thread: listing, deleting, exporting
 * and importing. Loading and saving go through the engine worker instead (see `useLoadGame`), so
 * save bytes stay off the main thread for those.
 *
 * The screens read these from context, so tests can swap in `src/test/fakeStorage.ts`, which has
 * the same signatures.
 */
export interface SaveStorage {
  readonly listSlots: typeof listSlots;
  readonly deleteSlot: typeof deleteSlot;
  readonly exportSlot: typeof exportSlot;
  readonly triggerDownload: typeof triggerDownload;
  readonly importSaveFile: typeof importSaveFile;
}

/** The real IndexedDB storage. */
export const browserSaveStorage: SaveStorage = {
  listSlots,
  deleteSlot,
  exportSlot,
  triggerDownload,
  importSaveFile,
};

const SaveStorageContext = createContext<SaveStorage>(browserSaveStorage);

export interface SaveStorageProviderProps {
  readonly storage: SaveStorage;
  readonly children: ReactNode;
}

/** Replaces the save storage for everything below it. The app never needs it; tests do. */
export function SaveStorageProvider({ storage, children }: SaveStorageProviderProps) {
  return <SaveStorageContext.Provider value={storage}>{children}</SaveStorageContext.Provider>;
}

/** The save storage calls: the browser's own unless a provider above says otherwise. */
export function useSaveStorage(): SaveStorage {
  return useContext(SaveStorageContext);
}
