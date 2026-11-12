import { lazy, Suspense } from 'react';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import styles from './MatchLabScreen.module.css';

const SCREEN_TITLE = 'Match lab';

/**
 * The lab loads as its own chunk the first time it is opened, like the calendar. The heading is
 * not part of it, so the page has its `h1`, and focus somewhere to land, before the chunk arrives.
 */
const MatchLabView = lazy(async () => {
  const { MatchLabView: View } = await import('./MatchLabView');
  return { default: View };
});

/**
 * The Match lab at `/game/match-lab`: rate a segment that is on no card (a match or a talking
 * segment, its slot, the show it is on and who is on each side) to see how the rating works
 * before booking anything. Other features add panels with `registerLabPanel`.
 */
export function MatchLabScreen() {
  useDocumentTitle(SCREEN_TITLE);

  return (
    <div className={styles['screen']}>
      <div className={styles['intro']}>
        <RouteHeading className={styles['heading']}>{SCREEN_TITLE}</RouteHeading>
        <p className={styles['lead']}>
          Try out a segment before you book it. Nothing here happens in the game.
        </p>
      </div>
      <Suspense
        fallback={
          <p className={styles['loading']} role="status">
            Loading the Match lab…
          </p>
        }
      >
        <MatchLabView />
      </Suspense>
    </div>
  );
}
