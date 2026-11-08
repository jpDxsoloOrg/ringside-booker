import { describe, expect, it } from 'vitest';

import { readBlogConfig } from '../src/config';
import { BlogConfigError } from '../src/errors';

describe('readBlogConfig', () => {
  it('returns the documented defaults when nothing is set', () => {
    expect(readBlogConfig({})).toEqual({
      siteUrl: null,
      repoUrl: 'https://github.com/jpDxsoloOrg/ringside-booker',
      repoBranch: 'main',
      assetBaseUrl:
        'https://raw.githubusercontent.com/jpDxsoloOrg/ringside-booker/main/docs/blog/images',
    });
  });

  it('treats empty variables as unset', () => {
    expect(readBlogConfig({ BLOG_SITE_URL: '', BLOG_REPO_BRANCH: ' ' }).repoBranch).toBe('main');
  });

  it('fails on a non-URL BLOG_ASSET_BASE_URL and names the variable', () => {
    const read = () => readBlogConfig({ BLOG_ASSET_BASE_URL: 'not a url' });
    expect(read).toThrow(BlogConfigError);
    expect(read).toThrow(/BLOG_ASSET_BASE_URL/);
  });

  it('trims trailing slashes', () => {
    const config = readBlogConfig({
      BLOG_SITE_URL: 'https://blog.example.com/',
      BLOG_REPO_URL: 'https://github.com/example/fork/',
      BLOG_REPO_BRANCH: 'feat/blog-04',
      BLOG_ASSET_BASE_URL: 'https://cdn.example.com/images//',
    });
    expect(config).toEqual({
      siteUrl: 'https://blog.example.com',
      repoUrl: 'https://github.com/example/fork',
      repoBranch: 'feat/blog-04',
      assetBaseUrl: 'https://cdn.example.com/images',
    });
  });
});
