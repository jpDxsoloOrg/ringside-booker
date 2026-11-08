/**
 * The engine host: the object the engine Web Worker exposes to the main thread through Comlink.
 *
 * It owns the running engine and the world revision, and it decides who this device plays as. When
 * a world is installed it resolves the local seat once, then passes the seat's viewer to every
 * query and its controller as `issuedBy` to every command, so screens and hooks never handle
 * either. It wraps the engine's own multi-day advance with an abort signal going in and throttled
 * progress coming out; the day loop, the gates and cancellation stay in the engine.
 *
 * It also loads and saves games. Storage runs here in the worker for those calls, so a save's
 * bytes go from IndexedDB through the engine's checks into a running engine without visiting the
 * main thread (see `saveGames.ts`). Listing, deleting, exporting and importing slots run on the
 * main thread, which needs the DOM for downloads and file pickers.
 *
 * Every result is plain JSON. The engine checks its own results when `debugChecks` is on (dev and
 * test builds); the host checks the advance outcome and progress objects it builds itself the same
 * way. Nothing here throws for game reasons: a call before a world is loaded, a second advance or
 * bad advance options come back as `{ ok: false, reasons }`, and a save that will not load comes
 * back as the stage that refused it and its issues.
 */

import {
  addDays,
  assertSerialisable,
  defaultSystems,
  ENGINE_VERSION,
  INTERNAL,
  INVALID_ARGS,
  inspectSave,
  serializeError,
} from '@ringside/engine';
import type {
  AdvanceProgress as EngineDayProgress,
  AdvanceResult,
  CommandArgs,
  CommandData,
  CommandName,
  CommandResult,
  CreateEngineOptions,
  Engine,
  EngineState,
  GameDate,
  InspectReport,
  QueryArgs,
  QueryData,
  QueryName,
  QueryResult,
  Reason,
  TunableIssue,
} from '@ringside/engine';
import * as storage from '@/storage';
import type { SlotRecord } from '@/storage';
import { resolveLocalViewer } from './localViewer';
import type { LocalSeat } from './localViewer';
import {
  decodeSaveBytes,
  encodeEngineState,
  encodeFailure,
  fromStorage,
  NO_GAME_TO_SAVE_MESSAGE,
  readSlotBytes,
  seatPromotionName,
  seatWarnings,
  stageFailure,
  tunableIssueWarnings,
} from './saveGames';
import type {
  AutosaveOptions,
  EncodedSave,
  LoadSaveResult,
  LoadSlotWhich,
  SaveSlotResult,
} from './saveGames';
import { yieldToEventLoop } from './yieldToEventLoop';

export type {
  LoadFailureStage,
  LoadSaveFailure,
  LoadSaveResult,
  LoadSaveSummary,
  LoadSlotWhich,
  SaveSlotResult,
} from './saveGames';

/** Builds an engine: `createEngine` in the worker, a wrapper adding test systems in tests. */
export type EngineFactory = (options: CreateEngineOptions) => Engine;

/** The reason every call gets before a world is loaded. */
export const NO_WORLD_REASON: Reason = Object.freeze({
  code: 'noWorld',
  message: 'No game is loaded',
});

/** The reason a second advance gets while one is still running. */
export const ADVANCE_BUSY_REASON: Reason = Object.freeze({
  code: 'busy',
  message: 'The game is already moving forward.',
});

/** At most one progress report per this many milliseconds, plus a final one. */
export const PROGRESS_INTERVAL_MS = 50;

export interface PingResult {
  readonly engineVersion: string;
}

/** A query's result and the world revision it was computed at. */
export interface HostQueryResponse<K extends QueryName> {
  readonly revision: number;
  readonly result: QueryResult<QueryData<K>>;
}

/** A command's result and the world revision after it (bumped only when it was applied). */
export interface HostCommandResponse<K extends CommandName> {
  readonly revision: number;
  readonly result: CommandResult<CommandData<K>>;
}

/** What the UI asks for. The engine validates `maxDays` (1 to 3650) and `stopAtDate`. */
export interface AdvanceRequest {
  readonly maxDays: number;
  readonly stopAtDate?: GameDate;
}

/** Progress of a running advance, sent at most every {@link PROGRESS_INTERVAL_MS} plus once at the end. */
export interface AdvanceProgress {
  /** Days simulated so far. */
  readonly daysDone: number;
  /** The most days this advance will run. It can stop sooner. */
  readonly daysRequested: number;
  /** The world's date now: the day after the last one simulated. */
  readonly currentDate: GameDate;
  /** The world revision after the last simulated day. */
  readonly revision: number;
}

/**
 * How an advance ended: the engine's `AdvanceResult` (why it stopped, failures, dates) and the
 * revision after it, or the reasons it never started.
 */
export type AdvanceOutcome =
  | (AdvanceResult & { readonly ok: true; readonly revision: number })
  | { readonly ok: false; readonly reasons: Reason[]; readonly revision: number };

/** The host as the main thread sees it. Every member is plain data in and out, or a callback. */
export interface EngineHost {
  ping(): Promise<PingResult>;
  /** Runs a query for the local seat's viewer. */
  query<K extends QueryName>(name: K, args: QueryArgs<K>): Promise<HostQueryResponse<K>>;
  /** Runs a command issued by the local seat's controller. */
  command<K extends CommandName>(name: K, args: CommandArgs<K>): Promise<HostCommandResponse<K>>;
  /** Advances up to `request.maxDays` days, reporting progress as it goes. */
  advanceDays(
    request: AdvanceRequest,
    onProgress: (progress: AdvanceProgress) => void,
  ): Promise<AdvanceOutcome>;
  /** Stops the running advance after the day it is on. Does nothing when none is running. */
  cancelAdvance(): void;
  isWorldLoaded(): boolean;
  /** The local seat, so the session store can mirror it. Null before a world is loaded. */
  getSeat(): LocalSeat | null;
  /**
   * Loads a save from a slot and makes it the running game: the newest of its manual save and
   * autosave (`latest`), or one of its backups. The save is checked stage by stage; a save that
   * fails a stage leaves the running game (if any) as it was.
   */
  loadFromSlot(slotId: string, which: LoadSlotWhich): Promise<LoadSaveResult>;
  /** A manual save of the running game into an existing slot (its backups rotate). */
  saveToSlot(slotId: string): Promise<SaveSlotResult>;
  /** Creates a new slot holding the running game, for a game that has never been saved. */
  createSlot(label: string): Promise<SaveSlotResult>;
  /** Writes the running game as the slot's autosave, rotating a monthly backup first if asked. */
  autosave(slotId: string, options: AutosaveOptions): Promise<SaveSlotResult>;
  /** Reads a save's header without loading it, for importing a file. */
  inspectSave(bytes: Uint8Array): Promise<InspectReport>;
  /**
   * Stops the running game. Every call after it gets the noWorld reason until a game loads.
   * Returns the revision after it, which is newer than any result from the old game.
   */
  unloadWorld(): UnloadResult;
}

/** What unloading the world reports. */
export interface UnloadResult {
  readonly revision: number;
}

/** What installing a world reports. */
export interface InstallResult {
  readonly seat: LocalSeat;
  /** The revision the new world starts at. */
  readonly revision: number;
  /** Notes on the seat choice, such as a save with several human players. */
  readonly warnings: string[];
  /** Tunable overrides the engine dropped while loading the state. */
  readonly loadIssues: TunableIssue[];
}

/**
 * The host inside the worker. `installEngine` is the one place an engine is created: loading a
 * save slot and starting a new game both go through it. It is not part of {@link EngineHost},
 * because the main thread installs worlds through those flows, never directly.
 */
export interface WorkerEngineHost extends EngineHost {
  installEngine(state: EngineState): InstallResult;
}

export interface EngineHostOptions {
  /**
   * Run the engine's plain-JSON checks on every result. Defaults to on in dev and test builds and
   * off in production, where they cost time on every call.
   */
  readonly debugChecks?: boolean;
  /** Minimum gap between progress reports. Defaults to {@link PROGRESS_INTERVAL_MS}. */
  readonly progressIntervalMs?: number;
  /** A millisecond clock for throttling progress. Defaults to `performance.now`. */
  readonly now?: () => number;
  /** The real-world time a save records, as an ISO string. Defaults to the system clock. */
  readonly savedAtNow?: () => string;
}

interface RunningEngine {
  readonly engine: Engine;
  readonly seat: LocalSeat;
}

function defaultNow(): number {
  return performance.now();
}

function defaultSavedAtNow(): string {
  return new Date().toISOString();
}

/** The reason for advance options the engine refused, or for an advance that broke. */
function advanceErrorReason(error: unknown): Reason {
  const { message } = serializeError(error);
  if (error instanceof RangeError) return { code: INVALID_ARGS, message };
  return { code: INTERNAL, message: `Something went wrong inside the game: ${message}` };
}

/** Creates the engine host. It starts with no world; `installEngine` loads one. */
export function createEngineHost(
  engineFactory: EngineFactory,
  options: EngineHostOptions = {},
): WorkerEngineHost {
  const debugChecks =
    options.debugChecks ?? (import.meta.env.DEV || import.meta.env.MODE === 'test');
  const progressIntervalMs = options.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
  const now = options.now ?? defaultNow;
  const savedAtNow = options.savedAtNow ?? defaultSavedAtNow;

  let running: RunningEngine | null = null;
  let revision = 0;
  let advanceAbort: AbortController | null = null;

  function checked<T>(value: T, path: string): T {
    if (debugChecks) assertSerialisable(value, path);
    return value;
  }

  async function runAdvance(
    current: RunningEngine,
    request: AdvanceRequest,
    onProgress: (progress: AdvanceProgress) => void,
  ): Promise<AdvanceOutcome> {
    const abort = new AbortController();
    advanceAbort = abort;
    let lastReportAt = Number.NEGATIVE_INFINITY;
    // A holder, because TypeScript cannot see the onDay callback assign a plain variable.
    const latest: { day: EngineDayProgress | null } = { day: null };
    let reportedDayIndex = 0;

    const report = (day: EngineDayProgress): void => {
      const progress: AdvanceProgress = {
        daysDone: day.dayIndex,
        daysRequested: request.maxDays,
        currentDate: addDays(day.date, 1),
        revision,
      };
      reportedDayIndex = day.dayIndex;
      lastReportAt = now();
      onProgress(checked(progress, 'advanceDays.progress'));
    };

    try {
      const result = await current.engine.advanceDays({
        maxDays: request.maxDays,
        ...(request.stopAtDate === undefined ? {} : { stopAtDate: request.stopAtDate }),
        signal: abort.signal,
        onDay: (day) => {
          revision += 1;
          latest.day = day;
          if (now() - lastReportAt >= progressIntervalMs) report(day);
        },
      });
      if (latest.day !== null && latest.day.dayIndex !== reportedDayIndex) report(latest.day);
      return checked({ ...result, ok: true, revision }, 'advanceDays.outcome');
    } catch (error: unknown) {
      return { ok: false, reasons: [advanceErrorReason(error)], revision };
    } finally {
      advanceAbort = null;
    }
  }

  function installEngine(state: EngineState): InstallResult {
    // Built before the old game stops, so an engine that refuses the state leaves it running.
    const engine = engineFactory({
      state,
      systems: defaultSystems,
      host: { yieldToHost: yieldToEventLoop },
      debugChecks,
    });
    advanceAbort?.abort();
    const { seat, warnings } = resolveLocalViewer(state);
    running = { engine, seat };
    revision += 1;
    return { seat, revision, warnings, loadIssues: [...engine.loadIssues] };
  }

  async function loadFromSlot(slotId: string, which: LoadSlotWhich): Promise<LoadSaveResult> {
    if (advanceAbort !== null) {
      return stageFailure('build', ADVANCE_BUSY_REASON.message);
    }
    const read = await readSlotBytes(slotId, which);
    if (!read.ok) return read;
    const decoded = await decodeSaveBytes(read.bytes);
    if (!decoded.ok) return decoded;

    let install: InstallResult;
    try {
      install = installEngine(decoded.state);
    } catch (error: unknown) {
      return stageFailure(
        'build',
        `The game could not start from this save: ${serializeError(error).message}`,
      );
    }
    const result: LoadSaveResult = {
      ok: true,
      summary: {
        label: read.label,
        seat: install.seat,
        promotionName: seatPromotionName(decoded.state, install.seat.promotionId),
        gameDate: decoded.state.world.meta.currentDate,
        migrationsApplied: decoded.migrationsApplied,
      },
      warnings: [
        ...decoded.warnings,
        ...tunableIssueWarnings(install.loadIssues),
        ...seatWarnings(install.warnings),
      ],
      revision: install.revision,
    };
    return checked(result, 'loadFromSlot');
  }

  /**
   * Encodes the running game under `label` and hands it to `write`. Problems come back as data:
   * no game loaded, a slot that is gone, a game that would not encode or a storage refusal.
   */
  async function writeSave(
    label: string | storage.StorageResult<string>,
    write: (encoded: EncodedSave) => Promise<storage.StorageResult<SlotRecord>>,
  ): Promise<SaveSlotResult> {
    const current = running;
    if (current === null) {
      return { ok: false, message: NO_GAME_TO_SAVE_MESSAGE, storageError: null };
    }
    if (typeof label !== 'string' && !label.ok) {
      return { ok: false, message: label.error.message, storageError: label.error };
    }
    let encoded: EncodedSave;
    try {
      encoded = await encodeEngineState(
        current.engine.exportState(),
        current.seat,
        typeof label === 'string' ? label : label.value,
        savedAtNow(),
      );
    } catch (error: unknown) {
      return encodeFailure(error);
    }
    return checked(fromStorage(await write(encoded)), 'save');
  }

  /** The label of an existing slot, which the save header repeats. */
  async function slotLabel(slotId: string): Promise<storage.StorageResult<string>> {
    const slot = await storage.getSlot(slotId);
    return slot.ok ? { ok: true, value: slot.value.label } : slot;
  }

  // The engine's advanceDays does not take an `issuedBy`: time moving is not a command. When it
  // does (multiplayer "ready" turns), the seat's controller is passed here like every command.
  return {
    installEngine,
    loadFromSlot,

    async saveToSlot(slotId: string): Promise<SaveSlotResult> {
      return writeSave(await slotLabel(slotId), ({ bytes, header, meta }) =>
        storage.saveToSlot(slotId, bytes, header, meta),
      );
    },

    createSlot(label: string): Promise<SaveSlotResult> {
      return writeSave(label, ({ bytes, header, meta }) =>
        storage.createSlot(label, bytes, header, meta),
      );
    },

    async autosave(slotId: string, autosaveOptions: AutosaveOptions): Promise<SaveSlotResult> {
      return writeSave(await slotLabel(slotId), ({ bytes, header, meta }) =>
        storage.writeAutosave(slotId, bytes, header, meta, autosaveOptions),
      );
    },

    inspectSave(bytes: Uint8Array): Promise<InspectReport> {
      return inspectSave(bytes);
    },

    unloadWorld(): UnloadResult {
      advanceAbort?.abort();
      if (running !== null) {
        running = null;
        // Every cached query belongs to the old game, so the revision moves on.
        revision += 1;
      }
      return { revision };
    },

    ping(): Promise<PingResult> {
      return Promise.resolve({ engineVersion: ENGINE_VERSION });
    },

    query<K extends QueryName>(name: K, args: QueryArgs<K>): Promise<HostQueryResponse<K>> {
      if (running === null) {
        return Promise.resolve({ revision, result: { ok: false, reasons: [NO_WORLD_REASON] } });
      }
      const result = running.engine.query(name, args, running.seat.viewer);
      return Promise.resolve({ revision, result });
    },

    command<K extends CommandName>(name: K, args: CommandArgs<K>): Promise<HostCommandResponse<K>> {
      if (running === null) {
        return Promise.resolve({ revision, result: { ok: false, reasons: [NO_WORLD_REASON] } });
      }
      const result = running.engine.command(name, args, running.seat.controller);
      if (result.ok) revision += 1;
      return Promise.resolve({ revision, result });
    },

    advanceDays(
      request: AdvanceRequest,
      onProgress: (progress: AdvanceProgress) => void,
    ): Promise<AdvanceOutcome> {
      if (running === null) {
        return Promise.resolve({ ok: false, reasons: [NO_WORLD_REASON], revision });
      }
      if (advanceAbort !== null) {
        return Promise.resolve({ ok: false, reasons: [ADVANCE_BUSY_REASON], revision });
      }
      return runAdvance(running, request, onProgress);
    },

    cancelAdvance(): void {
      advanceAbort?.abort();
    },

    isWorldLoaded(): boolean {
      return running !== null;
    },

    getSeat(): LocalSeat | null {
      return running?.seat ?? null;
    },
  };
}
