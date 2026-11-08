/**
 * @vitest-environment node
 *
 * Contrast check for both themes. Reads tokens.css, resolves each semantic colour to its palette
 * hex, and checks the WCAG 2 contrast ratio of the pairs the UI relies on. Semantic tokens are
 * plain hex or var() references to hex palette entries on purpose, so a small parser is enough.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokensCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

interface CssBlock {
  /** Enclosing at-rule preludes, outermost first, for example `['@media (...)']`. */
  readonly atRules: readonly string[];
  readonly selector: string;
  readonly declarations: ReadonlyMap<string, string>;
}

function parseDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const statement of body.split(';')) {
    const colonIndex = statement.indexOf(':');
    if (colonIndex === -1) continue;
    const property = statement.slice(0, colonIndex).trim();
    const value = statement.slice(colonIndex + 1).trim();
    if (property !== '') declarations.set(property, value.replace(/\s+/g, ' '));
  }
  return declarations;
}

/** Style rules with their declarations and the at-rules they sit in. No nesting inside rules. */
function parseBlocks(css: string): CssBlock[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: CssBlock[] = [];
  const preludes: string[] = [];
  let buffer = '';
  for (const character of source) {
    if (character === '{') {
      preludes.push(buffer.trim().replace(/\s+/g, ' '));
      buffer = '';
    } else if (character === '}') {
      const prelude = preludes.pop();
      if (prelude === undefined) throw new Error('tokens.css has an unmatched closing brace');
      if (!prelude.startsWith('@')) {
        blocks.push({
          atRules: [...preludes],
          selector: prelude,
          declarations: parseDeclarations(buffer),
        });
      }
      buffer = '';
    } else {
      buffer += character;
    }
  }
  if (preludes.length > 0) throw new Error('tokens.css has an unclosed block');
  return blocks;
}

function findBlock(blocks: readonly CssBlock[], selector: string, atRule?: string): CssBlock {
  const block = blocks.find(
    (candidate) =>
      candidate.selector === selector &&
      (atRule === undefined
        ? candidate.atRules.length === 0
        : candidate.atRules.length === 1 && candidate.atRules[0] === atRule),
  );
  if (block === undefined) {
    throw new Error(`tokens.css has no "${selector}" block${atRule ? ` inside ${atRule}` : ''}`);
  }
  return block;
}

const HEX_COLOUR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const VAR_REFERENCE = /^var\((--[\w-]+)\)$/;

/** Follows var() references until a hex literal. */
function resolveColour(tokens: ReadonlyMap<string, string>, name: string): string {
  const seen = new Set<string>();
  let current = name;
  for (;;) {
    if (seen.has(current)) throw new Error(`${name} has a var() cycle`);
    seen.add(current);
    const value = tokens.get(current);
    if (value === undefined) throw new Error(`${current} is not defined`);
    if (HEX_COLOUR.test(value)) return value.toLowerCase();
    const reference = VAR_REFERENCE.exec(value)?.[1];
    if (reference === undefined) {
      throw new Error(`${current} is "${value}"; colour tokens must be hex or var(--palette-*)`);
    }
    current = reference;
  }
}

function channelToLinear(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of an opaque #rrggbb colour. */
function relativeLuminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`${hex} is not an opaque #rrggbb colour`);
  const red = channelToLinear(Number.parseInt(hex.slice(1, 3), 16));
  const green = channelToLinear(Number.parseInt(hex.slice(3, 5), 16));
  const blue = channelToLinear(Number.parseInt(hex.slice(5, 7), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(firstHex: string, secondHex: string): number {
  const first = relativeLuminance(firstHex);
  const second = relativeLuminance(secondHex);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const SEMANTIC_COLOUR_TOKENS = [
  '--color-bg',
  '--color-surface',
  '--color-surface-raised',
  '--color-surface-sunken',
  '--color-border',
  '--color-border-strong',
  '--color-text',
  '--color-text-muted',
  '--color-text-inverse',
  '--color-accent',
  '--color-accent-contrast',
  '--color-positive',
  '--color-negative',
  '--color-warning',
  '--color-info',
  '--color-focus',
  '--color-overlay',
  ...Array.from({ length: 8 }, (_, index) => `--color-cat-${String(index + 1)}`),
  '--color-metal-gold',
  '--color-metal-silver',
  '--color-metal-bronze',
  '--color-metal-plain',
  '--color-metal-ink',
  '--color-belt-strap',
];

interface ContrastRequirement {
  readonly foreground: string;
  readonly background: string;
  readonly minimum: number;
}

const CONTRAST_REQUIREMENTS: readonly ContrastRequirement[] = [
  // Body text: WCAG AA for normal text.
  { foreground: '--color-text', background: '--color-bg', minimum: 4.5 },
  { foreground: '--color-text', background: '--color-surface', minimum: 4.5 },
  { foreground: '--color-text', background: '--color-surface-raised', minimum: 4.5 },
  { foreground: '--color-accent-contrast', background: '--color-accent', minimum: 4.5 },
  // Status colours show up as text in tables (money up or down, warnings), so they meet AA too.
  { foreground: '--color-positive', background: '--color-surface', minimum: 4.5 },
  { foreground: '--color-negative', background: '--color-surface', minimum: 4.5 },
  { foreground: '--color-warning', background: '--color-surface', minimum: 4.5 },
  { foreground: '--color-info', background: '--color-surface', minimum: 4.5 },
  // Secondary text, focus ring and strong borders: WCAG AA for large text and UI parts.
  { foreground: '--color-text-muted', background: '--color-surface', minimum: 3 },
  { foreground: '--color-focus', background: '--color-bg', minimum: 3 },
  { foreground: '--color-border-strong', background: '--color-surface', minimum: 3 },
  // Placeholder art: initials and monograms sit on a category colour and get small at the xs and
  // sm image sizes, so they meet AA for normal text.
  ...Array.from({ length: 8 }, (_, index) => ({
    foreground: '--color-text-inverse',
    background: `--color-cat-${String(index + 1)}`,
    minimum: 4.5,
  })),
  // Engraved initials on a belt plate, for every metal tier.
  ...['gold', 'silver', 'bronze', 'plain'].map((tier) => ({
    foreground: '--color-metal-ink',
    background: `--color-metal-${tier}`,
    minimum: 4.5,
  })),
];

const blocks = parseBlocks(tokensCss);
const palette = findBlock(blocks, ':root').declarations;
const lightBlock = findBlock(blocks, ":root, [data-theme='light']");
const darkBlock = findBlock(blocks, "[data-theme='dark']");
const systemDarkBlock = findBlock(
  blocks,
  ":root:not([data-theme='light'])",
  '@media (prefers-color-scheme: dark)',
);

const themes = [
  { name: 'light', tokens: new Map([...palette, ...lightBlock.declarations]) },
  { name: 'dark', tokens: new Map([...palette, ...darkBlock.declarations]) },
] as const;

describe('token parser', () => {
  it('resolves a semantic token through the palette', () => {
    const tokens = new Map([
      ['--palette-x', '#ABCDEF'],
      ['--color-y', 'var(--palette-x)'],
    ]);
    expect(resolveColour(tokens, '--color-y')).toBe('#abcdef');
  });

  it('computes the WCAG ratio of black on white as 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('rejects colour maths that the parser cannot check', () => {
    const tokens = new Map([['--color-y', 'color-mix(in srgb, red, blue)']]);
    expect(() => resolveColour(tokens, '--color-y')).toThrow(/must be hex/);
  });
});

describe('theme blocks', () => {
  it('sets color-scheme so native controls match', () => {
    expect(lightBlock.declarations.get('color-scheme')).toBe('light');
    expect(darkBlock.declarations.get('color-scheme')).toBe('dark');
    expect(systemDarkBlock.declarations.get('color-scheme')).toBe('dark');
  });

  it('keeps the system dark block identical to the data-theme dark block', () => {
    expect([...systemDarkBlock.declarations]).toEqual([...darkBlock.declarations]);
  });

  it('keeps palette tokens out of the theme blocks', () => {
    for (const block of [lightBlock, darkBlock]) {
      const paletteNames = [...block.declarations.keys()].filter((name) =>
        name.startsWith('--palette-'),
      );
      expect(paletteNames).toEqual([]);
    }
  });
});

describe.each(themes)('$name theme', ({ tokens }) => {
  it.each(SEMANTIC_COLOUR_TOKENS)('defines %s as a hex colour', (name) => {
    expect(resolveColour(tokens, name)).toMatch(HEX_COLOUR);
  });

  it.each(CONTRAST_REQUIREMENTS)(
    '$foreground on $background has contrast of at least $minimum',
    ({ foreground, background, minimum }) => {
      const ratio = contrastRatio(
        resolveColour(tokens, foreground),
        resolveColour(tokens, background),
      );
      expect(ratio).toBeGreaterThanOrEqual(minimum);
    },
  );
});
