import type { z } from 'zod';

/** One problem with a value, found while validating frontmatter or config. */
export interface BlogIssue {
  /** Dotted path of the offending field, for example `tags.2`. Empty for the whole value. */
  readonly path: string;
  readonly message: string;
}

/** The file is not shaped like a post: no frontmatter block, an unterminated one, or bad YAML. */
export class BlogFormatError extends Error {
  override readonly name = 'BlogFormatError';
  /** 1-based line in the file where the problem starts. */
  readonly line: number;
  /** The file being read, when there is one. */
  readonly filePath: string | null;
  /** The message without the location prefix. */
  readonly detail: string;

  constructor(detail: string, line: number, filePath: string | null = null) {
    const where = filePath === null ? `line ${String(line)}` : `${filePath}:${String(line)}`;
    super(`${where}: ${detail}`);
    this.line = line;
    this.filePath = filePath;
    this.detail = detail;
  }
}

/** The frontmatter parsed as YAML but does not match the post schema. */
export class BlogFrontmatterError extends Error {
  override readonly name = 'BlogFrontmatterError';
  readonly filePath: string;
  readonly issues: readonly BlogIssue[];

  constructor(filePath: string, issues: readonly BlogIssue[]) {
    const details = issues.map((issue) => `  - ${formatIssue(issue)}`).join('\n');
    super(`${filePath}: invalid frontmatter\n${details}`);
    this.filePath = filePath;
    this.issues = issues;
  }
}

/** A BLOG_* environment variable is set to something unusable. */
export class BlogConfigError extends Error {
  override readonly name = 'BlogConfigError';
  readonly issues: readonly BlogIssue[];

  constructor(issues: readonly BlogIssue[]) {
    const details = issues.map((issue) => `  - ${formatIssue(issue)}`).join('\n');
    super(`invalid blog config\n${details}`);
    this.issues = issues;
  }
}

/** A post cannot be turned into a blog payload, for example an image outside docs/blog/images. */
export class BlogTransformError extends Error {
  override readonly name = 'BlogTransformError';
  readonly filePath: string;
  readonly problems: readonly string[];

  constructor(filePath: string, problems: readonly string[]) {
    const details = problems.map((problem) => `  - ${problem}`).join('\n');
    super(`${filePath}: cannot build the blog payload\n${details}`);
    this.filePath = filePath;
    this.problems = problems;
  }
}

function formatIssue(issue: BlogIssue): string {
  return issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`;
}

/** Flattens zod issues into `{ path, message }` pairs for error messages and the checker. */
export function toBlogIssues(error: z.ZodError): BlogIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    message: issue.message,
  }));
}
