/**
 * The content packs inlined in the bundle: every JSON file under the repo's `content/` folder, keyed
 * by its path inside that folder (`worlds/default/pack.json`). The build script writes them into the
 * bundle as one object; this module groups them into the `RawPack`s the engine's loader takes.
 *
 * It mirrors the web app's `contentPacks.ts` (which loads the same files lazily through Vite), but
 * synchronously, because the files are already in memory. A pack folder holds a `pack.json`; its
 * manifest is parsed with the engine's schema, then every record file it lists is taken from the
 * same folder. Nothing throws for bad content: a bad manifest or a missing file comes back as a
 * `PackIssue` and that pack is left out.
 */

import { packManifestSchema, RECORD_KINDS } from '@ringside/engine';
import type { PackIssue, PackManifest, RawPack, RecordKind } from '@ringside/engine';

/** Parsed JSON files by path inside `content/`. */
export type ContentFiles = Readonly<Record<string, unknown>>;

export interface ContentPackSet {
  readonly packs: readonly RawPack[];
  readonly issues: readonly PackIssue[];
}

const MANIFEST_FILE_NAME = 'pack.json';

/** Code-unit order, so the pack order never depends on the runtime's locale. */
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function folderOf(manifestPath: string): string {
  return manifestPath.slice(0, manifestPath.length - MANIFEST_FILE_NAME.length);
}

function folderName(folder: string): string {
  const parts = folder.split('/').filter((part) => part !== '');
  return parts[parts.length - 1] ?? folder;
}

function hasFile(files: ContentFiles, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(files, path);
}

function readManifest(
  files: ContentFiles,
  manifestPath: string,
): { ok: true; manifest: PackManifest } | { ok: false; issue: PackIssue } {
  const parsed = packManifestSchema.safeParse(files[manifestPath]);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  const [first] = parsed.error.issues;
  return {
    ok: false,
    issue: {
      severity: 'error',
      code: 'manifest',
      packId: folderName(folderOf(manifestPath)),
      path:
        first?.path.map((segment) => (typeof segment === 'number' ? segment : String(segment))) ??
        [],
      message: `${MANIFEST_FILE_NAME} is not a valid manifest: ${first?.message ?? 'unknown problem'}`,
    },
  };
}

function readPack(
  files: ContentFiles,
  manifestPath: string,
): { pack: RawPack | null; issues: PackIssue[] } {
  const manifestRead = readManifest(files, manifestPath);
  if (!manifestRead.ok) return { pack: null, issues: [manifestRead.issue] };
  const { manifest } = manifestRead;
  const folder = folderOf(manifestPath);
  const issues: PackIssue[] = [];
  const records: Partial<Record<RecordKind, unknown>> = {};
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file === undefined) continue;
    const path = `${folder}${file}`;
    if (hasFile(files, path)) {
      records[kind] = files[path];
    } else {
      issues.push({
        severity: 'error',
        code: 'missing-file',
        packId: manifest.id,
        file,
        kind,
        path: ['files', kind],
        message: `${MANIFEST_FILE_NAME} lists ${file}, which was not bundled`,
      });
    }
  }
  return { pack: issues.length === 0 ? { manifest, files: records } : null, issues };
}

/** Every pack in `files`, in folder path order, and the problems found reading them. */
export function readContentPacks(files: ContentFiles): ContentPackSet {
  const manifestPaths = Object.keys(files)
    .filter((path) => path === MANIFEST_FILE_NAME || path.endsWith(`/${MANIFEST_FILE_NAME}`))
    .sort(compareText);
  const packs: RawPack[] = [];
  const issues: PackIssue[] = [];
  for (const manifestPath of manifestPaths) {
    const result = readPack(files, manifestPath);
    if (result.pack !== null) packs.push(result.pack);
    issues.push(...result.issues);
  }
  return { packs, issues };
}
