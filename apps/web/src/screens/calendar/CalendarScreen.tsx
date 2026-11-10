import { lazy, Suspense } from 'react';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import styles from './CalendarScreen.module.css';

const SCREEN_TITLE = 'Calendar';

/**
 * The month views and the show sheet load as their own chunk the first time the calendar is
 * opened, like the other big screens. The heading below is not part of it, so the page has its
 * `h1`, and focus has somewhere to land, before the chunk arrives.
 */
const CalendarView = lazy(async () => {
  const { CalendarView: View } = await import('./CalendarView');
  return { default: View };
});

/**
 * The calendar at `/game/calendar`: every dated show, yours or the whole world's, a month at a
 * time. `routes.game.calendarAt({ month, scope, show })` links to a month or straight to a show.
 */
export function CalendarScreen() {
  useDocumentTitle(SCREEN_TITLE);

  return (
    <div className={styles['screen']}>
      <RouteHeading className={styles['heading']}>{SCREEN_TITLE}</RouteHeading>
      <Suspense
        fallback={
          <p className={styles['loading']} role="status">
            Loading the calendar…
          </p>
        }
      >
        <CalendarView />
      </Suspense>
    </div>
  );
}
