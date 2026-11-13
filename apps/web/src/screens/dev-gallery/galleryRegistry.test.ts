import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectGalleryEntries, galleryEntries, galleryEntryFiles } from './entries';
import { GALLERY_GROUPS } from './galleryEntry';
import type { GalleryEntry } from './galleryEntry';

// A path, not a URL: under jsdom the URL class is not the one node:fs accepts.
const ENTRIES_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), 'entries');
const ENTRY_FILE_SUFFIX = '.gallery.tsx';

function renderNothing(): null {
  return null;
}

function entryModule(entry: Partial<GalleryEntry>): Record<string, unknown> {
  return {
    galleryEntry: { title: 'Sample', group: 'Primitives', render: renderNothing, ...entry },
  };
}

describe('gallery registry', () => {
  it('collects every *.gallery.tsx file in entries/', () => {
    const filesOnDisk = readdirSync(ENTRIES_DIRECTORY)
      .filter((fileName) => fileName.endsWith(ENTRY_FILE_SUFFIX))
      .map((fileName) => `./${fileName}`)
      .sort();

    expect(filesOnDisk.length).toBeGreaterThan(0);
    expect([...galleryEntryFiles].sort()).toEqual(filesOnDisk);
    expect(galleryEntries).toHaveLength(filesOnDisk.length);
  });

  it('names each entry file after its id, so the focus-ring e2e can list them from disk', () => {
    const stems = galleryEntryFiles
      .map((filePath) => filePath.replace(/^\.\//, '').replace(ENTRY_FILE_SUFFIX, ''))
      .sort();
    expect(galleryEntries.map((entry) => entry.id).sort()).toEqual(stems);
  });

  it('gives every entry a unique id', () => {
    const ids = galleryEntries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the tokens, primitives, broadcast kit, art and engine built so far', () => {
    const groupsInUse = new Set(galleryEntries.map((entry) => entry.group));
    expect([...groupsInUse]).toEqual(
      expect.arrayContaining(['Tokens', 'Primitives', 'Broadcast', 'Art', 'Engine']),
    );
  });

  it('has an entry for every broadcast component', () => {
    const broadcastIds = galleryEntries
      .filter((entry) => entry.group === 'Broadcast')
      .map((entry) => entry.id);
    expect(broadcastIds).toEqual(
      expect.arrayContaining([
        'live-bug-button',
        'lower-third',
        'score-bug',
        'ticker',
        'segmented-meter',
        'card-slot',
        'chamfer-panel',
        'slash-divider',
      ]),
    );
  });

  it('has an entry for every office component', () => {
    const officeIds = galleryEntries
      .filter((entry) => entry.group === 'Office')
      .map((entry) => entry.id);
    expect(officeIds).toEqual(
      expect.arrayContaining([
        'kpi-card',
        'delta-chip',
        'sparkline',
        'alignment-chip',
        'availability-chip',
        'worker-link',
        'worker-profile-header',
        'champion-card',
        'stat-table',
        'rival-rules-chip',
        'needs-list',
        'decision-log-list',
        'promotion-header',
      ]),
    );
  });

  it('has an entry for every piece of the Workers screens', () => {
    expect(galleryEntries.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'popularity-drilldown',
        'availability-chip',
        'worker-link',
        'worker-profile-header',
      ]),
    );
  });

  it('lists entries by group order, then by title', () => {
    const ranks = galleryEntries.map((entry) => GALLERY_GROUPS.indexOf(entry.group));
    expect(ranks).toEqual([...ranks].sort((first, second) => first - second));
  });

  it('rejects two files that share an id, naming both', () => {
    expect(() =>
      collectGalleryEntries({
        './first.gallery.tsx': entryModule({ id: 'same-id' }),
        './second.gallery.tsx': entryModule({ id: 'same-id' }),
      }),
    ).toThrow(/"same-id" is used by both \.\/first\.gallery\.tsx and \.\/second\.gallery\.tsx/);
  });

  it('rejects a file without a valid galleryEntry export', () => {
    expect(() => collectGalleryEntries({ './empty.gallery.tsx': {} })).toThrow(
      /\.\/empty\.gallery\.tsx must export a valid `galleryEntry`/,
    );
    expect(() =>
      collectGalleryEntries({ './bad-id.gallery.tsx': entryModule({ id: 'Not Kebab' }) }),
    ).toThrow(/bad-id\.gallery\.tsx/);
    expect(() =>
      collectGalleryEntries({
        './bad-group.gallery.tsx': { galleryEntry: { id: 'x-one', title: 'X', group: 'Misc' } },
      }),
    ).toThrow(/bad-group\.gallery\.tsx/);
  });

  it('sorts collected entries by group, then title', () => {
    const entries = collectGalleryEntries({
      './c.gallery.tsx': entryModule({ id: 'engine-thing', group: 'Engine', title: 'Alpha' }),
      './b.gallery.tsx': entryModule({ id: 'zed', group: 'Tokens', title: 'Zed' }),
      './a.gallery.tsx': entryModule({ id: 'apple', group: 'Tokens', title: 'Apple' }),
    });
    expect(entries.map((entry) => entry.id)).toEqual(['apple', 'zed', 'engine-thing']);
  });
});
