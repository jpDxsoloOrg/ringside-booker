import { GALLERY_GROUPS, isGalleryEntry } from '../galleryEntry';
import type { GalleryEntry } from '../galleryEntry';

/**
 * Every `*.gallery.tsx` file in this folder, loaded up front. Adding a file is the only step to
 * add an entry; nothing else lists them, so parallel UI tickets never edit a shared list.
 */
const entryModules = import.meta.glob<Record<string, unknown>>('./*.gallery.tsx', { eager: true });

/** The export each entry file provides. */
export const GALLERY_ENTRY_EXPORT = 'galleryEntry';

function groupRank(entry: GalleryEntry): number {
  return GALLERY_GROUPS.indexOf(entry.group);
}

/**
 * Turns glob results into the entry list: checks each module exports a valid `galleryEntry`,
 * rejects duplicate ids, and sorts by group order and then by title.
 *
 * @throws Error naming the file when an export is missing or malformed, or an id is reused.
 */
export function collectGalleryEntries(
  modules: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): readonly GalleryEntry[] {
  const filesById = new Map<string, string>();
  const entries: GalleryEntry[] = [];

  for (const [filePath, moduleExports] of Object.entries(modules)) {
    const candidate = moduleExports[GALLERY_ENTRY_EXPORT];
    if (!isGalleryEntry(candidate)) {
      throw new Error(
        `${filePath} must export a valid \`${GALLERY_ENTRY_EXPORT}\`: { id (kebab-case), title, ` +
          `group (${GALLERY_GROUPS.join(' | ')}), render, notes? }.`,
      );
    }
    const firstFile = filesById.get(candidate.id);
    if (firstFile !== undefined) {
      throw new Error(
        `Gallery entry id "${candidate.id}" is used by both ${firstFile} and ${filePath}.`,
      );
    }
    filesById.set(candidate.id, filePath);
    entries.push(candidate);
  }

  return entries.sort(
    (first, second) =>
      groupRank(first) - groupRank(second) || first.title.localeCompare(second.title, 'en'),
  );
}

/** Every gallery entry, in display order. */
export const galleryEntries: readonly GalleryEntry[] = collectGalleryEntries(entryModules);

/** The entry file paths the glob found, for the registry test. */
export const galleryEntryFiles: readonly string[] = Object.keys(entryModules);
