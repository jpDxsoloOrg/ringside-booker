/**
 * Initials for placeholder art. Grapheme-aware, so accented letters, emoji and other combined
 * characters are never split in half.
 */

/** Leading articles skipped when they start a multi-word name ("The Brass Cartographer" → BC). */
const LEADING_ARTICLES: ReadonlySet<string> = new Set(['the', 'el', 'la', 'los', 'der']);

const WORD_SEPARATORS = /[\s-]+/u;

let cachedSegmenter: Intl.Segmenter | null = null;

function graphemeSegmenter(): Intl.Segmenter | null {
  if (!('Segmenter' in Intl)) return null;
  cachedSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return cachedSegmenter;
}

/** Splits text into user-perceived characters, falling back to code points without Segmenter. */
export function graphemesOf(text: string): string[] {
  const segmenter = graphemeSegmenter();
  if (segmenter === null) return Array.from(text);
  return Array.from(segmenter.segment(text), (segment) => segment.segment);
}

function firstGrapheme(word: string): string {
  return graphemesOf(word)[0] ?? '';
}

/**
 * Up to `max` initials for a name, upper-cased for the current locale.
 *
 * - Words are split on whitespace and hyphens; leading articles are dropped.
 * - One word: its first two graphemes (`"Zé"` → `"ZÉ"`), never more than `max`.
 * - Several words: the first grapheme of the first words and of the last word, so two initials
 *   are first + last (`"Ana-Lucía Reyes"` → `"AR"`).
 * - No words at all: `"?"`.
 */
export function initialsFor(name: string, max = 2): string {
  const limit = Math.max(1, Math.floor(max));
  const words = name.split(WORD_SEPARATORS).filter((word) => word !== '');
  while (words.length > 1 && LEADING_ARTICLES.has((words[0] ?? '').toLowerCase())) {
    words.shift();
  }

  const onlyWord = words.length === 1 ? words[0] : undefined;
  if (onlyWord !== undefined) {
    return graphemesOf(onlyWord).slice(0, Math.min(2, limit)).join('').toLocaleUpperCase();
  }
  if (words.length === 0) return '?';

  let chosenWords = words;
  if (limit === 1) chosenWords = words.slice(0, 1);
  else if (words.length > limit) chosenWords = [...words.slice(0, limit - 1), ...words.slice(-1)];
  return chosenWords.map(firstGrapheme).join('').toLocaleUpperCase();
}
