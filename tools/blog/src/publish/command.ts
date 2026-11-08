import { readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { formatReport } from '../check/format';
import { CheckUsageError, runChecks } from '../check/run';
import { readBlogConfig } from '../config';
import type { BlogConfig } from '../config';
import {
  BlogConfigError,
  BlogFormatError,
  BlogFrontmatterError,
  BlogTransformError,
} from '../errors';
import { SERIES_README_PATH, buildIndexPayload } from '../indexPost';
import { listPosts, loadPost } from '../load';
import type { LoadedPost } from '../load';
import { findPublishedNeighbours } from '../series';
import { toPostPayload } from '../transform';
import type { PostPayload } from '../transform';
import type { EnvFile } from './env';
import { PublishEnvError, readPublishEnv } from './env';
import { BlogSchemaError, assertBlogSchema } from './preflight';
import type { Queryable } from './queryable';
import { BlogAuthorError, BlogPublishError, BlogSlugChangeError, publishPost } from './upsert';
import type { FieldChange, PublishAction, PublishOptions, PublishResult } from './upsert';
import { writeBack } from './writeBack';

// `npm run blog:publish -- <file> | --all | --index-only [--dry-run] [--no-write-back] [--allow-new-slug]`
// Exit codes: 0 published (or nothing to do), 1 refused or failed, 2 bad arguments.

export const PUBLISH_USAGE = `Usage: npm run blog:publish -- <file> [--dry-run] [--no-write-back] [--allow-new-slug]
       npm run blog:publish -- --all [--dry-run] [--no-write-back]
       npm run blog:publish -- --index-only [--dry-run]

  <file>            the post to publish, for example docs/blog/01-why-im-building-a-wrestling-booking-sim.md
  --all             publish every draft and final post in part order, then the series index
  --index-only      publish just the series index post
  --dry-run         show what would change on the blog, then roll back without writing anything
  --no-write-back   don't write publishedAt back into the post and the series index
  --allow-new-slug  publish even though a post with the same title exists under another slug
                    (one post file only)
`;

export const CI_REFUSAL = 'publishing runs only from a local machine';

const BLOG_DIR = 'docs/blog';

export const REPUBLISH_ALL_COMMAND = 'npm run blog:publish -- --all';

/** A connected database client. A `pg` Client satisfies it. */
export interface DatabaseClient extends Queryable {
  end(): Promise<void>;
}

export interface PublishCommandDeps {
  /** Absolute path of the repository root; relative file arguments are resolved against it. */
  readonly repoRoot: string;
  readonly processEnv: NodeJS.ProcessEnv;
  /** Reads tools/blog/.env.local. Never called when the command refuses to run under CI. */
  readonly loadEnvFile: () => Promise<EnvFile>;
  readonly connect: (databaseUrl: string) => Promise<DatabaseClient>;
  readonly now: () => Date;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** A batch publish stopped part way. Earlier posts stay published; each was its own transaction. */
export class BatchPublishError extends Error {
  override readonly name = 'BatchPublishError';
}

const KNOWN_ERRORS = [
  PublishEnvError,
  BlogConfigError,
  BlogFormatError,
  BlogFrontmatterError,
  BlogTransformError,
  BlogSchemaError,
  BlogAuthorError,
  BlogSlugChangeError,
  BlogPublishError,
  BatchPublishError,
];

type PublishMode =
  | { readonly kind: 'file'; readonly file: string }
  | { readonly kind: 'all' }
  | { readonly kind: 'index-only' };

interface PublishFlags {
  readonly dryRun: boolean;
  readonly writeBack: boolean;
  readonly allowNewSlug: boolean;
}

/** Everything a publish needs once the settings are read and checked. */
interface PublishSetup {
  readonly deps: PublishCommandDeps;
  readonly flags: PublishFlags;
  readonly settings: NodeJS.ProcessEnv;
  readonly config: BlogConfig;
  readonly databaseUrl: string;
  readonly authorEmail: string;
  readonly siteUrl: string;
}

/** Runs the publish command and returns its exit code. */
export async function runPublishCommand(
  argv: readonly string[],
  deps: PublishCommandDeps,
): Promise<number> {
  // The blog database is write access to a live site. Refuse before reading any setting.
  const ciFlag = deps.processEnv['CI'];
  if (ciFlag !== undefined && ciFlag !== '') {
    deps.stderr(`${CI_REFUSAL} (CI is set)\n`);
    return 1;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        all: { type: 'boolean', default: false },
        'index-only': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'no-write-back': { type: 'boolean', default: false },
        'allow-new-slug': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error: unknown) {
    deps.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${PUBLISH_USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    deps.stdout(PUBLISH_USAGE);
    return 0;
  }
  const mode = readMode(values.all, values['index-only'], positionals);
  if (typeof mode === 'string') {
    deps.stderr(`${mode}\n\n${PUBLISH_USAGE}`);
    return 2;
  }
  if (mode.kind !== 'file' && values['allow-new-slug']) {
    deps.stderr(`--allow-new-slug works with one post file only\n\n${PUBLISH_USAGE}`);
    return 2;
  }
  const flags: PublishFlags = {
    dryRun: values['dry-run'],
    writeBack: !values['no-write-back'],
    allowNewSlug: values['allow-new-slug'],
  };

  const secrets: string[] = [];
  try {
    const envFile = await deps.loadEnvFile();
    const publishEnv = readPublishEnv({ envFile, processEnv: deps.processEnv });
    secrets.push(
      publishEnv.databaseUrl,
      publishEnv.authorEmail,
      ...urlSecrets(publishEnv.databaseUrl),
    );

    // The other BLOG_* settings follow the same order: the env file first, then the shell. The
    // database URL is left out so it only ever reaches the database client.
    const settings: NodeJS.ProcessEnv = { ...deps.processEnv, ...envFile.values };
    delete settings['BLOG_DATABASE_URL'];
    const setup: PublishSetup = {
      deps,
      flags,
      settings,
      config: { ...readBlogConfig(settings), siteUrl: publishEnv.siteUrl },
      databaseUrl: publishEnv.databaseUrl,
      authorEmail: publishEnv.authorEmail,
      siteUrl: publishEnv.siteUrl,
    };

    switch (mode.kind) {
      case 'file':
        return await publishOneFile(setup, mode.file);
      case 'all':
        return await publishBatch(setup, true);
      case 'index-only':
        return await publishBatch(setup, false);
    }
  } catch (error: unknown) {
    if (error instanceof CheckUsageError) {
      deps.stderr(`${redact(error.message, secrets)}\n`);
      return 2;
    }
    const message = error instanceof Error ? error.message : String(error);
    const known = KNOWN_ERRORS.some((errorClass) => error instanceof errorClass);
    deps.stderr(`${known ? '' : 'publish failed: '}${redact(message, secrets)}\n`);
    return 1;
  }
}

/** The mode the arguments ask for, or the reason they don't make sense. */
function readMode(
  all: boolean,
  indexOnly: boolean,
  positionals: readonly string[],
): PublishMode | string {
  if (all && indexOnly) {
    return 'pass --all or --index-only, not both';
  }
  if (all || indexOnly) {
    if (positionals.length > 0) {
      return `--${all ? 'all' : 'index-only'} publishes from the whole docs/blog folder; don't pass a file`;
    }
    return all ? { kind: 'all' } : { kind: 'index-only' };
  }
  const [file] = positionals;
  if (file === undefined || positionals.length > 1) {
    return 'pass exactly one post file, or --all';
  }
  return { kind: 'file', file };
}

/** Runs the checker with the private list required. False (after printing) when it found errors. */
async function passesChecks(
  setup: PublishSetup,
  files: readonly string[] | undefined,
): Promise<boolean> {
  const issues = await runChecks({
    repoRoot: setup.deps.repoRoot,
    ...(files === undefined ? { only: 'blog' as const } : { files }),
    requireBannedTerms: true,
    env: setup.settings,
  });
  if (issues.length > 0) {
    setup.deps.stdout(formatReport(issues));
  }
  if (issues.some((issue) => issue.severity === 'error')) {
    setup.deps.stderr('not published: fix the errors above first\n');
    return false;
  }
  return true;
}

function publishOptions(setup: PublishSetup, now: Date): PublishOptions {
  return {
    authorEmail: setup.authorEmail,
    siteUrl: setup.siteUrl,
    dryRun: setup.flags.dryRun,
    allowNewSlug: setup.flags.allowNewSlug,
    now,
  };
}

async function publishOneFile(setup: PublishSetup, file: string): Promise<number> {
  const { deps } = setup;
  const postPath = resolve(deps.repoRoot, file);
  if (!(await passesChecks(setup, [postPath]))) {
    return 1;
  }

  const post = await loadPost(postPath);
  const allPosts = await loadAllPosts(join(deps.repoRoot, BLOG_DIR));
  const now = deps.now();
  const payload = toPostPayload(post, { allPosts, config: setup.config, now });

  const client = await deps.connect(setup.databaseUrl);
  let result: PublishResult;
  try {
    await assertBlogSchema(client);
    result = await publishPost(client, payload, publishOptions(setup, now));
  } finally {
    await client.end();
  }

  deps.stdout(formatResult(result));
  await writeBackIfFirstPublish(setup, post, result);
  if (!result.dryRun) {
    const hint = staleNavHint(post, allPosts, result);
    if (hint !== null) {
      deps.stdout(`${hint}\n`);
    }
  }
  return 0;
}

/** One post the batch publishes; `post` is null for the series index. */
interface BatchJob {
  readonly label: string;
  readonly post: LoadedPost | null;
  readonly payload: PostPayload;
}

/** One line of the batch summary. */
export interface BatchRow {
  readonly part: string;
  readonly slug: string;
  readonly action: PublishAction | 'failed' | 'not run';
}

/**
 * `--all` (every draft and final post in part order, then the index) or `--index-only`. Every
 * payload is built before connecting, so a post that can't be built stops the run before any
 * write. Each post is its own transaction, and the first failure stops the run.
 */
async function publishBatch(setup: PublishSetup, withPosts: boolean): Promise<number> {
  const { deps } = setup;
  if (!(await passesChecks(setup, undefined))) {
    return 1;
  }

  const blogDir = join(deps.repoRoot, BLOG_DIR);
  const allPosts = await loadAllPosts(blogDir);
  const now = deps.now();
  const context = { allPosts, config: setup.config, now };
  const jobs: BatchJob[] = [];
  if (withPosts) {
    const publishable = allPosts
      .filter((post) => post.frontmatter.status === 'draft' || post.frontmatter.status === 'final')
      .sort((left, right) => left.frontmatter.part - right.frontmatter.part);
    for (const post of publishable) {
      jobs.push({
        label: String(post.frontmatter.part),
        post,
        payload: toPostPayload(post, context),
      });
    }
  }
  const readme = await readFile(join(deps.repoRoot, SERIES_README_PATH), 'utf8');
  jobs.push({
    label: 'index',
    post: null,
    payload: buildIndexPayload(readme, allPosts, { config: setup.config, now }),
  });

  const rows: BatchRow[] = [];
  let failure: { job: BatchJob; error: unknown } | null = null;
  const client = await deps.connect(setup.databaseUrl);
  try {
    await assertBlogSchema(client);
    for (const job of jobs) {
      let result: PublishResult;
      try {
        result = await publishPost(client, job.payload, publishOptions(setup, now));
      } catch (error: unknown) {
        failure = { job, error };
        break;
      }
      rows.push({ part: job.label, slug: job.payload.slug, action: result.action });
      if (job.post !== null) {
        await writeBackIfFirstPublish(setup, job.post, result);
      }
    }
  } finally {
    await client.end();
  }

  if (failure !== null) {
    const failedIndex = jobs.indexOf(failure.job);
    rows.push({ part: failure.job.label, slug: failure.job.payload.slug, action: 'failed' });
    for (const job of jobs.slice(failedIndex + 1)) {
      rows.push({ part: job.label, slug: job.payload.slug, action: 'not run' });
    }
  }
  deps.stdout(formatBatchSummary(rows, setup.flags.dryRun));

  if (failure !== null) {
    const written = setup.flags.dryRun
      ? []
      : rows.filter((row) => row.action === 'created' || row.action === 'updated');
    const writtenText =
      written.length === 0
        ? 'nothing was written before it'
        : `already written: ${written.map((row) => `${describeRow(row)} (${row.slug})`).join(', ')}`;
    const reason = failure.error instanceof Error ? failure.error.message : String(failure.error);
    throw new BatchPublishError(
      `stopped at ${describeRow({ part: failure.job.label })} (${failure.job.payload.slug}); ` +
        `${writtenText}\n${reason}`,
    );
  }
  return 0;
}

function describeRow(row: { readonly part: string }): string {
  return row.part === 'index' ? 'the series index' : `part ${row.part}`;
}

/** Writes `publishedAt` back after the first live publish of a `final` post, as BLOG-06 does. */
async function writeBackIfFirstPublish(
  setup: PublishSetup,
  post: LoadedPost,
  result: PublishResult,
): Promise<void> {
  const { deps } = setup;
  if (
    result.dryRun ||
    !setup.flags.writeBack ||
    post.frontmatter.status !== 'final' ||
    post.frontmatter.publishedAt !== undefined ||
    result.publishedAt === null
  ) {
    return;
  }
  const written = await writeBack({
    repoRoot: deps.repoRoot,
    postPath: post.path,
    part: post.frontmatter.part,
    publishedAt: result.publishedAt,
  });
  const postRepoPath = relative(deps.repoRoot, post.path).split(sep).join('/');
  if (written.postUpdated) {
    deps.stdout(`wrote publishedAt to ${postRepoPath}\n`);
  }
  if (written.readmeUpdated) {
    deps.stdout('filled the Published cell in docs/blog/README.md\n');
  } else if (!written.readmeRowFound) {
    deps.stderr(
      `docs/blog/README.md has no series index row for part ${String(post.frontmatter.part)}\n`,
    );
  }
}

/**
 * After a single-file publish, the other published parts and the index carry navigation built
 * from the old state. When the post went up, came down or (while up) changed its title, names
 * what is now out of date. Null when nothing is.
 */
export function staleNavHint(
  post: LoadedPost,
  allPosts: readonly LoadedPost[],
  result: PublishResult,
): string | null {
  const visibilityChanged = result.changes.some(
    (change) =>
      change.field === 'published' && (change.before === 'true' || change.after === 'true'),
  );
  const titleChanged =
    post.frontmatter.status === 'final' &&
    result.changes.some((change) => change.field === 'title' && change.before !== null);
  if (!visibilityChanged && !titleChanged) {
    return null;
  }
  const { previous, next } = findPublishedNeighbours(post.frontmatter.part, allPosts);
  const stale: string[] = [];
  if (previous !== null) {
    stale.push(`Part ${String(previous.frontmatter.part)}'s Next link`);
  }
  if (next !== null) {
    stale.push(`Part ${String(next.frontmatter.part)}'s Previous link`);
  }
  stale.push('the series index');
  const [first = '', ...rest] = stale;
  const subject =
    rest.length === 0
      ? first
      : `${[first, ...rest.slice(0, -1)].join(', ')} and ${rest.at(-1) ?? ''}`;
  const verb = stale.length === 1 ? 'is' : 'are';
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${verb} out of date; run \`${REPUBLISH_ALL_COMMAND}\``;
}

/** Every post that loads, so links between parts resolve. Posts that don't load are skipped. */
async function loadAllPosts(blogDir: string): Promise<LoadedPost[]> {
  const loaded: LoadedPost[] = [];
  for (const path of await listPosts(blogDir)) {
    try {
      loaded.push(await loadPost(path));
    } catch (error: unknown) {
      if (!(error instanceof BlogFormatError || error instanceof BlogFrontmatterError)) {
        throw error;
      }
    }
  }
  return loaded;
}

/** The parts of a connection string that must never be printed, beyond the string itself. */
function urlSecrets(databaseUrl: string): string[] {
  try {
    const url = new URL(databaseUrl);
    return [url.password, url.username, url.host, url.hostname].filter((part) => part.length > 2);
  } catch {
    return [];
  }
}

/** Masks settings that may have ended up in a driver's error message. */
export function redact(message: string, secrets: readonly string[]): string {
  let redacted = message;
  for (const secret of [...secrets].sort((left, right) => right.length - left.length)) {
    if (secret !== '') {
      redacted = redacted.split(secret).join('[redacted]');
    }
  }
  return redacted;
}

const MAX_CELL_LENGTH = 70;

function cell(value: string | null): string {
  if (value === null) {
    return '-';
  }
  const singleLine = value.replace(/\s+/g, ' ');
  return singleLine.length > MAX_CELL_LENGTH
    ? `${singleLine.slice(0, MAX_CELL_LENGTH - 1)}…`
    : singleLine;
}

/** `created <slug> → <url>`, a dry-run note, and a table of the changed fields. */
export function formatResult(result: PublishResult): string {
  const lines = [`${result.action} ${result.slug} → ${result.url}`];
  if (result.dryRun) {
    lines.push('dry run: nothing was written');
  }
  if (result.changes.length > 0) {
    lines.push('', ...formatChanges(result.changes));
  }
  return `${lines.join('\n')}\n`;
}

function formatChanges(changes: readonly FieldChange[]): string[] {
  return formatTable([
    ['field', 'before', 'after'],
    ...changes.map((change) => [change.field, cell(change.before), cell(change.after)]),
  ]);
}

/** `Part | Slug | Action` for a batch run, and a dry-run note when nothing was saved. */
export function formatBatchSummary(rows: readonly BatchRow[], dryRun: boolean): string {
  const lines = [
    '',
    ...formatTable([
      ['Part', 'Slug', 'Action'],
      ...rows.map((row) => [row.part, row.slug, row.action]),
    ]),
  ];
  if (dryRun) {
    lines.push('dry run: nothing was written');
  }
  return `${lines.join('\n')}\n`;
}

/** Left-aligned columns two spaces apart, with a dashed rule under the header row. */
function formatTable(rows: readonly (readonly string[])[]): string[] {
  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_unused, column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length)),
  );
  const formatRow = (row: readonly string[]): string =>
    row
      .map((value, column) => value.padEnd(widths[column] ?? 0))
      .join('  ')
      .trimEnd();
  const [header, ...body] = rows;
  return [
    formatRow(header ?? []),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...body.map(formatRow),
  ];
}
