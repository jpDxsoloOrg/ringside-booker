/**
 * An in-memory stand-in for the slot screens' storage calls, with the same signatures as the
 * storage module's `listSlots`, `deleteSlot`, `exportSlot`, `triggerDownload` and
 * `importSaveFile`. Tests seed slots, queue failures and read back what was called.
 *
 * It holds slot records only; loading and saving go through the engine worker, which the screen
 * tests run against real (fake-indexeddb) storage instead.
 */

import { CURRENT_FORMAT_VERSION, ENGINE_VERSION, parseGameDate } from '@ringside/engine';
import type { SaveHeader } from '@ringside/engine';
import type { SaveStorage } from '@/screens/saves/saveStorage';
import { SAVE_FILE_MIME_TYPE } from '@/storage';
import type {
  DeliveryOutcome,
  ExportedSave,
  ImportResult,
  InspectSave,
  SlotRecord,
  StorageError,
  StorageResult,
} from '@/storage';

/** A slot record for tests. Every field has a sensible default. */
export function fakeSlot(
  overrides: Partial<Omit<SlotRecord, 'header'>> & { readonly header?: Partial<SaveHeader> } = {},
): SlotRecord {
  const { header, ...rest } = overrides;
  const label = rest.label ?? 'Test league';
  return {
    slotId: 'slot-1',
    label,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
    lastAutosaveAt: null,
    formatVersion: CURRENT_FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    sizes: { current: 48 * 1024, autosave: null },
    backups: [],
    ...rest,
    header: {
      worldName: 'Test world',
      promotionName: 'Test Promotion A',
      promotionShortName: 'TPA',
      gameDate: parseGameDate('2026-04-10'),
      startDate: parseGameDate('2026-01-05'),
      daysSimulated: 95,
      cash: null,
      label,
      ...header,
    },
  };
}

/** What `exportSlot` hands back in the fake. */
export const FAKE_EXPORT_FILE_NAME = 'test-league-2026-04-10.rbsave';

export interface FakeStorage extends SaveStorage {
  /** The slots, kept newest `updatedAt` first like the real store. */
  readonly slots: SlotRecord[];
  /** Slot ids passed to `deleteSlot`, in order. */
  readonly deleted: string[];
  /** File names handed to `triggerDownload`, in order. */
  readonly downloads: string[];
  /** The next `importSaveFile` call returns this instead of inspecting the file. */
  failNextImport(error: StorageError): void;
  /** The next `listSlots` call fails with this. */
  failNextList(error: StorageError): void;
}

/** A file's bytes. jsdom's File has no `arrayBuffer()`, so this goes through a FileReader. */
function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const { result } = reader;
      if (result instanceof ArrayBuffer) resolve(new Uint8Array(result));
      else reject(new Error('The file reader returned text, not bytes.'));
    });
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('The file could not be read.'));
    });
    reader.readAsArrayBuffer(file);
  });
}

function sortNewestFirst(slots: SlotRecord[]): void {
  slots.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

/** A fake storage holding `initialSlots`. */
export function createFakeStorage(initialSlots: readonly SlotRecord[] = []): FakeStorage {
  const slots = [...initialSlots];
  sortNewestFirst(slots);
  const deleted: string[] = [];
  const downloads: string[] = [];
  let nextImportFailure: StorageError | null = null;
  let nextListFailure: StorageError | null = null;

  const notFound = (slotId: string): StorageError => ({
    code: 'notFound',
    message: `Save slot ${slotId} does not exist.`,
    slotId,
    kind: null,
  });

  return {
    slots,
    deleted,
    downloads,
    failNextImport(error) {
      nextImportFailure = error;
    },
    failNextList(error) {
      nextListFailure = error;
    },
    listSlots(): Promise<StorageResult<SlotRecord[]>> {
      if (nextListFailure !== null) {
        const error = nextListFailure;
        nextListFailure = null;
        return Promise.resolve({ ok: false, error });
      }
      return Promise.resolve({ ok: true, value: [...slots] });
    },
    deleteSlot(slotId: string): Promise<StorageResult<null>> {
      const index = slots.findIndex((slot) => slot.slotId === slotId);
      if (index < 0) return Promise.resolve({ ok: false, error: notFound(slotId) });
      slots.splice(index, 1);
      deleted.push(slotId);
      return Promise.resolve({ ok: true, value: null });
    },
    exportSlot(slotId: string): Promise<StorageResult<ExportedSave>> {
      if (!slots.some((slot) => slot.slotId === slotId)) {
        return Promise.resolve({ ok: false, error: notFound(slotId) });
      }
      const blob = new Blob(['save bytes'], { type: SAVE_FILE_MIME_TYPE });
      return Promise.resolve({ ok: true, value: { fileName: FAKE_EXPORT_FILE_NAME, blob } });
    },
    triggerDownload(fileName: string): Promise<DeliveryOutcome> {
      downloads.push(fileName);
      return Promise.resolve('downloaded');
    },
    async importSaveFile(file: File, inspect: InspectSave): Promise<ImportResult> {
      if (nextImportFailure !== null) {
        const error = nextImportFailure;
        nextImportFailure = null;
        return { ok: false, error };
      }
      const bytes = await readFileBytes(file);
      const report = await inspect(bytes);
      if (!report.ok) return { ok: false, error: report };
      const slot = fakeSlot({
        slotId: `imported-${String(slots.length + 1)}`,
        label: `${report.header.label} (imported)`,
        updatedAt: new Date().toISOString(),
        header: report.header,
      });
      slots.unshift(slot);
      return { ok: true, slot };
    },
  };
}
