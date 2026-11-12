/**
 * The booking screen's note for a show that has already run: "This show has run" and a way to its
 * results. `booking.card` already refuses edits to a completed show (`canEdit: false`), so the
 * board is read-only by itself; this only says why and where to look instead. Registered through
 * the booking screen's feature list (`screens/booking/sections/index.ts`).
 */
import { useNavigate } from 'react-router-dom';
import type { EventInstanceId } from '@ringside/engine';
import { routes } from '@/app/routes';
import { Button } from '@/components/Button';
import { registerBookingPanel } from '@/screens/booking/registries/bookingPanels';
import type { BookingPanelDefinition } from '@/screens/booking/registries/bookingPanels';
import styles from './bookingPanel.module.css';

function RanBanner({ eventInstanceId }: { readonly eventInstanceId: EventInstanceId }) {
  const navigate = useNavigate();
  return (
    <div className={styles['ranBanner']}>
      <p className={styles['ranText']}>This show has run</p>
      <Button
        variant="primary"
        iconStart="history"
        onClick={() => {
          navigate(routes.game.showResults(eventInstanceId));
        }}
      >
        See results
      </Button>
    </div>
  );
}

export const RAN_BANNER_PANEL: BookingPanelDefinition = {
  id: 'shows.ranBanner',
  order: 5,
  placement: 'side',
  render: ({ card, eventInstanceId }) =>
    card.show.status === 'completed' ? <RanBanner eventInstanceId={eventInstanceId} /> : null,
};

registerBookingPanel(RAN_BANNER_PANEL);
