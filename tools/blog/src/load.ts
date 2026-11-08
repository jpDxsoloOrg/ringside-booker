import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { parseDocument } from 'yaml';

import { BlogFormatError, BlogFrontmatterError, toBlogIssues } from './errors';
import { POST_FILE_NAME_PATTERN, PostFrontmatter } from './frontmatter';

/** A post file read from disk, with its frontmatter validated. */
export interface LoadedPost {
  /** The path the post was read from. */
  readonly path: string;
  /** The file's base name, for example `01-why-im-building-it.md`. */
  readonly fileName: string;
  /** The `NN` prefix of the file name as a number, or null when the name has none. */
  readonly partFromFileName: number | null;
  readonly frontmatter: PostFrontmatter;
  /** Everything after the closing `---` line, untouched. */
  readonly body: string;
}

const FENCE_LINE = '---';

/**
 * Splits a post into its YAML frontmatter and body. The file must start with a `---` line, and
 * the block ends at the next line that is exactly `---`. Throws BlogFormatError with the line
 * number when the block is missing, unterminated or not valid YAML.
 */
export function splitFrontmatter(raw: string): { data: unknown; body: string } {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trimEnd() !== FENCE_LINE) {
    throw new BlogFormatError('expected a frontmatter block starting with "---"', 1);
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trimEnd() === FENCE_LINE);
  if (closingIndex === -1) {
    throw new BlogFormatError(
      'the frontmatter block opened on line 1 is never closed with "---"',
      1,
    );
  }

  const yamlSource = lines.slice(1, closingIndex).join('\n');
  const document = parseDocument(yamlSource);
  const firstError = document.errors[0];
  if (firstError !== undefined) {
    // The YAML starts on file line 2, so YAML line N is file line N + 1.
    const yamlLine = firstError.linePos?.[0].line ?? 1;
    throw new BlogFormatError(`invalid YAML: ${firstError.message}`, yamlLine + 1);
  }

  return {
    data: document.toJS() as unknown,
    body: lines.slice(closingIndex + 1).join('\n'),
  };
}

/** Parses a post's text. `path` is only used for error messages and the returned record. */
export function parsePost(path: string, raw: string): LoadedPost {
  let split: { data: unknown; body: string };
  try {
    split = splitFrontmatter(raw);
  } catch (error: unknown) {
    if (error instanceof BlogFormatError) {
      throw new BlogFormatError(error.detail, error.line, path);
    }
    throw error;
  }

  const parsed = PostFrontmatter.safeParse(split.data);
  if (!parsed.success) {
    throw new BlogFrontmatterError(path, toBlogIssues(parsed.error));
  }

  const fileName = basename(path);
  const partMatch = /^(\d{2})-/.exec(fileName);
  return {
    path,
    fileName,
    partFromFileName: partMatch?.[1] === undefined ? null : Number(partMatch[1]),
    frontmatter: parsed.data,
    body: split.body,
  };
}

/** Reads and validates one post file. */
export async function loadPost(path: string): Promise<LoadedPost> {
  const raw = await readFile(path, 'utf8');
  return parsePost(path, raw);
}

/** Lists the post files in `blogDir`, sorted by name. Templates and the README are skipped. */
export async function listPosts(blogDir: string): Promise<string[]> {
  const entries = await readdir(blogDir, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith('_') &&
        entry.name !== 'README.md' &&
        POST_FILE_NAME_PATTERN.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .map((fileName) => join(blogDir, fileName));
}
