/**
 * The content packs bundled with the app, loaded inside the engine worker.
 *
 * Every JSON file under the repo's `content/` folder is found at build time with a lazy
 * `import.meta.glob` (`@content` is a Vite alias for that folder). Lazy means each file becomes its
 * own chunk that only the worker fetches, and only when the new-game wizard asks for packs, so no
 * pack data sits in the main bundle. Only JSON is matched, so the plain-text name blocklist under
 * `content/blocklist/` is never bundled at all.
 *
 * A pack is a folder holding a `pack.json`. Its manifest is parsed with the engine's schema, then
 * every record file the manifest lists is loaded from the same folder and grouped into the
 * `RawPack` the engine's loader takes. A file the manifest does not list (a build script's input,
 * say) is never fetched. The result is cached, so the second call costs nothing.
 *
 * Nothing here throws for bad content: a manifest that fails its schema, or a listed file that is
 * missing or will not load, comes back as a `PackIssue` and that pack is left out.
 */

import { packManifestSchema, RECORD_KINDS } from '@ringside/engine';
import type { PackIssue, PackManifest, RawPack, RecordKind } from '@ringside/engine';

/** A lazy module loader per file path, as `import.meta.glob` returns them. */
export type ContentModules = Readonly<Record<string, () => Promise<unknown>>>;

/** The bundled packs and the problems found while reading them. */
export interface ContentPackSet {
  readonly packs: readonly RawPack[];
  readonly issues: readonly PackIssue[];
}

/** The manifest file every pack folder holds. */
export const MANIFEST_FILE_NAME = 'pack.json';

const MANIFEST_SUFFIX = `/${MANIFEST_FILE_NAME}`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Code-unit order, so the pack order never depends on the browser's locale. */
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** The folder a manifest path sits in, with its trailing slash: `…/worlds/default/`. */
function folderOf(manifestPath: string): string {
  return manifestPath.slice(0, manifestPath.length - MANIFEST_FILE_NAME.length);
}

/** A readable pack name for an issue before its manifest has been read: the folder's last part. */
function folderName(folder: string): string {
  const parts = folder.split('/').filter((part) => part !== '');
  return parts.at(-1) ?? folder;
}

/** The manifest of the pack in `folder`, or an issue explaining why it could not be read. */
async function readManifest(
  modules: ContentModules,
  manifestPath: string,
): Promise<{ ok: true; manifest: PackManifest } | { ok: false; issue: PackIssue }> {
  const packId = folderName(folderOf(manifestPath));
  const load = modules[manifestPath];
  if (load === undefined) {
    return {
      ok: false,
      issue: {
        severity: 'error',
        code: 'manifest',
        packId,
        path: [],
        message: `No ${MANIFEST_FILE_NAME} was bundled for ${packId}`,
      },
    };
  }
  let json: unknown;
  try {
    json = await load();
  } catch (error: unknown) {
    return {
      ok: false,
      issue: {
        severity: 'error',
        code: 'manifest',
        packId,
        path: [],
        message: `${MANIFEST_FILE_NAME} could not be loaded: ${errorMessage(error)}`,
      },
    };
  }
  const parsed = packManifestSchema.safeParse(json);
  if (!parsed.success) {
    const [first] = parsed.error.issues;
    return {
      ok: false,
      issue: {
        severity: 'error',
        code: 'manifest',
        packId,
        path:
          first?.path.map((segment) => (typeof segment === 'number' ? segment : String(segment))) ??
          [],
        message: `${MANIFEST_FILE_NAME} is not a valid manifest: ${first?.message ?? 'unknown problem'}`,
      },
    };
  }
  return { ok: true, manifest: parsed.data };
}

/** Reads one pack folder: its manifest, then every record file the manifest lists. */
async function readPack(
  modules: ContentModules,
  manifestPath: string,
): Promise<{ pack: RawPack | null; issues: PackIssue[] }> {
  const manifestRead = await readManifest(modules, manifestPath);
  if (!manifestRead.ok) return { pack: null, issues: [manifestRead.issue] };
  const { manifest } = manifestRead;
  const folder = folderOf(manifestPath);
  const issues: PackIssue[] = [];
  const files: Partial<Record<RecordKind, unknown>> = {};

  const listed = RECORD_KINDS.flatMap((kind) => {
    const file = manifest.files[kind];
    return file === undefined ? [] : [{ kind, file }];
  });
  const loaded = await Promise.all(
    listed.map(async ({ kind, file }) => {
      const load = modules[`${folder}${file}`];
      if (load === undefined) {
        return { kind, file, ok: false as const, message: `${file} was not bundled` };
      }
      try {
        return { kind, file, ok: true as const, data: await load() };
      } catch (error: unknown) {
        return {
          kind,
          file,
          ok: false as const,
          message: `${file} could not be loaded: ${errorMessage(error)}`,
        };
      }
    }),
  );
  for (const entry of loaded) {
    if (entry.ok) {
      files[entry.kind] = entry.data;
    } else {
      issues.push({
        severity: 'error',
        code: 'missing-file',
        packId: manifest.id,
        file: entry.file,
        kind: entry.kind,
        path: ['files', entry.kind],
        message: `${MANIFEST_FILE_NAME} lists ${entry.message}`,
      });
    }
  }
  return { pack: issues.length === 0 ? { manifest, files } : null, issues };
}

/**
 * Reads every pack in `modules`: each path ending in `/pack.json` is a pack folder. Packs come
 * back in folder path order; a pack with any problem is left out and its issues are reported.
 */
export async function readContentPacks(modules: ContentModules): Promise<ContentPackSet> {
  const manifestPaths = Object.keys(modules)
    .filter((path) => path.endsWith(MANIFEST_SUFFIX) || path === MANIFEST_FILE_NAME)
    .sort(compareText);
  const results = await Promise.all(manifestPaths.map((path) => readPack(modules, path)));
  const packs: RawPack[] = [];
  const issues: PackIssue[] = [];
  for (const result of results) {
    if (result.pack !== null) packs.push(result.pack);
    issues.push(...result.issues);
  }
  return { packs, issues };
}

/**
 * A cached reader over `modules`: the first call reads the packs, later calls share that read.
 * A read that throws (it should not) is forgotten, so the next call tries again.
 */
export function createContentPackSource(modules: ContentModules): () => Promise<ContentPackSet> {
  let cached: Promise<ContentPackSet> | null = null;
  return async () => {
    cached ??= readContentPacks(modules);
    try {
      return await cached;
    } catch (error: unknown) {
      cached = null;
      throw error;
    }
  };
}

/** Every JSON file under `content/`, loaded only when asked for. */
const bundledContentModules: ContentModules = import.meta.glob('@content/**/*.json', {
  import: 'default',
});

/** The packs that ship with the app, read once and cached for the worker's lifetime. */
export const loadBundledContentPacks: () => Promise<ContentPackSet> =
  createContentPackSource(bundledContentModules);
