// Banned terms are matched here and never printed as they are. The repo and its CI logs are
// public, so every message shows a term masked: the first letter of each word, the rest as `*`.

import { parseTermLines, textPattern } from '@ringside/validate-world/real-name-matcher';

import type { BannedTerm } from './types';

/**
 * Masks a term for output: `Fictional Banned Co` becomes `F******** B***** C*`. Whitespace
 * between words is kept as single spaces; every other character after a word's first is a `*`.
 */
export function maskTerm(term: string): string {
  return term
    .trim()
    .split(/\s+/)
    .map((word) => {
      const firstCodePoint = word.codePointAt(0);
      const first = firstCodePoint === undefined ? '' : String.fromCodePoint(firstCodePoint);
      return first + '*'.repeat(Math.max(0, word.length - first.length));
    })
    .join(' ');
}

/**
 * A global pattern for one term in running text, from the real-name matcher the world validator
 * uses too. It only matches whole words: the characters on either side may not be letters, digits
 * or underscores. A plain term ignores case and the whitespace inside it matches any run of
 * whitespace, so a term split across a line break in the source is still found. A `[case]` term
 * (`Sting [case]`, a name that is also an everyday word) matches only as written or in capitals.
 */
export function bannedTermPattern(term: BannedTerm): RegExp {
  return textPattern(term);
}

/**
 * Reads a term list: one term per line, `#` comment lines and blank lines ignored, and an optional
 * `[case]` flag after a one-word term. Throws `TermLineError` (with the line, never the term) for
 * a line it cannot use.
 */
export function parseTermList(text: string): BannedTerm[] {
  return parseTermLines(text).map(({ spec }) => spec);
}

/** Replaces every occurrence of every term in `text` with the term's mask. */
export function maskTermsIn(text: string, terms: readonly BannedTerm[]): string {
  // Longest first, so a longer term is masked before a shorter one inside it.
  const sortedTerms = [...terms].sort((left, right) => right.name.length - left.name.length);
  let masked = text;
  for (const term of sortedTerms) {
    masked = masked.replace(bannedTermPattern(term), maskTerm(term.name));
  }
  return masked;
}
