import { describe, expect, it } from 'vitest';
import { fakeSlot } from '@/test/fakeStorage';
import {
  formatIssue,
  formatRelativeTime,
  formatSaveSize,
  slotSummaryLine,
  UNREADABLE_STAGES,
} from './slotFormat';

const NOW = new Date('2026-11-08T12:00:00.000Z');

describe('formatRelativeTime', () => {
  it.each([
    ['2026-11-08T11:59:30.000Z', 'just now'],
    ['2026-11-08T11:55:00.000Z', '5 minutes ago'],
    ['2026-11-08T09:00:00.000Z', '3 hours ago'],
    ['2026-11-07T12:00:00.000Z', 'yesterday'],
    ['2026-11-05T12:00:00.000Z', '3 days ago'],
    ['2026-10-25T12:00:00.000Z', '2 weeks ago'],
    ['2026-08-08T12:00:00.000Z', '3 months ago'],
    ['2024-11-08T12:00:00.000Z', '2 years ago'],
  ])('puts %s as "%s"', (isoTime, expected) => {
    expect(formatRelativeTime(isoTime, NOW)).toBe(expected);
  });

  it('copes with a time that does not parse', () => {
    expect(formatRelativeTime('not a time', NOW)).toBe('at an unknown time');
  });
});

describe('formatSaveSize', () => {
  it('uses KB below a megabyte and MB from there', () => {
    expect(formatSaveSize(10)).toBe('0.1 KB');
    expect(formatSaveSize(48 * 1024)).toBe('48.0 KB');
    expect(formatSaveSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSaveSize(5.25 * 1024 * 1024)).toBe('5.3 MB');
  });
});

describe('slot words', () => {
  it('writes an issue as path: message, or the message alone', () => {
    expect(formatIssue({ path: 'header.gameDate', message: 'Invalid date' })).toBe(
      'header.gameDate: Invalid date',
    );
    expect(formatIssue({ path: '', message: 'Not gzip' })).toBe('Not gzip');
  });

  it('sums a slot up as label, promotion and date', () => {
    expect(slotSummaryLine(fakeSlot({ label: 'League' }))).toBe(
      'League · Test Promotion A · Apr 10, 2026',
    );
    expect(slotSummaryLine(fakeSlot({ label: 'Solo', header: { promotionName: null } }))).toBe(
      'Solo · Unemployed · Apr 10, 2026',
    );
  });

  it('treats only file-level failures as unreadable', () => {
    expect([...UNREADABLE_STAGES]).toEqual(['decode', 'parse', 'format']);
  });
});
