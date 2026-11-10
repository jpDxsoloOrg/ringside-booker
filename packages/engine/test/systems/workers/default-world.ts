// The shipped default world, loaded once for the workers tests that measure against it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  loadWorldFromPacks,
  packManifestSchema,
  RECORD_KINDS,
  type RawPack,
  type RecordKind,
} from '../../../src/persistence/packs';

const CONTENT_ROOT = fileURLToPath(new URL('../../../../../content/', import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Reads a shipped pack the way the tools do: its manifest and every file the manifest lists. */
function readContentPack(folder: string): RawPack {
  const packRoot = `${CONTENT_ROOT}${folder}/`;
  const manifest = packManifestSchema.parse(readJson(`${packRoot}pack.json`));
  const files: Partial<Record<RecordKind, unknown>> = {};
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file !== undefined) {
      files[kind] = readJson(`${packRoot}${file}`);
    }
  }
  return { manifest, files };
}

/** The default world as a new game would start it, before any day has run. */
export function loadDefaultWorld() {
  const loaded = loadWorldFromPacks(
    [readContentPack('base'), readContentPack('worlds/default')],
    ['default-world'],
    { seed: 'default-world-workers' },
  );
  if (!loaded.ok) {
    throw new Error(`The default world did not load: ${JSON.stringify(loaded.issues)}`);
  }
  return loaded.value.world;
}
