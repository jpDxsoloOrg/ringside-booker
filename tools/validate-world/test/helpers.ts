/**
 * Shared test helpers: the fixture packs on disk, in-memory edits to them, and a loader that hands
 * back the world and merged content the rules run on.
 */

import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadWorldFromPacks,
  packs,
  type GameWorldView,
  type MergedContent,
  type RawPack,
  type RecordKind,
} from '@ringside/engine';
import { formatIssue, type ValidationIssue } from '../src/issues';
import { readPacks } from '../src/readPacks';
import type { CliIo } from '../src/run';
import type { ContentRule } from '../src/rules/index';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The loader's fixture packs (WLD-02). */
export const ENGINE_FIXTURE_PACKS = join(REPO_ROOT, 'packages/engine/test/fixtures/packs');

/** A miniature repository for CLI runs: a valid world, its base pack and a test blocklist. */
export const FIXTURE_REPO = fileURLToPath(new URL('./fixtures/repo/', import.meta.url));

/** Reads `mini-base` and `mini-world` from disk, the way the CLI does. */
export async function readMiniWorld(): Promise<RawPack[]> {
  const read = await readPacks([
    join(ENGINE_FIXTURE_PACKS, 'mini-base'),
    join(ENGINE_FIXTURE_PACKS, 'mini-world'),
  ]);
  expectNoIssues(read.issues);
  return read.packs;
}

/** Reads the valid `check-world` fixture and its base pack. */
export async function readCheckWorld(): Promise<RawPack[]> {
  const read = await readPacks([join(FIXTURE_REPO, 'content/worlds/check-world')], {
    contentRoot: join(FIXTURE_REPO, 'content'),
  });
  expectNoIssues(read.issues);
  return read.packs;
}

function expectNoIssues(issues: readonly ValidationIssue[]): void {
  if (issues.length > 0) {
    throw new Error(`Fixture packs did not read cleanly:\n${issues.map(formatIssue).join('\n')}`);
  }
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A copy of `rawPacks` where the record file of `kind` in pack `packId` is replaced by what `edit`
 * returns. The pack's manifest gains the file when it had none.
 */
export function editRecords(
  rawPacks: readonly RawPack[],
  packId: string,
  kind: RecordKind,
  edit: (records: JsonRecord[]) => JsonRecord[],
): RawPack[] {
  return rawPacks.map((pack) => {
    if (pack.manifest.id !== packId) {
      return pack;
    }
    const current: unknown = structuredClone(pack.files[kind] ?? []);
    const records = Array.isArray(current) ? current.filter(isJsonRecord) : [];
    return {
      manifest: {
        ...pack.manifest,
        files: { ...pack.manifest.files, [kind]: pack.manifest.files[kind] ?? `${kind}.json` },
      },
      files: { ...pack.files, [kind]: edit(records) },
    };
  });
}

/** Replaces fields of one record, found by key. */
export function patchRecord(
  key: string,
  fields: JsonRecord,
): (records: JsonRecord[]) => JsonRecord[] {
  return (records) =>
    records.map((record) => (record['key'] === key ? { ...record, ...fields } : record));
}

/** Adds a copy of the record `fromKey` with new fields (including a new `key`). */
export function cloneRecord(
  fromKey: string,
  fields: JsonRecord,
): (records: JsonRecord[]) => JsonRecord[] {
  return (records) => {
    const source = records.find((record) => record['key'] === fromKey);
    if (source === undefined) {
      throw new Error(`No record ${fromKey} to clone`);
    }
    return [...records, { ...structuredClone(source), ...fields }];
  };
}

export interface Loaded {
  readonly world: GameWorldView;
  readonly content: MergedContent;
}

/** Loads packs through the engine loader and merges them again for the rules. Throws on errors. */
export function loadForRules(rawPacks: readonly RawPack[], rootIds: readonly string[]): Loaded {
  const loaded = loadWorldFromPacks(rawPacks, rootIds, { seed: 'validate' });
  if (!loaded.ok) {
    throw new Error(`Packs did not load:\n${loaded.issues.map(packs.formatPackIssue).join('\n')}`);
  }
  const resolved = packs.resolvePacks(rawPacks, rootIds);
  if (!resolved.ok) {
    throw new Error('Packs did not resolve');
  }
  const merged = packs.mergeRecords(resolved.value);
  if (!merged.ok) {
    throw new Error('Packs did not merge');
  }
  return { world: loaded.value.world, content: merged.value };
}

/** Runs one rule over packs and returns its issues. */
export function checkRule(
  rule: ContentRule,
  rawPacks: readonly RawPack[],
  rootIds: readonly string[],
): ValidationIssue[] {
  const { world, content } = loadForRules(rawPacks, rootIds);
  return rule.check(world, content);
}

/** An I/O sink that keeps everything written to it. */
export function captureIo(repoRoot: string): CliIo & { out: () => string; err: () => string } {
  let stdout = '';
  let stderr = '';
  return {
    repoRoot,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    out: () => stdout,
    err: () => stderr,
  };
}

/** A throwaway copy of the fixture repository, removed again by the returned `cleanUp`. */
export async function copyFixtureRepo(): Promise<{ root: string; cleanUp: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'validate-world-'));
  await cp(FIXTURE_REPO, root, { recursive: true });
  return {
    root,
    cleanUp: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * Runs one rule over packs the engine refuses to materialise. Several rules repeat checks the
 * loader's integrity pass also makes (overlapping reigns, exclusive contracts), so a broken pack
 * never reaches them in a real run; this checks the rule on its own, with the merged records of
 * `rawPacks` and the world (and so the start date) of `worldPacks`.
 */
export function checkRuleOnMergedRecords(
  rule: ContentRule,
  rawPacks: readonly RawPack[],
  worldPacks: readonly RawPack[],
  rootIds: readonly string[],
): ValidationIssue[] {
  const { world } = loadForRules(worldPacks, rootIds);
  const resolved = packs.resolvePacks(rawPacks, rootIds);
  if (!resolved.ok) {
    throw new Error('Packs did not resolve');
  }
  const merged = packs.mergeRecords(resolved.value);
  if (!merged.ok) {
    throw new Error(`Packs did not merge:\n${merged.issues.map(packs.formatPackIssue).join('\n')}`);
  }
  return rule.check(world, merged.value);
}

/** True when the engine loader itself refuses the packs. */
export function loaderRejects(rawPacks: readonly RawPack[], rootIds: readonly string[]): boolean {
  return !loadWorldFromPacks(rawPacks, rootIds, { seed: 'validate' }).ok;
}
