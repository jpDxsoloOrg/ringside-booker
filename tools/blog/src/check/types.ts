// The shapes shared by the blog and journal checker: rule IDs, issues and the source files the
// rules read.

export const RULE_IDS = [
  'frontmatter-valid',
  'file-name-matches-part',
  'mdx-compiles',
  'no-body-h1',
  'banned-terms',
  'banned-terms-missing',
  'no-private-references',
  'no-todo-in-final',
  'links-resolve',
  'images-have-alt',
  'series-index-sync',
  'excerpt-length',
  'journal-file-name',
  'journal-frontmatter',
  'journal-sections',
  'journal-index-sync',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export type Severity = 'error' | 'warning';

/** One problem found in one file. */
export interface CheckIssue {
  readonly rule: RuleId;
  readonly severity: Severity;
  /** Repo-relative POSIX path, or SETUP_FILE for problems with the checker's own setup. */
  readonly file: string;
  /** 1-based line in `file`, when the problem has one. */
  readonly line?: number;
  readonly message: string;
}

/** The `file` of issues that belong to no file, such as a missing private banned-terms list. */
export const SETUP_FILE = '(setup)';

/** A Markdown file read from the repo, with its frontmatter located but not yet validated. */
export interface SourceFile {
  /** Repo-relative POSIX path, for example `docs/blog/01-why.md`. */
  readonly path: string;
  /** The file text with any BOM removed and line endings turned into `\n`. */
  readonly text: string;
  /**
   * 1-based line of the `---` that closes the frontmatter block, or 0 when there is no complete
   * block. The body starts on the next line.
   */
  readonly frontmatterEndLine: number;
  /** The parsed YAML, or undefined when the block is missing or not valid YAML. */
  readonly frontmatterData: unknown;
  /** Why the frontmatter could not be read, or null when it parsed. */
  readonly frontmatterProblem: { readonly line: number; readonly message: string } | null;
}

/** The two banned-term lists, already parsed. */
export interface BannedTerms {
  /** List (a): the committed real-name blocklist. Empty when the file does not exist yet. */
  readonly realNames: readonly string[];
  /** List (b): the private list kept outside the repo, or null when it was not found. */
  readonly privateTerms: readonly string[] | null;
}
