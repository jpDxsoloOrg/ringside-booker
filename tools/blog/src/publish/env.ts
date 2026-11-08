import { readFile } from 'node:fs/promises';
import * as nodeUtil from 'node:util';

import { z } from 'zod';

// Settings for the publisher. The blog's database URL is write access to a live site and this
// repo is public, so it is read from one place only: the gitignored tools/blog/.env.local file on
// my own machine. It is never read from process.env, so a CI secret or a shell export can't
// supply it. The author email and site URL are not secret and fall back to the shell.

/** Where the env file lives, relative to the repo root. Used in messages and as the default. */
export const ENV_FILE_REPO_PATH = 'tools/blog/.env.local';

/** The parsed env file. `values` is empty when the file does not exist. */
export interface EnvFile {
  /** The path shown in messages, for example `tools/blog/.env.local`. */
  readonly displayPath: string;
  readonly exists: boolean;
  readonly values: Readonly<Record<string, string>>;
}

export interface PublishEnv {
  /** Direct (non-pooled) PostgreSQL connection string for the blog database. */
  readonly databaseUrl: string;
  /** Email of the blog user that new posts are credited to. */
  readonly authorEmail: string;
  /** The blog's public origin, without a trailing slash. */
  readonly siteUrl: string;
}

export interface ReadPublishEnvOptions {
  readonly envFile: EnvFile;
  readonly processEnv: NodeJS.ProcessEnv;
}

/** A publish setting is missing or unusable. The message never includes a value. */
export class PublishEnvError extends Error {
  override readonly name = 'PublishEnvError';
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    const details = problems.map((problem) => `  - ${problem}`).join('\n');
    super(`cannot publish: missing or invalid settings\n${details}`);
    this.problems = problems;
  }
}

const PublishEnvSchema = z.object({
  BLOG_DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, { error: 'must be a postgres:// or postgresql:// URL' }),
  BLOG_AUTHOR_EMAIL: z.email({ error: 'must be an email address' }),
  BLOG_SITE_URL: z
    .url({ protocol: /^https?$/, error: 'must be an absolute http(s) URL' })
    .transform((url) => url.replace(/\/+$/, '')),
});

type PublishVariable = keyof z.infer<typeof PublishEnvSchema>;

const PUBLISH_VARIABLES: readonly PublishVariable[] = [
  'BLOG_DATABASE_URL',
  'BLOG_AUTHOR_EMAIL',
  'BLOG_SITE_URL',
];

/** Variables that may only come from the env file, never from the shell. */
const FILE_ONLY_VARIABLES: ReadonlySet<string> = new Set(['BLOG_DATABASE_URL']);

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/**
 * Reads and validates the publish settings. `BLOG_DATABASE_URL` comes only from the env file;
 * `BLOG_AUTHOR_EMAIL` and `BLOG_SITE_URL` come from the file, falling back to `processEnv`.
 * Throws PublishEnvError naming each missing or invalid variable and the file, never a value.
 */
export function readPublishEnv({ envFile, processEnv }: ReadPublishEnvOptions): PublishEnv {
  const raw: Partial<Record<PublishVariable, string>> = {};
  const problems: string[] = [];
  for (const variable of PUBLISH_VARIABLES) {
    const fromFile = nonEmpty(envFile.values[variable]);
    const value = FILE_ONLY_VARIABLES.has(variable)
      ? fromFile
      : (fromFile ?? nonEmpty(processEnv[variable]));
    if (value === undefined) {
      problems.push(
        FILE_ONLY_VARIABLES.has(variable)
          ? `${variable} is not set in ${envFile.displayPath} (it is read from that file only, never from the shell)`
          : `${variable} is not set in ${envFile.displayPath} or the environment`,
      );
    } else {
      raw[variable] = value;
    }
  }

  const parsed = PublishEnvSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const variable = PUBLISH_VARIABLES.find((name) => name === issue.path[0]);
      // Missing values were reported above with a clearer message.
      if (variable !== undefined && raw[variable] !== undefined) {
        problems.push(`${variable} ${issue.message}`);
      }
    }
  }
  if (problems.length > 0 || !parsed.success) {
    throw new PublishEnvError(problems);
  }
  return {
    databaseUrl: parsed.data.BLOG_DATABASE_URL,
    authorEmail: parsed.data.BLOG_AUTHOR_EMAIL,
    siteUrl: parsed.data.BLOG_SITE_URL,
  };
}

// ---------------------------------------------------------------------------------------------
// Env file parsing. Node's util.parseEnv is used when this Node has it (20.12 and later); older
// versions get the small parser below. Neither touches process.env.
// ---------------------------------------------------------------------------------------------

const utilWithParseEnv: { parseEnv?: (content: string) => NodeJS.Dict<string> } = nodeUtil;

/** Parses dotenv text into a plain object. Does not read or change process.env. */
export function parseEnvText(text: string): Record<string, string> {
  const parsed = utilWithParseEnv.parseEnv?.(text) ?? parseEnvFallback(text);
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) {
      values[key] = value;
    }
  }
  return values;
}

/** `KEY=value` lines, optional `export `, `#` comments, single- or double-quoted values. */
export function parseEnvFallback(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] === undefined) {
      continue;
    }
    const rawValue = match[2] ?? '';
    const quoted = /^(["'`])(.*)\1$/.exec(rawValue);
    values[match[1]] =
      quoted === null ? rawValue.replace(/\s+#.*$/, '') : (quoted[2] ?? '').replace(/\\n/g, '\n');
  }
  return values;
}

/** Reads the env file at `absolutePath`. A missing file gives an empty set of values. */
export async function loadEnvFile(absolutePath: string, displayPath: string): Promise<EnvFile> {
  let text: string;
  try {
    text = await readFile(absolutePath, 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { displayPath, exists: false, values: {} };
    }
    throw error;
  }
  return { displayPath, exists: true, values: parseEnvText(text) };
}
