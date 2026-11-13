import type { EventInstanceId } from '@ringside/engine';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { EmptyState } from '@/components/EmptyState';
import { VisuallyHidden } from '@/components/layout';
import { PopularityChangeList } from '@/components/PopularityChangeList';
import styles from './PopularitySection.module.css';

/** What each status without a record says, in plain words. */
export const POPULARITY_EMPTY_TEXT = {
  notCompleted: 'Popularity changes once the show has run.',
  pruned: 'Popularity details are kept for a year after a show.',
  notApplied: "This show didn't change anyone's popularity.",
} as const;

const ERROR_TITLE = "Popularity changes can't be shown";
const NO_REASON = 'The game did not say why.';

function errorText(error: EngineQueryError | null): string {
  if (error === null) return NO_REASON;
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ') || NO_REASON;
}

const SKELETON_ROWS = ['1', '2', '3', '4'] as const;

/** The section's shape in quiet blocks while the answer loads. */
function PopularityLoading() {
  return (
    <div className={styles['skeleton']} aria-busy="true">
      <VisuallyHidden>Loading the popularity changes</VisuallyHidden>
      <span className={styles['skeletonSummary']} />
      {SKELETON_ROWS.map((key) => (
        <span key={key} className={styles['skeletonRow']} />
      ))}
    </div>
  );
}

export interface PopularitySectionProps {
  readonly eventInstanceId: EventInstanceId;
}

/**
 * The results page's "Popularity" section (EVT5-03): where this show won or lost its promotion
 * fans, region by region under each country, with a Why? on every change. Rival shows get it too,
 * because promotion popularity is public. The heading is the results panel's own.
 */
export function PopularitySection({ eventInstanceId }: PopularitySectionProps) {
  const query = useEngineQuery('popularity.showChange', { eventInstanceId });
  const data = query.data;
  if (query.status === 'loading') return <PopularityLoading />;
  if (query.status === 'error' || data === undefined) {
    return <EmptyState icon="info" title={ERROR_TITLE} body={errorText(query.error)} />;
  }
  if (data.status !== 'applied' || data.summary === null) {
    const text =
      data.status === 'applied'
        ? POPULARITY_EMPTY_TEXT.notApplied
        : POPULARITY_EMPTY_TEXT[data.status];
    return <EmptyState icon="users" title={text} />;
  }
  return <PopularityChangeList data={data} />;
}
