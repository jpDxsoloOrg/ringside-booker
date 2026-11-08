import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { format } from 'prettier';
import { afterEach, describe, expect, it } from 'vitest';

import {
  insertPublishedAt,
  setPublishedCell,
  toIsoDate,
  updateSeriesIndex,
  writeBack,
} from '../src/publish/writeBack';
import { copyFixtureRepo, fixturePath, removeRepo } from './helpers';

// The repo's Prettier settings (.prettierrc.json), so "unchanged by Prettier" means the same
// thing here as in `npm run format:check`.
const PRETTIER_OPTIONS = {
  parser: 'markdown',
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  semi: true,
} as const;

const POST = `---
title: "Same seed, same show: what I'd change"
slug: ringside-booker-03-same-seed-same-show
series: ringside-booker
part: 3
status: final
excerpt: 'How named random streams keep one change from reshuffling every other result.'
tags: [gamedev, typescript] # the series tag is added automatically
journal: []
# coverImage: https://raw.githubusercontent.com/jpDxsoloOrg/ringside-booker/main/docs/blog/images/03/cover.png
# publishedAt: written by the publish script on first publish; leave it out
---

The opening paragraph.

## A section

- a list item
`;

const README_PATH = fixturePath('repo/docs/blog/README.md');

let copiedRepo: string | null = null;

afterEach(async () => {
  if (copiedRepo !== null) {
    await removeRepo(copiedRepo);
    copiedRepo = null;
  }
});

describe('insertPublishedAt', () => {
  it('adds publishedAt as the last frontmatter line and leaves every other line as it was', () => {
    const edited = insertPublishedAt(POST, '2026-11-08');
    const before = POST.split('\n');
    const after = edited.split('\n');
    const closingIndex = before.indexOf('---', 1);

    expect(after).toHaveLength(before.length + 1);
    expect(after[closingIndex]).toBe('publishedAt: 2026-11-08');
    expect(after[closingIndex + 1]).toBe('---');
    expect(after.slice(0, closingIndex)).toEqual(before.slice(0, closingIndex));
    expect(after.slice(closingIndex + 1)).toEqual(before.slice(closingIndex));
  });

  it('is idempotent once publishedAt is set', () => {
    const once = insertPublishedAt(POST, '2026-11-08');
    expect(insertPublishedAt(once, '2026-11-08')).toBe(once);
    expect(insertPublishedAt(once, '2026-12-25')).toBe(once);
  });

  it('does not count a commented-out publishedAt as set', () => {
    expect(insertPublishedAt(POST, '2026-11-08')).toContain('\npublishedAt: 2026-11-08\n---\n');
  });

  it('keeps Windows line endings', () => {
    const crlf = POST.replace(/\n/g, '\r\n');
    const edited = insertPublishedAt(crlf, '2026-11-08');
    expect(edited).toContain('\r\npublishedAt: 2026-11-08\r\n---\r\n');
    expect(edited.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('leaves a file without a complete frontmatter block alone', () => {
    expect(insertPublishedAt('No frontmatter here.\n', '2026-11-08')).toBe(
      'No frontmatter here.\n',
    );
    expect(insertPublishedAt('---\ntitle: x\n', '2026-11-08')).toBe('---\ntitle: x\n');
  });

  it('gives a file Prettier leaves unchanged', async () => {
    const edited = insertPublishedAt(POST, '2026-11-08');
    expect(await format(edited, PRETTIER_OPTIONS)).toBe(edited);
  });
});

describe('series index Published cell', () => {
  it('changes only the right part row', async () => {
    const readme = await readFile(README_PATH, 'utf8');
    const edited = setPublishedCell(readme, 2, '2026-11-08');
    expect(edited).not.toBeNull();

    const before = readme.split('\n');
    const after = (edited ?? '').split('\n');
    const changed = after.flatMap((line, index) => (line === before[index] ? [] : [line]));
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatch(/^\| 02 \| The second fixture post \| .* \| 2026-11-08 \|$/);
  });

  it('returns null when the part has no row', async () => {
    const readme = await readFile(README_PATH, 'utf8');
    expect(setPublishedCell(readme, 9, '2026-11-08')).toBeNull();
  });

  it('re-aligns the table so Prettier leaves the README unchanged', async () => {
    const readme = await readFile(README_PATH, 'utf8');
    const updated = await updateSeriesIndex(readme, README_PATH, 1, '2026-11-08');
    expect(updated).not.toBeNull();
    const text = updated ?? '';
    expect(await format(text, PRETTIER_OPTIONS)).toBe(text);

    const rows = text.split('\n').filter((line) => line.startsWith('| 0'));
    expect(rows[0]).toMatch(/^\| 01 +\| The first fixture post +\|.*\| 2026-11-08 \|$/);
    expect(rows[1]).toMatch(/\| - +\|$/);
    // Lines outside the table are untouched.
    const outside = (source: string): string[] =>
      source.split('\n').filter((line) => !line.startsWith('|'));
    expect(outside(text)).toEqual(outside(readme));
  });

  it('is idempotent once the cell holds the date', async () => {
    const readme = await readFile(README_PATH, 'utf8');
    const once = await updateSeriesIndex(readme, README_PATH, 1, '2026-11-08');
    expect(await updateSeriesIndex(once ?? '', README_PATH, 1, '2026-11-08')).toBe(once);
  });
});

describe('writeBack', () => {
  it('writes the date into the post and the series index of a repo', async () => {
    copiedRepo = await copyFixtureRepo();
    const postPath = join(copiedRepo, 'docs/blog/01-the-first-fixture-post.md');
    const publishedAt = new Date('2026-11-08T23:59:00.000Z');

    const result = await writeBack({ repoRoot: copiedRepo, postPath, part: 1, publishedAt });
    expect(result).toEqual({ postUpdated: true, readmeUpdated: true, readmeRowFound: true });
    expect(await readFile(postPath, 'utf8')).toContain('\npublishedAt: 2026-11-08\n---\n');
    expect(await readFile(join(copiedRepo, 'docs/blog/README.md'), 'utf8')).toMatch(
      /\| 01 +\|.*\| 2026-11-08 \|/,
    );

    const again = await writeBack({ repoRoot: copiedRepo, postPath, part: 1, publishedAt });
    expect(again).toEqual({ postUpdated: false, readmeUpdated: false, readmeRowFound: true });
  });

  it('formats dates in UTC', () => {
    expect(toIsoDate(new Date('2026-11-08T23:59:00.000Z'))).toBe('2026-11-08');
  });
});
