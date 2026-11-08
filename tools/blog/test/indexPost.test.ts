import { readFile } from 'node:fs/promises';

import { compile } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';

import { readBlogConfig } from '../src/config';
import { BlogTransformError } from '../src/errors';
import type { PostStatus } from '../src/frontmatter';
import { PUBLIC_INDEX_END_MARKER, buildIndexPayload } from '../src/indexPost';
import type { IndexContext } from '../src/indexPost';
import { listPosts, loadPost } from '../src/load';
import type { LoadedPost } from '../src/load';
import { catchError } from './helpers';

const NOW = new Date('2026-11-08T15:30:00.000Z');
const CONTEXT: IndexContext = { config: readBlogConfig({}), now: NOW };

const README = `# Ringside Booker: the blog series

I'm building a wrestling booking sim in the open, and these are the posts: one
per milestone, plus deep dives on the [systems](../design/architecture.md) I think are interesting.

The second paragraph is about this folder and stays in the repo.

## Series index

| Part | Title                     | Status  | Draws from | Published  |
| ---- | ------------------------- | ------- | ---------- | ---------- |
| 01   | The first part            | final   | Kickoff    | 2026-11-01 |
| 02   | The second part           | draft   | FND        | -          |
| 03   | The third part            | final   | SIM        | 2026-11-20 |
| 04   | A planned part, no file   | planned | WLD        | -          |

${PUBLIC_INDEX_END_MARKER}

## Rules

### Content rules

- **No other games by name.** The rules text must never reach the blog.

### MDX safety

- **No bare braces.** Also kept out of the index.
`;

function makePost(part: number, status: PostStatus, title: string): LoadedPost {
  const label = String(part).padStart(2, '0');
  return {
    path: `docs/blog/${label}-part.md`,
    fileName: `${label}-part.md`,
    partFromFileName: part,
    frontmatter: {
      title,
      slug: `ringside-booker-${label}-part`,
      series: 'ringside-booker',
      part,
      status,
      excerpt: `The excerpt for part ${String(part)}, long enough to pass the frontmatter rules.`,
      tags: ['gamedev'],
      journal: [],
    },
    body: 'Body.\n',
  };
}

// Listed out of order on purpose: the index sorts by part.
const POSTS = [
  makePost(3, 'final', 'The third part'),
  makePost(1, 'final', 'The first part'),
  makePost(2, 'draft', 'The second part'),
];

function section(content: string, heading: string): string {
  const start = content.indexOf(`## ${heading}\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = content.slice(start + heading.length + 4);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('buildIndexPayload', () => {
  it('builds the index record: slug, title, tags, published', () => {
    const payload = buildIndexPayload(README, POSTS, CONTEXT);
    expect(payload.slug).toBe('ringside-booker-series');
    expect(payload.title).toBe('Ringside Booker: the series');
    expect(payload.tags).toEqual([{ name: 'ringside-booker', slug: 'ringside-booker' }]);
    expect(payload.published).toBe(true);
    expect(payload.publishedAt).toEqual(NOW);
    expect(payload.coverImage).toBeNull();
  });

  it('opens with the intro paragraph, links made absolute, and takes the excerpt from it', () => {
    const { content, excerpt } = buildIndexPayload(README, POSTS, CONTEXT);
    expect(content.startsWith("I'm building a wrestling booking sim in the open")).toBe(true);
    expect(content).toContain(
      '[systems](https://github.com/jpDxsoloOrg/ringside-booker/blob/main/docs/design/architecture.md)',
    );
    expect(content).not.toContain('The second paragraph');
    expect(content).not.toContain('# Ringside Booker');
    expect(excerpt.length).toBeLessThanOrEqual(160);
    expect(excerpt.startsWith("I'm building a wrestling booking sim in the open")).toBe(true);
    expect(excerpt).not.toContain('](');
  });

  it('leaves out everything after the marker', () => {
    const { content } = buildIndexPayload(README, POSTS, CONTEXT);
    expect(content).not.toContain('Rules');
    expect(content).not.toContain('other games');
    expect(content).not.toContain('braces');
    expect(content).not.toContain('public-index-end');
  });

  it('lists the final parts in part order, with links and excerpts', () => {
    const published = section(buildIndexPayload(README, POSTS, CONTEXT).content, 'Published parts');
    const first = published.indexOf('**Part 1: [The first part](/blog/ringside-booker-01-part)**');
    const third = published.indexOf('**Part 3: [The third part](/blog/ringside-booker-03-part)**');
    expect(first).toBeGreaterThan(-1);
    expect(third).toBeGreaterThan(first);
    expect(published).toContain('The excerpt for part 1');
    expect(published).not.toContain('The second part');
  });

  it('lists draft and planned parts under "Coming up" without links', () => {
    const { content } = buildIndexPayload(README, POSTS, CONTEXT);
    const comingUp = section(content, 'Coming up');
    expect(comingUp).toContain('- Part 2: The second part');
    expect(comingUp).toContain('- Part 4: A planned part, no file');
    expect(comingUp).not.toContain('](');
    expect(content).not.toContain('ringside-booker-02-part');
  });

  it('compiles as MDX with GFM', async () => {
    const { content } = buildIndexPayload(README, POSTS, CONTEXT);
    await expect(compile(content, { remarkPlugins: [remarkGfm] })).resolves.toBeDefined();
  });

  it('throws a clear error when the README has no marker', () => {
    const withoutMarker = README.replace(PUBLIC_INDEX_END_MARKER, '');
    const error = catchError(
      () => buildIndexPayload(withoutMarker, POSTS, CONTEXT),
      BlogTransformError,
    );
    expect(error.filePath).toBe('docs/blog/README.md');
    expect(error.message).toContain('no <!-- public-index-end --> marker');
  });

  it('throws when the series index sits below the marker', () => {
    const [intro = '', rest = ''] = README.split('## Series index');
    const moved = `${intro}${PUBLIC_INDEX_END_MARKER}\n\n## Series index${rest.replace(PUBLIC_INDEX_END_MARKER, '')}`;
    expect(() => buildIndexPayload(moved, POSTS, CONTEXT)).toThrow(
      /no table under "## Series index"/,
    );
  });

  it('throws when a row is final but no final post file backs it', () => {
    const posts = POSTS.filter((post) => post.frontmatter.part !== 3);
    expect(() => buildIndexPayload(README, posts, CONTEXT)).toThrow(
      /part 3 is final in the series index but has no final post file/,
    );
  });

  it('omits "Published parts" while nothing is final', () => {
    const drafts = POSTS.map((post) => ({
      ...post,
      frontmatter: { ...post.frontmatter, status: 'draft' as const },
    }));
    const readme = README.replace(/\| final {3}\|/g, '| draft   |');
    const { content } = buildIndexPayload(readme, drafts, CONTEXT);
    expect(content).not.toContain('## Published parts');
    expect(section(content, 'Coming up')).toContain('- Part 1: The first part');
  });

  it('builds from the real docs/blog/README.md', async () => {
    const readmeUrl = new URL('../../../docs/blog/README.md', import.meta.url);
    const readme = await readFile(readmeUrl, 'utf8');
    const blogDir = new URL('../../../docs/blog/', import.meta.url).pathname;
    const posts = await Promise.all((await listPosts(blogDir)).map((path) => loadPost(path)));
    const { content, excerpt } = buildIndexPayload(readme, posts, CONTEXT);
    expect(excerpt.length).toBeLessThanOrEqual(160);
    expect(content).not.toMatch(/Content rules|MDX safety|Banned terms|Frontmatter/);
    await expect(compile(content, { remarkPlugins: [remarkGfm] })).resolves.toBeDefined();
  });
});
