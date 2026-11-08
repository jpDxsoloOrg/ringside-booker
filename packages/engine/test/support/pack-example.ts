/**
 * The worked example pack from docs/design/data-packs.md, read straight out of the doc.
 *
 * Each file of the example is a ```json block preceded by an `<!-- example-pack-file: <path> -->`
 * marker. Reading the doc instead of keeping a copy means the example a modder copies is exactly
 * the one the tests parse.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DOC_PATH = fileURLToPath(new URL('../../../../docs/design/data-packs.md', import.meta.url));

const EXAMPLE_BLOCK = /<!-- example-pack-file: (\S+) -->\s*```json\n([\s\S]*?)\n```/g;

/** File path inside the pack → parsed JSON, in the order the doc lists them. */
export function readExamplePack(): Map<string, unknown> {
  const doc = readFileSync(DOC_PATH, 'utf8');
  const files = new Map<string, unknown>();
  for (const match of doc.matchAll(EXAMPLE_BLOCK)) {
    const [, path, body] = match;
    if (path === undefined || body === undefined) {
      continue;
    }
    if (files.has(path)) {
      throw new Error(`The worked example lists ${path} twice`);
    }
    files.set(path, JSON.parse(body) as unknown);
  }
  return files;
}
