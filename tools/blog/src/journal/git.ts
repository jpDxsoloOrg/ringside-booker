import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Reads commit history for the journal tools. Git runs through execFile with an argument array,
// never through a shell, so a date or topic can never be read as a shell command.

const execFileAsync = promisify(execFile);

/** Big enough for the whole history of a long-running repo. */
const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** The group commit subjects without a ticket ID go under. */
export const UNTRACKED = 'untracked';

/** A ticket ID such as FND-01: capital letters, a hyphen and a number. */
export const TICKET_ID_PATTERN = /^[A-Z]+-\d+$/;

/** `[FND-01] Scaffold the monorepo` */
const BRACKETED_ID = /\[([A-Z]+-\d+)\]/;
/** `FND-02: World store` */
const LEADING_ID = /^([A-Z]+-\d+):/;
/** `feat: world store (FND-02)` or `fix: rounding (SIM-05, FND-14)`, the conventional form. */
const TRAILING_IDS = /\(([A-Z]+-\d+(?:\s*,\s*[A-Z]+-\d+)*)\)\s*$/;

/** One commit: its committer date (`YYYY-MM-DD`) and subject line. */
export interface CommitRecord {
  readonly date: string;
  readonly subject: string;
}

async function runGit(args: readonly string[], repoRoot: string): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER_BYTES,
  });
  return stdout;
}

function nonEmptyLines(output: string): string[] {
  return output.split('\n').filter((line) => line.trim() !== '');
}

/**
 * The subjects of every commit made on or after `sinceIsoDate` (`YYYY-MM-DD`, read as the start
 * of that day), oldest first. Merge commits are skipped: their subjects repeat the work they merge.
 */
export async function readCommitSubjects(
  sinceIsoDate: string,
  repoRoot: string,
): Promise<string[]> {
  const output = await runGit(
    ['log', `--since=${sinceIsoDate} 00:00:00`, '--no-merges', '--reverse', '--pretty=%s'],
    repoRoot,
  );
  return nonEmptyLines(output);
}

/** Every commit in the history with its committer date, oldest first. Merge commits are skipped. */
export async function readCommitLog(repoRoot: string): Promise<CommitRecord[]> {
  const output = await runGit(['log', '--no-merges', '--reverse', '--pretty=%cs%x09%s'], repoRoot);
  return nonEmptyLines(output).map((line) => {
    const tabIndex = line.indexOf('\t');
    return { date: line.slice(0, tabIndex), subject: line.slice(tabIndex + 1) };
  });
}

/** The committer date (`YYYY-MM-DD`) of the project's first commit, or null in an empty repo. */
export async function readFirstCommitDate(repoRoot: string): Promise<string | null> {
  let output: string;
  try {
    output = await runGit(['log', '--max-parents=0', '--pretty=%cs'], repoRoot);
  } catch {
    // `git log` fails in a repository with no commits yet.
    return null;
  }
  const dates = nonEmptyLines(output).sort();
  return dates[0] ?? null;
}

/**
 * The ticket IDs a commit subject names: `[FND-01] subject`, a leading `FND-01: subject`, or the
 * conventional `type: subject (FND-01)`, which may list several IDs. Empty when it names none.
 */
export function ticketIdsIn(subject: string): string[] {
  const bracketed = BRACKETED_ID.exec(subject)?.[1];
  if (bracketed !== undefined) {
    return [bracketed];
  }
  const leading = LEADING_ID.exec(subject)?.[1];
  if (leading !== undefined) {
    return [leading];
  }
  const trailing = TRAILING_IDS.exec(subject)?.[1];
  if (trailing !== undefined) {
    return [...new Set(trailing.split(',').map((id) => id.trim()))];
  }
  return [];
}

/** The epic prefix of a ticket ID: `FND` for `FND-01`. */
export function epicOf(ticketId: string): string {
  return ticketId.slice(0, ticketId.lastIndexOf('-'));
}

/**
 * Groups commit subjects by the ticket IDs they name, keeping the order the subjects came in.
 * A subject naming two tickets is listed under both. Subjects without an ID go under UNTRACKED,
 * which comes last, so nothing silently disappears.
 */
export function groupByTicket(subjects: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const untracked: string[] = [];
  for (const subject of subjects) {
    const ids = ticketIdsIn(subject);
    if (ids.length === 0) {
      untracked.push(subject);
    }
    for (const id of ids) {
      const group = groups.get(id);
      if (group === undefined) {
        groups.set(id, [subject]);
      } else {
        group.push(subject);
      }
    }
  }
  if (untracked.length > 0) {
    groups.set(UNTRACKED, untracked);
  }
  return groups;
}
