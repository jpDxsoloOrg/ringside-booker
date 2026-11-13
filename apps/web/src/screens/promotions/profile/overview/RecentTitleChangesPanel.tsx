/**
 * The Overview tab's "Recent title changes" panel (AIP5-05): the promotion's last five title
 * changes from `aip.recentTitleChanges`, drawn by `RecentTitleChangesList`. Shown for every
 * promotion, your own included (your shows' changes have no booker's reason).
 */
import type { PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { RecentTitleChangesList } from './RecentTitleChangesList';
import styles from './RecentTitleChanges.module.css';

export const RECENT_TITLE_CHANGES_LIMIT = 5;

export function RecentTitleChangesPanel({ promotionId }: { readonly promotionId: PromotionId }) {
  const changes = useEngineQuery('aip.recentTitleChanges', {
    promotionId,
    limit: RECENT_TITLE_CHANGES_LIMIT,
  });
  return (
    <Panel title="Recent title changes" headingLevel={2}>
      {changes.status === 'loading' ? (
        <p className={styles['muted']}>Looking up the title changes…</p>
      ) : changes.data === undefined ? (
        <EmptyState
          icon="warning"
          size="inline"
          headingLevel={3}
          title="The title changes could not be looked up"
        />
      ) : (
        <RecentTitleChangesList changes={changes.data.changes} />
      )}
    </Panel>
  );
}
