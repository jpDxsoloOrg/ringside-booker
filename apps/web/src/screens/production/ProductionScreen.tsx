import { lazy, Suspense } from 'react';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { useSessionStore } from '@/app/session/sessionStore';
import { EmptyState } from '@/components/EmptyState';
import styles from './ProductionScreen.module.css';

const SCREEN_TITLE = 'Production';

/**
 * The rows, header and dialog load as their own chunk the first time Production is opened, like
 * Finances. The heading is not part of it, so the page has its `h1` before the chunk arrives.
 */
const ProductionView = lazy(async () => {
  const { ProductionView: View } = await import('./ProductionView');
  return { default: View };
});

/**
 * Business > Production at `/game/production`: what the seat's promotion spends on its stage,
 * camera, editing and pyro (on every show) and on music, writing, marketing and back office
 * (every month), what each level does, and − / + to change a level through a dialog that shows
 * the fee and every number it moves.
 */
export function ProductionScreen() {
  useDocumentTitle(SCREEN_TITLE);
  const promotionId = useSessionStore((state) => state.seat?.promotionId ?? null);

  return (
    <div className={styles['screen']}>
      <div className={styles['intro']}>
        <RouteHeading className={styles['heading']}>{SCREEN_TITLE}</RouteHeading>
        <p className={styles['lead']}>
          Better production makes better shows and lets popularity grow further, and costs more.
          Press − or + to see the fee and what changes before you decide.
        </p>
      </div>
      {promotionId === null ? (
        <EmptyState
          size="page"
          icon="video"
          title="No production to run"
          body="You don't run a promotion, so there is no production to look at."
          headingLevel={2}
        />
      ) : (
        <Suspense
          fallback={
            <p className={styles['muted']} role="status">
              Loading production…
            </p>
          }
        >
          <ProductionView promotionId={promotionId} />
        </Suspense>
      )}
    </div>
  );
}
