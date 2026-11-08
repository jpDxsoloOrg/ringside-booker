import { posix } from 'node:path';

import { z } from 'zod';

import { blankOut, bodyText, readTableAfterHeading } from './markdown';
import { makeIssue, schemaIssues } from './rules';
import type { CheckIssue, SourceFile } from './types';

// Rules for dev journal entries, docs/dev-journal/YYYY-MM-<topic>.md. The fields and sections
// are the ones docs/dev-journal/README.md and _template.md describe; change them together.

export const JOURNAL_DIR = 'docs/dev-journal';
export const JOURNAL_README_PATH = 'docs/dev-journal/README.md';

/** The epic exit checklist and closing-ticket table. It lives with the entries but is not one. */
export const EPIC_EXIT_CHECKLIST_PATH = 'docs/dev-journal/epic-exit-checklist.md';

/** The journal template and inbox, which journal:new reads. */
export const JOURNAL_TEMPLATE_PATH = 'docs/dev-journal/_template.md';
export const JOURNAL_INBOX_PATH = 'docs/dev-journal/_inbox.md';

/** Topics are kebab-case: lowercase letters and digits separated by single hyphens. */
export const JOURNAL_TOPIC_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Markdown files in docs/dev-journal that are not entries, besides the `_` templates and inbox. */
const JOURNAL_NON_ENTRY_FILES: ReadonlySet<string> = new Set([
  'README.md',
  posix.basename(EPIC_EXIT_CHECKLIST_PATH),
]);

/**
 * Whether a Markdown file in docs/dev-journal is a journal entry, or is meant to be one. The
 * README, the epic exit checklist and `_` files (the template and the inbox) are not.
 */
export function isJournalEntryFileName(fileName: string): boolean {
  return !JOURNAL_NON_ENTRY_FILES.has(fileName) && !fileName.startsWith('_');
}

/** `YYYY-MM-<topic>.md`, with an optional `-2`, `-3`... for a second entry on the same topic. */
export const JOURNAL_FILE_NAME_PATTERN = /^\d{4}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*(-\d+)?\.md$/;

/** The ten `##` sections every entry has, in this order. */
export const JOURNAL_SECTIONS = [
  'Summary',
  'What I built',
  'Decisions and why',
  'How this differs from other games in the genre',
  'Numbers',
  'What went wrong or surprised me',
  'Open questions',
  'Blog angle',
  'Raw notes',
  'Next',
] as const;

const INDEX_HEADING = 'Index';

export const JournalFrontmatter = z
  .object({
    title: z.string().trim().min(1),
    date: z.iso.date({ error: 'date must be an ISO date, YYYY-MM-DD' }),
    epics: z.array(
      z.string().regex(/^[A-Z][A-Z0-9]*$/, {
        error: 'epics are epic prefixes in capitals, such as FND or SIM',
      }),
    ),
    milestone: z.string(),
    tickets: z.array(
      z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/, {
        error: 'tickets are ticket IDs such as FND-01',
      }),
    ),
    blogCandidates: z.array(z.string().trim().min(1)),
  })
  .strict();

export type JournalFrontmatter = z.infer<typeof JournalFrontmatter>;

/** Context for the rules that check one journal entry. */
export interface JournalRuleContext {
  readonly source: SourceFile;
  /** docs/dev-journal/README.md, or null when it does not exist. */
  readonly readme: SourceFile | null;
}

function fileNameOf(source: SourceFile): string {
  return posix.basename(source.path);
}

/** Entries are named `YYYY-MM-<topic>.md` with a real month. */
export function journalFileName(context: JournalRuleContext): CheckIssue[] {
  const fileName = fileNameOf(context.source);
  const month = Number(fileName.slice(5, 7));
  if (JOURNAL_FILE_NAME_PATTERN.test(fileName) && month >= 1 && month <= 12) {
    return [];
  }
  return [
    makeIssue(
      'journal-file-name',
      'error',
      context.source.path,
      null,
      'journal entries are named YYYY-MM-<kebab-topic>.md, for example 2026-11-project-kickoff.md',
    ),
  ];
}

/** The frontmatter has the six template fields, and `date` falls in the file name's month. */
export function journalFrontmatter(context: JournalRuleContext): CheckIssue[] {
  const { source } = context;
  if (source.frontmatterProblem !== null) {
    return [
      makeIssue(
        'journal-frontmatter',
        'error',
        source.path,
        source.frontmatterProblem.line,
        source.frontmatterProblem.message,
      ),
    ];
  }
  const parsed = JournalFrontmatter.safeParse(source.frontmatterData);
  if (!parsed.success) {
    return schemaIssues(source, 'journal-frontmatter', {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)),
        message: issue.message,
      })),
    });
  }

  const fileName = fileNameOf(source);
  const fileMonth = /^(\d{4}-\d{2})-/.exec(fileName)?.[1];
  const dateMonth = parsed.data.date.slice(0, 7);
  if (fileMonth !== undefined && fileMonth !== dateMonth) {
    return schemaIssues(source, 'journal-frontmatter', {
      ok: false,
      issues: [
        {
          path: ['date'],
          message: `${parsed.data.date} is not in ${fileMonth}, the month in the file name`,
        },
      ],
    });
  }
  return [];
}

/** The ten template sections are all there, as `##` headings, in the template's order. */
export function journalSections(context: JournalRuleContext): CheckIssue[] {
  const { source } = context;
  const lines = blankOut(bodyText(source), { fences: true, comments: true }).split('\n');
  const headingLines = new Map<string, number>();
  lines.forEach((line, index) => {
    const heading = /^##[ \t]+(.+?)[ \t]*$/.exec(line)?.[1];
    if (heading !== undefined && !headingLines.has(heading)) {
      headingLines.set(heading, index + 1);
    }
  });

  const issues: CheckIssue[] = [];
  let previous: { section: string; line: number } | null = null;
  for (const section of JOURNAL_SECTIONS) {
    const line = headingLines.get(section);
    if (line === undefined) {
      issues.push(
        makeIssue(
          'journal-sections',
          'error',
          source.path,
          null,
          `missing the "## ${section}" section (write "Nothing this time." if it is empty)`,
        ),
      );
      continue;
    }
    if (previous !== null && line < previous.line) {
      issues.push(
        makeIssue(
          'journal-sections',
          'error',
          source.path,
          line,
          `"## ${section}" comes before "## ${previous.section}"; keep the template's order`,
        ),
      );
      continue;
    }
    previous = { section, line };
  }
  return issues;
}

/** Each entry has a row in the README's index table. A warning: the index is easy to forget. */
export function journalIndexSync(context: JournalRuleContext): CheckIssue[] {
  const { source, readme } = context;
  const fileName = fileNameOf(source);
  const rows = readme === null ? null : readTableAfterHeading(readme.text, INDEX_HEADING);
  const linked = new Set<string>();
  for (const row of rows ?? []) {
    for (const cell of row.cells) {
      for (const match of cell.matchAll(/\]\(([^)\s]+)\)/g)) {
        linked.add(posix.basename((match[1] ?? '').replace(/#.*$/, '')));
      }
    }
  }
  if (linked.has(fileName)) {
    return [];
  }
  return [
    makeIssue(
      'journal-index-sync',
      'warning',
      source.path,
      null,
      `no row links to this entry in the index of ${JOURNAL_README_PATH}`,
    ),
  ];
}
