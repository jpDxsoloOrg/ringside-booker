import { readTableAfterHeading } from '../check/markdown';
import type { JournalEntrySummary } from './entries';
import { sortEntries } from './entries';
import { TICKET_ID_PATTERN, epicOf, ticketIdsIn } from './git';
import type { CommitRecord } from './git';
import { localIsoDate } from './scaffold';

// What `npm run journal:due` works out: which epics have shipped enough since their last journal
// entry to need a new one. Advisory only; nothing here fails a build.

export const DEFAULT_DUE_THRESHOLD = 10;
/** A "state of the build" entry is due when the newest entry is older than this. */
export const STATE_OF_THE_BUILD_DAYS = 30;

const CLOSING_TICKETS_HEADING = 'Closing tickets';
const EPIC_PREFIX_PATTERN = /^[A-Z][A-Z0-9]*$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type DueStatus = 'due' | 'ok';

export interface EpicDueRow {
  readonly epic: string;
  /** The newest entry listing this epic, or null when none does. */
  readonly lastEntry: JournalEntrySummary | null;
  /** Commits naming one of the epic's tickets made after the last entry's date. */
  readonly commitsSince: number;
  /** The epic's closing ticket, when it appears in a commit after the last entry. */
  readonly closingTicketSeen: string | null;
  readonly status: DueStatus;
}

export interface StateOfTheBuild {
  readonly status: DueStatus;
  /** The newest entry's date, or null when there are no entries. */
  readonly newestEntryDate: string | null;
  /** Whole days from the newest entry's date to today, or null when there are no entries. */
  readonly daysSince: number | null;
}

export interface JournalDueReport {
  readonly rows: readonly EpicDueRow[];
  readonly stateOfTheBuild: StateOfTheBuild;
}

export interface JournalDueInput {
  /** Every commit in the history, with its date. */
  readonly commits: readonly CommitRecord[];
  readonly entries: readonly JournalEntrySummary[];
  /** Closing ticket ID per epic prefix, from the epic exit checklist. */
  readonly closingTickets: ReadonlyMap<string, string>;
  readonly now: Date;
  /** Commits since the last entry that make an epic due. */
  readonly threshold: number;
}

/**
 * Reads the `Epic | Closing ticket ID | Entry file` table under `## Closing tickets` in
 * docs/dev-journal/epic-exit-checklist.md. Rows that are not an epic prefix and a ticket ID are
 * skipped.
 */
export function readClosingTickets(checklistText: string): Map<string, string> {
  const closingTickets = new Map<string, string>();
  for (const row of readTableAfterHeading(checklistText, CLOSING_TICKETS_HEADING) ?? []) {
    const [epicCell, ticketCell] = row.cells.map((cell) => cell.replace(/`/g, '').trim());
    if (
      epicCell !== undefined &&
      ticketCell !== undefined &&
      EPIC_PREFIX_PATTERN.test(epicCell) &&
      TICKET_ID_PATTERN.test(ticketCell)
    ) {
      closingTickets.set(epicCell, ticketCell);
    }
  }
  return closingTickets;
}

/**
 * For each epic prefix named in the commits, finds the newest entry that lists it and counts the
 * epic's commits made after that entry's date. Commits on the entry's own date count as covered
 * by it. An epic is due when that count reaches the threshold, or when its closing ticket shows
 * up in a commit with no entry for the epic after it.
 */
export function computeJournalDue(input: JournalDueInput): JournalDueReport {
  const entries = sortEntries(input.entries);
  const commitsByEpic = new Map<string, { date: string; ids: string[] }[]>();
  for (const commit of input.commits) {
    const ids = ticketIdsIn(commit.subject);
    for (const epic of new Set(ids.map(epicOf))) {
      const list = commitsByEpic.get(epic) ?? [];
      list.push({ date: commit.date, ids });
      commitsByEpic.set(epic, list);
    }
  }

  const rows = [...commitsByEpic.keys()].sort().map((epic): EpicDueRow => {
    const lastEntry = entries.filter((entry) => entry.epics.includes(epic)).at(-1) ?? null;
    const after = (commitsByEpic.get(epic) ?? []).filter(
      (commit) => lastEntry === null || commit.date > lastEntry.date,
    );
    const closingTicket = input.closingTickets.get(epic);
    const closingTicketSeen =
      closingTicket !== undefined && after.some((commit) => commit.ids.includes(closingTicket))
        ? closingTicket
        : null;
    const due = after.length >= input.threshold || closingTicketSeen !== null;
    return {
      epic,
      lastEntry,
      commitsSince: after.length,
      closingTicketSeen,
      status: due ? 'due' : 'ok',
    };
  });

  const newestEntryDate = entries.at(-1)?.date ?? null;
  const daysSince = newestEntryDate === null ? null : daysBetween(newestEntryDate, input.now);
  return {
    rows,
    stateOfTheBuild: {
      status: daysSince === null || daysSince > STATE_OF_THE_BUILD_DAYS ? 'due' : 'ok',
      newestEntryDate,
      daysSince,
    },
  };
}

/** Whole calendar days from `isoDate` to the local date of `now`. */
function daysBetween(isoDate: string, now: Date): number {
  const start = Date.parse(`${isoDate}T00:00:00Z`);
  const end = Date.parse(`${localIsoDate(now)}T00:00:00Z`);
  return Math.round((end - start) / MILLISECONDS_PER_DAY);
}

/** The report as a text table plus a note per due reason and the state-of-the-build line. */
export function formatJournalDue(report: JournalDueReport, threshold: number): string {
  const header = ['Epic', 'Last entry', 'Commits since', 'Status'];
  const body = report.rows.map((row) => [
    row.epic,
    row.lastEntry === null ? '-' : `${row.lastEntry.fileName} (${row.lastEntry.date})`,
    String(row.commitsSince),
    row.status,
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...body.map((cells) => (cells[column] ?? '').length)),
  );
  const renderRow = (cells: readonly string[]): string =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(' | ')} |`;

  const lines: string[] = [];
  if (body.length === 0) {
    lines.push('No epic prefixes found in the commit history.');
  } else {
    lines.push(
      renderRow(header),
      renderRow(widths.map((width) => '-'.repeat(width))),
      ...body.map(renderRow),
    );
  }

  const reasons: string[] = [];
  for (const row of report.rows) {
    if (row.closingTicketSeen !== null) {
      reasons.push(
        `${row.epic}: closing ticket ${row.closingTicketSeen} is in the history with no ${row.epic} entry after it.`,
      );
    }
    if (row.commitsSince >= threshold) {
      reasons.push(
        `${row.epic}: ${String(row.commitsSince)} commits since its last entry (threshold ${String(threshold)}).`,
      );
    }
  }
  if (reasons.length > 0) {
    lines.push('', ...reasons);
  }

  const state = report.stateOfTheBuild;
  lines.push(
    '',
    state.newestEntryDate === null
      ? 'state-of-the-build due: there are no journal entries yet'
      : `state-of-the-build ${state.status}: newest entry ${state.newestEntryDate}, ${pluralDays(state.daysSince ?? 0)} ago`,
  );
  return `${lines.join('\n')}\n`;
}

function pluralDays(days: number): string {
  return days === 1 ? '1 day' : `${String(days)} days`;
}
