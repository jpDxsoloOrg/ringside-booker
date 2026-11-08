import { describe, expect, it } from 'vitest';

import { BlogFormatError, BlogFrontmatterError } from '../src/errors';
import { listPosts, loadPost, splitFrontmatter } from '../src/load';
import { catchError, fixturePath } from './helpers';

describe('splitFrontmatter', () => {
  it('splits the YAML block from the body', () => {
    const split = splitFrontmatter('---\ntitle: Hello\ntags: [one]\n---\n\nBody text.\n');
    expect(split).toEqual({ data: { title: 'Hello', tags: ['one'] }, body: '\nBody text.\n' });
  });

  it('accepts Windows line endings', () => {
    expect(splitFrontmatter('---\r\ntitle: Hello\r\n---\r\nBody').data).toEqual({ title: 'Hello' });
  });

  it('throws BlogFormatError on line 1 when the block is missing', () => {
    expect(() => splitFrontmatter('## Heading\n')).toThrow(BlogFormatError);
    expect(() => splitFrontmatter('## Heading\n')).toThrow(/line 1/);
  });

  it('throws BlogFormatError on line 1 when the block is never closed', () => {
    expect(() => splitFrontmatter('---\ntitle: Hello\n\nBody\n')).toThrow(/line 1/);
  });

  it('reports the file line of a YAML error', () => {
    const error = catchError(
      () => splitFrontmatter('---\ntitle: Hello\ntags: [one\n---\n'),
      BlogFormatError,
    );
    expect(error.line).toBeGreaterThanOrEqual(3);
  });
});

describe('loadPost', () => {
  it('loads a post with its file name, part and validated frontmatter', async () => {
    const post = await loadPost(fixturePath('posts/02-foundations.md'));
    expect(post.fileName).toBe('02-foundations.md');
    expect(post.partFromFileName).toBe(2);
    expect(post.frontmatter.slug).toBe('ringside-booker-02-foundations');
    expect(post.body.startsWith('\n## Opening')).toBe(true);
  });

  it('throws BlogFormatError naming line 1 when the closing --- is missing', async () => {
    const path = fixturePath('broken/unterminated.md');
    await expect(loadPost(path)).rejects.toThrow(BlogFormatError);
    await expect(loadPost(path)).rejects.toThrow(/unterminated\.md:1: .*line 1/);
  });

  it('throws BlogFormatError when there is no frontmatter', async () => {
    await expect(loadPost(fixturePath('broken/no-frontmatter.md'))).rejects.toThrow(
      BlogFormatError,
    );
  });

  it('throws BlogFormatError for invalid YAML', async () => {
    await expect(loadPost(fixturePath('broken/bad-yaml.md'))).rejects.toThrow(/invalid YAML/);
  });

  it('throws BlogFrontmatterError listing every schema problem', async () => {
    const loading = loadPost(fixturePath('broken/bad-schema.md'));
    await expect(loading).rejects.toBeInstanceOf(BlogFrontmatterError);
    await expect(loading).rejects.toThrow(/slug/);
    await expect(loading).rejects.toThrow(/author/);
  });
});

describe('listPosts', () => {
  it('returns only NN-name.md files, sorted, skipping templates, the README and other files', async () => {
    const posts = await listPosts(fixturePath('list'));
    expect(posts).toEqual([fixturePath('list/01-a.md'), fixturePath('list/02-b.md')]);
  });
});
