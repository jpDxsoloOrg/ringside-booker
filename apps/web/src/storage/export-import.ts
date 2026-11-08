/**
 * Moving a save between devices: export a slot as an `.rbsave` file and import one as a new slot.
 *
 * An `.rbsave` file is exactly the stored gzip bytes; nothing is re-encoded on the way out or in.
 * Import never overwrites a slot: it always creates a new one, so a mistaken import cannot destroy
 * a game.
 */

import type { InspectReport, LoadFailure } from '@ringside/engine';
import {
  MAX_IMPORT_BYTES,
  SAVE_FILE_EXTENSION,
  SAVE_FILE_MIME_TYPE,
  SAVE_FILE_SLUG_MAX_LENGTH,
} from './constants';
import { runTransaction } from './db';
import type { SlotRecord } from './db';
import { storageFailure, type StorageError, type StorageResult } from './errors';
import { createSlot, readSlotBlob, type LoadWhich } from './save-slots';

/** What the injected inspector returns: the engine's `inspectSave` report. */
export type InspectResult = InspectReport;

/** An inspector failure: the load stage that refused the file and its issues. */
export type InspectFailure = LoadFailure;

/** Reads a save's header without loading the world; the app passes the worker's `inspectSave`. */
export type InspectSave = (bytes: Uint8Array) => Promise<InspectResult>;

export interface ExportedSave {
  readonly fileName: string;
  readonly blob: Blob;
}

export type ImportResult =
  | { readonly ok: true; readonly slot: SlotRecord }
  | { readonly ok: false; readonly error: StorageError | InspectFailure };

/** What `triggerDownload` ended up doing. */
export type DeliveryOutcome = 'shared' | 'downloaded' | 'cancelled';

const SLUG_FALLBACK = 'save';

/** How long the download link stays valid after the click, for browsers that fetch it late. */
const OBJECT_URL_REVOKE_DELAY_MS = 10_000;

/**
 * A file-name-safe version of a label: lowercase `a-z`, `0-9` and single hyphens, at most
 * `SAVE_FILE_SLUG_MAX_LENGTH` characters. Accents are dropped (`é` → `e`); a label with nothing
 * usable left becomes `save`.
 */
export function slugifyLabel(label: string): string {
  const slug = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SAVE_FILE_SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? SLUG_FALLBACK : slug;
}

/** `<slug(label)>-<gameDate>.rbsave`. */
export function saveFileName(label: string, gameDate: string): string {
  return `${slugifyLabel(label)}-${gameDate}${SAVE_FILE_EXTENSION}`;
}

/**
 * The bytes as a view on a plain `ArrayBuffer`, which is what `Blob` accepts. Stored bytes always
 * are, so this is the same memory, not a copy; bytes on a shared buffer are copied.
 */
function onPlainBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const { buffer } = bytes;
  if (buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer, bytes.byteOffset, bytes.byteLength);
  }
  return Uint8Array.from(bytes);
}

/**
 * A slot's save as a file: its name and a `Blob` of exactly the stored bytes. `which` picks the
 * save, `latest` by default. Works in a Web Worker as well as on the main thread.
 */
export async function exportSlot(
  slotId: string,
  which: LoadWhich = 'latest',
): Promise<StorageResult<ExportedSave>> {
  return runTransaction(['slots', 'blobs'], 'readonly', async (transaction) => {
    const slot = await transaction.objectStore('slots').get(slotId);
    const record = await readSlotBlob(transaction, slotId, which);
    const label = slot?.label ?? SLUG_FALLBACK;
    return {
      fileName: saveFileName(label, record.gameDate),
      blob: new Blob([onPlainBuffer(record.bytes)], { type: SAVE_FILE_MIME_TYPE }),
    };
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function canShareFile(file: File): boolean {
  if (typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') {
    return false;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function download(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, OBJECT_URL_REVOKE_DELAY_MS);
}

/**
 * Hands an exported save to the player. Where the browser can share files (phones), the share
 * sheet opens first; if sharing is not possible or fails, the file downloads instead. Closing the
 * share sheet counts as `cancelled` and downloads nothing.
 *
 * Main thread only (it needs the DOM). Call it straight from the click handler: browsers only open
 * the share sheet during a user gesture, so export the slot beforehand.
 */
export async function triggerDownload(fileName: string, blob: Blob): Promise<DeliveryOutcome> {
  const file = new File([blob], fileName, { type: blob.type });
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return 'shared';
    } catch (error: unknown) {
      if (isAbort(error)) {
        return 'cancelled';
      }
      // Sharing was refused (no user gesture, policy); a download still works.
    }
  }
  download(fileName, blob);
  return 'downloaded';
}

async function readFileBytes(file: File): Promise<StorageResult<Uint8Array>> {
  try {
    return { ok: true, value: new Uint8Array(await file.arrayBuffer()) };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return storageFailure({ code: 'readFailed', message: `The file could not be read: ${detail}` });
  }
}

async function runInspect(inspect: InspectSave, bytes: Uint8Array): Promise<InspectResult | null> {
  try {
    return await inspect(bytes);
  } catch {
    return null;
  }
}

/**
 * Imports an `.rbsave` file as a new slot labelled `<header label> (imported)`.
 *
 * Files over `MAX_IMPORT_BYTES` are refused before they are read. The bytes go through `inspect`
 * (the engine's `inspectSave`, wherever it runs), and an inspection failure comes back as is, so
 * the UI can show the stage and the issues. An existing slot is never overwritten.
 */
export async function importSaveFile(file: File, inspect: InspectSave): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) {
    return storageFailure({
      code: 'tooLarge',
      message: `The file is ${String(file.size)} bytes; saves larger than ${String(MAX_IMPORT_BYTES)} bytes cannot be imported.`,
      sizeBytes: file.size,
      limitBytes: MAX_IMPORT_BYTES,
    });
  }
  const read = await readFileBytes(file);
  if (!read.ok) {
    return read;
  }
  const bytes = read.value;
  const report = await runInspect(inspect, bytes);
  if (report === null) {
    return storageFailure({
      code: 'readFailed',
      message: 'The save could not be checked: the game engine did not answer.',
    });
  }
  if (!report.ok) {
    return { ok: false, error: report };
  }
  const created = await createSlot(`${report.header.label} (imported)`, bytes, report.header, {
    formatVersion: report.formatVersion,
    engineVersion: report.engineVersion,
    savedAt: new Date().toISOString(),
  });
  if (!created.ok) {
    return created;
  }
  return { ok: true, slot: created.value };
}
