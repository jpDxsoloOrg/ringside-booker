/**
 * The medical care a person gets: the best medical policy among their employers, or the free-agent
 * level when nobody employs them. Shared by condition recovery here and by injury healing and
 * injury risk (WRK6-03, WRK6-04). Design: docs/design/health.md#medical-care.
 */

import { compareDates, type GameDate } from '../../core/date';
import type { PersonId, PromotionId } from '../../core/ids';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';

/** A medical policy level: 0 (none) to 3 (the best). */
export type MedicalLevel = 0 | 1 | 2 | 3;

export interface MedicalCare {
  level: MedicalLevel;
  /** The employer whose policy sets the level, or null for the free-agent level. */
  promotionId: PromotionId | null;
}

function asMedicalLevel(value: number): MedicalLevel {
  if (value <= 0) {
    return 0;
  }
  if (value >= 3) {
    return 3;
  }
  return value < 2 ? 1 : 2;
}

/**
 * The highest `policies.medical` among the person's active employments that have started by
 * `date` (ties go to the lower promotion id), or `health.medical.freeAgentLevel` with no
 * promotion. Offered, ended and future contracts do not count.
 */
export function medicalLevelOf(
  read: GameWorldView,
  personId: PersonId,
  date: GameDate,
  tunables: EngineTunables,
): MedicalCare {
  let best: MedicalCare | null = null;
  for (const employment of read.tables.employments.lookup('byPerson', personId)) {
    if (employment.status !== 'active' || compareDates(employment.startsOn, date) > 0) {
      continue;
    }
    const promotion = read.tables.promotions.get(employment.promotionId);
    if (promotion === undefined) {
      continue;
    }
    const level = promotion.policies.medical;
    if (
      best === null ||
      level > best.level ||
      (level === best.level && best.promotionId !== null && promotion.id < best.promotionId)
    ) {
      best = { level, promotionId: promotion.id };
    }
  }
  return (
    best ?? {
      level: asMedicalLevel(tunables.get('health.medical.freeAgentLevel')),
      promotionId: null,
    }
  );
}
