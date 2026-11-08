// Reads and drains docs/dev-journal/_inbox.md. The inbox is a header (title, instructions and an
// example inside a code fence) followed by a `## Notes` heading, and the notes are the bullets
// under that heading.

const NOTES_HEADING = '## Notes';

/** The inbox split into the part that stays and the notes that move into the next entry. */
export interface InboxContents {
  /** Everything up to and including the `## Notes` heading, ending with a newline. */
  readonly header: string;
  /**
   * One string per bullet, exactly as written; a bullet's follow-on lines stay with it. Any other
   * text under the heading is kept as a note of its own.
   */
  readonly items: readonly string[];
}

/**
 * Splits the inbox into its header and its note bullets. Without a `## Notes` heading nothing is
 * treated as a note, so the whole file is header and stays where it is.
 */
export function splitInbox(text: string): InboxContents {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const headingIndex = lines.findIndex((line) => line.trimEnd() === NOTES_HEADING);
  if (headingIndex === -1) {
    return { header: text.endsWith('\n') ? text : `${text}\n`, items: [] };
  }

  const items: string[] = [];
  let current: string[] | null = null;
  for (const line of lines.slice(headingIndex + 1)) {
    if (line.trim() === '' || /^[-*+][ \t]/.test(line)) {
      // A blank line or a new bullet ends the note before it.
      if (current !== null) {
        items.push(current.join('\n'));
      }
      current = line.trim() === '' ? null : [line.trimEnd()];
    } else if (current !== null) {
      // Indented or lazy follow-on lines belong to the bullet above.
      current.push(line.trimEnd());
    } else {
      // Text that is not a bullet is still a note; draining must never lose it.
      current = [line.trimEnd()];
    }
  }
  if (current !== null) {
    items.push(current.join('\n'));
  }

  return { header: `${lines.slice(0, headingIndex + 1).join('\n')}\n`, items };
}
