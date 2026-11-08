/**
 * Words and numbers the save screens show: relative times, file sizes, load stages and backup
 * reasons. Pure functions, so they are tested without rendering anything.
 */

import type { LoadIssue } from '@ringside/engine';
import { formatGameDate } from '@/components/format';
import type { BackupReason, SlotRecord } from '@/storage';
import type { LoadFailureStage } from '@/worker/engineHost';

/** What a slot shows for a save with no promotion in its header. */
export const UNEMPLOYED_LABEL = 'Unemployed';

/** How many issues an error report lists before "and N more". */
export const MAX_SHOWN_ISSUES = 20;

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

const RELATIVE_UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', YEAR_MS],
  ['month', MONTH_MS],
  ['week', WEEK_MS],
  ['day', DAY_MS],
  ['hour', HOUR_MS],
  ['minute', MINUTE_MS],
];

const relativeTimeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * A real-world time relative to `now`: "3 days ago", "yesterday", "5 minutes ago", "just now".
 * Uses the largest unit that fits; a time that does not parse gives "at an unknown time".
 */
export function formatRelativeTime(isoTime: string, now: Date = new Date()): string {
  const then = Date.parse(isoTime);
  if (Number.isNaN(then)) return 'at an unknown time';
  const elapsed = now.getTime() - then;
  if (Math.abs(elapsed) < MINUTE_MS) return 'just now';
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= unitMs) {
      return relativeTimeFormat.format(-Math.round(elapsed / unitMs), unit);
    }
  }
  return 'just now';
}

const KILOBYTE = 1024;
const MEGABYTE = 1024 * KILOBYTE;

/** A save's size in KB below a megabyte and in MB from there, one decimal place. */
export function formatSaveSize(bytes: number): string {
  if (bytes >= MEGABYTE) return `${(bytes / MEGABYTE).toFixed(1)} MB`;
  return `${Math.max(0.1, bytes / KILOBYTE).toFixed(1)} KB`;
}

/** Each load stage as a player reads it. */
export const LOAD_STAGE_LABELS: Readonly<Record<LoadFailureStage, string>> = {
  storage: 'Reading the save from this browser',
  decode: 'Unpacking the file',
  parse: 'Reading the save data',
  format: 'Checking it is a Ringside Booker save',
  version: 'Checking the save version',
  migrate: 'Upgrading an older save',
  validate: 'Checking the save contents',
  build: 'Building the game world',
  integrity: 'Checking the world fits together',
};

/**
 * Stages where the file itself is unreadable: such a slot can still be exported for a bug report
 * or deleted, but loading it again would fail the same way.
 */
export const UNREADABLE_STAGES: ReadonlySet<LoadFailureStage> = new Set([
  'decode',
  'parse',
  'format',
]);

/** One issue as a line: `path: message`, or just the message for the whole file. */
export function formatIssue(issue: LoadIssue): string {
  return issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`;
}

/** Why a backup was taken, as a short phrase. */
export const BACKUP_REASON_LABELS: Readonly<Record<BackupReason, string>> = {
  manualSave: 'Before a manual save',
  monthly: 'Monthly backup',
  beforeImportOverwrite: 'Before an import',
};

/** The promotion a slot plays, or "Unemployed". */
export function slotPromotionName(slot: SlotRecord): string {
  return slot.header.promotionName ?? UNEMPLOYED_LABEL;
}

/** `{label} · {promotion} · {game date}`: a slot in one line, as Continue shows it. */
export function slotSummaryLine(slot: SlotRecord): string {
  return `${slot.label} · ${slotPromotionName(slot)} · ${formatGameDate(slot.header.gameDate)}`;
}
