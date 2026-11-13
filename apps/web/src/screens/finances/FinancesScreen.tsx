import { lazy, Suspense } from 'react';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { useSessionStore } from '@/app/session/sessionStore';
import { EmptyState } from '@/components/EmptyState';
import styles from './Finances.module.css';

const SCREEN_TITLE = 'Finances';

/**
 * The tabs load as their own chunk the first time Finances is opened, like the Match lab. The
 * heading is not part of it, so the page has its `h1`, and focus somewhere to land, before the
 * chunk arrives.
 */
const FinancesView = lazy(async () => {
  const { FinancesView: View } = await import('./FinancesView');
  return { default: View };
});

/**
 * Business > Finances at `/game/finances`: the books of the promotion the local seat runs, in
 * Overview, Monthly, Ledger and Policies tabs, plus any tab another feature registered with
 * `registerFinanceTab`. A seat that runs no promotion has no books to show.
 */
export function FinancesScreen() {
  useDocumentTitle(SCREEN_TITLE);
  const promotionId = useSessionStore((state) => state.seat?.promotionId ?? null);

  return (
    <div className={styles['screen']}>
      <div className={styles['intro']}>
        <RouteHeading className={styles['heading']}>{SCREEN_TITLE}</RouteHeading>
        <p className={styles['lead']}>
          Where the money comes from and where it goes. Press the ? beside a figure to see how it
          was worked out.
        </p>
      </div>
      {promotionId === null ? (
        <EmptyState
          size="page"
          icon="finance"
          title="No books to show"
          body="You don't run a promotion, so there are no finances to look at."
          headingLevel={2}
        />
      ) : (
        <Suspense
          fallback={
            <p className={styles['muted']} role="status">
              Loading Finances…
            </p>
          }
        >
          <FinancesView promotionId={promotionId} />
        </Suspense>
      )}
    </div>
  );
}
