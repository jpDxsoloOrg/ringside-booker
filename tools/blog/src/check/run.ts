import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { POST_FILE_NAME_PATTERN } from '../frontmatter';
import {
  JOURNAL_DIR,
  JOURNAL_README_PATH,
  isJournalEntryFileName,
  journalFileName,
  journalFrontmatter,
  journalIndexSync,
  journalSections,
} from './journal';
import type { JournalRuleContext } from './journal';
import { TermLineError } from '@ringside/validate-world/real-name-matcher';

import { maskTermsIn, parseTermList } from './mask';
import { bodyAfterFrontmatter, readSource } from './markdown';
import {
  BLOG_README_PATH,
  bannedTerms,
  bannedTermsMissing,
  excerptLength,
  fileNameMatchesPart,
  frontmatterValid,
  imagesHaveAlt,
  linksResolve,
  mdxCompiles,
  noBodyH1,
  noPrivateReferences,
  noTodoInFinal,
  seriesIndexSync,
  validatePostFrontmatter,
} from './rules';
import type { ContentRuleContext, PostEntry, PostRuleContext } from './rules';
import type { BannedTerm, BannedTerms, CheckIssue, SourceFile } from './types';

export const BLOG_DIR = 'docs/blog';
/** List (a), owned by the world content tooling. */
export const REAL_NAMES_PATH = 'content/blocklist/real-names.txt';
/** List (b)'s default location, relative to the home folder. */
export const DEFAULT_BANNED_TERMS_FILE = join('.config', 'ringside-booker', 'banned-terms.txt');

export type CheckScope = 'blog' | 'journal';

export interface RunChecksOptions {
  /** Absolute path of the repository root. */
  readonly repoRoot: string;
  /**
   * Check only these files (absolute, or relative to `repoRoot`). The series index is still
   * checked against the whole docs/blog folder. Every file is checked when this is left out.
   */
  readonly files?: readonly string[];
  /** Make a missing private banned-terms list an error instead of a warning. */
  readonly requireBannedTerms: boolean;
  /** Check only the blog or only the journal. Both when left out. */
  readonly only?: CheckScope;
  /**
   * The private list itself, one list line per item (so `Name [case]` works), instead of reading
   * it from the environment. For tests.
   */
  readonly privateBannedTerms?: readonly string[];
  /** Where BLOG_BANNED_TERMS and BLOG_BANNED_TERMS_FILE are read from. Defaults to process.env. */
  readonly env?: NodeJS.ProcessEnv;
  /** The home folder the default list path is under. Defaults to the user's home folder. */
  readonly homeDir?: string;
}

/** A path given to the checker that it cannot check. The CLI reports it as a usage error. */
export class CheckUsageError extends Error {
  override readonly name = 'CheckUsageError';
}

/** Runs every blog and journal rule and returns the issues, sorted by file, line and rule. */
export async function runChecks(options: RunChecksOptions): Promise<CheckIssue[]> {
  const { repoRoot } = options;
  const includeBlog = options.only !== 'journal';
  const includeJournal = options.only !== 'blog';
  const selected = options.files === undefined ? null : selectFiles(repoRoot, options.files);
  const isSelected = (source: SourceFile): boolean =>
    selected === null || selected.has(source.path);

  const terms: BannedTerms = {
    realNames: await loadRealNameBlocklist(repoRoot),
    privateTerms:
      options.privateBannedTerms === undefined
        ? await loadPrivateBannedTerms(options.env ?? process.env, options.homeDir ?? homedir())
        : nonEmptyOrNull(
            parseListOrThrow(options.privateBannedTerms.join('\n'), PRIVATE_LIST_LABEL),
          ),
  };
  const fileExists = (repoPath: string): boolean => existsSync(join(repoRoot, repoPath));
  const issues: CheckIssue[] = [...bannedTermsMissing(terms, options.requireBannedTerms)];
  const checkContent = (source: SourceFile, privateReferences: boolean): void => {
    const context: ContentRuleContext = { source, bannedTerms: terms };
    issues.push(...bannedTerms(context));
    if (privateReferences) {
      issues.push(...noPrivateReferences(context));
    }
  };

  if (includeBlog) {
    const blogFiles = await readMarkdownFolder(repoRoot, BLOG_DIR);
    const readme = blogFiles.find((source) => source.path === BLOG_README_PATH) ?? null;
    const posts = blogFiles.filter((source) => isEntryFile(source.path)).map(toPostEntry);

    for (const source of blogFiles.filter(isSelected)) {
      // The READMEs state the content rules, so they name the phrases the rule looks for.
      checkContent(source, source.path !== BLOG_README_PATH);
    }
    for (const post of posts.filter((entry) => isSelected(entry.source))) {
      const context: PostRuleContext = { post, allPosts: posts, fileExists };
      issues.push(
        ...frontmatterValid(context),
        ...fileNameMatchesPart(context),
        ...mdxCompiles(context),
        ...noBodyH1(context),
        ...noTodoInFinal(context),
        ...linksResolve(context),
        ...imagesHaveAlt(context),
        ...excerptLength(context),
      );
    }
    issues.push(...seriesIndexSync({ readme, posts }));
  }

  if (includeJournal) {
    const journalFiles = await readMarkdownFolder(repoRoot, JOURNAL_DIR);
    const readme = journalFiles.find((source) => source.path === JOURNAL_README_PATH) ?? null;
    for (const source of journalFiles.filter(isSelected)) {
      checkContent(source, source.path !== JOURNAL_README_PATH);
      if (isJournalEntryFileName(fileName(source.path))) {
        const context: JournalRuleContext = { source, readme };
        issues.push(
          ...journalFileName(context),
          ...journalFrontmatter(context),
          ...journalSections(context),
          ...journalIndexSync(context),
        );
      }
    }
  }

  const allTerms = [...terms.realNames, ...(terms.privateTerms ?? [])];
  return sortIssues(
    issues.map((issue) => ({
      ...issue,
      file: maskTermsIn(issue.file, allTerms),
      message: maskTermsIn(issue.message, allTerms),
    })),
  );
}

function fileName(repoPath: string): string {
  return repoPath.slice(repoPath.lastIndexOf('/') + 1);
}

/**
 * Every Markdown file in docs/blog except the README and `_` files (the template) is a post, or is
 * meant to be one. The journal has its own list of non-entry files (isJournalEntryFileName).
 */
function isEntryFile(repoPath: string): boolean {
  const name = fileName(repoPath);
  return name !== 'README.md' && !name.startsWith('_');
}

function toPostEntry(source: SourceFile): PostEntry {
  if (source.frontmatterProblem !== null) {
    return { source, frontmatter: null, loaded: null };
  }
  const result = validatePostFrontmatter(source.frontmatterData);
  if (!result.ok) {
    return { source, frontmatter: null, loaded: null };
  }
  const name = fileName(source.path);
  const partMatch = POST_FILE_NAME_PATTERN.test(name) ? /^(\d{2})-/.exec(name) : null;
  return {
    source,
    frontmatter: result.frontmatter,
    loaded: {
      path: source.path,
      fileName: name,
      partFromFileName: partMatch?.[1] === undefined ? null : Number(partMatch[1]),
      frontmatter: result.frontmatter,
      body: bodyAfterFrontmatter(source),
    },
  };
}

/** Reads every `.md` file directly inside `folder`, sorted by name. A missing folder is empty. */
async function readMarkdownFolder(repoRoot: string, folder: string): Promise<SourceFile[]> {
  let names: string[];
  try {
    const entries = await readdir(join(repoRoot, folder), { withFileTypes: true });
    names = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort();
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
  return Promise.all(
    names.map(async (name) => {
      const repoPath = `${folder}/${name}`;
      return readSource(repoPath, await readFile(join(repoRoot, repoPath), 'utf8'));
    }),
  );
}

/** Turns the requested paths into repo-relative POSIX paths, refusing anything uncheckable. */
function selectFiles(repoRoot: string, files: readonly string[]): Set<string> {
  const selected = new Set<string>();
  for (const file of files) {
    const absolutePath = isAbsolute(file) ? file : resolve(repoRoot, file);
    const repoPath = relative(repoRoot, absolutePath).split(sep).join('/');
    const folder = repoPath.slice(0, repoPath.lastIndexOf('/'));
    if ((folder !== BLOG_DIR && folder !== JOURNAL_DIR) || !repoPath.endsWith('.md')) {
      throw new CheckUsageError(
        `${file}: only Markdown files directly in ${BLOG_DIR}/ or ${JOURNAL_DIR}/ can be checked`,
      );
    }
    if (!existsSync(absolutePath)) {
      throw new CheckUsageError(`${file}: no such file`);
    }
    selected.add(repoPath);
  }
  return selected;
}

/** How a line of the private list is named in errors; the line itself is never printed. */
const PRIVATE_LIST_LABEL = 'the private banned-terms list';

/**
 * Parses a term list, turning an unusable line into a usage error that names the list and the
 * line number but not the line, which may hold a private term.
 */
function parseListOrThrow(text: string, listLabel: string): BannedTerm[] {
  try {
    return parseTermList(text);
  } catch (error: unknown) {
    if (error instanceof TermLineError) {
      throw new CheckUsageError(`${listLabel}, line ${String(error.line)}: ${error.message}`);
    }
    throw error;
  }
}

/** List (a): the committed real-name blocklist. Empty until the file exists. */
export async function loadRealNameBlocklist(repoRoot: string): Promise<BannedTerm[]> {
  let text: string;
  try {
    text = await readFile(join(repoRoot, REAL_NAMES_PATH), 'utf8');
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
  return parseListOrThrow(text, REAL_NAMES_PATH);
}

/**
 * List (b): the private list. `BLOG_BANNED_TERMS` (newline-separated) wins; otherwise the file at
 * `BLOG_BANNED_TERMS_FILE`, or `~/.config/ringside-booker/banned-terms.txt`. Null when none of
 * them exists or the list has no terms, so the check can never pass silently with an empty list.
 */
export async function loadPrivateBannedTerms(
  env: NodeJS.ProcessEnv,
  homeDir: string,
): Promise<readonly BannedTerm[] | null> {
  const inline = env['BLOG_BANNED_TERMS'];
  if (inline !== undefined && inline.trim() !== '') {
    return nonEmptyOrNull(parseListOrThrow(inline, PRIVATE_LIST_LABEL));
  }
  const configuredPath = env['BLOG_BANNED_TERMS_FILE']?.trim() ?? '';
  const listPath =
    configuredPath === ''
      ? join(homeDir, DEFAULT_BANNED_TERMS_FILE)
      : resolve(configuredPath.replace(/^~(?=$|[/\\])/, homeDir));
  let text: string;
  try {
    text = await readFile(listPath, 'utf8');
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
  return nonEmptyOrNull(parseListOrThrow(text, PRIVATE_LIST_LABEL));
}

function nonEmptyOrNull(terms: readonly BannedTerm[]): readonly BannedTerm[] | null {
  return terms.length === 0 ? null : terms;
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

function sortIssues(issues: readonly CheckIssue[]): CheckIssue[] {
  return [...issues].sort(
    (left, right) =>
      compareText(left.file, right.file) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      compareText(left.rule, right.rule) ||
      compareText(left.message, right.message),
  );
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
