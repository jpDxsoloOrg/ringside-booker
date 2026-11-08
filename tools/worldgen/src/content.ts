/**
 * Reading the build's inputs from the repository: the `base` and `default-world` packs, the roster
 * spec and the headliners.
 *
 * The world pack is read without the four files the build writes, so a build never depends on the
 * output of the previous one: the same spec and seed always give the same files.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packManifestSchema, RECORD_KINDS, type RawPack, type RecordKind } from '@ringside/engine';
import { headlinersSchema, rosterSpecSchema, type Headliner, type RosterSpec } from './specSchema';

/** The default world pack, relative to the repository root. */
export const DEFAULT_WORLD_DIR = 'content/worlds/default';
export const BASE_PACK_DIR = 'content/base';
export const WORLD_PACK_ID = 'default-world';

/** The record kinds the build writes, and the file each goes to. */
export const GENERATED_FILES = {
  person: 'people.json',
  employment: 'employments.json',
  team: 'teams.json',
  titleReign: 'reigns.json',
} as const satisfies Partial<Record<RecordKind, string>>;

export type GeneratedKind = keyof typeof GENERATED_FILES;

export const SPEC_FILE = 'roster.spec.json';
export const HEADLINERS_FILE = 'headliners.json';

async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text) as unknown;
}

function isGeneratedKind(kind: RecordKind): kind is GeneratedKind {
  return Object.hasOwn(GENERATED_FILES, kind);
}

/** Reads a pack folder: its manifest and every file it lists, leaving out the generated kinds. */
export async function readPackWithout(
  folder: string,
  leaveOut: (kind: RecordKind) => boolean,
): Promise<RawPack> {
  const manifest = packManifestSchema.parse(await readJson(join(folder, 'pack.json')));
  const files: Partial<Record<RecordKind, unknown>> = {};
  const listed: Partial<Record<RecordKind, string>> = {};
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file === undefined || leaveOut(kind)) {
      continue;
    }
    listed[kind] = file;
    files[kind] = await readJson(join(folder, file));
  }
  return { manifest: { ...manifest, files: listed }, files };
}

/** Everything the build reads. */
export interface BuildInputs {
  readonly packs: readonly RawPack[];
  readonly spec: RosterSpec;
  readonly headliners: readonly Headliner[];
}

/** Reads the packs (without generated files), the spec and the headliners from `repoRoot`. */
export async function readBuildInputs(repoRoot: string): Promise<BuildInputs> {
  const worldDir = join(repoRoot, DEFAULT_WORLD_DIR);
  const base = await readPackWithout(join(repoRoot, BASE_PACK_DIR), () => false);
  const world = await readPackWithout(worldDir, isGeneratedKind);
  const spec = rosterSpecSchema.parse(await readJson(join(worldDir, SPEC_FILE)));
  const headliners = headlinersSchema.parse(await readJson(join(worldDir, HEADLINERS_FILE)));
  return { packs: [base, world], spec, headliners };
}
