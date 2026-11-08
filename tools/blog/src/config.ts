import { z } from 'zod';

import { BlogConfigError, toBlogIssues } from './errors';

/** Settings for turning repo posts into blog posts. Database settings live with the publisher. */
export interface BlogConfig {
  /** The blog's public origin, for example for printing post URLs. Optional until publishing. */
  readonly siteUrl: string | null;
  /** The public repo; links to repo files point at `${repoUrl}/blob/${repoBranch}/...`. */
  readonly repoUrl: string;
  readonly repoBranch: string;
  /** Where `docs/blog/images` is served from; post images become `${assetBaseUrl}/NN/x.svg`. */
  readonly assetBaseUrl: string;
}

export const DEFAULT_REPO_URL = 'https://github.com/jpDxsoloOrg/ringside-booker';
export const DEFAULT_REPO_BRANCH = 'main';
export const DEFAULT_ASSET_BASE_URL =
  'https://raw.githubusercontent.com/jpDxsoloOrg/ringside-booker/main/docs/blog/images';

function urlSetting(variableName: string) {
  return z
    .url({ protocol: /^https?$/, error: `${variableName} must be an absolute http(s) URL` })
    .transform((url) => url.replace(/\/+$/, ''));
}

const BlogEnv = z.object({
  BLOG_SITE_URL: urlSetting('BLOG_SITE_URL').optional(),
  BLOG_REPO_URL: urlSetting('BLOG_REPO_URL').default(DEFAULT_REPO_URL),
  BLOG_REPO_BRANCH: z
    .string()
    .regex(/^[\w./-]+$/, { error: 'BLOG_REPO_BRANCH must be a branch name without spaces' })
    .default(DEFAULT_REPO_BRANCH),
  BLOG_ASSET_BASE_URL: urlSetting('BLOG_ASSET_BASE_URL').default(DEFAULT_ASSET_BASE_URL),
});

/** Reads an env var, treating an empty value the same as an unset one. */
function readSetting(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/** Reads and validates the BLOG_* settings. Throws BlogConfigError naming each bad variable. */
export function readBlogConfig(env: NodeJS.ProcessEnv): BlogConfig {
  const parsed = BlogEnv.safeParse({
    BLOG_SITE_URL: readSetting(env, 'BLOG_SITE_URL'),
    BLOG_REPO_URL: readSetting(env, 'BLOG_REPO_URL'),
    BLOG_REPO_BRANCH: readSetting(env, 'BLOG_REPO_BRANCH'),
    BLOG_ASSET_BASE_URL: readSetting(env, 'BLOG_ASSET_BASE_URL'),
  });
  if (!parsed.success) {
    throw new BlogConfigError(toBlogIssues(parsed.error));
  }
  return {
    siteUrl: parsed.data.BLOG_SITE_URL ?? null,
    repoUrl: parsed.data.BLOG_REPO_URL,
    repoBranch: parsed.data.BLOG_REPO_BRANCH,
    assetBaseUrl: parsed.data.BLOG_ASSET_BASE_URL,
  };
}
