import { lazy, Suspense } from 'react';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import styles from './BookingScreen.module.css';

const SCREEN_TITLE = 'Booking';

/**
 * The card board, the checklist and the drag-and-drop code load as their own chunk the first time
 * Booking opens. The heading is not part of it, so the page has its `h1` straight away.
 */
const BookingView = lazy(async () => {
  const { BookingView: View } = await import('./BookingView');
  return { default: View };
});

/**
 * Booking at `/game/booking`: one of your shows at a time (`?event=` picks which), its card slot by
 * slot, the checklist and, on show day, Run the show.
 */
export function BookingScreen() {
  useDocumentTitle(SCREEN_TITLE);
  return (
    <div className={styles['screen']}>
      <RouteHeading className={styles['heading']}>{SCREEN_TITLE}</RouteHeading>
      <Suspense
        fallback={
          <p className={styles['loading']} role="status">
            Loading the card…
          </p>
        }
      >
        <BookingView />
      </Suspense>
    </div>
  );
}
