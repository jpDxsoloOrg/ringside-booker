import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphemesOf, initialsFor } from './initials';

describe('initialsFor', () => {
  it.each([
    ['The Brass Cartographer', 'BC'],
    ['Marlo Quint', 'MQ'],
    ['Ana-Lucía Reyes', 'AR'],
    ['Zé', 'ZÉ'],
    ['El Faro Azul', 'FA'],
    ['Los Hermanos Brea', 'HB'],
    ['der Nebelturm Kollektiv', 'NK'],
    ['  wren   okafor-dale ', 'WD'],
    ['The', 'TH'],
  ])('%s → %s', (name, expected) => {
    expect(initialsFor(name)).toBe(expected);
  });

  it('returns "?" for an empty or blank name', () => {
    expect(initialsFor('')).toBe('?');
    expect(initialsFor('   ')).toBe('?');
    expect(initialsFor(' - ')).toBe('?');
  });

  it('keeps emoji and combined graphemes whole', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    const flag = '\u{1F1F3}\u{1F1FF}';
    const decomposedE = 'é';
    expect(initialsFor(`${family} Crew`)).toBe(`${family}C`);
    expect(initialsFor(`${flag} Kiwi`)).toBe(`${flag}K`);
    expect(initialsFor(`${decomposedE}mile Vasquez`)).toBe('ÉV');
    expect(initialsFor(flag + family)).toBe(flag + family);
  });

  it('takes up to max initials: the first words and the last word', () => {
    expect(initialsFor('Pacific Coast Grappling Alliance', 3)).toBe('PCA');
    expect(initialsFor('Pacific Coast Grappling', 3)).toBe('PCG');
    expect(initialsFor('Marlo Quint', 1)).toBe('M');
    expect(initialsFor('Vortex', 3)).toBe('VO');
  });
});

describe('graphemesOf without Intl.Segmenter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('falls back to code points', async () => {
    const intlWithoutSegmenter = Object.fromEntries(
      Object.getOwnPropertyNames(Intl)
        .filter((property) => property !== 'Segmenter')
        .map((property) => [property, Reflect.get(Intl, property) as unknown]),
    );
    vi.stubGlobal('Intl', intlWithoutSegmenter);
    vi.resetModules();
    const fresh = await import('./initials');
    expect(fresh.initialsFor('Marlo Quint')).toBe('MQ');
    // Code points split a decomposed accent from its letter; that is the accepted fallback cost.
    expect(fresh.graphemesOf('e\u0301x')).toEqual(['e', '\u0301', 'x']);
  });

  it('splits by grapheme when Segmenter exists', () => {
    expect(graphemesOf('éx')).toEqual(['é', 'x']);
  });
});
