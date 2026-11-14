import { PUSH_LEVELS } from '@ringside/engine';
import type { ContractKind, ContractPerkKey, ContractRow, Push } from '@ringside/engine';
import type { ContractStatus } from '@/components/ContractStatusChip';

/**
 * The Contracts screen's words. Card positions reuse the roster's `pushLabel` and roles the
 * promotion profile's `EMPLOYMENT_ROLE_LABELS`, so a person reads the same everywhere.
 */

/** Each kind of contract in words. */
export const CONTRACT_KIND_LABELS: Readonly<Record<ContractKind, string>> = {
  written: 'Written',
  perAppearance: 'Per appearance',
  development: 'Development',
  tour: 'Tour',
};

/** Each perk in words, as a small badge. */
export const CONTRACT_PERK_LABELS: Readonly<Record<ContractPerkKey, string>> = {
  creativeControl: 'Creative control',
  noHouseShows: 'No house shows',
  ironClad: 'Iron-clad',
  travelCovered: 'Travel covered',
};

/** What the end-date cell says for a contract with no end date. */
export const NO_END_DATE = 'No end date';

/** The days an expiring contract counts as "ending soon" when the tunable can't be read. */
export const DEFAULT_EXPIRING_SOON_DAYS = 30;

/** A push's place for sorting, top of the card first. */
export function pushRank(push: Push): number {
  return PUSH_LEVELS.indexOf(push);
}

/**
 * The chips a row shows, most urgent first: a request or walk-out risk, the unhappy clock, a new
 * notice, then where the contract stands (ended, starting, ending soon or running).
 */
export function contractStatusesOf(
  row: Pick<
    ContractRow,
    'status' | 'startsOn' | 'daysLeft' | 'endReason' | 'notice' | 'unhappy' | 'request' | 'walkout'
  >,
  expiringSoonDays: number,
  expiringWindowDays: number,
): ContractStatus[] {
  const chips: ContractStatus[] = [];
  if (row.request?.status === 'open') chips.push({ kind: 'wantsToLeave' });
  if (row.walkout !== null && row.walkout.chance > 0) {
    chips.push({ kind: 'walkoutRisk', chance: row.walkout.chance });
  }
  if (row.unhappy !== null) {
    chips.push({
      kind: 'unhappy',
      days: row.unhappy.days,
      of: row.unhappy.of,
      paused: row.unhappy.paused,
    });
  }
  if (row.notice === 'unseen') chips.push({ kind: 'unseen' });
  if (row.endReason !== null) {
    chips.push({ kind: 'ended', reason: row.endReason });
  } else if (row.status === 'signed') {
    chips.push({ kind: 'starts', on: row.startsOn });
  } else if (row.daysLeft !== null && row.daysLeft <= expiringWindowDays) {
    chips.push({
      kind: 'expiring',
      daysLeft: row.daysLeft,
      warn: row.daysLeft <= expiringSoonDays,
    });
  } else if (chips.length === 0) {
    chips.push({ kind: 'active' });
  }
  return chips;
}
