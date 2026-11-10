/**
 * The engine host's side of saving and loading: what crosses the worker boundary, and the steps
 * between an engine and a save slot. Storage runs in the worker for these calls, so save bytes
 * never travel to the main thread on a normal load or save.
 *
 * - Load: storage `loadFromSlot` → the engine's staged `loadSave` with `engineLoadOptions()` (every
 *   simulation part checked by its own schema) → `engineStateFromSave` → the host installs it.
 * - Save: `exportState` → `createSaveDocument` (the header names the local seat's promotion) →
 *   `encodeSave` → storage `saveToSlot`, `createSlot` or `writeAutosave`.
 *
 * Nothing here throws at the main thread: every problem comes back as data the UI can show.
 */

import {
  appendPathSegment,
  classifyLoadFailure,
  createSaveDocument,
  CURRENT_FORMAT_VERSION,
  encodeSave,
  ENGINE_VERSION,
  engineLoadOptions,
  engineSaveSchemaFingerprint,
  engineSaveState,
  engineStateFromSave,
  inspectSave,
  loadSave,
  SAVE_LABEL_MAX_LENGTH,
  serializeError,
  TABLES,
} from '@ringside/engine';
import type {
  AppliedMigration,
  EngineState,
  GameDate,
  LoadIssue,
  LoadStage,
  PromotionId,
  SaveCompat,
  SaveDocument,
  SaveHeader,
  TunableIssue,
} from '@ringside/engine';
import * as storage from '@/storage';
import type { AutosaveOptions, BackupKind, SlotRecord, StorageError } from '@/storage';
import type { LocalSeat } from './localViewer';

/** Which save of a slot to load: the newest of its manual save and autosave, or one backup. */
export type LoadSlotWhich = 'latest' | BackupKind;

/** What a successful load tells the screen that asked for it. */
export interface LoadSaveSummary {
  /** The slot's label. */
  readonly label: string;
  readonly seat: LocalSeat;
  /** The local seat's promotion, or null for an unemployed or observer seat. */
  readonly promotionName: string | null;
  /** The world's date after loading. */
  readonly gameDate: GameDate;
  /** The format upgrades that ran, oldest first. Empty for a current save. */
  readonly migrationsApplied: readonly AppliedMigration[];
}

/** Where a load stopped: one of the engine's load stages, or `storage` when the bytes never arrived. */
export type LoadFailureStage = LoadStage | 'storage';

export interface LoadSaveFailure {
  readonly ok: false;
  readonly stage: LoadFailureStage;
  /** At most 50, each with a document path (empty for the whole file) and a readable message. */
  readonly issues: readonly LoadIssue[];
  /** How many more issues there were. */
  readonly truncated: number;
  /** The storage problem, when `stage` is `storage`. */
  readonly storageError: StorageError | null;
  /**
   * Set when the save failed because it was made with an older build (its schema fingerprint is
   * not this build's). Null for every other failure, which keeps the detailed report.
   */
  readonly compat: SaveCompat | null;
}

export type LoadSaveResult =
  | {
      readonly ok: true;
      readonly summary: LoadSaveSummary;
      /** Problems that did not stop the load, such as dropped unknown tunable overrides. */
      readonly warnings: readonly LoadIssue[];
      /** The world revision the loaded game starts at. */
      readonly revision: number;
    }
  | LoadSaveFailure;

/** How a save into a slot ended. */
export type SaveSlotResult =
  | { readonly ok: true; readonly slot: SlotRecord }
  | {
      readonly ok: false;
      /** A sentence the UI can show as it is. */
      readonly message: string;
      /** The storage problem, when storage refused the write. Null for a problem before it. */
      readonly storageError: StorageError | null;
    };

/** The message every save call gets when no game is loaded. */
export const NO_GAME_TO_SAVE_MESSAGE = 'There is no game loaded to save.';

/** A load failure from a storage error: the bytes could not be read. */
export function storageLoadFailure(error: StorageError): LoadSaveFailure {
  return {
    ok: false,
    stage: 'storage',
    issues: [{ path: '', message: error.message }],
    truncated: 0,
    storageError: error,
    compat: null,
  };
}

/** A load failure at an engine stage with one issue for the whole file. */
export function stageFailure(stage: LoadStage, message: string): LoadSaveFailure {
  return {
    ok: false,
    stage,
    issues: [{ path: '', message }],
    truncated: 0,
    storageError: null,
    compat: null,
  };
}

/**
 * Marks a failure as "made with an older build" when it stopped at a guarded stage and the
 * save's schema fingerprint is not this build's. Only the header is read. A header that cannot be
 * read leaves the failure as it is.
 */
export async function withCompat(
  failure: LoadSaveFailure,
  bytes: Uint8Array,
): Promise<LoadSaveFailure> {
  const currentFingerprint = engineSaveSchemaFingerprint();
  if (
    classifyLoadFailure({ stage: failure.stage, savedFingerprint: null, currentFingerprint }) ===
    null
  ) {
    return failure;
  }
  const inspected = await inspectSave(bytes);
  if (!inspected.ok) return failure;
  const compat = classifyLoadFailure({
    stage: failure.stage,
    savedFingerprint: inspected.header.schemaFingerprint ?? null,
    currentFingerprint,
  });
  return compat === null ? failure : { ...failure, compat };
}

/** The bytes of one save in a slot, read from storage. */
export async function readSlotBytes(
  slotId: string,
  which: LoadSlotWhich,
): Promise<
  { readonly ok: true; readonly bytes: Uint8Array; readonly label: string } | LoadSaveFailure
> {
  const slot = await storage.getSlot(slotId);
  if (!slot.ok) return storageLoadFailure(slot.error);
  const loaded = await storage.loadFromSlot(slotId, which);
  if (!loaded.ok) return storageLoadFailure(loaded.error);
  return { ok: true, bytes: loaded.value.bytes, label: slot.value.label };
}

/** A checked save, ready to install: the engine state and what the load found on the way. */
export interface DecodedSave {
  readonly ok: true;
  readonly state: EngineState;
  readonly migrationsApplied: readonly AppliedMigration[];
  readonly warnings: readonly LoadIssue[];
}

/**
 * Runs the engine's staged load on save bytes, with every simulation part validated by the
 * engine's own schemas and the tunable overrides checked. A document that passes is turned into
 * the engine state `createEngine` takes.
 */
export async function decodeSaveBytes(bytes: Uint8Array): Promise<DecodedSave | LoadSaveFailure> {
  const report = await loadSave(bytes, TABLES, engineLoadOptions());
  if (!report.ok) {
    return withCompat(
      {
        ok: false,
        stage: report.stage,
        issues: [...report.issues],
        truncated: report.truncated,
        storageError: null,
        compat: null,
      },
      bytes,
    );
  }
  let state: EngineState;
  try {
    state = engineStateFromSave(report.doc);
  } catch (error: unknown) {
    return withCompat(
      stageFailure(
        'build',
        `The save could not be turned into a game: ${serializeError(error).message}`,
      ),
      bytes,
    );
  }
  return {
    ok: true,
    state,
    migrationsApplied: [...report.migrationsApplied],
    warnings: [...report.warnings],
  };
}

/** Tunable overrides the engine dropped while starting, as load warnings. */
export function tunableIssueWarnings(issues: readonly TunableIssue[]): LoadIssue[] {
  return issues.map((issue) => ({
    path: appendPathSegment('state.tunableOverrides', issue.key),
    message: issue.message,
  }));
}

/** Seat notes from installing a world (several human players, say), as load warnings. */
export function seatWarnings(warnings: readonly string[]): LoadIssue[] {
  return warnings.map((message) => ({ path: '', message }));
}

/** The name of the seat's promotion in the state, or null when it runs none. */
export function seatPromotionName(
  state: EngineState,
  promotionId: PromotionId | null,
): string | null {
  if (promotionId === null) return null;
  return (
    state.world.tables.promotions.find((promotion) => promotion.id === promotionId)?.name ?? null
  );
}

/** A slot label cut to the length a save header allows. */
export function headerLabel(label: string): string {
  const trimmed = label.trim();
  const usable = trimmed === '' ? 'Saved game' : trimmed;
  return usable.length <= SAVE_LABEL_MAX_LENGTH ? usable : usable.slice(0, SAVE_LABEL_MAX_LENGTH);
}

/** A save ready for storage: the encoded bytes, its header and the metadata storage records. */
export interface EncodedSave {
  readonly bytes: Uint8Array;
  readonly header: SaveHeader;
  readonly meta: storage.SaveBytesMeta;
}

/**
 * Encodes the running game as a save document. The header names the local seat's promotion (null
 * for an observer), carries `label` and records `savedAt`.
 */
export async function encodeEngineState(
  state: EngineState,
  seat: LocalSeat,
  label: string,
  savedAt: string,
): Promise<EncodedSave> {
  const doc: SaveDocument = createSaveDocument(engineSaveState(state), {
    headerPromotionId: seat.promotionId,
    savedAt,
    label: headerLabel(label),
    engineVersion: ENGINE_VERSION,
    schemaFingerprint: engineSaveSchemaFingerprint(),
  });
  const bytes = await encodeSave(doc);
  return {
    bytes,
    header: doc.header,
    meta: { formatVersion: CURRENT_FORMAT_VERSION, engineVersion: ENGINE_VERSION, savedAt },
  };
}

/** A save failure from something thrown before storage was reached (encoding, a bad header). */
export function encodeFailure(error: unknown): SaveSlotResult {
  return {
    ok: false,
    message: `The game could not be saved: ${serializeError(error).message}`,
    storageError: null,
  };
}

/** A storage result as a save result. */
export function fromStorage(result: storage.StorageResult<SlotRecord>): SaveSlotResult {
  if (result.ok) return { ok: true, slot: result.value };
  return { ok: false, message: result.error.message, storageError: result.error };
}

export type { AutosaveOptions };
