import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { format, resolveConfig } from 'prettier';

// After the first live publish of a `final` post, the date it went out is written back to the
// repo: `publishedAt` in the post's frontmatter and the `Published` cell of its row in the series
// index. The repo then records when each post was published, and the next publish sends the same
// date. The post file is edited by inserting one line, so every other line stays byte-identical.

/** The series index, relative to the repo root. */
export const BLOG_README_REPO_PATH = 'docs/blog/README.md';

const FENCE_LINE = '---';
const PUBLISHED_AT_LINE = /^publishedAt[ \t]*:/;

/** `YYYY-MM-DD` of a date, in UTC (the blog stores UTC). */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lineEnding(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Adds `publishedAt: <date>` as the last line of the frontmatter block. Returns the text unchanged
 * when the block already sets `publishedAt` (a commented-out line doesn't count) or when the text
 * has no complete frontmatter block.
 */
export function insertPublishedAt(fileText: string, isoDate: string): string {
  const eol = lineEnding(fileText);
  const lines = fileText.split(eol);
  if (lines[0]?.replace(/^\uFEFF/, '').trimEnd() !== FENCE_LINE) {
    return fileText;
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trimEnd() === FENCE_LINE);
  if (closingIndex === -1) {
    return fileText;
  }
  if (lines.slice(1, closingIndex).some((line) => PUBLISHED_AT_LINE.test(line))) {
    return fileText;
  }
  lines.splice(closingIndex, 0, `publishedAt: ${isoDate}`);
  return lines.join(eol);
}

/** Splits a Markdown table row into its trimmed cells. Escaped pipes stay inside their cell. */
function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) {
    return null;
  }
  return trimmed
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/**
 * Sets the `Published` cell of part `part`'s row in the series index table. Only that cell of
 * that row changes; the result is not yet re-aligned (see `updateSeriesIndex`). Returns null when
 * the table or the row is missing.
 */
export function setPublishedCell(readmeText: string, part: number, isoDate: string): string | null {
  const eol = lineEnding(readmeText);
  const lines = readmeText.split(eol);
  const partLabel = String(part).padStart(2, '0');
  let partColumn = -1;
  let publishedColumn = -1;
  for (const [index, line] of lines.entries()) {
    const cells = splitRow(line);
    if (cells === null) {
      partColumn = -1;
      publishedColumn = -1;
      continue;
    }
    if (cells.includes('Part') && cells.includes('Published')) {
      partColumn = cells.indexOf('Part');
      publishedColumn = cells.indexOf('Published');
      continue;
    }
    if (partColumn === -1 || cells[partColumn] !== partLabel) {
      continue;
    }
    if (cells[publishedColumn] === isoDate) {
      return readmeText;
    }
    cells[publishedColumn] = isoDate;
    lines[index] = `| ${cells.join(' | ')} |`;
    return lines.join(eol);
  }
  return null;
}

/**
 * Sets the part's `Published` cell and re-aligns the README with Prettier, using the repo's
 * Prettier config, so the file still passes `npm run format:check`. Null when the row is missing.
 */
export async function updateSeriesIndex(
  readmeText: string,
  readmePath: string,
  part: number,
  isoDate: string,
): Promise<string | null> {
  const edited = setPublishedCell(readmeText, part, isoDate);
  if (edited === null || edited === readmeText) {
    return edited;
  }
  const config = (await resolveConfig(readmePath)) ?? {};
  return format(edited, { ...config, parser: 'markdown', filepath: readmePath });
}

export interface WriteBackOptions {
  readonly repoRoot: string;
  /** Absolute path of the post file. */
  readonly postPath: string;
  readonly part: number;
  readonly publishedAt: Date;
}

export interface WriteBackResult {
  readonly postUpdated: boolean;
  readonly readmeUpdated: boolean;
  /** False when the series index has no row for the part. */
  readonly readmeRowFound: boolean;
}

/** Writes `publishedAt` into the post and its series index row, touching only what changes. */
export async function writeBack(options: WriteBackOptions): Promise<WriteBackResult> {
  const isoDate = toIsoDate(options.publishedAt);

  const postText = await readFile(options.postPath, 'utf8');
  const newPostText = insertPublishedAt(postText, isoDate);
  const postUpdated = newPostText !== postText;
  if (postUpdated) {
    await writeFile(options.postPath, newPostText, 'utf8');
  }

  const readmePath = join(options.repoRoot, BLOG_README_REPO_PATH);
  const readmeText = await readFile(readmePath, 'utf8');
  const newReadmeText = await updateSeriesIndex(readmeText, readmePath, options.part, isoDate);
  const readmeUpdated = newReadmeText !== null && newReadmeText !== readmeText;
  if (newReadmeText !== null && readmeUpdated) {
    await writeFile(readmePath, newReadmeText, 'utf8');
  }
  return { postUpdated, readmeUpdated, readmeRowFound: newReadmeText !== null };
}
