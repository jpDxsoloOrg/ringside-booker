import { useNavigate } from 'react-router-dom';
import type { CalendarShow, EventInstanceId } from '@ringside/engine';
import { Button } from '@/components/Button';
import { registerShowSheetAction } from '@/screens/calendar/registry';
import type { ShowSheetActionDefinition, ShowSheetContext } from '@/screens/calendar/registry';
import { bookingShowUrl } from './bookingUrl';

/** True when the sheet's show is one of yours that can still be booked: stored, open, not past. */
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
}

function BookShowButton({ eventInstanceId, show }: BookShowButtonProps) {
  const navigate = useNavigate();
  return (
    <Button
      variant="primary"
      iconStart="booking"
      onClick={() => {
        navigate(bookingShowUrl(eventInstanceId));
      }}
    >
      {show.segmentCount > 0 ? 'Edit card' : 'Book this show'}
    </Button>
  );
}

/** "Book this show" (or "Edit card") in the calendar's show sheet, for your own open shows. */
export const BOOK_SHOW_ACTION: ShowSheetActionDefinition = {
  id: 'booking.book',
  order: 10,
  render: (context) =>
    canOpenInBooking(context) && context.show.eventInstanceId !== null ? (
      <BookShowButton eventInstanceId={context.show.eventInstanceId} show={context.show} />
    ) : null,
};

registerShowSheetAction(BOOK_SHOW_ACTION);
