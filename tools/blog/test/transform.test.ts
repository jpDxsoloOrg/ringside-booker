import { readFile } from 'node:fs/promises';

import { compile } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import { beforeAll, describe, expect, it } from 'vitest';

import { readBlogConfig, type BlogConfig } from '../src/config';
import { BlogTransformError } from '../src/errors';
import type { PostFrontmatter } from '../src/frontmatter';
import { loadPost, type LoadedPost } from '../src/load';
import { toPostPayload, type TransformContext } from '../src/transform';
import { catchError, fixturePath } from './helpers';

const NOW = new Date('2026-11-07T12:00:00.000Z');
const DEFAULT_CONFIG: BlogConfig = readBlogConfig({});

let kickoff: LoadedPost;
let foundations: LoadedPost;
let outline: LoadedPost;
let allPosts: LoadedPost[];

beforeAll(async () => {
  kickoff = await loadPost(fixturePath('posts/01-kickoff.md'));
  foundations = await loadPost(fixturePath('posts/02-foundations.md'));
  outline = await loadPost(fixturePath('posts/03-outline.md'));
  allPosts = [kickoff, foundations, outline];
});

function context(overrides: Partial<TransformContext> = {}): TransformContext {
  return { allPosts, config: DEFAULT_CONFIG, now: NOW, ...overrides };
}

function withBody(post: LoadedPost, body: string): LoadedPost {
  return { ...post, body };
}

function withFrontmatter(post: LoadedPost, frontmatter: PostFrontmatter): LoadedPost {
  return { ...post, frontmatter };
}

/** The post's frontmatter with the optional `excerpt` and `publishedAt` left out. */
function withoutOptionalDates(frontmatter: PostFrontmatter): PostFrontmatter {
  const { title, slug, series, part, status, tags, journal } = frontmatter;
  return { title, slug, series, part, status, tags, journal };
}

describe('toPostPayload: content', () => {
  it('removes HTML comments, including multi-line ones', () => {
    const { content } = toPostPayload(kickoff, context());
    expect(content).not.toContain('note to self');
    expect(content).not.toContain('an inline note');
    expect(content.startsWith('This is the hook paragraph.')).toBe(true);
  });

  it('rewrites links to sibling posts to their blog slugs, keeping the anchor', () => {
    const { content } = toPostPayload(kickoff, context());
    expect(content).toContain('[the next part](/blog/ringside-booker-02-foundations#rng)');
    expect(content).toContain('[the one after](/blog/ringside-booker-03-same-seed-same-show)');
  });

  it('rewrites other repo-relative links to the repo host', () => {
    const { content } = toPostPayload(kickoff, context());
    expect(content).toContain(
      '[the architecture](https://github.com/jpDxsoloOrg/ringside-booker/blob/main/docs/design/architecture.md)',
    );
    expect(content).toContain(
      '[index](https://github.com/jpDxsoloOrg/ringside-booker/blob/main/docs/blog/README.md)',
    );
  });

  it('uses an overridden repo URL and branch', () => {
    const config = readBlogConfig({
      BLOG_REPO_URL: 'https://github.com/example/fork',
      BLOG_REPO_BRANCH: 'release',
    });
    const { content } = toPostPayload(kickoff, context({ config }));
    expect(content).toContain(
      '[the architecture](https://github.com/example/fork/blob/release/docs/design/architecture.md)',
    );
  });

  it('serves images from the asset base URL and keeps the title', () => {
    const { content } = toPostPayload(kickoff, context());
    expect(content).toContain(
      '![A championship belt drawn as a plain shape](https://raw.githubusercontent.com/jpDxsoloOrg/ringside-booker/main/docs/blog/images/01/belt.svg',
    );
    expect(content).toContain("01/belt.svg 'The belt')");
  });

  it('rewrites an image nested in a link, and reference definitions', () => {
    const { content } = toPostPayload(kickoff, context());
    expect(content).toContain(
      '[![A diagram inside a link](https://raw.githubusercontent.com/jpDxsoloOrg/ringside-booker/main/docs/blog/images/01/loop.svg)](https://github.com/jpDxsoloOrg/ringside-booker/blob/main/docs/design/architecture.md#engine-rules)',
    );
    expect(content).toContain(
      '[diagram]: https://raw.githubusercontent.com/jpDxsoloOrg/ringside-booker/main/docs/blog/images/01/loop.svg',
    );
  });

  it('turns images/01/belt.svg into the public raw URL with the default config', () => {
    const post = withBody(kickoff, '![belt](images/01/belt.svg)\n');
    expect(toPostPayload(post, context()).content).toBe(
      '![belt](https://raw.githubusercontent.com/jpDxsoloOrg/ringside-booker/main/docs/blog/images/01/belt.svg)\n',
    );
  });

  it('throws BlogTransformError for an image outside docs/blog/images, naming every one', () => {
    const post = withBody(kickoff, '![x](../design/x.png)\n\n![y](./cover.png)\n');
    const { problems } = catchError(() => toPostPayload(post, context()), BlogTransformError);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('../design/x.png');
    expect(problems[1]).toContain('./cover.png');
  });

  it('throws for a link to a post file that is not loaded', () => {
    const post = withBody(kickoff, 'See [part nine](09-missing.md).\n');
    expect(() => toPostPayload(post, context())).toThrow(/09-missing\.md/);
  });

  it('leaves absolute URLs and same-page anchors untouched', () => {
    const { content } = toPostPayload(kickoff, context());
    expect(content).toContain('[an example](https://example.com/page)');
    expect(content).toContain('[same page](#how-it-works)');
  });

  it('leaves links and comments inside fenced code blocks and inline code untouched', () => {
    const { content } = toPostPayload(kickoff, context());
    expect(content).toContain(
      '// A link in code stays: [arch](../design/architecture.md) <!-- and so does this -->',
    );
    expect(content).toContain("const image = '![x](../design/x.png)';");
    expect(content).toContain('`[arch](../design/architecture.md)` and `<!-- kept -->`');
  });

  it('produces Markdown that compiles as MDX with GFM', async () => {
    const raw = await readFile(kickoff.path, 'utf8');
    const { content } = toPostPayload(kickoff, context());
    await expect(compile(content, { remarkPlugins: [remarkGfm] })).resolves.toBeDefined();
    // The repo file itself does not compile, because of its HTML comments.
    await expect(compile(raw, { remarkPlugins: [remarkGfm] })).rejects.toThrow();
  });

  it('is pure: the same inputs give identical output', () => {
    const first = toPostPayload(kickoff, context());
    const second = toPostPayload(kickoff, context());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('does not import fs or process, or read the clock', async () => {
    const source = await readFile(new URL('../src/transform.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from 'node:fs|from 'fs|process\.|Date\.now|new Date\(\)/);
  });
});

describe('toPostPayload: fields', () => {
  it('copies title, slug and excerpt from the frontmatter', () => {
    const payload = toPostPayload(foundations, context());
    expect(payload.title).toBe('Foundations: one World, deterministic days');
    expect(payload.slug).toBe('ringside-booker-02-foundations');
    expect(payload.excerpt).toBe(foundations.frontmatter.excerpt);
    expect(payload.coverImage).toBeNull();
  });

  it('builds an excerpt from the first paragraph, cut at a word boundary', () => {
    const post = withFrontmatter(foundations, withoutOptionalDates(foundations.frontmatter));
    const { excerpt } = toPostPayload(post, context());
    expect(excerpt.length).toBeLessThanOrEqual(160);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt.startsWith('The World store holds every table')).toBe(true);
    expect(excerpt).toContain('the day loop in core/pipeline runs');
    const withoutEllipsis = excerpt.slice(0, -1);
    const firstParagraph =
      'The World store holds every table the game needs, and the day loop in core/pipeline runs ' +
      'each system in a fixed order, so the same seed always gives the same week of shows';
    expect(firstParagraph.startsWith(withoutEllipsis)).toBe(true);
    expect([' ', ',']).toContain(firstParagraph.charAt(withoutEllipsis.length));
  });

  it('keeps a short first paragraph whole', () => {
    const post = withBody(
      withFrontmatter(kickoff, withoutOptionalDates(kickoff.frontmatter)),
      '## Heading\n\nA *short* opening with [a link](https://example.com).\n',
    );
    expect(toPostPayload(post, context()).excerpt).toBe('A short opening with a link.');
  });

  it('gives a final post without publishedAt the current time', () => {
    const payload = toPostPayload(kickoff, context());
    expect(payload.published).toBe(true);
    expect(payload.publishedAt).toEqual(NOW);
  });

  it('keeps a final post publishedAt from the frontmatter', () => {
    const post = withFrontmatter(kickoff, { ...kickoff.frontmatter, publishedAt: '2026-12-01' });
    expect(toPostPayload(post, context()).publishedAt).toEqual(
      new Date('2026-12-01T00:00:00.000Z'),
    );
  });

  it('pushes a draft as unpublished with no publishedAt', () => {
    const payload = toPostPayload(foundations, context());
    expect(payload.published).toBe(false);
    expect(payload.publishedAt).toBeNull();
  });

  it('refuses outline and planned posts', () => {
    expect(() => toPostPayload(outline, context())).toThrow(BlogTransformError);
    const planned = withFrontmatter(outline, { ...outline.frontmatter, status: 'planned' });
    expect(() => toPostPayload(planned, context())).toThrow(/planned/);
  });

  it('always includes ringside-booker exactly once, de-duplicated by slug and sorted', () => {
    const listed = toPostPayload(kickoff, context()).tags;
    const notListed = toPostPayload(foundations, context()).tags;
    for (const tags of [listed, notListed]) {
      expect(tags.filter((tag) => tag.slug === 'ringside-booker')).toHaveLength(1);
    }
    expect(listed).toEqual([
      { name: 'gamedev', slug: 'gamedev' },
      { name: 'ringside-booker', slug: 'ringside-booker' },
      { name: 'typescript', slug: 'typescript' },
    ]);
    const spaced = withFrontmatter(foundations, {
      ...foundations.frontmatter,
      tags: ['ringside booker', 'game dev', 'game-dev'],
    });
    expect(toPostPayload(spaced, context()).tags).toEqual([
      { name: 'game dev', slug: 'game-dev' },
      { name: 'ringside-booker', slug: 'ringside-booker' },
    ]);
  });
});
