/**
 * @vitest-environment node
 *
 * Reduced motion across every stylesheet in the app, not only the broadcast kit. The motion tokens
 * drop to 0ms under reduced motion (global.css), so a transition or a one-off entry animation
 * timed with a token stops by itself. A looping animation does not: it needs its own rules that
 * switch it off, both for the OS setting (unless the player turned motion back on) and for the
 * in-game setting. A stylesheet that times motion any other way fails here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(import.meta.dirname, '..');

function listStylesheets(directory: string): string[] {
  const stylesheets: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) stylesheets.push(...listStylesheets(path));
    else if (entry.name.endsWith('.css')) stylesheets.push(path);
  }
  return stylesheets;
}

interface Stylesheet {
  readonly name: string;
  readonly css: string;
}

const stylesheets: readonly Stylesheet[] = listStylesheets(SOURCE_ROOT).map((path) => ({
  name: relative(SOURCE_ROOT, path),
  // Comments mention durations and animations in prose; only declarations count.
  css: readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
}));

/** Every value of `property` in the stylesheet, with whitespace collapsed. */
function declarationValues(css: string, property: string): string[] {
  const pattern = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;}]+)`, 'g');
  return Array.from(css.matchAll(pattern), (match) => (match[1] ?? '').replace(/\s+/g, ' ').trim());
}

/** A literal time such as `1.2s` or `800ms`, which reduced motion cannot reach. */
const LITERAL_TIME = /(?:^|[\s,(])\d*\.?\d+m?s\b/;

/** The rule that stops a looping animation under the OS setting, unless motion was turned back on. */
const OS_REDUCED_RULE =
  /@media \(prefers-reduced-motion: reduce\) \{\s*:global\(:root:not\(\[data-reduced-motion='off'\]\)\) [^{]+\{\s*animation: none;/;

/** The rule that stops it under the in-game setting. */
const SETTING_REDUCED_RULE = /:global\(\[data-reduced-motion='on'\]\) [^{]+\{\s*animation: none;/;

describe('motion in every stylesheet', () => {
  it('finds the stylesheets', () => {
    expect(stylesheets.length).toBeGreaterThan(20);
  });

  it.each(stylesheets)('$name times its transitions with motion tokens', ({ css }) => {
    for (const value of declarationValues(css, 'transition')) {
      expect(value, 'transition').not.toMatch(LITERAL_TIME);
      expect(value, 'transition').toMatch(/var\(--motion-/);
    }
    for (const value of declarationValues(css, 'transition-duration')) {
      expect(value, 'transition-duration').toMatch(/^var\(--motion-[a-z]+\)$/);
    }
  });

  it.each(stylesheets)(
    '$name stops each looping animation under reduced motion and times the rest with tokens',
    ({ css }) => {
      const animations = declarationValues(css, 'animation').filter((value) => value !== 'none');
      const looping = animations.filter((value) => /\binfinite\b/.test(value));
      for (const value of animations) {
        if (!looping.includes(value)) {
          expect(value, 'a one-off animation').toMatch(/var\(--motion-/);
        }
      }
      if (looping.length > 0) {
        expect(css, 'OS reduced-motion rule').toMatch(OS_REDUCED_RULE);
        expect(css, 'in-game reduced-motion rule').toMatch(SETTING_REDUCED_RULE);
      }
    },
  );
});
