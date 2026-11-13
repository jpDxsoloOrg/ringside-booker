import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The gallery's entry files. Each is named after its entry id (the registry test checks). */
const GALLERY_ENTRIES_DIRECTORY = fileURLToPath(
  new URL('../../src/screens/dev-gallery/entries/', import.meta.url),
);
const GALLERY_ENTRY_SUFFIX = '.gallery.tsx';

/**
 * Every gallery entry id, read from disk so each entry gets its own test: a slow engine runs them
 * in parallel, and a failure names the entry. The accessibility spec checks the gallery lists
 * exactly these.
 */
export const GALLERY_ENTRY_IDS: readonly string[] = readdirSync(GALLERY_ENTRIES_DIRECTORY)
  .filter((fileName) => fileName.endsWith(GALLERY_ENTRY_SUFFIX))
  .map((fileName) => fileName.slice(0, -GALLERY_ENTRY_SUFFIX.length))
  .sort();
