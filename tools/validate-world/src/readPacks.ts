/**
 * Reads data packs from disk into the `RawPack`s the engine loader takes.
 *
 * The loader never touches the file system, so this is the one place that does: it reads each
 * pack's `pack.json`, then every file the manifest lists, and parses the JSON. Content problems
 * (broken JSON, a manifest that fails its schema, a listed file that is missing) come back as
 * issues so the run can report all of them; a pack folder that does not exist is a usage error and
 * throws `PackDirectoryError`.
 *
 * Packs named in `dependsOn` but not passed in are looked up by ID under the content root, so
 * `validate-world content/worlds/default` finds the base pack it builds on without being told.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import {
  packManifestSchema,
  RECORD_KINDS,
  type PackManifest,
  type RawPack,
  type RecordKind,
} from '@ringside/engine';
import { validationError, type ValidationIssue } from './issues';

/** A pack folder that cannot be read at all: missing, not a folder, or without a `pack.json`. */
export class PackDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackDirectoryError';
  }
}

export interface ReadPacksOptions {
  /** Where dependency packs are looked up by ID. Left out = no lookup. */
  readonly contentRoot?: string;
  /** Paths in messages are shown relative to this folder. Defaults to the working directory. */
  readonly displayRoot?: string;
}

export interface ReadPacksResult {
  /** Every pack read: the ones asked for first, then discovered dependencies. */
  readonly packs: RawPack[];
  /** The IDs of the packs read from the folders passed in, in that order. */
  readonly requestedIds: string[];
  /** The folder each pack was read from, by pack ID. */
  readonly folders: ReadonlyMap<string, string>;
  readonly issues: ValidationIssue[];
}

const MANIFEST_FILE = 'pack.json';

/** Folders never searched for packs. */
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', 'coverage']);

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

/** Line and column (both from 1) of a character offset in `text`. */
function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const lines = before.split('\n');
  const lastLine = lines.at(-1) ?? '';
  return { line: lines.length, column: lastLine.length + 1 };
}

/**
 * Where a `JSON.parse` error points. V8 reports either `(line L column C)` or `at position N`
 * depending on its version, and nothing at all for input that ends early.
 */
export function locateJsonError(
  text: string,
  error: unknown,
): { line: number; column: number } | null {
  const message = describeError(error);
  const lineMatch = /line (\d+) column (\d+)/.exec(message);
  if (lineMatch !== null) {
    return { line: Number(lineMatch[1]), column: Number(lineMatch[2]) };
  }
  const positionMatch = /position (\d+)/.exec(message);
  if (positionMatch !== null) {
    return lineAndColumn(text, Number(positionMatch[1]));
  }
  if (/end of (?:JSON|data)/i.test(message)) {
    return lineAndColumn(text, text.length);
  }
  return null;
}

type JsonOutcome = { ok: true; value: unknown } | { ok: false; message: string };

/** Parses JSON text, describing a syntax error with the file path, line and column. */
export function parseJsonText(text: string, displayPath: string): JsonOutcome {
  const withoutBom = text.startsWith('﻿') ? text.slice(1) : text;
  try {
    const value: unknown = JSON.parse(withoutBom);
    return { ok: true, value };
  } catch (error: unknown) {
    const location = locateJsonError(withoutBom, error);
    const where =
      location === null
        ? displayPath
        : `${displayPath}:${String(location.line)}:${String(location.column)}`;
    return { ok: false, message: `Invalid JSON at ${where}: ${describeError(error)}` };
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

interface PackReader {
  readonly displayRoot: string;
  readonly issues: ValidationIssue[];
}

/** A path relative to the display root, or the full path when it lies outside it. */
export function displayPath(root: string, path: string): string {
  const shown = relative(root, path);
  if (shown === '') {
    return '.';
  }
  return shown.startsWith('..') || isAbsolute(shown) ? path : shown;
}

function display(reader: PackReader, path: string): string {
  return displayPath(reader.displayRoot, path);
}

/** Reads one pack folder. Returns null (with issues recorded) when the pack cannot be used. */
async function readPackFolder(
  reader: PackReader,
  folder: string,
): Promise<{ pack: RawPack; manifest: PackManifest } | null> {
  if (!(await isDirectory(folder))) {
    throw new PackDirectoryError(`Pack folder not found: ${display(reader, folder)}`);
  }
  const manifestPath = join(folder, MANIFEST_FILE);
  let manifestText: string;
  try {
    manifestText = await readFile(manifestPath, 'utf8');
  } catch (error: unknown) {
    throw new PackDirectoryError(
      errorCode(error) === 'ENOENT'
        ? `No ${MANIFEST_FILE} in ${display(reader, folder)}`
        : `Cannot read ${display(reader, manifestPath)}: ${describeError(error)}`,
    );
  }
  const folderName = basename(folder);
  const manifestJson = parseJsonText(manifestText, display(reader, manifestPath));
  if (!manifestJson.ok) {
    reader.issues.push(
      validationError({
        code: 'json-syntax',
        packId: folderName,
        file: MANIFEST_FILE,
        path: [],
        message: manifestJson.message,
      }),
    );
    return null;
  }
  const parsed = packManifestSchema.safeParse(manifestJson.value);
  if (!parsed.success) {
    for (const problem of parsed.error.issues) {
      reader.issues.push(
        validationError({
          code: 'manifest',
          packId: folderName,
          file: MANIFEST_FILE,
          path: problem.path.map((segment) =>
            typeof segment === 'number' ? segment : String(segment),
          ),
          message: `${display(reader, manifestPath)}: ${problem.message}`,
        }),
      );
    }
    return null;
  }
  const manifest = parsed.data;
  const files: Partial<Record<RecordKind, unknown>> = {};
  let usable = true;
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file === undefined) {
      continue;
    }
    const filePath = join(folder, file);
    let text: string;
    try {
      text = await readFile(filePath, 'utf8');
    } catch (error: unknown) {
      usable = false;
      reader.issues.push(
        validationError({
          code: errorCode(error) === 'ENOENT' ? 'missing-file' : 'unreadable-file',
          packId: manifest.id,
          file,
          kind,
          path: ['files', kind],
          message:
            errorCode(error) === 'ENOENT'
              ? `pack.json lists ${file} for ${kind} records, but ${display(reader, filePath)} does not exist`
              : `Cannot read ${display(reader, filePath)}: ${describeError(error)}`,
        }),
      );
      continue;
    }
    const json = parseJsonText(text, display(reader, filePath));
    if (!json.ok) {
      usable = false;
      reader.issues.push(
        validationError({
          code: 'json-syntax',
          packId: manifest.id,
          file,
          kind,
          path: [],
          message: json.message,
        }),
      );
      continue;
    }
    files[kind] = json.value;
  }
  return usable ? { pack: { manifest, files }, manifest } : null;
}

/** Every `pack.json` under `root`, as pack ID → folder. The first folder in path order wins. */
async function indexPackFolders(root: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const pending = [root];
  const manifests: string[] = [];
  while (pending.length > 0) {
    const folder = pending.shift();
    if (folder === undefined) {
      break;
    }
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    const sorted = [...entries].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of sorted) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_FOLDERS.has(entry.name)) {
        pending.push(join(folder, entry.name));
      } else if (entry.isFile() && entry.name === MANIFEST_FILE) {
        manifests.push(folder);
      }
    }
  }
  for (const folder of manifests.sort()) {
    try {
      const text = await readFile(join(folder, MANIFEST_FILE), 'utf8');
      const json = parseJsonText(text, folder);
      if (!json.ok || typeof json.value !== 'object' || json.value === null) {
        continue;
      }
      const id: unknown = Reflect.get(json.value, 'id');
      if (typeof id === 'string' && !index.has(id)) {
        index.set(id, folder);
      }
    } catch {
      // An unreadable manifest elsewhere in the content tree is not this run's problem.
    }
  }
  return index;
}

/**
 * Reads the packs in `folders`, then any dependency they name that was not passed in, looked up by
 * pack ID under `options.contentRoot`. A dependency that cannot be found is left for the loader to
 * report as `missing-dependency`.
 */
export async function readPacks(
  folders: readonly string[],
  options: ReadPacksOptions = {},
): Promise<ReadPacksResult> {
  const reader: PackReader = {
    displayRoot: options.displayRoot ?? process.cwd(),
    issues: [],
  };
  const packs: RawPack[] = [];
  const requestedIds: string[] = [];
  const folderById = new Map<string, string>();
  const readFolders = new Set<string>();
  const wanted = new Set<string>();

  const addPack = (result: { pack: RawPack; manifest: PackManifest }, folder: string): void => {
    packs.push(result.pack);
    folderById.set(result.manifest.id, folder);
    for (const dependency of result.manifest.dependsOn) {
      wanted.add(dependency.id);
    }
  };

  for (const folder of folders.map((path) => resolve(path))) {
    if (readFolders.has(folder)) {
      continue;
    }
    readFolders.add(folder);
    const result = await readPackFolder(reader, folder);
    if (result !== null) {
      addPack(result, folder);
      requestedIds.push(result.manifest.id);
    }
  }

  let index: Map<string, string> | null = null;
  for (;;) {
    const missing = [...wanted].filter((id) => !folderById.has(id)).sort();
    if (missing.length === 0 || options.contentRoot === undefined) {
      break;
    }
    index ??= await indexPackFolders(resolve(options.contentRoot));
    // Each ID is looked up once; a pack read here may add new IDs to `wanted` for the next round.
    for (const id of missing) {
      wanted.delete(id);
      const folder = index.get(id);
      if (folder === undefined || readFolders.has(folder)) {
        continue;
      }
      readFolders.add(folder);
      const result = await readPackFolder(reader, folder);
      if (result !== null) {
        addPack(result, folder);
      }
    }
  }

  return { packs, requestedIds, folders: folderById, issues: reader.issues };
}
