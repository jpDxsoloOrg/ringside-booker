/**
 * @vitest-environment node
 *
 * Checks the broadcast kit's stylesheets against the visual identity rules in one place: colours
 * come from semantic tokens only, every transition runs on a motion token (which reduced motion
 * sets to 0ms), and every looping animation is switched off under reduced motion, both from the
 * OS setting and from the in-game one.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BROADCAST_STYLESHEETS = [
  'LiveBugButton/LiveBugButton.module.css',
  'LowerThird/LowerThird.module.css',
  'ScoreBug/ScoreBug.module.css',
  'Ticker/Ticker.module.css',
  'SegmentedMeter/SegmentedMeter.module.css',
  'CardSlot/CardSlot.module.css',
  'ChamferPanel/ChamferPanel.module.css',
  'SlashDivider/SlashDivider.module.css',
] as const;

function readStylesheet(relativePath: string): string {
  return readFileSync(new URL(`./${relativePath}`, import.meta.url), 'utf8');
}

/** Declarations of one property, comments stripped. */
function declarations(css: string, property: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern = new RegExp(`(?:^|[\\s;{])${property}\\s*:([^;}]*)`, 'g');
  return Array.from(withoutComments.matchAll(pattern), (match) => (match[1] ?? '').trim());
}

describe.each(BROADCAST_STYLESHEETS)('%s', (relativePath) => {
  const css = readStylesheet(relativePath);

  it('uses semantic tokens, never palette tokens or raw hex colours', () => {
    expect(css).not.toMatch(/--palette-/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('times every transition with a motion token', () => {
    for (const transition of declarations(css, 'transition')) {
      expect(transition).toMatch(/var\(--motion-(fast|base)\)/);
    }
  });

  it('stops every looping animation under reduced motion', () => {
    const loops = declarations(css, 'animation').filter((value) => value.includes('infinite'));
    if (loops.length === 0) return;

    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*:global\(:root:not\(\[data-reduced-motion='off'\]\)\) [^{]+\{\s*animation: none;/,
    );
    expect(css).toMatch(/:global\(\[data-reduced-motion='on'\]\) [^{]+\{\s*animation: none;/);
  });
});
