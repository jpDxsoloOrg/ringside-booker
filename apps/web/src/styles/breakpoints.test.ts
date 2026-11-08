/**
 * @vitest-environment node
 *
 * breakpoints.css is the source of truth for the layout breakpoints; breakpoints.ts mirrors it for
 * script. This test reads the CSS and fails if the two disagree, so they cannot drift apart.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BP_MOBILE_QUERY, BP_WIDE_QUERY } from './breakpoints';

const breakpointsCss = readFileSync(new URL('./breakpoints.css', import.meta.url), 'utf8');

/** Every `@custom-media --name (query);` in the file, as name → query. */
function readCustomMedia(css: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const customMedia = new Map<string, string>();
  for (const match of withoutComments.matchAll(/@custom-media\s+(--[\w-]+)\s+([^;]+);/g)) {
    const [, name, query] = match;
    if (name !== undefined && query !== undefined) customMedia.set(name, query.trim());
  }
  return customMedia;
}

describe('breakpoints', () => {
  const customMedia = readCustomMedia(breakpointsCss);

  it('defines exactly the mobile and wide custom media', () => {
    expect([...customMedia.keys()].sort()).toEqual(['--bp-mobile', '--bp-wide']);
  });

  it('keeps BP_MOBILE_QUERY equal to --bp-mobile', () => {
    expect(customMedia.get('--bp-mobile')).toBe(BP_MOBILE_QUERY);
  });

  it('keeps BP_WIDE_QUERY equal to --bp-wide', () => {
    expect(customMedia.get('--bp-wide')).toBe(BP_WIDE_QUERY);
  });

  it('reads a query body the way the drift check needs', () => {
    const drifted = readCustomMedia('@custom-media --bp-mobile (width < 40rem);');
    expect(drifted.get('--bp-mobile')).not.toBe(BP_MOBILE_QUERY);
  });
});
