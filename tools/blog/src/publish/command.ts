import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { formatReport } from '../check/format';
import { CheckUsageError, runChecks } from '../check/run';
import { readBlogConfig } from '../config';
import {
  BlogConfigError,
  BlogFormatError,
  BlogFrontmatterError,
  BlogTransformError,
} from '../errors';
import { listPosts, loadPost } from '../load';
import type { LoadedPost } from '../load';
import { toPostPayload } from '../transform';
import type { EnvFile } from './env';
import { PublishEnvError, readPublishEnv } from './env';
import { BlogSchemaError, assertBlogSchema } from './preflight';
import type { Queryable } from './queryable';
import { BlogAuthorError, BlogPublishError, BlogSlugChangeError, publishPost } from './upsert';
import type { FieldChange, PublishResult } from './upsert';
import { writeBack } from './writeBack';

// `npm run blog:publish -- <file> [--dry-run] [--no-write-back] [--allow-new-slug]`
// Exit codes: 0 published (or nothing to do), 1 refused or failed, 2 bad arguments.

export const PUBLISH_USAGE = `Usage: npm run blog:publish -- <file> [--dry-run] [--no-write-back] [--allow-new-slug]

  <file>            the post to publish, for example docs/blog/01-why-im-building-a-wrestling-booking-sim.md
  --dry-run         show what would change on the blog, then roll back without writing anything
  --no-write-back   don't write publishedAt back into the post and the series index
  --allow-new-slug  publish even though a post with the same title exists under another slug
`;

export const CI_REFUSAL = 'publishing runs only from a local machine';

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
];

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
  const [file] = positionals;
  if (file === undefined || positionals.length > 1) {
    deps.stderr(`pass exactly one post file\n\n${PUBLISH_USAGE}`);
    return 2;
  }

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
    const config = { ...readBlogConfig(settings), siteUrl: publishEnv.siteUrl };

    const postPath = resolve(deps.repoRoot, file);
    const issues = await runChecks({
      repoRoot: deps.repoRoot,
      files: [postPath],
      requireBannedTerms: true,
      env: settings,
    });
    if (issues.length > 0) {
      deps.stdout(formatReport(issues));
    }
    if (issues.some((issue) => issue.severity === 'error')) {
      deps.stderr('not published: fix the errors above first\n');
      return 1;
    }

    const post = await loadPost(postPath);
    const allPosts = await loadAllPosts(join(deps.repoRoot, 'docs/blog'));
    const now = deps.now();
    const payload = toPostPayload(post, { allPosts, config, now });

    const client = await deps.connect(publishEnv.databaseUrl);
    let result: PublishResult;
    try {
      await assertBlogSchema(client);
      result = await publishPost(client, payload, {
        authorEmail: publishEnv.authorEmail,
        siteUrl: publishEnv.siteUrl,
        dryRun: values['dry-run'],
        allowNewSlug: values['allow-new-slug'],
        now,
      });
    } finally {
      await client.end();
    }

    deps.stdout(formatResult(result));
    if (
      !result.dryRun &&
      !values['no-write-back'] &&
      post.frontmatter.status === 'final' &&
      post.frontmatter.publishedAt === undefined &&
      result.publishedAt !== null
    ) {
      const written = await writeBack({
        repoRoot: deps.repoRoot,
        postPath,
        part: post.frontmatter.part,
        publishedAt: result.publishedAt,
      });
      const postRepoPath = relative(deps.repoRoot, postPath).split(sep).join('/');
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
    return 0;
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
  const rows = [
    ['field', 'before', 'after'],
    ...changes.map((change) => [change.field, cell(change.before), cell(change.after)]),
  ];
  const widths = [0, 1, 2].map((column) =>
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
