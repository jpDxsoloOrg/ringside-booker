import { describe, expect, it } from 'vitest';

import { slugify } from '../src/slugify';

describe('slugify', () => {
  it.each([
    ['Game Dev', 'game-dev'],
    ['TypeScript 5', 'typescript-5'],
    ['c++ & rust', 'c-rust'],
    ['ringside-booker', 'ringside-booker'],
  ])('turns %j into %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
