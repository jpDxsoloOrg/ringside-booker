import { parseGameDate } from '@ringside/engine';
import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_EVERY_DAYS,
  BACKUP_COUNT,
  shouldAutosave,
  type AutosaveInput,
} from './autosave-policy';

function input(overrides: Partial<AutosaveInput> & { last: string | null; now: string }) {
  const { last, now, ...rest } = overrides;
  return {
    lastAutosaveGameDate: last === null ? null : parseGameDate(last),
    currentGameDate: parseGameDate(now),
    playerShowJustCompleted: false,
    reason: 'dayAdvanced' as const,
    ...rest,
  };
}

describe('shouldAutosave', () => {
  it('uses a weekly interval and three backups', () => {
    expect(AUTOSAVE_EVERY_DAYS).toBe(7);
    expect(BACKUP_COUNT).toBe(3);
  });

  it('does not save 6 days after the last autosave', () => {
    expect(shouldAutosave(input({ last: '2027-03-01', now: '2027-03-07' }))).toEqual({
      save: false,
      monthlyBackup: false,
    });
  });

  it('saves 7 days after the last autosave', () => {
    expect(shouldAutosave(input({ last: '2027-03-01', now: '2027-03-08' }))).toEqual({
      save: true,
      monthlyBackup: false,
    });
  });

  it('saves after a completed player show, even the next day', () => {
    expect(
      shouldAutosave(
        input({ last: '2027-03-01', now: '2027-03-02', playerShowJustCompleted: true }),
      ),
    ).toEqual({ save: true, monthlyBackup: false });
  });

  it('saves with a monthly backup when the game month changes', () => {
    expect(shouldAutosave(input({ last: '2027-03-30', now: '2027-04-01' }))).toEqual({
      save: true,
      monthlyBackup: true,
    });
    expect(shouldAutosave(input({ last: '2027-12-29', now: '2028-01-02' }))).toEqual({
      save: true,
      monthlyBackup: true,
    });
  });

  it('sees the same month in another year as a new month', () => {
    expect(shouldAutosave(input({ last: '2027-03-01', now: '2028-03-03' })).monthlyBackup).toBe(
      true,
    );
  });

  it('saves when the page is hidden', () => {
    expect(
      shouldAutosave(input({ last: '2027-03-01', now: '2027-03-01', reason: 'pageHidden' })),
    ).toEqual({ save: true, monthlyBackup: false });
  });

  it('saves without a backup when the slot has no autosave yet', () => {
    expect(shouldAutosave(input({ last: null, now: '2027-03-01' }))).toEqual({
      save: true,
      monthlyBackup: false,
    });
  });
});
