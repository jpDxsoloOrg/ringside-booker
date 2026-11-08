/**
 * @vitest-environment node
 *
 * Checks the office kit's stylesheets (KpiCard, DeltaChip, Sparkline, AlignmentChip, ChampionCard
 * and the DataTable stat-table look) against the office register in
 * docs/design/visual-identity.md: semantic tokens only, calm shapes (rounded cards, no skew, no
 * glow, nothing looping but a loading skeleton), Barlow Condensed tabular numbers, and the phone
 * layouts the kit promises (KPI cards 2-up, champion cards in a swipe row).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OFFICE_STYLESHEETS = [
  'KpiCard/KpiCard.module.css',
  'DeltaChip/DeltaChip.module.css',
  'Sparkline/Sparkline.module.css',
  'AlignmentChip/AlignmentChip.module.css',
  'ChampionCard/ChampionCard.module.css',
  'DataTable/DataTable.module.css',
] as const;

const MOBILE = '@media (--bp-mobile)';

function readStylesheet(relativePath: string): string {
  return readFileSync(new URL(`./${relativePath}`, import.meta.url), 'utf8');
}

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The declarations of the first rule whose selector is exactly `selector`, inside `atRule` or not. */
function ruleBody(css: string, selector: string, atRule?: string): string | undefined {
  let source = withoutComments(css);
  if (atRule !== undefined) {
    const start = source.indexOf(`${atRule} {`);
    if (start === -1) return undefined;
    source = source.slice(start + atRule.length + 2);
  }
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  return match?.[1];
}

function declaration(
  css: string,
  selector: string,
  property: string,
  atRule?: string,
): string | undefined {
  const body = ruleBody(css, selector, atRule);
  if (body === undefined) return undefined;
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body);
  return match?.[1]?.trim().replace(/\s+/g, ' ');
}

describe.each(OFFICE_STYLESHEETS)('%s', (relativePath) => {
  const css = readStylesheet(relativePath);
  const code = withoutComments(css);

  it('uses semantic tokens, never palette tokens or raw hex colours', () => {
    expect(code).not.toMatch(/--palette-/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('stays calm: no skew and no glow', () => {
    expect(code).not.toMatch(/skew/);
    expect(code).not.toMatch(/--glow-/);
  });

  it('stops any looping animation (only the loading skeleton has one) under reduced motion', () => {
    if (!code.includes('infinite')) return;
    expect(code).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*[^{]+\{\s*animation: none;/,
    );
  });
});

describe('KpiCard styles', () => {
  const css = readStylesheet('KpiCard/KpiCard.module.css');

  it('is a rounded office card on the surface with a hairline', () => {
    expect(declaration(css, '.kpiCard', 'border-radius')).toBe('var(--radius-card)');
    expect(declaration(css, '.kpiCard', 'border')).toBe('1px solid var(--color-border)');
    expect(declaration(css, '.kpiCard', 'background')).toBe('var(--color-surface)');
  });

  it('sets the label in condensed capitals', () => {
    expect(declaration(css, '.label', 'font-family')).toBe('var(--font-family-display)');
    expect(declaration(css, '.label', 'text-transform')).toBe('uppercase');
  });

  it('sets the big number in Barlow Condensed with tabular figures', () => {
    expect(declaration(css, '.value', 'font-family')).toBe('var(--font-family-display)');
    expect(declaration(css, '.value', 'font-variant-numeric')).toBe('var(--font-feature-tabular)');
  });

  it('lays cards out 2-up on a phone', () => {
    expect(declaration(css, '.grid', 'grid-template-columns', MOBILE)).toBe(
      'repeat(2, minmax(0, 1fr))',
    );
  });
});

describe('DeltaChip styles', () => {
  const css = readStylesheet('DeltaChip/DeltaChip.module.css');

  it('uses the delta colours, never the action red', () => {
    expect(declaration(css, '.tone-positive', 'color')).toBe('var(--color-positive)');
    expect(declaration(css, '.tone-negative', 'color')).toBe('var(--color-negative)');
    expect(withoutComments(css)).not.toMatch(/--color-action/);
  });

  it('is a pill with tabular figures', () => {
    expect(declaration(css, '.variant-chip', 'border-radius')).toBe('var(--radius-pill)');
    expect(declaration(css, '.deltaChip', 'font-variant-numeric')).toBe(
      'var(--font-feature-tabular)',
    );
  });
});

describe('AlignmentChip styles', () => {
  const css = readStylesheet('AlignmentChip/AlignmentChip.module.css');

  it.each([
    ['face', 'var(--color-face)'],
    ['heel', 'var(--color-heel)'],
    ['tweener', 'var(--color-tweener)'],
  ] as const)('draws %s in %s', (alignment, colour) => {
    expect(declaration(css, `.soft.alignment-${alignment}`, 'color')).toBe(colour);
    expect(declaration(css, `.solid.alignment-${alignment}`, 'background')).toBe(colour);
  });

  it('is a condensed uppercase pill', () => {
    expect(declaration(css, '.alignmentChip', 'border-radius')).toBe('var(--radius-pill)');
    expect(declaration(css, '.alignmentChip', 'font-family')).toBe('var(--font-family-display)');
    expect(declaration(css, '.alignmentChip', 'text-transform')).toBe('uppercase');
  });
});

describe('ChampionCard styles', () => {
  const css = readStylesheet('ChampionCard/ChampionCard.module.css');

  it('is a rounded office card', () => {
    expect(declaration(css, '.championCard', 'border-radius')).toBe('var(--radius-card)');
  });

  it('marks the title side in gold', () => {
    expect(declaration(css, '.belt', 'border')).toBe('1px solid var(--color-prestige)');
    expect(declaration(css, '.prestige', 'color')).toBe('var(--color-prestige)');
    expect(declaration(css, '.holderName', 'color')).toBe('var(--color-prestige)');
  });

  it('becomes a horizontal swipe row that snaps on a phone', () => {
    expect(declaration(css, '.list', 'overflow-x', MOBILE)).toBe('auto');
    expect(declaration(css, '.list', 'scroll-snap-type', MOBILE)).toBe('x mandatory');
    expect(declaration(css, '.listItems', 'display', MOBILE)).toBe('flex');
    expect(declaration(css, '.listItem', 'scroll-snap-align', MOBILE)).toBe('start');
  });
});

describe('DataTable stat-table styles', () => {
  const css = readStylesheet('DataTable/DataTable.module.css');

  it('sets headers in condensed capitals over a strong hairline', () => {
    expect(declaration(css, '.table th', 'font-family')).toBe('var(--font-family-display)');
    expect(declaration(css, '.table th', 'text-transform')).toBe('uppercase');
    expect(declaration(css, '.table th', 'border-block-end-color')).toBe(
      'var(--color-border-strong)',
    );
  });

  it('lifts a hovered row to the hover surface', () => {
    expect(declaration(css, '.row:hover td', 'background', '@media (hover: hover)')).toBe(
      'var(--color-surface-hover)',
    );
  });

  it('draws zebra rows one surface step up', () => {
    expect(declaration(css, '.rowStriped td', 'background')).toBe('var(--color-surface-raised)');
  });
});
