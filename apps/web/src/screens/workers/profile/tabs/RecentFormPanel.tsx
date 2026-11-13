/**
 * The worker profile's Form tab (MTCH3-04): the last ten matches from `match.recentForm`, as a
 * strip of result pills on top and the per-match list below. Loaded with the tab, so the profile's
 * chunk does not carry it until someone opens it.
 */
import type { PersonId } from '@ringside/engine';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { RecentForm } from '@/components/RecentForm';
import styles from './RecentFormTab.module.css';

/** How many matches the tab shows. */
export const RECENT_FORM_TAB_LIMIT = 10;

function errorText(error: EngineQueryError | null): string {
  if (error === null) return 'The engine gave no reason.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ') || 'The engine gave no reason.';
}

export function RecentFormPanel({ personId }: { readonly personId: PersonId }) {
  const query = useEngineQuery('match.recentForm', { personId, limit: RECENT_FORM_TAB_LIMIT });

  if (query.status === 'loading') {
    return (
      <p className={styles['notice']} role="status">
        Loading recent form…
      </p>
    );
  }
  if (query.status === 'error' || query.data === undefined) {
    return (
      <EmptyState icon="error" title="Recent form can't be shown" body={errorText(query.error)} />
    );
  }
  const items = query.data.matches;
  return (
    <Panel title="Recent form" subtitle="Newest first">
      {items.length === 0 ? (
        <RecentForm items={items} variant="list" />
      ) : (
        <div className={styles['formStack']}>
          <RecentForm items={items} variant="strip" />
          <RecentForm items={items} variant="list" />
        </div>
      )}
    </Panel>
  );
}
