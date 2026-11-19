/**
 * The embedded engine host: what the Unity game calls through its JavaScript runtime.
 *
 * It is the web worker host (`apps/web/src/worker/engineHost.ts`) without the browser: it owns the
 * running engine and the world revision, resolves the local seat when a world is installed and
 * passes the seat's viewer to every query and its controller to every command, wraps the engine's
 * multi-day advance with a cancel flag and per-day progress, starts new games from the content
 * packs inlined in the bundle, and turns games into save bytes and back.
 *
 * Every argument and every result is a JSON string, the simplest thing any JavaScript runtime can
 * pass to C#. Saves cross as base64 text of the same gzipped save document the web app writes.
 * Nothing throws across the boundary: bad JSON, a call before a world is loaded, a second advance
 * or an engine fault come back as `{ "ok": false, "reasons": [...] }` (or a load `stage` failure).
 *
 * Calls that only touch memory are synchronous. `load`, `save`, `inspectSave` and `advanceDays`
 * return a Promise of the JSON string, because the engine's save codec and day loop are async; they
 * only ever wait on promise jobs (microtasks), never on timers, so a runtime settles them by
 * draining its job queue. See game/docs/engine-host.md.
 */

import {
  addDays,
  assertSerialisable,
  CURRENT_FORMAT_VERSION,
  createEngine,
  createNewGame,
  createSaveDocument,
  defaultSystems,
  encodeSave,
  ENGINE_VERSION,
  engineLoadOptions,
  engineSaveSchemaFingerprint,
  engineSaveState,
  engineStateFromSave,
  inspectSave,
  INTERNAL,
  INVALID_ARGS,
  isGameDate,
  loadSave,
  previewWorld,
  SAVE_LABEL_MAX_LENGTH,
  serializeError,
  TABLES,
  worldHash,
} from '@ringside/engine';
import type { Engine, EngineState, RawPack, Reason } from '@ringside/engine';
import { decodeBase64, encodeBase64 } from './base64';
import { readContentPacks } from './contentPacks';
import type { ContentFiles, ContentPackSet } from './contentPacks';
import { LOCAL_OBSERVER_PLAYER_ID, resolveLocalViewer } from './localSeat';
import type { LocalSeat } from './localSeat';
import { convertWorldMod } from './worldMod/convert';
import { baseGeographyOf } from './worldMod/base';
import { checkWorldModPack, ruleOf } from './worldMod/check';

/** Bumped when a function, an argument or a result shape of this API changes. */
export const HOST_API_VERSION = 2;

/** The most loader issues an import result lists; the rest are only counted. */
const MAX_REPORTED_PACK_ISSUES = 50;

/** The reason every world call gets before a game is loaded. */
export const NO_WORLD_REASON: Reason = Object.freeze({
  code: 'noWorld',
  message: 'No game is loaded',
});

/** The reason a second advance (or a load or new game during one) gets. */
export const ADVANCE_BUSY_REASON: Reason = Object.freeze({
  code: 'busy',
  message: 'The game is already moving forward.',
});

/** Save bytes as the caller may pass them: base64 text, or a byte array of any realm. */
export type SaveInput = string | ArrayLike<number>;

/** A progress listener: gets one JSON progress object per simulated day. */
export type ProgressListener = (progressJson: string) => unknown;

/** The object the bundle installs as `globalThis.RingsideEngine`. */
export interface RingsideEngineApi {
  info(): string;
  configure(optionsJson: string): string;
  listWorlds(): string;
  previewWorld(rootPackId: string): string;
  newGame(optionsJson: string): string;
  load(save: SaveInput): Promise<string>;
  save(optionsJson?: string): Promise<string>;
  inspectSave(save: SaveInput): Promise<string>;
  query(name: string, argsJson?: string, viewerJson?: string): string;
  command(name: string, argsJson?: string): string;
  advanceDays(optionsJson: string, onProgress?: ProgressListener): Promise<string>;
  importWorldMod(inputJson: string): string;
  removeImportedWorld(packId: string): string;
  cancelAdvance(): string;
  exportState(): string;
  worldHash(): string;
  unload(): string;
}

export interface EmbeddedHostOptions {
  /** Every JSON file under `content/`, keyed by its path inside that folder. */
  readonly content: ContentFiles;
  /** Names of the globals the bundle had to supply, reported by `info()`. */
  readonly shims?: readonly string[];
}

interface RunningEngine {
  readonly engine: Engine;
  readonly seat: LocalSeat;
}

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; reason: Reason };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): Reason {
  return { code: INVALID_ARGS, message };
}

function internal(error: unknown, what: string): Reason {
  return { code: INTERNAL, message: `${what}: ${serializeError(error).message}` };
}

/** Parses a JSON argument; an absent or empty one is `fallback`. */
function parseJson(text: unknown, what: string, fallback: unknown): Parsed<unknown> {
  if (text === undefined || text === null || text === '') return { ok: true, value: fallback };
  if (typeof text !== 'string') {
    return { ok: false, reason: invalid(`${what} must be a JSON string, got ${typeof text}`) };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: invalid(`${what} is not valid JSON: ${serializeError(error).message}`),
    };
  }
}

function parseObject(text: unknown, what: string): Parsed<Record<string, unknown>> {
  const parsed = parseJson(text, what, {});
  if (!parsed.ok) return parsed;
  if (!isPlainObject(parsed.value)) {
    return { ok: false, reason: invalid(`${what} must be a JSON object`) };
  }
  return { ok: true, value: parsed.value };
}

function toBytes(save: SaveInput | null | undefined): Parsed<Uint8Array> {
  try {
    if (typeof save === 'string') return { ok: true, value: decodeBase64(save) };
    // Checked again at run time: the caller is another language and may pass anything.
    if (typeof save === 'object' && save !== null && typeof save.length === 'number') {
      // `from` copies, so a typed array from another realm or a host array works too.
      return { ok: true, value: Uint8Array.from(save) };
    }
  } catch (error: unknown) {
    return { ok: false, reason: invalid(serializeError(error).message) };
  }
  return { ok: false, reason: invalid('The save must be base64 text or an array of bytes') };
}

/** A save header label: trimmed, never empty, cut to the length a header allows. */
function headerLabel(label: string): string {
  const trimmed = label.trim();
  const usable = trimmed === '' ? 'Saved game' : trimmed;
  return usable.slice(0, SAVE_LABEL_MAX_LENGTH);
}

/** Creates the host. It starts with no world; `newGame` or `load` installs one. */
export function createEmbeddedHost(options: EmbeddedHostOptions): RingsideEngineApi {
  const shims = [...(options.shims ?? [])];
  let debugChecks = false;
  let contentPacks: ContentPackSet | null = null;
  let running: RunningEngine | null = null;
  let revision = 0;
  /** The running advance's cancel flag, or null when none is running. */
  let advanceSignal: { aborted: boolean } | null = null;

  /** World packs converted from workshop world mods this session, by pack id. */
  const importedPacks = new Map<string, RawPack>();

  function packs(): ContentPackSet {
    contentPacks ??= readContentPacks(options.content);
    return contentPacks;
  }

  /** The bundled packs plus every imported world. */
  function allPacks(): readonly RawPack[] {
    const bundled = packs().packs.filter((pack) => !importedPacks.has(pack.manifest.id));
    return [...bundled, ...importedPacks.values()];
  }

  /** JSON text of a result, checked to be plain JSON first when debug checks are on. */
  function out(value: unknown, path: string): string {
    if (debugChecks) assertSerialisable(value, path);
    return JSON.stringify(value);
  }

  function refused(reasons: readonly Reason[]): string {
    return JSON.stringify({ ok: false, reasons, revision });
  }

  /** Runs a synchronous call, turning anything thrown into an internal reason. */
  function guard(what: string, run: () => string): string {
    try {
      return run();
    } catch (error: unknown) {
      return refused([internal(error, `${what} failed inside the game`)]);
    }
  }

  async function guardAsync(what: string, run: () => Promise<string>): Promise<string> {
    try {
      return await run();
    } catch (error: unknown) {
      return refused([internal(error, `${what} failed inside the game`)]);
    }
  }

  /** Builds an engine for `state` and makes it the running game. Throws when the engine refuses. */
  function install(state: EngineState): { seat: LocalSeat; warnings: string[] } {
    const engine = createEngine({ state, systems: defaultSystems, debugChecks });
    const { seat, warnings } = resolveLocalViewer(state);
    running = { engine, seat };
    revision += 1;
    return {
      seat,
      warnings: [
        ...warnings,
        ...engine.loadIssues.map((issue) => `${issue.key}: ${issue.message}`),
      ],
    };
  }

  function promotionName(state: EngineState, promotionId: string | null): string | null {
    if (promotionId === null) return null;
    return state.world.tables.promotions.find((row) => row.id === promotionId)?.name ?? null;
  }

  return {
    info: () =>
      JSON.stringify({
        engineVersion: ENGINE_VERSION,
        hostApiVersion: HOST_API_VERSION,
        saveFormatVersion: CURRENT_FORMAT_VERSION,
        schemaFingerprint: engineSaveSchemaFingerprint(),
        shims,
        debugChecks,
        worldLoaded: running !== null,
        revision,
      }),

    configure: (optionsJson) =>
      guard('configure', () => {
        const parsed = parseObject(optionsJson, 'The options');
        if (!parsed.ok) return refused([parsed.reason]);
        const { debugChecks: wanted } = parsed.value;
        if (wanted !== undefined && typeof wanted !== 'boolean') {
          return refused([invalid('debugChecks must be true or false')]);
        }
        if (wanted !== undefined) debugChecks = wanted;
        // Takes effect for the next engine built (newGame or load).
        return JSON.stringify({ ok: true, debugChecks });
      }),

    listWorlds: () =>
      guard('listWorlds', () => {
        const set = packs();
        const worlds = allPacks()
          .filter((pack) => pack.manifest.kind === 'world')
          .map((pack) => ({ ...pack.manifest, imported: importedPacks.has(pack.manifest.id) }));
        return out({ ok: true, packs: worlds, issues: set.issues }, 'listWorlds');
      }),

    previewWorld: (rootPackId) =>
      guard('previewWorld', () => {
        if (typeof rootPackId !== 'string' || rootPackId === '') {
          return refused([invalid('previewWorld needs a world pack id')]);
        }
        return out(previewWorld(allPacks(), rootPackId), 'previewWorld');
      }),

    newGame: (optionsJson) =>
      guard('newGame', () => {
        if (advanceSignal !== null) return refused([ADVANCE_BUSY_REASON]);
        const parsed = parseObject(optionsJson, 'The new-game options');
        if (!parsed.ok) return refused([parsed.reason]);
        const input = { playerId: LOCAL_OBSERVER_PLAYER_ID, ...parsed.value };
        const created = createNewGame(allPacks(), input);
        if (!created.ok) return refused(created.reasons);
        const installed = install(created.state);
        return out(
          {
            ok: true,
            summary: created.summary,
            seat: installed.seat,
            warnings: installed.warnings,
            revision,
          },
          'newGame',
        );
      }),

    load: (save) =>
      guardAsync('load', async () => {
        if (advanceSignal !== null) return refused([ADVANCE_BUSY_REASON]);
        const bytes = toBytes(save);
        if (!bytes.ok) return refused([bytes.reason]);
        const report = await loadSave(bytes.value, TABLES, engineLoadOptions());
        if (!report.ok) {
          return out(
            {
              ok: false,
              stage: report.stage,
              issues: report.issues,
              truncated: report.truncated,
              revision,
            },
            'load',
          );
        }
        let installed: { seat: LocalSeat; warnings: string[] };
        let state: EngineState;
        try {
          state = engineStateFromSave(report.doc);
          installed = install(state);
        } catch (error: unknown) {
          return out(
            {
              ok: false,
              stage: 'build',
              issues: [
                {
                  path: '',
                  message: `The game could not start from this save: ${serializeError(error).message}`,
                },
              ],
              truncated: 0,
              revision,
            },
            'load',
          );
        }
        return out(
          {
            ok: true,
            summary: {
              label: report.doc.header.label,
              seat: installed.seat,
              promotionName: promotionName(state, installed.seat.promotionId),
              gameDate: state.world.meta.currentDate,
              migrationsApplied: report.migrationsApplied,
            },
            warnings: [
              ...report.warnings,
              ...installed.warnings.map((message) => ({ path: '', message })),
            ],
            revision,
          },
          'load',
        );
      }),

    save: (optionsJson) =>
      guardAsync('save', async () => {
        const current = running;
        if (current === null) return refused([NO_WORLD_REASON]);
        const parsed = parseObject(optionsJson, 'The save options');
        if (!parsed.ok) return refused([parsed.reason]);
        const { label, savedAt } = parsed.value;
        if (label !== undefined && typeof label !== 'string') {
          return refused([invalid('label must be a string')]);
        }
        if (savedAt !== undefined && typeof savedAt !== 'string') {
          return refused([invalid('savedAt must be an ISO date-time string')]);
        }
        const state = current.engine.exportState();
        const doc = createSaveDocument(engineSaveState(state), {
          headerPromotionId: current.seat.promotionId,
          savedAt: savedAt ?? new Date().toISOString(),
          label: headerLabel(label ?? state.world.meta.worldName),
          engineVersion: ENGINE_VERSION,
          schemaFingerprint: engineSaveSchemaFingerprint(),
        });
        const bytes = await encodeSave(doc);
        return out(
          {
            ok: true,
            base64: encodeBase64(bytes),
            byteLength: bytes.length,
            header: doc.header,
            revision,
          },
          'save',
        );
      }),

    inspectSave: (save) =>
      guardAsync('inspectSave', async () => {
        const bytes = toBytes(save);
        if (!bytes.ok) return refused([bytes.reason]);
        return out(await inspectSave(bytes.value), 'inspectSave');
      }),

    query: (name, argsJson, viewerJson) =>
      guard('query', () => {
        const current = running;
        if (current === null) return refused([NO_WORLD_REASON]);
        const args = parseJson(argsJson, 'The query arguments', {});
        if (!args.ok) return refused([args.reason]);
        const viewer = parseJson(viewerJson, 'The viewer', current.seat.viewer);
        if (!viewer.ok) return refused([viewer.reason]);
        if (typeof name !== 'string') return refused([invalid('The query name must be a string')]);
        const result = current.engine.queryRaw(name, args.value, viewer.value);
        return out({ revision, result }, 'query');
      }),

    command: (name, argsJson) =>
      guard('command', () => {
        const current = running;
        if (current === null) return refused([NO_WORLD_REASON]);
        const args = parseJson(argsJson, 'The command arguments', {});
        if (!args.ok) return refused([args.reason]);
        if (typeof name !== 'string') {
          return refused([invalid('The command name must be a string')]);
        }
        const result = current.engine.commandRaw(name, args.value, current.seat.controller);
        if (result.ok) revision += 1;
        return out({ revision, result }, 'command');
      }),

    advanceDays: (optionsJson, onProgress) =>
      guardAsync('advanceDays', async () => {
        const current = running;
        if (current === null) return refused([NO_WORLD_REASON]);
        if (advanceSignal !== null) return refused([ADVANCE_BUSY_REASON]);
        const parsed = parseObject(optionsJson, 'The advance options');
        if (!parsed.ok) return refused([parsed.reason]);
        const { maxDays, stopAtDate } = parsed.value;
        if (typeof maxDays !== 'number') return refused([invalid('maxDays must be a number')]);
        if (stopAtDate !== undefined && !isGameDate(stopAtDate)) {
          return refused([invalid('stopAtDate must be a date in the form YYYY-MM-DD')]);
        }
        const signal = { aborted: false };
        advanceSignal = signal;
        try {
          const result = await current.engine.advanceDays({
            maxDays,
            // The engine checks maxDays' range and that the stop date is after today.
            ...(stopAtDate === undefined ? {} : { stopAtDate }),
            signal,
            onDay: (day) => {
              revision += 1;
              if (onProgress === undefined) return;
              onProgress(
                out(
                  {
                    daysDone: day.dayIndex,
                    daysRequested: maxDays,
                    date: day.date,
                    currentDate: addDays(day.date, 1),
                    revision,
                  },
                  'advanceDays.progress',
                ),
              );
            },
          });
          return out({ ...result, ok: true, revision }, 'advanceDays');
        } catch (error: unknown) {
          const reason =
            error instanceof RangeError
              ? invalid(serializeError(error).message)
              : internal(error, 'Something went wrong inside the game');
          return refused([reason]);
        } finally {
          advanceSignal = null;
        }
      }),

    importWorldMod: (inputJson) =>
      guard('importWorldMod', () => {
        const parsed = parseObject(inputJson, 'The world mod');
        if (!parsed.ok) return refused([parsed.reason]);
        const { tables, rosterOnly, packId } = parsed.value;
        if (!isPlainObject(tables)) {
          return refused([invalid('tables must be an object of table name to row arrays')]);
        }
        if (rosterOnly !== undefined && typeof rosterOnly !== 'boolean') {
          return refused([invalid('rosterOnly must be true or false')]);
        }
        if (packId !== undefined && typeof packId !== 'string') {
          return refused([invalid('packId must be a string')]);
        }
        const base = packs().packs.find((pack) => pack.manifest.id === 'base');
        if (base === undefined) return refused([invalid('The bundled base pack is missing')]);
        const conversion = convertWorldMod(tables, baseGeographyOf(base), {
          ...(rosterOnly === undefined ? {} : { rosterOnly }),
          ...(packId === undefined ? {} : { packId }),
        });
        if (!conversion.ok) {
          return out(
            {
              ok: false,
              stage: 'convert',
              errors: conversion.errors,
              report: conversion.report,
              revision,
            },
            'importWorldMod',
          );
        }
        const others = allPacks().filter(
          (candidate) => candidate.manifest.id !== conversion.pack.manifest.id,
        );
        // The same check a new game runs (resolve, merge, check every record, build the world);
        // records it refuses are left out and reported, and the pack is checked again.
        const checked = checkWorldModPack(others, conversion.pack, conversion.report);
        const listed = checked.issues.slice(0, MAX_REPORTED_PACK_ISSUES);
        if (!checked.ok) {
          const ruleCounts: Record<string, number> = {};
          for (const issue of checked.issues) {
            if (issue.severity !== 'error') continue;
            const rule = ruleOf(issue);
            ruleCounts[rule] = (ruleCounts[rule] ?? 0) + 1;
          }
          return out(
            {
              ok: false,
              stage: 'load',
              errors: [
                `The converted world did not load: ${String(checked.errorCount)} problem(s)`,
              ],
              ruleCounts,
              report: checked.report,
              issues: listed,
              issueCount: checked.issues.length,
              revision,
            },
            'importWorldMod',
          );
        }
        const { pack } = checked;
        importedPacks.set(pack.manifest.id, pack);
        return out(
          {
            ok: true,
            manifest: pack.manifest,
            report: checked.report,
            issues: listed,
            issueCount: checked.issues.length,
            revision,
          },
          'importWorldMod',
        );
      }),

    removeImportedWorld: (packId) =>
      guard('removeImportedWorld', () => {
        const removed = typeof packId === 'string' && importedPacks.delete(packId);
        return JSON.stringify({ ok: true, removed });
      }),

    cancelAdvance: () => {
      const wasRunning = advanceSignal !== null;
      if (advanceSignal !== null) advanceSignal.aborted = true;
      return JSON.stringify({ ok: true, cancelled: wasRunning });
    },

    exportState: () =>
      guard('exportState', () => {
        if (running === null) return refused([NO_WORLD_REASON]);
        return out({ ok: true, state: running.engine.exportState(), revision }, 'exportState');
      }),

    worldHash: () =>
      guard('worldHash', () => {
        if (running === null) return refused([NO_WORLD_REASON]);
        return JSON.stringify({
          ok: true,
          hash: worldHash(running.engine.exportState()),
          revision,
        });
      }),

    unload: () => {
      if (advanceSignal !== null) advanceSignal.aborted = true;
      if (running !== null) {
        running = null;
        revision += 1;
      }
      return JSON.stringify({ ok: true, revision });
    },
  };
}
