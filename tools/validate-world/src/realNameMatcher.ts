/**
 * The real-name matcher, shared by the world validator (names in content) and the blog checker
 * (running text in posts and journal entries), so the two can never disagree about a name.
 *
 * List format, for `content/blocklist/real-names.txt` and the blog's private list alike: one name
 * per line; blank lines and lines starting with `#` are ignored. A one-word name can end with the
 * `[case]` flag (`Sting [case]`) when it is also an everyday word. A flagged name only matches
 * text written the way the list writes it (`Sting`) or in capitals (`STING`), so "a loss to
 * sting less" is not a hit. Every other name matches whatever its case.
 *
 * Matching inside a name field (`matchesEntry`) ignores accents and punctuation as well:
 *
 * - A one-word entry (`Nightfall`) matches a field only when the whole field is that word, so a
 *   common word on the list does not flag every name that contains it. A leading "the" and
 *   trailing numbers (digits or Roman numerals) are ignored for this, so `The Nightfall`,
 *   `Nightfall 40` and `Nightfall XX` match too.
 * - A one-word entry written in capitals (`HCW`, an acronym of two to six letters or digits)
 *   matches as a whole word anywhere in the field (`HCW World Title`), because an acronym inside a
 *   name is still the real name.
 * - A longer entry (`Harbour City Wrestling`) matches when its words appear in a row anywhere in
 *   the field (`The Harbour City Wrestling Show`).
 * - Punctuation is tried both as a word break and as nothing, so `A.J. Example` matches
 *   `AJ Example` and `Rey-Example` matches `Rey Example`; a name with its spaces removed
 *   (`SmackExample` against `Smack Example`) matches too.
 * - A `[case]` entry follows the same rules, but compares letters with their case kept (accents
 *   and punctuation are still ignored): `Nightfall [case]` blocks "Nightfall" and "NIGHTFALL" but
 *   not "nightfall".
 *
 * Matching in running text (`textPattern`) finds the name as whole words anywhere: the characters
 * on either side may not be letters, digits or underscores, and the spaces inside a longer name
 * match any run of whitespace, including a line break.
 */

/** The flag that makes a one-word name match only as written or in capitals. */
export const CASE_FLAG = 'case';

/** One name from a list, without its flag. */
export interface TermSpec {
  readonly name: string;
  /** Set by `[case]`: the name only matches as written or in capitals. */
  readonly caseSensitive: boolean;
}

/** A list line that cannot be used. The message never repeats the line, which may be private. */
export class TermLineError extends Error {
  /** 1-based line in the list, or 0 when the problem is not tied to a list. */
  readonly line: number;

  constructor(message: string, line = 0) {
    super(message);
    this.name = 'TermLineError';
    this.line = line;
  }
}

/** A trailing `[flag]`. */
const FLAG_SUFFIX = /\s*\[([^\]]*)\]$/u;

/**
 * Reads one list line: null for a blank or `#` line, otherwise the name and its flag. Throws
 * `TermLineError` for an unknown flag, a flag with no name before it, or `[case]` on a name of
 * more than one word (a longer name is already precise, so it always ignores case).
 */
export function parseTermLine(rawLine: string): TermSpec | null {
  const trimmed = rawLine.trim();
  if (trimmed === '' || trimmed.startsWith('#')) {
    return null;
  }
  const flagMatch = FLAG_SUFFIX.exec(trimmed);
  if (flagMatch === null) {
    return { name: trimmed, caseSensitive: false };
  }
  const flag = (flagMatch[1] ?? '').trim();
  if (flag !== CASE_FLAG) {
    throw new TermLineError(`unknown flag; the only flag is [${CASE_FLAG}]`);
  }
  const name = trimmed.slice(0, flagMatch.index).trim();
  if (name === '') {
    throw new TermLineError(`[${CASE_FLAG}] needs a name before it`);
  }
  if (/\s/u.test(name)) {
    throw new TermLineError(
      `[${CASE_FLAG}] is only for one-word names; a longer name always ignores case`,
    );
  }
  return { name, caseSensitive: true };
}

/** Every name in a list's text, with its 1-based line. Throws `TermLineError` with the line. */
export function parseTermLines(text: string): { spec: TermSpec; line: number }[] {
  const terms: { spec: TermSpec; line: number }[] = [];
  text.split(/\r?\n/u).forEach((rawLine, index) => {
    let spec: TermSpec | null;
    try {
      spec = parseTermLine(rawLine);
    } catch (error: unknown) {
      if (error instanceof TermLineError) {
        throw new TermLineError(error.message, index + 1);
      }
      throw error;
    }
    if (spec !== null) {
      terms.push({ spec, line: index + 1 });
    }
  });
  return terms;
}

// ---------------------------------------------------------------------------------------------
// Running text
// ---------------------------------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const NOT_AFTER_WORD = '(?<![\\p{L}\\p{N}_])';
const NOT_BEFORE_WORD = '(?![\\p{L}\\p{N}_])';

/**
 * A global pattern that finds `term` as whole words in running text. A plain name ignores case
 * and its inner spaces match any whitespace; a `[case]` name matches only as written or in
 * capitals.
 */
export function textPattern(term: TermSpec): RegExp {
  const name = term.name.trim();
  if (term.caseSensitive) {
    const spellings = [...new Set([name, name.toUpperCase()])].map(escapeRegExp);
    return new RegExp(`${NOT_AFTER_WORD}(?:${spellings.join('|')})${NOT_BEFORE_WORD}`, 'gu');
  }
  const body = name
    .split(/\s+/u)
    .map((word) => escapeRegExp(word))
    .join('\\s+');
  return new RegExp(`${NOT_AFTER_WORD}${body}${NOT_BEFORE_WORD}`, 'giu');
}

// ---------------------------------------------------------------------------------------------
// Name fields
// ---------------------------------------------------------------------------------------------

/** The forms of a name that field matching compares. */
export interface NameForms {
  /** Words with punctuation read as a break. */
  readonly spacedWords: readonly string[];
  /** Words with punctuation dropped. */
  readonly joinedWords: readonly string[];
  /** Every letter and digit, nothing else. */
  readonly compact: string;
}

export interface BlocklistEntry extends TermSpec, NameForms {
  /** The file it came from, as shown in messages. */
  readonly source: string;
  readonly line: number;
  /** An acronym entry (one word in capitals): matches as a whole word anywhere in a field. */
  readonly anywhere: boolean;
  /** For a `[case]` entry, its forms with case kept; null for an entry that ignores case. */
  readonly casedForms: NameForms | null;
}

/** Letters that do not split into a base letter and an accent under Unicode decomposition. */
const SPECIAL_LETTERS: Readonly<Record<string, string>> = {
  ß: 'ss',
  ẞ: 'SS',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'TH',
  ı: 'i',
};

/** Accents removed and special letters spelled out, case kept. Punctuation is kept for now. */
export function foldAccents(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[ßẞæÆœŒøØłŁđĐðÐþÞı]/gu, (letter) => SPECIAL_LETTERS[letter] ?? letter);
}

/** Lower case, accents removed, special letters spelled out. Punctuation is kept for now. */
export function foldName(value: string): string {
  return foldAccents(value).toLowerCase();
}

function words(text: string): string[] {
  return text.split(/\s+/u).filter((word) => word.length > 0);
}

function formsOf(folded: string): NameForms {
  return {
    spacedWords: words(folded.replace(/[^\p{L}\p{N}]+/gu, ' ')),
    joinedWords: words(folded.replace(/[^\p{L}\p{N}\s]+/gu, '')),
    compact: folded.replace(/[^\p{L}\p{N}]+/gu, ''),
  };
}

/** The forms of a name that matching compares, with case ignored. */
export function nameForms(value: string): NameForms {
  return formsOf(foldName(value));
}

/** The forms of a name with case kept, for `[case]` entries. */
export function casedNameForms(value: string): NameForms {
  return formsOf(foldAccents(value));
}

/** How one word of a field is compared with one word of an entry. */
type SameWord = (fieldWord: string, entryWord: string) => boolean;

const sameIgnoringCase: SameWord = (fieldWord, entryWord) => fieldWord === entryWord;

/** As the list writes it, or in capitals. */
const sameAsWrittenOrCapitals: SameWord = (fieldWord, entryWord) =>
  fieldWord === entryWord || fieldWord === entryWord.toUpperCase();

function containsRun(
  haystack: readonly string[],
  needle: readonly string[],
  same: SameWord,
): boolean {
  if (needle.length === 0 || needle.length > haystack.length) {
    return false;
  }
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let all = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (!same(haystack[start + offset] ?? '', needle[offset] ?? '')) {
        all = false;
        break;
      }
    }
    if (all) {
      return true;
    }
  }
  return false;
}

/** Roman numerals from i upwards, in lower case. */
const ROMAN_NUMERAL = /^m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/u;

function isNumberWord(word: string): boolean {
  const lower = word.toLowerCase();
  return /^\p{N}+$/u.test(lower) || (lower.length > 0 && ROMAN_NUMERAL.test(lower));
}

/** A field's words without a leading "the" or trailing numbers (`The Example 40` → `Example`). */
function coreWords(field: readonly string[]): readonly string[] {
  let from = 0;
  let to = field.length;
  if (to - from > 1 && field[from]?.toLowerCase() === 'the') {
    from += 1;
  }
  while (to - from > 1 && isNumberWord(field[to - 1] ?? '')) {
    to -= 1;
  }
  return field.slice(from, to);
}

function wordsMatch(
  field: readonly string[],
  entry: readonly string[],
  anywhere: boolean,
  same: SameWord,
): boolean {
  if (entry.length === 1) {
    const entryWord = entry[0] ?? '';
    if (anywhere) {
      return field.some((fieldWord) => same(fieldWord, entryWord));
    }
    const core = coreWords(field);
    return core.length === 1 && same(core[0] ?? '', entryWord);
  }
  return containsRun(field, entry, same);
}

function formsMatch(
  field: NameForms,
  entry: NameForms,
  anywhere: boolean,
  same: SameWord,
): boolean {
  if (field.compact.length > 0 && same(field.compact, entry.compact)) {
    return true;
  }
  return (
    wordsMatch(field.spacedWords, entry.spacedWords, anywhere, same) ||
    wordsMatch(field.joinedWords, entry.joinedWords, anywhere, same)
  );
}

/** One word written in capitals and digits only, two to six characters long: an acronym. */
export function isAcronym(name: string): boolean {
  return /^[\p{Lu}\p{N}]{2,6}$/u.test(name) && /\p{Lu}/u.test(name);
}

/** The entry for one parsed name. Its `compact` form is empty when it has no letters or digits. */
export function createEntry(spec: TermSpec, source: string, line: number): BlocklistEntry {
  return {
    name: spec.name,
    caseSensitive: spec.caseSensitive,
    source,
    line,
    ...nameForms(spec.name),
    anywhere: isAcronym(spec.name),
    casedForms: spec.caseSensitive ? casedNameForms(spec.name) : null,
  };
}

/** True when the name field `value` matches `entry` under the rules at the top of this file. */
export function matchesEntry(value: string, entry: BlocklistEntry): boolean {
  if (entry.casedForms !== null) {
    return formsMatch(
      casedNameForms(value),
      entry.casedForms,
      entry.anywhere,
      sameAsWrittenOrCapitals,
    );
  }
  return formsMatch(nameForms(value), entry, entry.anywhere, sameIgnoringCase);
}
