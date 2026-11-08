import { describe, expect, it } from 'vitest';

import { PostFrontmatter } from '../src/frontmatter';

const validFinal = {
  title: 'Same seed, same show',
  slug: 'ringside-booker-03-same-seed-same-show',
  series: 'ringside-booker',
  part: 3,
  status: 'final',
  excerpt: 'How named random streams keep one change from reshuffling every result after it.',
  tags: ['gamedev', 'typescript', 'simulation'],
  publishedAt: '2026-12-01',
  coverImage:
    'https://raw.githubusercontent.com/jpDxsoloOrg/ringside-booker/main/docs/blog/images/03/cover.png',
  journal: ['docs/dev-journal/2026-11-project-kickoff.md'],
};

function issuePaths(input: unknown): PropertyKey[][] {
  const result = PostFrontmatter.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path);
}

describe('PostFrontmatter', () => {
  it('parses a valid final post', () => {
    expect(PostFrontmatter.parse(validFinal)).toEqual(validFinal);
  });

  it('accepts an outline without an excerpt', () => {
    const { title, slug, series, part, tags, journal } = validFinal;
    const outline = { title, slug, series, part, tags, journal, status: 'outline' };
    expect(PostFrontmatter.safeParse(outline).success).toBe(true);
  });

  it('requires an excerpt for a draft', () => {
    const { title, slug, series, part, tags, journal } = validFinal;
    const draft = { title, slug, series, part, tags, journal, status: 'draft' };
    expect(issuePaths(draft)).toEqual([['excerpt']]);
  });

  it('rejects unknown keys', () => {
    expect(PostFrontmatter.safeParse({ ...validFinal, author: 'someone' }).success).toBe(false);
  });

  it('rejects a slug without the series prefix', () => {
    expect(issuePaths({ ...validFinal, slug: 'my-post' })).toEqual([['slug']]);
  });

  it('rejects more than six tags', () => {
    const tags = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
    expect(issuePaths({ ...validFinal, tags })).toEqual([['tags']]);
  });

  it('rejects duplicate and badly formed tags', () => {
    expect(issuePaths({ ...validFinal, tags: ['gamedev', 'Game Dev'] })).toEqual([['tags', 1]]);
    expect(issuePaths({ ...validFinal, tags: ['gamedev', 'gamedev'] })).toEqual([['tags', 1]]);
  });

  it('rejects a status that is not in the lifecycle', () => {
    expect(issuePaths({ ...validFinal, status: 'published' })).toEqual([['status']]);
  });

  it('rejects a publishedAt that is not a calendar date and a non-https cover image', () => {
    expect(issuePaths({ ...validFinal, publishedAt: '2026-13-01' })).toEqual([['publishedAt']]);
    expect(issuePaths({ ...validFinal, coverImage: 'http://example.com/cover.png' })).toEqual([
      ['coverImage'],
    ]);
  });
});
