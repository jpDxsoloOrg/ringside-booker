/**
 * @vitest-environment node
 *
 * Contrast check for the shipped theme. Reads tokens.css, resolves each semantic colour to its
 * palette hex, checks the roles against docs/design/visual-identity.md, and checks the WCAG 2
 * contrast ratio of the pairs the UI relies on. Semantic tokens are
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

/** The show importance colours, lowest importance first. */
const IMPORTANCE_COLOUR_TOKENS = [
  '--color-importance-house',
  '--color-importance-minor',
  '--color-importance-regular',
  '--color-importance-major',
  '--color-importance-flagship',
];

/** `foreground` laid over `background` at `opacity`, as an opaque hex: what a tint looks like. */
function blendOver(foregroundHex: string, backgroundHex: string, opacity: number): string {
  const channel = (hex: string, start: number): number =>
    Number.parseInt(hex.slice(start, start + 2), 16);
  return `#${[1, 3, 5]
    .map((start) =>
      Math.round(
        channel(foregroundHex, start) * opacity + channel(backgroundHex, start) * (1 - opacity),
      )
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * Every semantic colour role from docs/design/visual-identity.md, then the older names that are
 * mapped onto those roles so existing components keep working.
 */
const SEMANTIC_COLOUR_TOKENS = [
  '--color-bg',
  '--color-surface',
  '--color-surface-raised',
  '--color-surface-hover',
  '--color-border',
  '--color-border-strong',
  '--color-text',
  '--color-text-muted',
  '--color-text-subtle',
  '--color-action',
  '--color-action-contrast',
  '--color-action-bright',
  '--color-data',
  '--color-prestige',
  '--color-positive',
  '--color-negative',
  '--color-face',
  '--color-heel',
  '--color-tweener',
  '--color-side-neutral',
  '--color-surface-sunken',
  '--color-text-inverse',
  '--color-accent',
  '--color-accent-contrast',
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
  ...IMPORTANCE_COLOUR_TOKENS,
];

/** The hex values visual-identity.md gives each role. tokens.css must match them exactly. */
const VISUAL_IDENTITY_ROLES: Readonly<Record<string, string>> = {
  '--color-bg': '#090d16',
  '--color-surface': '#0f172a',
  '--color-surface-raised': '#131d31',
  '--color-surface-hover': '#1a2740',
  '--color-border': '#24334d',
  '--color-border-strong': '#3b4d6b',
  '--color-text': '#f1f5f9',
  '--color-text-muted': '#94a3b8',
  '--color-text-subtle': '#64748b',
  '--color-action': '#d7301a',
  '--color-action-bright': '#ff3b1d',
  '--color-data': '#00e5ff',
  '--color-prestige': '#facc15',
  '--color-positive': '#34d399',
  '--color-negative': '#fb7185',
  '--color-face': '#00e5ff',
  '--color-heel': '#ff3b1d',
  '--color-tweener': '#a78bfa',
};

/** Older names and the role each one now follows. */
const MAPPED_LEGACY_TOKENS: Readonly<Record<string, string>> = {
  '--color-accent': '--color-action-bright',
  '--color-surface-sunken': '--color-bg',
  '--color-info': '--color-data',
  '--color-warning': '--color-prestige',
  '--color-focus': '--color-data',
};

/**
 * Colours that are read as text. Body text and every accent role used for words or numbers
 * (deltas, alignment chips, prestige, data, live labels) meet WCAG AA for normal text.
 */
const NORMAL_TEXT_ROLES = [
  '--color-text',
  '--color-text-muted',
  '--color-action-bright',
  '--color-data',
  '--color-prestige',
  '--color-positive',
  '--color-negative',
  '--color-face',
  '--color-heel',
  '--color-tweener',
  '--color-side-neutral',
  '--color-accent',
  '--color-warning',
  '--color-info',
];

/** The two backgrounds text sits on most: the canvas and the raised surface. */
const TEXT_BACKGROUNDS = ['--color-bg', '--color-surface', '--color-surface-raised'];

interface ContrastRequirement {
  readonly foreground: string;
  readonly background: string;
  readonly minimum: number;
}

const CONTRAST_REQUIREMENTS: readonly ContrastRequirement[] = [
  // Text roles: WCAG AA for normal text on the canvas and on panels.
  ...NORMAL_TEXT_ROLES.flatMap((foreground) =>
    TEXT_BACKGROUNDS.map((background) => ({ foreground, background, minimum: 4.5 })),
  ),
  // Subtle text is for large or decorative text only, so it meets AA for large text.
  ...TEXT_BACKGROUNDS.map((background) => ({
    foreground: '--color-text-subtle',
    background,
    minimum: 3,
  })),
  // Primary buttons: white text on the action fill.
  { foreground: '--color-action-contrast', background: '--color-action', minimum: 4.5 },
  { foreground: '--color-accent-contrast', background: '--color-accent', minimum: 4.5 },
  // Tooltips: inverse text on a --color-text background.
  { foreground: '--color-text-inverse', background: '--color-text', minimum: 4.5 },
  // Dark ink on the bright fills: prestige and danger buttons, solid data, prestige, positive and
  // negative badges.
  ...['--color-data', '--color-prestige', '--color-positive', '--color-negative'].map(
    (background) => ({ foreground: '--color-text-inverse', background, minimum: 4.5 }),
  ),
  // Keyboard focus ring: WCAG AA for UI parts, on the canvas and on both panel surfaces.
  { foreground: '--color-focus', background: '--color-bg', minimum: 3 },
  { foreground: '--color-focus', background: '--color-surface', minimum: 3 },
  { foreground: '--color-focus', background: '--color-surface-raised', minimum: 3 },
  // Placeholder art: initials and monograms sit on a category colour and get small at the xs and
  // sm image sizes, so they meet AA for normal text.
  ...Array.from({ length: 8 }, (_, index) => ({
    foreground: '--color-text-inverse',
    background: `--color-cat-${String(index + 1)}`,
    minimum: 4.5,
  })),
  // Ringed initials (the default person placeholder): the category colour as lettering on the
  // raised surface, AA for normal text since the initials get small at the xs and sm sizes.
  ...Array.from({ length: 8 }, (_, index) => ({
    foreground: `--color-cat-${String(index + 1)}`,
    background: '--color-surface-raised',
    minimum: 4.5,
  })),
  // Solid alignment chips: dark ink on the face, heel and tweener fills.
  ...['--color-face', '--color-heel', '--color-tweener'].map((background) => ({
    foreground: '--color-text-inverse',
    background,
    minimum: 4.5,
  })),
  // Show importance: the bar on a calendar chip is a UI part on a panel or a popover.
  ...IMPORTANCE_COLOUR_TOKENS.flatMap((foreground) =>
    ['--color-surface', '--color-surface-raised'].map((background) => ({
      foreground,
      background,
      minimum: 3,
    })),
  ),
  // Engraved initials on a belt plate, for every metal tier.
  ...['gold', 'silver', 'bronze', 'plain'].map((tier) => ({
    foreground: '--color-metal-ink',
    background: `--color-metal-${tier}`,
    minimum: 4.5,
  })),
];

const blocks = parseBlocks(tokensCss);
const palette = findBlock(blocks, ':root').declarations;
const darkBlock = findBlock(blocks, ":root, [data-theme='dark']");

/** Only dark ships for now (D-11). A light theme adds its own entry here. */
const themes = [
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
  it('makes dark the default on :root and sets color-scheme so native controls match', () => {
    expect(darkBlock.declarations.get('color-scheme')).toBe('dark');
  });

  it('ships no light or OS-dependent theme while the game is dark only', () => {
    const themeSelectors = blocks
      .filter((block) => block.selector.includes('[data-theme='))
      .map((block) => block.selector);
    expect(themeSelectors).toEqual([":root, [data-theme='dark']"]);
    expect(blocks.filter((block) => block.atRules.length > 0)).toEqual([]);
  });

  it('keeps palette tokens out of the theme blocks', () => {
    const paletteNames = [...darkBlock.declarations.keys()].filter((name) =>
      name.startsWith('--palette-'),
    );
    expect(paletteNames).toEqual([]);
  });

  it('defines the shape and glow tokens', () => {
    expect(palette.get('--radius-card')).toBe('10px');
    expect(palette.get('--radius-control')).toBe('8px');
    expect(palette.get('--radius-pill')).toBe('999px');
    expect(palette.get('--skew-broadcast')).toBe('-12deg');
    expect(palette.get('--chamfer')).toBe('8px');
    expect(darkBlock.declarations.get('--glow-action')).toMatch(/#ff3b1d/);
    expect(darkBlock.declarations.get('--glow-data')).toMatch(/#00e5ff/);
  });

  it('names Barlow Condensed for display and Inter for the interface', () => {
    expect(palette.get('--font-family-display')).toMatch(/^'Barlow Condensed',/);
    expect(palette.get('--font-family-ui')).toMatch(/^'Inter',/);
    expect(palette.get('--font-feature-tabular')).toBe('tabular-nums');
  });
});

describe.each(themes)('$name theme', ({ tokens }) => {
  it.each(SEMANTIC_COLOUR_TOKENS)('defines %s as a hex colour', (name) => {
    expect(resolveColour(tokens, name)).toMatch(HEX_COLOUR);
  });

  it.each(Object.entries(VISUAL_IDENTITY_ROLES))('sets %s to %s', (name, hex) => {
    expect(resolveColour(tokens, name)).toBe(hex);
  });

  it.each(Object.entries(MAPPED_LEGACY_TOKENS))('maps %s onto %s', (legacyName, roleName) => {
    expect(resolveColour(tokens, legacyName)).toBe(resolveColour(tokens, roleName));
  });

  it('puts white text on the action fill', () => {
    expect(resolveColour(tokens, '--color-action-contrast')).toBe('#ffffff');
  });

  it('aliases every importance colour to an existing palette step', () => {
    expect(IMPORTANCE_COLOUR_TOKENS.map((name) => resolveColour(tokens, name))).toEqual([
      resolveColour(tokens, '--palette-navy-400'),
      resolveColour(tokens, '--palette-teal-400'),
      resolveColour(tokens, '--palette-sky-400'),
      resolveColour(tokens, '--palette-orange-400'),
      resolveColour(tokens, '--color-prestige'),
    ]);
  });

  // A calendar chip's name and tag are normal-size text on the importance colour laid over the
  // surface at the tint opacity, on a panel and inside a popover.
  describe.each(IMPORTANCE_COLOUR_TOKENS)('text on the %s tint', (importance) => {
    it.each(
      ['--color-surface', '--color-surface-raised'].flatMap((surface) =>
        ['--color-text', '--color-text-muted'].map((text) => ({ surface, text })),
      ),
    )('$text over $surface has contrast of at least 4.5', ({ surface, text }) => {
      const opacity = Number(tokens.get('--opacity-importance-tint'));
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThanOrEqual(0.25);
      const tint = blendOver(
        resolveColour(tokens, importance),
        resolveColour(tokens, surface),
        opacity,
      );
      expect(contrastRatio(resolveColour(tokens, text), tint)).toBeGreaterThanOrEqual(4.5);
    });
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
