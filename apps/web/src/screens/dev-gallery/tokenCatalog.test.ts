import { describe, expect, it } from 'vitest';
import { contrastLevel, contrastRatio } from './contrast';
import { baseTokens, colourTokens, readTokenCatalog, remValue } from './tokenCatalog';

describe('token catalog', () => {
  it('reads every semantic colour from tokens.css with its hex for each theme', () => {
    const light = colourTokens('light');
    const dark = colourTokens('dark');

    expect(light.find((token) => token.name === '--color-bg')?.hex).toBe('#f6f5f3');
    expect(dark.find((token) => token.name === '--color-bg')?.hex).toBe('#131312');
    expect(light.find((token) => token.name === '--color-overlay')?.hex).toBe('#1d1c1a99');
    expect(light.map((token) => token.name)).toEqual(dark.map((token) => token.name));
    expect(light.every((token) => token.hex !== undefined)).toBe(true);
  });

  it('lists base tokens by prefix in source order', () => {
    expect(baseTokens('--radius-').map((token) => token.name)).toEqual([
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--radius-pill',
    ]);
    expect(baseTokens('--space-')).toHaveLength(11);
    expect(baseTokens('--shadow-')).toHaveLength(3);
  });

  it('leaves a colour it cannot resolve to hex as undefined', () => {
    const catalog = readTokenCatalog(
      ":root { --palette-a: #112233; } :root, [data-theme='light'] { --color-a: var(--palette-a); --color-b: red; --color-c: var(--missing); }",
    );
    expect(colourTokens('light', catalog)).toEqual([
      { name: '--color-a', hex: '#112233' },
      { name: '--color-b', hex: undefined },
      { name: '--color-c', hex: undefined },
    ]);
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
