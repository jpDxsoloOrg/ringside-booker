import type { EventInstanceId } from '@ringside/engine';
import { routes } from '@/app/routes';

/** The names of the booking screen's search parameters. */
export const BOOKING_PARAMS = { event: 'event' } as const;

/**
 * The booking screen on one show: `/game/booking?event=evi_…`. The show-day gate's "Go to show"
 * button and the calendar's "Book this show" link here.
 */
export function bookingShowUrl(eventInstanceId: EventInstanceId): string {
  const search = new URLSearchParams({ [BOOKING_PARAMS.event]: eventInstanceId });
  return `${routes.game.booking()}?${search.toString()}`;
}
