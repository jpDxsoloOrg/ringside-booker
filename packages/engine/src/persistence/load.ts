/**
 * Loading a save: bytes in, a checked World (or a readable report) out.
 *
 * The pipeline runs these stages in order and stops at the first one that fails:
 *
 * 1. `decode`: gzip or plain UTF-8, within the size limit (`codec.ts`).
 * 2. `parse`: the text is JSON and the top level is an object.
 * 3. `format`: `format` is `ringside-booker/save` and `formatVersion` is a whole number.
 * 4. `version`: the save is not newer than this build, and not older than v1.
 * 5. `migrate`: older documents are upgraded one version at a time.
 * 6. `validate`: the document matches the current schema. Before the schema runs, unknown tunable
 *    overrides and unreadable traces are dropped and listed as warnings, so a removed tunable never
 *    makes an old save unloadable.
 * 7. `build`: the rows go into a fresh World and every index is rebuilt. Repeated IDs and unique
 *    index clashes stop here.
 * 8. `integrity`: `checkWorld` runs on the built world; dangling references and broken invariants
 *    are errors. The world is only handed out once this passes.
 *
 * `checkWorld` needs a built world (invariants read through indexes), which is why `build` runs
 * before `integrity`. Nothing in the pipeline throws to the caller: every problem, including an
 * unexpected bug, comes back as a failure naming its stage.
 */

import { MigrationError, SaveDocumentError } from '../core/errors';
import {
  appendPathSegment,
  isJsonObject,
  isJsonValue,
  type JsonObject,
  type JsonValue,
} from '../core/json';
import { checkWorld, type IntegrityIssue } from '../model/integrity';
import type { GameTables } from '../model/tables';
import type { CreateWorldOptions, World } from '../model/world';
import { decodeSave } from './codec';
import { CURRENT_FORMAT_VERSION, MIGRATIONS, type Migration } from './migrations/registry';
import { runMigrations, type AppliedMigration } from './migrations/run';
import {
  documentPath,
  loadFailure,
  singleIssueFailure,
  type LoadFailure,
  type LoadIssue,
  type LoadResult,
  type LoadStage,
} from './report';
import {
  createSaveDocumentSchema,
  SAVE_FORMAT,
  type SaveDocument,
  type StatePartSchemas,
} from './save-document';
import { documentToWorld } from './world-document';

/** What `validateTunableOverrides` returns: the overrides to keep and the ones it dropped. */
export interface TunableOverrideCheck {
  readonly kept: JsonObject;
  readonly dropped: readonly { readonly key: string; readonly message: string }[];
}

/** What `validateTraces` returns. Dropped paths are relative to the traces part. */
export interface TraceCheck {
  readonly kept: JsonValue;
  readonly dropped: readonly LoadIssue[];
}

export interface ReadOptions {
  /** Overrides the 128 MB unpacked size limit, for tests. */
  readonly maxBytes?: number;
  /**
   * The migration chain and current version, for tests of the migration harness. The game always
   * uses `MIGRATIONS` and `CURRENT_FORMAT_VERSION`.
   */
  readonly migrations?: { readonly list: readonly Migration[]; readonly current: number };
}

export interface LoadOptions extends ReadOptions {
  /** Schemas for the simulation parts (see `createSaveDocumentSchema`). */
  readonly stateParts?: StatePartSchemas;
  /**
   * Checks the stored tunable overrides against the tunables registry. Overrides it drops (an
   * unknown key, a value out of range) become warnings and the load carries on without them.
   */
  readonly validateTunableOverrides?: (overrides: JsonObject) => TunableOverrideCheck;
  /** Checks the stored traces. Traces it drops become warnings and the load carries on. */
  readonly validateTraces?: (traces: JsonValue) => TraceCheck;
  /** Options for the World the load builds, such as its ID factory. */
  readonly worldOptions?: CreateWorldOptions;
}

export interface LoadSuccess {
  readonly ok: true;
  readonly world: World<GameTables>;
  /** The validated (and, if it was old, migrated) document the world was built from. */
  readonly doc: SaveDocument;
  /** The migration steps that ran, in order. Empty for a current save. */
  readonly migrationsApplied: readonly AppliedMigration[];
  /** Problems that did not stop the load, such as dropped tunable overrides. */
  readonly warnings: readonly LoadIssue[];
}

export type LoadReport = LoadSuccess | LoadFailure;

/** A parsed document that passed the format and version checks, before migration. */
export interface ReadDocument {
  readonly doc: JsonObject;
  readonly formatVersion: number;
}

/** Tracks the stage in progress, so an unexpected error is reported against it. */
interface StageCursor {
  stage: LoadStage;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeJson(value: JsonValue | undefined): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}

function parseStage(text: string): LoadResult<JsonObject> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    return singleIssueFailure('parse', '', `The save is not valid JSON (${describeError(error)}).`);
  }
  if (!isJsonValue(parsed) || !isJsonObject(parsed)) {
    return singleIssueFailure('parse', '', 'The save is JSON but not an object.');
  }
  return { ok: true, value: parsed };
}

function formatStage(doc: JsonObject): LoadResult<number> {
  const format = doc['format'];
  if (format !== SAVE_FORMAT) {
    return singleIssueFailure(
      'format',
      'format',
      `This is not a Ringside Booker save: format is ${describeJson(format)}, expected "${SAVE_FORMAT}".`,
    );
  }
  const formatVersion = doc['formatVersion'];
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion)) {
    return singleIssueFailure(
      'format',
      'formatVersion',
      `The save's format version is ${describeJson(formatVersion)}, expected a whole number.`,
    );
  }
  return { ok: true, value: formatVersion };
}

function versionStage(formatVersion: number, current: number): LoadFailure | null {
  if (formatVersion > current) {
    return singleIssueFailure(
      'version',
      'formatVersion',
      `This save was made by a newer version of the game (save format v${String(formatVersion)}; this version reads up to v${String(current)}). Update the game to load it.`,
    );
  }
  if (formatVersion < 1) {
    return singleIssueFailure(
      'version',
      'formatVersion',
      `Save format v${String(formatVersion)} is not supported; the oldest supported format is v1.`,
    );
  }
  return null;
}

/**
 * Stages 1-4: decode, parse, format and version. Shared by `loadSave` and `inspectSave`. Never
 * throws.
 */
export async function readSaveDocument(
  bytes: Uint8Array,
  options: ReadOptions = {},
): Promise<LoadResult<ReadDocument>> {
  const decoded = await decodeSave(
    bytes,
    options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes },
  );
  if (!decoded.ok) {
    return decoded;
  }
  const parsed = parseStage(decoded.value);
  if (!parsed.ok) {
    return parsed;
  }
  const formatVersion = formatStage(parsed.value);
  if (!formatVersion.ok) {
    return formatVersion;
  }
  const current = options.migrations?.current ?? CURRENT_FORMAT_VERSION;
  const versionFailure = versionStage(formatVersion.value, current);
  if (versionFailure !== null) {
    return versionFailure;
  }
  return { ok: true, value: { doc: parsed.value, formatVersion: formatVersion.value } };
}

/** Runs the validate-stage hooks that drop bad tunable overrides and traces, collecting warnings. */
function dropUnreadableParts(
  doc: JsonObject,
  options: LoadOptions,
  warnings: LoadIssue[],
): JsonObject {
  const state = doc['state'];
  if (state === undefined || !isJsonObject(state)) {
    return doc;
  }
  let nextState = state;

  const overrides = state['tunableOverrides'];
  if (options.validateTunableOverrides !== undefined && overrides !== undefined) {
    if (isJsonObject(overrides)) {
      const checked = options.validateTunableOverrides(overrides);
      for (const dropped of checked.dropped) {
        warnings.push({
          path: appendPathSegment('state.tunableOverrides', dropped.key),
          message: `${dropped.message} The override was dropped.`,
        });
      }
      nextState = { ...nextState, tunableOverrides: checked.kept };
    }
  }

  const traces = state['traces'];
  if (options.validateTraces !== undefined && traces !== undefined) {
    const checked = options.validateTraces(traces);
    for (const dropped of checked.dropped) {
      warnings.push({
        path: dropped.path === '' ? 'state.traces' : `state.traces.${dropped.path}`,
        message: `${dropped.message} The trace was dropped.`,
      });
    }
    nextState = { ...nextState, traces: checked.kept };
  }

  return nextState === state ? doc : { ...doc, state: nextState };
}

function validateStage(doc: JsonObject, options: LoadOptions): LoadResult<SaveDocument> {
  const result = createSaveDocumentSchema(options.stateParts).safeParse(doc);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return loadFailure(
    'validate',
    result.error.issues.map((issue) => ({
      path: documentPath(issue.path),
      message: issue.message,
    })),
  );
}

/** The document path of the row and field an integrity issue is about. */
function integrityPath(doc: SaveDocument, issue: IntegrityIssue): string {
  let path = appendPathSegment('state.world.tables', issue.table);
  if (issue.id !== undefined) {
    const rows: readonly { readonly id: string }[] =
      Object.entries(doc.state.world.tables).find(([name]) => name === issue.table)?.[1] ?? [];
    const index = rows.findIndex((row) => row.id === issue.id);
    if (index >= 0) {
      path = appendPathSegment(path, index);
    }
  }
  return issue.path === undefined ? path : `${path}.${issue.path}`;
}

async function runLoad(
  bytes: Uint8Array,
  registry: GameTables,
  options: LoadOptions,
  cursor: StageCursor,
): Promise<LoadReport> {
  const read = await readSaveDocument(bytes, options);
  if (!read.ok) {
    return read;
  }

  cursor.stage = 'migrate';
  const chain = options.migrations ?? { list: MIGRATIONS, current: CURRENT_FORMAT_VERSION };
  let migrated: ReturnType<typeof runMigrations>;
  try {
    migrated = runMigrations(read.value.doc, chain.list, chain.current);
  } catch (error: unknown) {
    if (error instanceof MigrationError) {
      return singleIssueFailure('migrate', '', error.message);
    }
    throw error;
  }

  cursor.stage = 'validate';
  const warnings: LoadIssue[] = [];
  const repaired = dropUnreadableParts(migrated.doc, options, warnings);
  const validated = validateStage(repaired, options);
  if (!validated.ok) {
    return validated;
  }
  const doc = validated.value;

  cursor.stage = 'build';
  let world: World<GameTables>;
  try {
    world = documentToWorld(doc, registry, options.worldOptions);
  } catch (error: unknown) {
    if (error instanceof SaveDocumentError) {
      return singleIssueFailure('build', error.path, error.problem);
    }
    throw error;
  }

  cursor.stage = 'integrity';
  const report = checkWorld(world, registry);
  const errors: LoadIssue[] = [];
  for (const issue of report.issues) {
    const loadIssue = { path: integrityPath(doc, issue), message: issue.message };
    if (issue.severity === 'warning') {
      warnings.push(loadIssue);
    } else {
      errors.push(loadIssue);
    }
  }
  if (!report.ok) {
    return loadFailure('integrity', errors, report.truncated);
  }

  return { ok: true, world, doc, migrationsApplied: migrated.applied, warnings };
}

/**
 * Loads a save: decodes, parses, checks the format and version, migrates, validates, builds the
 * World and checks its integrity. Never throws: every problem comes back as a failure naming the
 * stage it stopped at, with at most 50 issues (`truncated` counts the rest), each with a document
 * path and a readable message.
 */
export async function loadSave(
  bytes: Uint8Array,
  registry: GameTables,
  options: LoadOptions = {},
): Promise<LoadReport> {
  const cursor: StageCursor = { stage: 'decode' };
  try {
    return await runLoad(bytes, registry, options, cursor);
  } catch (error: unknown) {
    return singleIssueFailure(
      cursor.stage,
      '',
      `Loading failed unexpectedly at the ${cursor.stage} stage: ${describeError(error)}`,
    );
  }
}
