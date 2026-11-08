import { CURRENT_FORMAT_VERSION, ENGINE_VERSION, parseGameDate } from '@ringside/engine';
import type { SaveHeader } from '@ringside/engine';
import type { SlotRecord } from '@/storage';

/** A gallery slot: a sample league with whatever the entry wants changed. */
function sampleSlot(
  slotId: string,
  label: string,
  overrides: Partial<Omit<SlotRecord, 'header'>> & { readonly header?: Partial<SaveHeader> } = {},
): SlotRecord {
  const { header, ...rest } = overrides;
  return {
    slotId,
    label,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-11-05T12:00:00.000Z',
    lastAutosaveAt: null,
    formatVersion: CURRENT_FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    sizes: { current: 47 * 1024, autosave: null },
    backups: [],
    ...rest,
    header: {
      worldName: 'Sample world',
      promotionName: 'Harbour City Wrestling',
      promotionShortName: 'HCW',
      gameDate: parseGameDate('2031-03-14'),
      startDate: parseGameDate('2031-01-01'),
      daysSimulated: 72,
      cash: null,
      label,
      ...header,
    },
  };
}

/** Sample saved games for the slot card entry. */
export const GALLERY_SAVE_SLOTS = {
  employed: sampleSlot('gallery-employed', 'Northern circuit run', {
    backups: [
      {
        kind: 'backup-1',
        savedAt: '2026-11-04T12:00:00.000Z',
        gameDate: parseGameDate('2031-03-07'),
        sizeBytes: 46 * 1024,
        reason: 'manualSave',
      },
    ],
  }),
  unemployed: sampleSlot('gallery-unemployed', 'Free agent tour', {
    updatedAt: '2026-11-08T11:20:00.000Z',
    formatVersion: 0,
    sizes: { current: 2.4 * 1024 * 1024, autosave: null },
    header: { promotionName: null, promotionShortName: null },
  }),
  broken: sampleSlot('gallery-broken', 'Hand-edited save'),
} as const;
