/**
 * The shipped `base` pack's geography (WLD-04) and name mixes (WLD-05) pass the checker: no loader
 * warnings (one-sided neighbours) and no `geography` rule problems with region populations,
 * missing regions or missing name mixes.
 *
 * The CLI loads worlds, so the run goes through a throwaway world pack with no records of its own
 * that depends on `base`, in a temporary copy of the repository's `content/base` and blocklist.
 */

import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatIssue } from '../src/issues';
import { readPacks } from '../src/readPacks';
import { geography } from '../src/rules/geography';
import { runValidateWorld } from '../src/run';
import { captureIo, loadForRules, REPO_ROOT } from './helpers';

const BASE_PACK = join(REPO_ROOT, 'content/base');

const GEO_CHECK_WORLD = {
  formatVersion: 1,
  id: 'geo-check',
  name: 'Geography check',
  version: '0.1.0',
  kind: 'world',
  description: 'An empty world on the base map, for checking the geography.',
  author: 'Ringside Booker tests',
  dependsOn: [{ id: 'base', version: '^0.1.0' }],
  startDate: '2026-01-05',
  files: {},
};

describe('the shipped base geography', () => {
  let repoRoot = '';

  beforeAll(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'validate-base-geography-'));
    await cp(BASE_PACK, join(repoRoot, 'content/base'), { recursive: true });
    await cp(join(REPO_ROOT, 'content/blocklist'), join(repoRoot, 'content/blocklist'), {
      recursive: true,
    });
    const worldFolder = join(repoRoot, 'content/worlds/geo-check');
    await mkdir(worldFolder, { recursive: true });
    await writeFile(join(worldFolder, 'pack.json'), `${JSON.stringify(GEO_CHECK_WORLD)}\n`);
  });

  afterAll(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('reports no geography problems', async () => {
    const read = await readPacks([join(repoRoot, 'content/worlds/geo-check')], {
      contentRoot: join(repoRoot, 'content'),
    });
    expect(read.issues).toEqual([]);
    const { world, content } = loadForRules(read.packs, ['geo-check']);
    const issues = geography.check(world, content);
    expect(issues.map(formatIssue)).toEqual([]);
  });

  it('prints no loader warnings and no geography issues in validate-world', async () => {
    const io = captureIo(repoRoot);
    await runValidateWorld(['content/worlds/geo-check'], io);
    const issueLines = io
      .out()
      .split('\n')
      .filter((line) => /^(error|warning) /.test(line));
    expect(issueLines.filter((line) => line.includes('one-sided-neighbour'))).toEqual([]);
    expect(issueLines.filter((line) => line.includes(' geography '))).toEqual([]);
    expect(io.err()).toBe('');
  });
});
