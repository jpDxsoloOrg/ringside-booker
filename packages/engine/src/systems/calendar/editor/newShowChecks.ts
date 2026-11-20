/**
 * The checks for a new dated show (a one-off special): refusals that block it, and warnings that
 * only tell the player something ("Altura already has Overclock that night"). The command and the
 * live-check query both call {@link checkNewShow}, so the sheet shows the command's own words.
 *
 * Design notes: docs/design/calendar.md#schedule-editor.
 */

import type { Reason } from '../../../core/api/result';
import { compareDates, type GameDate } from '../../../core/date';
import type { BrandId, PromotionId, RegionId, VenueId } from '../../../core/ids';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { GameWorldView } from '../../../model/tables';
import {
  checkBrand,
  checkFormat,
  checkName,
  checkPlace,
  dateWords,
  effectiveFromOf,
  maxDateOf,
  type DraftCheckContext,
  type DraftFormat,
} from './definitionDraft';

/** A note that never blocks the show. */
export interface NewShowWarning {
  code: 'sameNightShow' | 'venueBusy';
  message: string;
}

/** A new dated show as the sheet sends it. */
export interface NewShowDraft {
  readonly promotionId: PromotionId;
  readonly name: string;
  readonly brandId: BrandId | null;
  readonly importance: EventImportance;
  readonly format: DraftFormat;
  readonly date: GameDate;
  readonly regionId: RegionId | null;
  readonly venueId: VenueId | null;
}

/** Refusals and warnings for one new dated show. */
export function checkNewShow(
  read: GameWorldView,
  show: NewShowDraft,
  ctx: DraftCheckContext,
): { reasons: Reason[]; warnings: NewShowWarning[] } {
  const reasons: Reason[] = [...checkName(show.name)];
  const promotion = read.tables.promotions.get(show.promotionId);
  const effectiveFrom = effectiveFromOf(ctx);
  const maxDate = maxDateOf(ctx);
  if (compareDates(show.date, effectiveFrom) < 0) {
    reasons.push({
      code: 'dateTooSoon',
      message: `Pick a date from ${dateWords(effectiveFrom)}`,
      field: 'date',
    });
  } else if (compareDates(show.date, maxDate) > 0) {
    reasons.push({
      code: 'dateTooFar',
      message: `Pick a date before ${dateWords(maxDate)}`,
      field: 'date',
    });
  }
  const trimmed = show.name.trim().toLowerCase();
  if (reasons.length === 0) {
    for (const other of read.tables.eventInstances.lookup('byDate', show.date)) {
      if (
        other.promotionId === show.promotionId &&
        other.status !== 'cancelled' &&
        other.name.trim().toLowerCase() === trimmed
      ) {
        reasons.push({
          code: 'nameTakenOnDate',
          message: `${promotion?.name ?? 'This promotion'} already has ${other.name} on ${dateWords(show.date)}`,
          field: 'name',
        });
        break;
      }
    }
  }
  reasons.push(...checkBrand(read, show.promotionId, show.brandId));
  reasons.push(...checkFormat(show.format));
  reasons.push(
    ...checkPlace(
      read,
      show.promotionId,
      { regionId: show.regionId, venueId: show.venueId },
      show.date,
      { region: 'regionId', venue: 'venueId' },
    ),
  );

  const warnings: NewShowWarning[] = [];
  for (const other of read.tables.eventInstances.lookup('byDate', show.date)) {
    if (other.status === 'cancelled') {
      continue;
    }
    if (other.promotionId === show.promotionId && other.name.trim().toLowerCase() !== trimmed) {
      if (!warnings.some((warning) => warning.code === 'sameNightShow')) {
        warnings.push({
          code: 'sameNightShow',
          message: `${promotion?.name ?? 'This promotion'} already has ${other.name} that night`,
        });
      }
    }
    if (show.venueId !== null && other.venueId === show.venueId) {
      const venue = read.tables.venues.get(show.venueId);
      if (!warnings.some((warning) => warning.code === 'venueBusy')) {
        warnings.push({
          code: 'venueBusy',
          message: `${venue?.name ?? 'That venue'} already hosts ${other.name} that night`,
        });
      }
    }
  }
  return { reasons, warnings };
}
