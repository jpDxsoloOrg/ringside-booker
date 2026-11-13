import { useNavigate } from 'react-router-dom';
import type { CalendarShow, EventInstanceId, GameDate } from '@ringside/engine';
import { Button } from '@/components/Button';
import { registerShowSheetAction } from '@/screens/calendar/registry';
import type { ShowSheetActionDefinition, ShowSheetContext } from '@/screens/calendar/registry';
import { bookingShowUrl } from './bookingUrl';

/**
 * True when the sheet's show is one of yours that can still be booked: stored, open (`booked` only
 * comes from a save made before the lock was removed), not past.
 */
export function canOpenInBooking({ show, isOwn, today }: ShowSheetContext): boolean {
  return (
    isOwn &&
    show.eventInstanceId !== null &&
    (show.status === 'scheduled' || show.status === 'booked') &&
    show.date >= today
  );
}

interface BookShowButtonProps {
  readonly eventInstanceId: EventInstanceId;
  readonly show: CalendarShow;
  readonly today: GameDate;
}

/**
 * "Go to the show" on its day (you run it from there, EVT2-09), else "Edit card" once something is
 * booked, else "Book this show". All three open the show in Booking.
 */
export function bookShowLabel(show: CalendarShow, today: GameDate): string {
  if (show.date === today) return 'Go to the show';
  return show.segmentCount > 0 ? 'Edit card' : 'Book this show';
}

function BookShowButton({ eventInstanceId, show, today }: BookShowButtonProps) {
  const navigate = useNavigate();
  return (
    <Button
      variant="primary"
      iconStart="booking"
      onClick={() => {
        navigate(bookingShowUrl(eventInstanceId));
      }}
    >
      {bookShowLabel(show, today)}
    </Button>
  );
}

/**
 * "Book this show" (or "Edit card", or "Go to the show" on its day) in the calendar's show sheet,
 * for your own open shows.
 */
export const BOOK_SHOW_ACTION: ShowSheetActionDefinition = {
  id: 'booking.book',
  order: 10,
  render: (context) =>
    canOpenInBooking(context) && context.show.eventInstanceId !== null ? (
      <BookShowButton
        eventInstanceId={context.show.eventInstanceId}
        show={context.show}
        today={context.today}
      />
    ) : null,
};

registerShowSheetAction(BOOK_SHOW_ACTION);
