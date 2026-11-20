/**
 * The "One show a week" rule of a draft-start game (`draftSchedule: weekly`): every promotion runs
 * exactly one weekly show. The schedule editor asks here before it adds a show, so the player
 * cannot add a second recurring show or a one-off special, and an edit keeps the show weekly on
 * one day. Under the Open schedule (or without a draft) nothing is refused.
 *
 * Design: docs/design/draft.md#schedule.
 */

import type { Reason } from '../../core/api/result';
import { compareDates } from '../../core/date';
import type { EventDefinitionId, PromotionId } from '../../core/ids';
import type { Recurrence } from '../../model/entities/event-definition';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { getSetting } from '../newgame/settings';
import './settings';

export const ONE_WEEKLY_SHOW_CODE = 'draft.oneWeeklyShow';

function oneShowAWeek(read: GameWorldView): boolean {
  return getSetting(read, 'draftStart') && getSetting(read, 'draftSchedule') === 'weekly';
}

/** Why this schedule change breaks "One show a week", or nothing. */
export function weeklyScheduleRefusals(
  read: GameWorldView,
  change:
    | { kind: 'create'; promotionId: PromotionId; recurrence: DeepReadonly<Recurrence> }
    | { kind: 'update'; eventDefinitionId: EventDefinitionId; recurrence: DeepReadonly<Recurrence> }
    | { kind: 'oneOff'; promotionId: PromotionId },
): Reason[] {
  if (!oneShowAWeek(read)) {
    return [];
  }
  const refuse = (message: string, field?: string): Reason[] => [
    { code: ONE_WEEKLY_SHOW_CODE, message, ...(field === undefined ? {} : { field }) },
  ];
  if (change.kind === 'oneOff') {
    return refuse('This game runs one weekly show per promotion: no specials.');
  }
  const weeklyOnOneDay =
    change.recurrence.kind === 'weekly' && change.recurrence.weekdays.length === 1;
  if (!weeklyOnOneDay) {
    return refuse('This game runs one weekly show per promotion: pick one weekday.', 'recurrence');
  }
  if (change.kind === 'create') {
    const today = read.meta.currentDate;
    const running = read.tables.eventDefinitions
      .values()
      .some(
        (definition) =>
          definition.promotionId === change.promotionId &&
          (definition.activeUntil === null || compareDates(definition.activeUntil, today) >= 0),
      );
    if (running) {
      return refuse(
        'This game runs one weekly show per promotion: change or retire the one you have.',
      );
    }
  }
  return [];
}
