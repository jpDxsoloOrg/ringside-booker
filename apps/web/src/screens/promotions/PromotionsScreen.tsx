import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { PromotionListRow } from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { promotionLinkState } from '@/app/entityLinks';
import { routes } from '@/app/routes';
import { DataTable } from '@/components/DataTable';
import type { SortState } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatNumber } from '@/components/format';
import { useTracePanelStore } from '@/components/Trace';
import { useIsMobile } from '@/styles/useMediaQuery';
import {
  comparePromotionTies,
  PROMOTION_COLUMNS,
  SORTABLE_PROMOTION_COLUMNS,
} from './promotionColumns';
import { promotionsSortFromSearch, searchWithPromotionsSort } from './promotionsListParams';
import styles from './PromotionsScreen.module.css';
import { RivalRulesChip } from './RivalRulesChip';

const TITLE = 'Promotions';
const NO_ROWS: readonly PromotionListRow[] = [];
const NO_ARGS = {};

function rowId(row: PromotionListRow): string {
  return row.promotionId;
}

function rowLabel(row: PromotionListRow): string {
  return row.name;
}

function errorText(error: EngineQueryError | null): string {
  if (error === null) return 'Something went wrong.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

/** "12 promotions · 11 run by the computer". */
export function promotionsCountText(rows: readonly PromotionListRow[]): string {
  const computer = rows.filter((row) => row.controlledBy === 'computer').length;
  return `${formatNumber(rows.length)} ${rows.length === 1 ? 'promotion' : 'promotions'} · ${formatNumber(computer)} run by the computer`;
}

/**
 * World > Promotions: every promotion in the world in one sortable table (cards on a phone), with
 * the Rival rules chip beside the heading. The sort lives in the URL, so the profile's back link
 * returns to it. Popularity is the home country's, with its Why?; a rival's money never shows.
 */
export function PromotionsScreen() {
  useDocumentTitle(TITLE);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const query = useEngineQuery('promotions.list', NO_ARGS);
  const rules = useEngineQuery('aip.rules', NO_ARGS);

  const sort = useMemo(
    () => promotionsSortFromSearch(searchParams, SORTABLE_PROMOTION_COLUMNS),
    [searchParams],
  );
  // Replace, so Back leaves the list instead of stepping through every sort change.
  const changeSort = useCallback(
    (next: SortState): void => {
      setSearchParams((current) => searchWithPromotionsSort(current, next), { replace: true });
    },
    [setSearchParams],
  );
  const openProfile = useCallback(
    (row: PromotionListRow): void => {
      useTracePanelStore.setState({ openPanelId: null });
      navigate(routes.game.promotion(row.promotionId), { state: promotionLinkState(location) });
    },
    [navigate, location],
  );

  const failed = query.status === 'error';
  const rows = failed ? NO_ROWS : (query.data ?? NO_ROWS);

  // One tree for every state, so the heading focused on arrival stays mounted when the query
  // settles.
  return (
    <div className={styles['screen']}>
      <div className={styles['intro']}>
        <RouteHeading className={styles['heading']}>{TITLE}</RouteHeading>
        {rules.data !== undefined && <RivalRulesChip rules={rules.data} />}
        {query.data !== undefined && !failed && (
          <p className={styles['count']}>
            <span className="tabular">{promotionsCountText(rows)}</span>
          </p>
        )}
      </div>

      {failed ? (
        <EmptyState
          size="page"
          icon="building"
          title="The promotions could not be loaded"
          body={errorText(query.error)}
        />
      ) : (
        <DataTable
          className={styles['table']}
          rows={rows}
          columns={PROMOTION_COLUMNS}
          getRowId={rowId}
          compareTies={comparePromotionTies}
          getRowLabel={rowLabel}
          caption={TITLE}
          sort={sort}
          onSortChange={changeSort}
          loading={query.status === 'loading'}
          // On a phone the name's link covers the card (see the CSS), as on the workers list.
          {...(isMobile ? {} : { onActivate: openProfile })}
          emptyState={
            <EmptyState
              icon="building"
              title="No promotions"
              body="This world has no promotions in it."
            />
          }
        />
      )}
    </div>
  );
}
