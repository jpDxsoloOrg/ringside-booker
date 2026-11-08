import { parseDocument } from 'yaml';

import type { SourceFile } from './types';

// Markdown helpers for the checker. Unlike the publish transform, nothing here removes text: code
// and comments are blanked out with spaces and every newline is kept, so an index into the
// blanked text is still the same line and column in the file.

const FENCE_LINE = '---';
const NEWLINE_CODE = 10;

/** Builds a SourceFile from a file's text, locating and parsing (not validating) its frontmatter. */
export function readSource(path: string, rawText: string): SourceFile {
  const text = rawText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (lines[0]?.trimEnd() !== FENCE_LINE) {
    return withoutFrontmatter(path, text, 1, 'expected a frontmatter block starting with "---"');
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trimEnd() === FENCE_LINE);
  if (closingIndex === -1) {
    return withoutFrontmatter(
      path,
      text,
      1,
      'the frontmatter block opened on line 1 is never closed with "---"',
    );
  }

  const document = parseDocument(lines.slice(1, closingIndex).join('\n'));
  const firstError = document.errors[0];
  if (firstError !== undefined) {
    // The YAML starts on file line 2, so YAML line N is file line N + 1.
    const yamlLine = firstError.linePos?.[0].line ?? 1;
    return {
      path,
      text,
      frontmatterEndLine: closingIndex + 1,
      frontmatterData: undefined,
      frontmatterProblem: { line: yamlLine + 1, message: `invalid YAML: ${firstError.message}` },
    };
  }
  return {
    path,
    text,
    frontmatterEndLine: closingIndex + 1,
    frontmatterData: document.toJS() as unknown,
    frontmatterProblem: null,
  };
}

function withoutFrontmatter(path: string, text: string, line: number, message: string): SourceFile {
  return {
    path,
    text,
    frontmatterEndLine: 0,
    frontmatterData: undefined,
    frontmatterProblem: { line, message },
  };
}

/** The body as it sits in the file: the frontmatter lines are blanked, so line numbers match. */
export function bodyText(source: SourceFile): string {
  if (source.frontmatterEndLine === 0) {
    return source.text;
  }
  const lines = source.text.split('\n');
  return lines.map((line, index) => (index < source.frontmatterEndLine ? '' : line)).join('\n');
}

/** The body exactly as the post loader returns it: every line after the closing `---`. */
export function bodyAfterFrontmatter(source: SourceFile): string {
  return source.text.split('\n').slice(source.frontmatterEndLine).join('\n');
}

/** 1-based line number of the character at `index`. */
export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let position = 0; position < index && position < text.length; position += 1) {
    if (text.charCodeAt(position) === NEWLINE_CODE) {
      line += 1;
    }
  }
  return line;
}

/** The line of a top-level frontmatter key, for pointing at a field. Null when it is not there. */
export function frontmatterKeyLine(source: SourceFile, key: string): number | null {
  const lines = source.text.split('\n');
  for (let index = 1; index < source.frontmatterEndLine - 1; index += 1) {
    if (lines[index]?.startsWith(`${key}:`) === true) {
      return index + 1;
    }
  }
  return null;
}

export interface BlankOptions {
  /** Blank fenced code blocks (``` or ~~~), fence lines included. */
  readonly fences?: boolean;
  /** Blank inline code spans, backticks included. */
  readonly inlineCode?: boolean;
  /** Blank HTML comments outside code. */
  readonly comments?: boolean;
}

function blank(source: string): string {
  return source.replace(/[^\n]/g, ' ');
}

/**
 * Returns `text` with the chosen kinds of code and comments replaced by spaces. Code is always
 * recognised (so a `<!--` inside code never starts a comment), but only blanked when asked.
 */
export function blankOut(text: string, options: BlankOptions): string {
  let output = '';
  let position = 0;

  while (position < text.length) {
    const atLineStart = position === 0 || text[position - 1] === '\n';
    if (atLineStart) {
      const fenceEnd = findFencedBlockEnd(text, position);
      if (fenceEnd !== null) {
        const block = text.slice(position, fenceEnd);
        output += options.fences === true ? blank(block) : block;
        position = fenceEnd;
        continue;
      }
    }

    if (text.startsWith('<!--', position)) {
      const closeIndex = text.indexOf('-->', position + 4);
      const end = closeIndex === -1 ? text.length : closeIndex + 3;
      const comment = text.slice(position, end);
      output += options.comments === true ? blank(comment) : comment;
      position = end;
      continue;
    }

    const character = text.charAt(position);
    if (character === '`') {
      const runLength = countRun(text, position, '`');
      const closeIndex = findClosingBacktickRun(text, position + runLength, runLength);
      if (closeIndex === null) {
        output += text.slice(position, position + runLength);
        position += runLength;
      } else {
        const span = text.slice(position, closeIndex + runLength);
        output += options.inlineCode === true ? blank(span) : span;
        position = closeIndex + runLength;
      }
      continue;
    }

    if (character === '\\' && position + 1 < text.length) {
      // Keep escapes as a pair so an escaped backtick is never read as a code span.
      output += text.slice(position, position + 2);
      position += 2;
      continue;
    }

    output += character;
    position += 1;
  }
  return output;
}

/** If a fenced code block opens at `lineStart`, returns the index just past its closing line. */
function findFencedBlockEnd(text: string, lineStart: number): number | null {
  const openingLine = readLine(text, lineStart);
  const opening = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(openingLine.text);
  const fence = opening?.[1];
  if (fence === undefined || (fence.startsWith('`') && opening?.[2]?.includes('`') === true)) {
    return null;
  }
  const fenceCharacter = fence.charAt(0);
  const closingPattern = new RegExp(
    `^[ \\t]*\\${fenceCharacter}{${String(fence.length)},}[ \\t]*$`,
  );

  let lineEnd = openingLine.end;
  while (lineEnd < text.length) {
    const line = readLine(text, lineEnd + 1);
    if (closingPattern.test(line.text)) {
      return line.end;
    }
    lineEnd = line.end;
  }
  // An unclosed fence runs to the end of the document, as in CommonMark.
  return text.length;
}

function readLine(text: string, start: number): { text: string; end: number } {
  const newlineIndex = text.indexOf('\n', start);
  const end = newlineIndex === -1 ? text.length : newlineIndex;
  return { text: text.slice(start, end), end };
}

function countRun(text: string, start: number, character: string): number {
  let length = 0;
  while (text.charAt(start + length) === character) {
    length += 1;
  }
  return length;
}

/** Finds a backtick run of exactly `runLength` before the paragraph ends, or null. */
function findClosingBacktickRun(text: string, start: number, runLength: number): number | null {
  const paragraphEnd = text.slice(start).search(/\n[ \t]*\n/);
  const limit = paragraphEnd === -1 ? text.length : start + paragraphEnd;
  let position = start;
  while (position < limit) {
    if (text.charAt(position) === '`') {
      const length = countRun(text, position, '`');
      if (length === runLength) {
        return position;
      }
      position += length;
    } else {
      position += 1;
    }
  }
  return null;
}

/** One row of a Markdown table, with the file line it sits on. */
export interface TableRow {
  readonly line: number;
  readonly cells: readonly string[];
}

/**
 * Reads the first pipe table after the `## <heading>` line: its data rows, without the header and
 * the separator row. Returns null when the heading or the table is missing.
 */
export function readTableAfterHeading(text: string, heading: string): TableRow[] | null {
  const lines = blankOut(text, { fences: true, comments: true }).split('\n');
  const headingIndex = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (headingIndex === -1) {
    return null;
  }
  let index = headingIndex + 1;
  while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith('|')) {
    if ((lines[index] ?? '').startsWith('## ')) {
      return null;
    }
    index += 1;
  }
  const rows: TableRow[] = [];
  for (; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim();
    if (!line.startsWith('|')) {
      break;
    }
    rows.push({ line: index + 1, cells: splitTableRow(line) });
  }
  if (rows.length < 2) {
    return null;
  }
  // Drop the header row and the |---| separator row.
  return rows.slice(2);
}

function splitTableRow(line: string): string[] {
  const inner = line.replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}
