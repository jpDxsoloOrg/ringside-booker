import type { CalendarShow } from '@ringside/engine';
import { formatGameDate } from '@/components/format';
import type { RoleTone } from '@/components/tone';

/** What a projected show's status reads. */
export const PROJECTED_STATUS_TEXT = 'Projected: not on the schedule yet';

/**
 * A show's status in words, as the show sheet states it. A show the viewer called off says when;
 * a rival's just says it was cancelled. A show whose day passed says whether it had a card.
 */
export function statusText(show: CalendarShow): string {
  switch (show.status) {
    case 'scheduled':
      return 'Scheduled';
    case 'booked':
      return 'Booked';
    case 'completed':
      return 'Completed';
    case 'projected':
      return PROJECTED_STATUS_TEXT;
    case 'cancelled':
      break;
  }
  if (show.cancellation?.reason === 'notRun') {
    return show.segmentCount === 0 ? 'Not run (no card)' : 'Not run';
  }
  if (show.isOwn && show.cancellation !== null) {
    return `Cancelled by you on ${formatGameDate(show.cancellation.on, 'dayMonthYear')}`;
  }
  return 'Cancelled';
}

/** The badge tone that goes with each status. The words always sit beside it. */
export function statusTone(show: CalendarShow): RoleTone {
  switch (show.status) {
    case 'scheduled':
      return 'data';
    case 'booked':
      return 'action';
    case 'completed':
      return 'positive';
    case 'projected':
      return 'neutral';
    case 'cancelled':
      return show.cancellation?.reason === 'notRun' ? 'negative' : 'neutral';
  }
}
