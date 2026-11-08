import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EPIC_EXIT_CHECKLIST_PATH } from '../src/check/journal';
import {
  DEFAULT_DUE_THRESHOLD,
  computeJournalDue,
  formatJournalDue,
  readClosingTickets,
} from '../src/journal/due';
import type { EpicDueRow, JournalDueInput } from '../src/journal/due';
import type { JournalEntrySummary } from '../src/journal/entries';
import type { CommitRecord } from '../src/journal/git';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Midday local time, so the local date is 2026-12-08 in every time zone. */
const NOW = new Date(2026, 11, 8, 12, 0, 0);

const CLOSING_TICKETS = new Map([
  ['FND', 'FND-13'],
  ['SIM', 'SIM-13'],
]);

/** `count` commits for one ticket, all on `date`. */
function commitsFor(ticketId: string, count: number, date: string): CommitRecord[] {
  return Array.from({ length: count }, (_unused, index) => ({
    date,
    subject: `[${ticketId}] change ${String(index + 1)}`,
  }));
}

function entry(fileName: string, date: string, epics: readonly string[]): JournalEntrySummary {
  return { fileName, date, epics };
}

function dueInput(overrides: Partial<JournalDueInput>): JournalDueInput {
  return {
    commits: [],
    entries: [entry('2026-12-recent.md', '2026-12-01', [])],
    closingTickets: CLOSING_TICKETS,
    now: NOW,
    threshold: DEFAULT_DUE_THRESHOLD,
    ...overrides,
  };
}

function rowFor(rows: readonly EpicDueRow[], epic: string): EpicDueRow {
  const row = rows.find((candidate) => candidate.epic === epic);
  if (row === undefined) {
    throw new Error(`no row for ${epic}`);
  }
  return row;
}

describe('computeJournalDue', () => {
  const entries = [
    entry('2026-11-foundation.md', '2026-11-10', ['FND']),
    entry('2026-11-sim.md', '2026-11-12', ['SIM']),
  ];

  it('marks an epic with 12 commits since its last entry due', () => {
    const report = computeJournalDue(
      dueInput({
        entries,
        commits: [
          ...commitsFor('FND-01', 4, '2026-11-01'),
          ...commitsFor('FND-14', 12, '2026-11-20'),
        ],
      }),
    );
    const row = rowFor(report.rows, 'FND');
    expect(row.lastEntry?.fileName).toBe('2026-11-foundation.md');
    expect(row.commitsSince).toBe(12);
    expect(row.status).toBe('due');
  });

  it('marks an epic with 3 commits since its last entry ok', () => {
    const report = computeJournalDue(
      dueInput({ entries, commits: commitsFor('SIM-14', 3, '2026-11-20') }),
    );
    expect(rowFor(report.rows, 'SIM')).toMatchObject({ commitsSince: 3, status: 'ok' });
  });

  it('counts commits on the entry date as covered by it', () => {
    const report = computeJournalDue(
      dueInput({ entries, commits: commitsFor('FND-12', 15, '2026-11-10') }),
    );
    expect(rowFor(report.rows, 'FND')).toMatchObject({ commitsSince: 0, status: 'ok' });
  });

  it('marks an epic due when its closing ticket appears with no later entry', () => {
    const report = computeJournalDue(
      dueInput({
        entries,
        commits: [{ date: '2026-11-25', subject: '[FND-13] Write the Foundation journal entry' }],
      }),
    );
    expect(rowFor(report.rows, 'FND')).toMatchObject({
      commitsSince: 1,
      closingTicketSeen: 'FND-13',
      status: 'due',
    });
  });

  it('marks the epic ok again once an entry lists it after the closing ticket', () => {
    const report = computeJournalDue(
      dueInput({
        entries: [...entries, entry('2026-11-foundation-2.md', '2026-11-26', ['FND'])],
        commits: [{ date: '2026-11-25', subject: '[FND-13] Write the Foundation journal entry' }],
      }),
    );
    expect(rowFor(report.rows, 'FND')).toMatchObject({ closingTicketSeen: null, status: 'ok' });
  });

  it('lists one row per epic prefix in the commits, with no entry when none lists it', () => {
    const report = computeJournalDue(
      dueInput({
        entries,
        commits: [
          { date: '2026-11-02', subject: 'feat: shell (UI-01)' },
          { date: '2026-11-03', subject: 'fix: rounding (SIM-05, FND-14)' },
          { date: '2026-11-04', subject: 'chore: tidy up' },
        ],
      }),
    );
    expect(report.rows.map((row) => row.epic)).toEqual(['FND', 'SIM', 'UI']);
    expect(rowFor(report.rows, 'UI')).toMatchObject({ lastEntry: null, commitsSince: 1 });
  });

  it('flags state-of-the-build when the newest entry is 31 days old, not at 30', () => {
    const old = computeJournalDue(
      dueInput({ entries: [entry('2026-11-old.md', '2026-11-07', [])] }),
    );
    expect(old.stateOfTheBuild).toEqual({
      status: 'due',
      newestEntryDate: '2026-11-07',
      daysSince: 31,
    });
    expect(formatJournalDue(old, DEFAULT_DUE_THRESHOLD)).toContain('state-of-the-build due');

    const recent = computeJournalDue(
      dueInput({ entries: [entry('2026-11-old.md', '2026-11-08', [])] }),
    );
    expect(recent.stateOfTheBuild).toMatchObject({ status: 'ok', daysSince: 30 });
  });

  it('prints the Epic | Last entry | Commits since | Status table', () => {
    const report = computeJournalDue(
      dueInput({ entries, commits: commitsFor('SIM-14', 3, '2026-11-20') }),
    );
    const lines = formatJournalDue(report, DEFAULT_DUE_THRESHOLD).split('\n');
    expect(lines[0]).toMatch(/^\| Epic +\| Last entry +\| Commits since +\| Status +\|$/);
    expect(lines[2]).toMatch(/^\| SIM +\| 2026-11-sim\.md \(2026-11-12\) +\| 3 +\| ok +\|$/);
  });
});

describe('readClosingTickets', () => {
  it('reads FND-13, SIM-13, WLD-12, UI-14 and VIS-10 from the epic exit checklist', async () => {
    const text = await readFile(join(REPO_ROOT, EPIC_EXIT_CHECKLIST_PATH), 'utf8');
    expect(Object.fromEntries(readClosingTickets(text))).toEqual({
      FND: 'FND-13',
      SIM: 'SIM-13',
      WLD: 'WLD-12',
      UI: 'UI-14',
      VIS: 'VIS-10',
    });
  });

  it('skips rows that are not an epic prefix and a ticket ID', () => {
    const text = [
      '## Closing tickets',
      '',
      '| Epic | Closing ticket ID | Entry file |',
      '| ---- | ----------------- | ---------- |',
      '| `ABC` | `ABC-09` | - |',
      '| <EPIC> | <EPIC>-NN | - |',
      '',
    ].join('\n');
    expect(Object.fromEntries(readClosingTickets(text))).toEqual({ ABC: 'ABC-09' });
  });
});
