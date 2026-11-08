import { UNTRACKED, epicOf } from './git';

// Builds a new journal entry from docs/dev-journal/_template.md. Pure: the CLI reads the template,
// the commits and the inbox, and decides where the file goes.

const FENCE_LINE = '---';
const PROMPT_LINE = /^_.*_$/;
const NOTHING_THIS_TIME = 'Nothing this time.';

/** Small words that stay lowercase inside a title, unless they come first. */
const MINOR_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'vs',
  'with',
]);

export interface BuildJournalEntryInput {
  /** The text of docs/dev-journal/_template.md. */
  readonly template: string;
  /** The kebab-case topic, for example `foundation`. */
  readonly topic: string;
  /** Epic prefixes the entry covers, such as `['FND']`. Empty means every ticket in the commits. */
  readonly epics: readonly string[];
  /** When the entry is written. Its local year, month and day give the file name and `date`. */
  readonly now: Date;
  /** The `date` of the newest existing entry, which is where the commits start; null if none. */
  readonly lastEntryDate: string | null;
  /** Commit subjects grouped by ticket ID, with UNTRACKED for subjects without one. */
  readonly commitsByTicket: ReadonlyMap<string, readonly string[]>;
  /** Bullets drained from _inbox.md, kept exactly as written. */
  readonly inboxItems: readonly string[];
}

export interface JournalEntryDraft {
  /** `YYYY-MM-<topic>.md`. The caller adds `-2`, `-3`... when the name is taken. */
  readonly fileName: string;
  readonly content: string;
}

/** `state-of-the-build` becomes `State of the Build`. */
export function titleCaseTopic(topic: string): string {
  return topic
    .split('-')
    .filter((word) => word !== '')
    .map((word, index) =>
      index > 0 && MINOR_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/** The local calendar date of `moment` as `YYYY-MM-DD`. */
export function localIsoDate(moment: Date): string {
  const year = String(moment.getFullYear()).padStart(4, '0');
  const month = String(moment.getMonth() + 1).padStart(2, '0');
  const day = String(moment.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Orders ticket IDs by epic prefix, then by number: FND-2 before FND-10. */
export function compareTicketIds(left: string, right: string): number {
  const leftEpic = epicOf(left);
  const rightEpic = epicOf(right);
  if (leftEpic !== rightEpic) {
    return leftEpic < rightEpic ? -1 : 1;
  }
  return ticketNumber(left) - ticketNumber(right);
}

function ticketNumber(ticketId: string): number {
  return Number(ticketId.slice(ticketId.lastIndexOf('-') + 1));
}

function yamlQuoted(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

function yamlList(items: readonly string[]): string {
  return `[${items.join(', ')}]`;
}

/** Fills the template with the title, date, epics, tickets, commit bullets and inbox notes. */
export function buildJournalEntry(input: BuildJournalEntryInput): JournalEntryDraft {
  const title = titleCaseTopic(input.topic);
  const date = localIsoDate(input.now);
  const epicSet = new Set(input.epics);
  const tickets = [...input.commitsByTicket.keys()]
    .filter((id) => id !== UNTRACKED && (epicSet.size === 0 || epicSet.has(epicOf(id))))
    .sort(compareTicketIds);

  let lines = input.template.replace(/\r\n?/g, '\n').split('\n');
  lines = fillFrontmatter(lines, {
    title: yamlQuoted(title),
    date,
    epics: yamlList(input.epics),
    tickets: yamlList(tickets),
  });
  const titleIndex = lines.findIndex((line) => line.startsWith('# '));
  if (titleIndex !== -1) {
    lines[titleIndex] = `# ${title}`;
  }
  lines = fillWhatIBuilt(lines, input, tickets);
  lines = replaceSection(lines, 'Raw notes', () =>
    input.inboxItems.length === 0 ? [NOTHING_THIS_TIME] : input.inboxItems,
  );

  let content = lines.join('\n');
  if (!content.endsWith('\n')) {
    content += '\n';
  }
  return { fileName: `${date.slice(0, 7)}-${input.topic}.md`, content };
}

/** Replaces the values of the named top-level keys inside the frontmatter block. */
function fillFrontmatter(lines: readonly string[], values: Record<string, string>): string[] {
  const closingIndex =
    lines[0]?.trimEnd() === FENCE_LINE
      ? lines.findIndex((line, index) => index > 0 && line.trimEnd() === FENCE_LINE)
      : -1;
  return lines.map((line, index) => {
    if (index === 0 || index >= closingIndex) {
      return line;
    }
    const key = /^([A-Za-z]+):/.exec(line)?.[1];
    const value = key === undefined ? undefined : values[key];
    return value === undefined ? line : `${key ?? ''}: ${value}`;
  });
}

function fillWhatIBuilt(
  lines: readonly string[],
  input: BuildJournalEntryInput,
  tickets: readonly string[],
): string[] {
  const untracked = input.commitsByTicket.get(UNTRACKED) ?? [];
  if (tickets.length === 0 && untracked.length === 0) {
    return [...lines];
  }
  const since =
    input.lastEntryDate === null
      ? 'Pre-filled from every commit in the history'
      : `Pre-filled from the commits since ${input.lastEntryDate}`;
  const bullets: string[] = [];
  for (const ticket of tickets) {
    bullets.push(`- **${ticket}: Feature name.** _What it does, with the file paths it touched._`);
    for (const subject of input.commitsByTicket.get(ticket) ?? []) {
      bullets.push(`  - ${subject}`);
    }
  }
  if (untracked.length > 0) {
    bullets.push(
      '- **Commits without a ticket ID.** _Fold these into the bullets above or delete them._',
    );
    for (const subject of untracked) {
      bullets.push(`  - ${subject}`);
    }
  }
  return replaceSection(lines, 'What I built', (body) => [
    ...body.filter((line) => PROMPT_LINE.test(line)).flatMap((line) => [line, '']),
    `_${since}; replace each commit list with a sentence._`,
    '',
    ...bullets,
  ]);
}

/**
 * Replaces the body of the `## <heading>` section (everything up to the next `##` heading) with
 * the lines `build` returns for the old body. Blank lines separate the body from the headings.
 * Lines are returned unchanged when the section is missing.
 */
function replaceSection(
  lines: readonly string[],
  heading: string,
  build: (body: readonly string[]) => readonly string[],
): string[] {
  const headingIndex = lines.findIndex((line) => line.trimEnd() === `## ${heading}`);
  if (headingIndex === -1) {
    return [...lines];
  }
  const nextIndex = lines.findIndex((line, index) => index > headingIndex && /^##\s/.test(line));
  const endIndex = nextIndex === -1 ? lines.length : nextIndex;
  const body = lines.slice(headingIndex + 1, endIndex).filter((line) => line.trim() !== '');
  const tail = nextIndex === -1 ? [''] : ['', ...lines.slice(endIndex)];
  return [...lines.slice(0, headingIndex + 1), '', ...build(body), ...tail];
}
