import { describe, expect, it } from 'vitest';
import { contrastLevel, contrastRatio } from './contrast';
import {
  baseLengthInPx,
  baseTokens,
  colourTokens,
  readTokenCatalog,
  remValue,
} from './tokenCatalog';

describe('token catalog', () => {
  it('reads every semantic colour from tokens.css with its hex for the dark theme', () => {
    const dark = colourTokens('dark');

    expect(dark.find((token) => token.name === '--color-bg')?.hex).toBe('#090d16');
    expect(dark.find((token) => token.name === '--color-action')?.hex).toBe('#d7301a');
    expect(dark.find((token) => token.name === '--color-overlay')?.hex).toBe('#05080fb3');
    expect(dark.every((token) => token.hex !== undefined)).toBe(true);
  });

  it('lists base tokens by prefix in source order', () => {
    expect(baseTokens('--radius-').map((token) => token.name)).toEqual([
      '--radius-card',
      '--radius-control',
      '--radius-pill',
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
    ]);
    expect(baseTokens('--space-')).toHaveLength(11);
    expect(baseTokens('--shadow-')).toHaveLength(3);
    expect(baseTokens('--font-family-').map((token) => token.name)).toEqual([
      '--font-family-display',
      '--font-family-ui',
      '--font-family-mono',
    ]);
  });

  it('leaves a colour it cannot resolve to hex as undefined', () => {
    const catalog = readTokenCatalog(
      ":root { --palette-a: #112233; } :root, [data-theme='dark'] { --color-a: var(--palette-a); --color-b: red; --color-c: var(--missing); }",
    );
    expect(colourTokens('dark', catalog)).toEqual([
      { name: '--color-a', hex: '#112233' },
      { name: '--color-b', hex: undefined },
      { name: '--color-c', hex: undefined },
    ]);
  });

  it('reads base lengths in px through var() references', () => {
    const catalog = readTokenCatalog(
      ':root { --a: 0.5rem; --b: 10px; --c: var(--b); --d: 12deg; --e: var(--e); --f: var(--g); }',
    );
    expect(baseLengthInPx('--a', catalog)).toBe(8);
    expect(baseLengthInPx('--b', catalog)).toBe(10);
    expect(baseLengthInPx('--c', catalog)).toBe(10);
    expect(baseLengthInPx('--d', catalog)).toBeUndefined();
    expect(baseLengthInPx('--e', catalog)).toBeUndefined();
    expect(baseLengthInPx('--f', catalog)).toBeUndefined();
    expect(baseLengthInPx('--radius-lg')).toBe(10);
  });

  it('reads rem values', () => {
    expect(remValue('0')).toBe(0);
    expect(remValue('0.25rem')).toBe(0.25);
    expect(remValue('999rem')).toBe(999);
    expect(remValue('2px')).toBeUndefined();
  });
});

describe('contrast', () => {
  it('matches the WCAG 2 extremes and levels', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(contrastLevel(4.5)).toBe('AA');
    expect(contrastLevel(4.49)).toBe('AA large');
    expect(contrastLevel(3)).toBe('AA large');
    expect(contrastLevel(2.99)).toBe('Below 3:1');
  });
});
