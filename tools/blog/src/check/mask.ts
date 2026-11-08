// Banned terms are matched here and never printed as they are. The repo and its CI logs are
// public, so every message shows a term masked: the first letter of each word, the rest as `*`.

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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A global, case-insensitive pattern for one term. It only matches whole words: the characters
 * on either side may not be letters, digits or underscores. Whitespace inside the term matches
 * any run of whitespace, so a term split across a line break in the source is still found.
 */
export function bannedTermPattern(term: string): RegExp {
  const body = term
    .trim()
    .split(/\s+/)
    .map((word) => escapeRegExp(word))
    .join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'giu');
}

/** Reads a term list: one term per line, `#` comment lines and blank lines ignored. */
export function parseTermList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** Replaces every occurrence of every term in `text` with the term's mask. */
export function maskTermsIn(text: string, terms: readonly string[]): string {
  // Longest first, so a longer term is masked before a shorter one inside it.
  const sortedTerms = [...terms].sort((left, right) => right.length - left.length);
  let masked = text;
  for (const term of sortedTerms) {
    masked = masked.replace(bannedTermPattern(term), maskTerm(term));
  }
  return masked;
}
