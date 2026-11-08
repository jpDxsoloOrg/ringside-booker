/**
 * @vitest-environment node
 *
 * The look of the primitives (Button, Panel, Badge, StatBar, EmptyState) lives in their CSS
 * Modules, which jsdom never applies. These checks read the stylesheets and pin the rules that
 * carry the visual identity (docs/design/visual-identity.md): which colour role each variant
 * fills with, the 44px touch target at phone width, the office and broadcast panel shapes, the
 * display face and tabular numbers. A restyle that drifts from the identity fails here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUTTON_VARIANTS } from './Button';
import { ROLE_TONES } from './tone';

interface CssRule {
  /** Enclosing at-rule preludes, outermost first, for example `['@media (--bp-mobile)']`. */
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

/** Style rules with their declarations and the at-rules around them. No nesting inside rules. */
function parseRules(css: string): CssRule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const preludes: string[] = [];
  let buffer = '';
  for (const character of source) {
    if (character === '{') {
      preludes.push(buffer.trim().replace(/\s+/g, ' '));
      buffer = '';
    } else if (character === '}') {
      const prelude = preludes.pop();
      if (prelude === undefined) throw new Error('unmatched closing brace');
      if (!prelude.startsWith('@')) {
        rules.push({
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
  return rules;
}

function readRules(relativePath: string): CssRule[] {
  return parseRules(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

/** The value of `property` in the rule for exactly `selector` (optionally inside `atRule`). */
function declaration(
  rules: readonly CssRule[],
  selector: string,
  property: string,
  atRule?: string,
): string | undefined {
  const rule = rules.find(
    (candidate) =>
      candidate.selector === selector &&
      (atRule === undefined ? candidate.atRules.length === 0 : candidate.atRules.includes(atRule)),
  );
  return rule?.declarations.get(property);
}

const MOBILE = '@media (--bp-mobile)';
const COARSE_POINTER = '@media (pointer: coarse)';

describe('Button styles', () => {
  const rules = readRules('./Button/Button.module.css');

  it('sets labels in the condensed display face, uppercase', () => {
    expect(declaration(rules, '.button', 'font-family')).toBe('var(--font-family-display)');
    expect(declaration(rules, '.button', 'text-transform')).toBe('uppercase');
    expect(declaration(rules, '.button', 'border-radius')).toBe('var(--radius-control)');
  });

  it.each([
    ['primary', 'background', 'var(--color-action)'],
    ['primary', 'color', 'var(--color-action-contrast)'],
    ['secondary', 'border-color', 'var(--color-data)'],
    ['secondary', 'color', 'var(--color-data)'],
    ['prestige', 'background', 'var(--color-prestige)'],
    ['prestige', 'color', 'var(--color-text-inverse)'],
    ['ghost', 'background', 'transparent'],
    ['danger', 'background', 'var(--color-negative)'],
    ['danger', 'color', 'var(--color-text-inverse)'],
  ] as const)('draws %s with %s %s', (variant, property, value) => {
    expect(declaration(rules, `.variant-${variant}`, property)).toBe(value);
  });

  it('styles every variant the component offers', () => {
    for (const variant of BUTTON_VARIANTS) {
      expect(
        rules.some((rule) => rule.selector === `.variant-${variant}`),
        variant,
      ).toBe(true);
    }
  });

  it('draws a visible cyan focus ring off the button', () => {
    expect(declaration(rules, '.button:focus-visible', 'outline')).toBe(
      '2px solid var(--color-focus)',
    );
    expect(declaration(rules, '.button:focus-visible', 'outline-offset')).toBe('2px');
  });

  it.each([MOBILE, COARSE_POINTER])('meets the 44px touch target under %s', (atRule) => {
    expect(declaration(rules, '.button', 'min-block-size', atRule)).toBe('var(--tap-target-min)');
    expect(declaration(rules, '.iconOnly, .iconOnly.size-sm', 'min-inline-size', atRule)).toBe(
      'var(--tap-target-min)',
    );
  });
});

describe('Panel styles', () => {
  const rules = readRules('./Panel/Panel.module.css');

  it('is an office card by default: card radius and a hairline, no shadow', () => {
    expect(declaration(rules, '.panel', 'border-radius')).toBe('var(--radius-card)');
    expect(declaration(rules, '.panel', 'border')).toBe('1px solid var(--color-border)');
    expect(declaration(rules, '.panel', 'box-shadow')).toBeUndefined();
  });

  it('cuts the broadcast panel square with chamfered corners', () => {
    expect(declaration(rules, '.variant-broadcast', 'border-radius')).toBe('0');
    expect(declaration(rules, '.variant-broadcast', 'clip-path')).toBe('var(--panel-cut)');
    expect(declaration(rules, '.variant-broadcast', '--panel-cut')).toContain('var(--chamfer)');
    expect(declaration(rules, '.variant-broadcast::before', 'clip-path')).toBe('var(--panel-cut)');
  });

  it('puts broadcast headers behind a skewed red-orange slash', () => {
    expect(declaration(rules, '.variant-broadcast .title::before', 'background')).toBe(
      'var(--color-action-bright)',
    );
    expect(declaration(rules, '.variant-broadcast .title::before', 'transform')).toBe(
      'skewX(var(--skew-broadcast))',
    );
  });
});

describe('Badge styles', () => {
  const rules = readRules('./Badge/Badge.module.css');

  it('is a condensed uppercase pill', () => {
    expect(declaration(rules, '.badge', 'font-family')).toBe('var(--font-family-display)');
    expect(declaration(rules, '.badge', 'text-transform')).toBe('uppercase');
    expect(declaration(rules, '.badge', 'border-radius')).toBe('var(--radius-pill)');
  });

  it.each(ROLE_TONES)('has soft and solid rules for the %s role', (tone) => {
    expect(declaration(rules, `.soft.tone-${tone}`, 'color')).toBeDefined();
    expect(declaration(rules, `.solid.tone-${tone}`, 'background')).toBeDefined();
  });

  it('fills a solid action chip like the primary button: action red with white text', () => {
    expect(declaration(rules, '.solid.tone-action', 'background')).toBe('var(--color-action)');
    expect(declaration(rules, '.solid.tone-action', 'color')).toBe('var(--color-action-contrast)');
  });
});

describe('StatBar styles', () => {
  const rules = readRules('./StatBar/StatBar.module.css');

  it.each([
    ['data', 'var(--color-data)'],
    ['action', 'var(--color-action-bright)'],
    ['prestige', 'var(--color-prestige)'],
  ] as const)('fills the %s band with %s', (tone, colour) => {
    expect(declaration(rules, `.tone-${tone}`, 'fill')).toBe(colour);
  });

  it('has a fill for every role', () => {
    for (const tone of ROLE_TONES) {
      expect(declaration(rules, `.tone-${tone}`, 'fill'), tone).toBeDefined();
    }
  });

  it('shows the number in the display face with tabular figures', () => {
    expect(declaration(rules, '.value', 'font-family')).toBe('var(--font-family-display)');
    expect(declaration(rules, '.value', 'font-variant-numeric')).toBe(
      'var(--font-feature-tabular)',
    );
  });
});

describe('EmptyState styles', () => {
  const rules = readRules('./EmptyState/EmptyState.module.css');

  it('sets the heading condensed and uppercase', () => {
    expect(declaration(rules, '.title', 'font-family')).toBe('var(--font-family-display)');
    expect(declaration(rules, '.title', 'text-transform')).toBe('uppercase');
  });

  it('draws the icon in a raised tile in the data colour', () => {
    expect(declaration(rules, '.iconTile', 'background')).toBe('var(--color-surface-raised)');
    expect(declaration(rules, '.iconTile', 'color')).toBe('var(--color-data)');
  });
});
