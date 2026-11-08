/**
 * Reads the design tokens straight out of tokens.css, so the gallery shows every token that
 * exists without keeping a second list. Semantic colours are hex or var() references to hex
 * palette entries (see docs/design/ui-tokens.md), so a small parser is enough.
 */
import tokensCss from '@/styles/tokens.css?raw';
import type { EffectiveTheme } from './useThemeState';

/** One custom property as written in tokens.css. */
export interface TokenDeclaration {
  readonly name: string;
  readonly value: string;
}

interface CssRule {
  readonly atRules: readonly string[];
  readonly selector: string;
  readonly declarations: readonly TokenDeclaration[];
}

function parseDeclarations(body: string): TokenDeclaration[] {
  const declarations: TokenDeclaration[] = [];
  for (const statement of body.split(';')) {
    const colonIndex = statement.indexOf(':');
    if (colonIndex === -1) continue;
    const name = statement.slice(0, colonIndex).trim();
    const value = statement
      .slice(colonIndex + 1)
      .trim()
      .replace(/\s+/g, ' ');
    if (name.startsWith('--')) declarations.push({ name, value });
  }
  return declarations;
}

/** Style rules with their custom properties and enclosing at-rules. No nesting inside rules. */
export function parseCssRules(css: string): readonly CssRule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const preludes: string[] = [];
  let buffer = '';
  for (const character of source) {
    if (character === '{') {
      preludes.push(buffer.trim().replace(/\s+/g, ' '));
      buffer = '';
    } else if (character === '}') {
      const prelude = preludes.pop() ?? '';
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

function declarationsOf(rules: readonly CssRule[], selector: string): readonly TokenDeclaration[] {
  return (
    rules.find((rule) => rule.selector === selector && rule.atRules.length === 0)?.declarations ??
    []
  );
}

export interface TokenCatalog {
  /** The theme-independent `:root` block: palette, spacing, type, radii, shadows and sizes. */
  readonly base: readonly TokenDeclaration[];
  /** Semantic colour declarations per theme. */
  readonly themes: Readonly<Record<EffectiveTheme, readonly TokenDeclaration[]>>;
}

/** Builds the catalog from the text of tokens.css. */
export function readTokenCatalog(css: string): TokenCatalog {
  const rules = parseCssRules(css);
  return {
    base: declarationsOf(rules, ':root'),
    themes: {
      light: declarationsOf(rules, ":root, [data-theme='light']"),
      dark: declarationsOf(rules, "[data-theme='dark']"),
    },
  };
}

/** The catalog for the app's own tokens.css. */
export const tokenCatalog: TokenCatalog = readTokenCatalog(tokensCss);

/** The base tokens whose names start with `prefix`, in source order. */
export function baseTokens(prefix: string, catalog = tokenCatalog): readonly TokenDeclaration[] {
  return catalog.base.filter((token) => token.name.startsWith(prefix));
}

const HEX_COLOUR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const VAR_REFERENCE = /^var\((--[\w-]+)\)$/;

/** One semantic colour token with its hex value in a theme. */
export interface ColourToken {
  readonly name: string;
  /** Lower-case `#rrggbb` or `#rrggbbaa`, or undefined when the value is not plain hex. */
  readonly hex: string | undefined;
}

/** Follows var() references through the theme and base tokens until a hex literal. */
function resolveHex(lookup: ReadonlyMap<string, string>, name: string): string | undefined {
  const seen = new Set<string>();
  let current = name;
  while (!seen.has(current)) {
    seen.add(current);
    const value = lookup.get(current);
    if (value === undefined) return undefined;
    if (HEX_COLOUR.test(value)) return value.toLowerCase();
    const reference = VAR_REFERENCE.exec(value)?.[1];
    if (reference === undefined) return undefined;
    current = reference;
  }
  return undefined;
}

/** Every `--color-*` token in a theme, with its resolved hex, in source order. */
export function colourTokens(
  theme: EffectiveTheme,
  catalog = tokenCatalog,
): readonly ColourToken[] {
  const themeDeclarations = catalog.themes[theme];
  const lookup = new Map<string, string>([
    ...catalog.base.map((token): [string, string] => [token.name, token.value]),
    ...themeDeclarations.map((token): [string, string] => [token.name, token.value]),
  ]);
  return themeDeclarations
    .filter((token) => token.name.startsWith('--color-'))
    .map((token) => ({ name: token.name, hex: resolveHex(lookup, token.name) }));
}

/** A token value in rem as a number (`0` counts as 0rem), or undefined for anything else. */
export function remValue(value: string): number | undefined {
  if (value === '0') return 0;
  const match = /^(\d*\.?\d+)rem$/.exec(value);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}
