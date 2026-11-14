import { useEffect, useMemo, useState } from 'react';
import type { DealRow } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { useMoneyFormatter } from '@/components/format';
import { Switch } from '@/components/Switch';
import { useIsMobile } from '@/styles/useMediaQuery';
import { dealColumns, dealTitle } from './dealColumns';
import { AVAILABLE_TAB_ID } from './networksParams';
import type { NetworksTabContext } from './registry';
import styles from './Networks.module.css';

const NO_ROWS: readonly DealRow[] = [];

export const NO_DEALS_TITLE = 'No TV deals yet';
export const NO_DEALS_TEXT =
  'A TV, streaming or pay-per-view deal pays you for every show it carries. See which networks would take your shows.';

function rowId(row: DealRow): string {
  return row.dealId;
}

/**
 * Your deals: every running deal (and, with "Show ended deals", the ones that ended and why),
 * with its slot, fee, last and expected viewers, trend, health and end date. A row opens the
 * deal sheet (`?deal=`). A deal just signed takes focus once its row is on screen.
 */
export function YourDealsTab({
  promotionId,
  openTab,
  openDeal,
  focusDealId,
  onDealFocused,
}: NetworksTabContext) {
  const [showEnded, setShowEnded] = useState(false);
  const deals = useEngineQuery(
    'broadcast.deals',
    { promotionId, include: showEnded ? 'all' : 'active' },
    { keepPreviousData: true },
  );
  const clock = useEngineQuery('clock.get', {});
  const money = useMoneyFormatter();
  const isMobile = useIsMobile();
  const rows = deals.data ?? NO_ROWS;
  const today = clock.data?.date ?? null;

  const columns = useMemo(
    () =>
      dealColumns({
        money,
        today,
        onOpen: (row) => {
          openDeal(row.dealId);
        },
      }),
    [money, today, openDeal],
  );

  // A deal just signed: focus its row's button once the row has arrived.
  useEffect(() => {
    if (focusDealId === null || !rows.some((row) => row.dealId === focusDealId)) return;
    const button = document.querySelector<HTMLElement>(`[data-deal-open="${focusDealId}"]`);
    if (button === null) return;
    button.focus();
    onDealFocused();
  }, [focusDealId, rows, onDealFocused]);

  if (deals.status === 'error') {
    return (
      <EmptyState
        icon="tv"
        title="Your deals can't be shown"
        body={deals.error?.kind === 'rejected' ? deals.error.reasons[0]?.message : undefined}
        headingLevel={2}
      />
    );
  }

  return (
    <div className={styles['panel']}>
      <div className={styles['toolbar']}>
        <Switch label="Show ended deals" checked={showEnded} onCheckedChange={setShowEnded} />
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={rowId}
        getRowLabel={dealTitle}
        caption="Your TV deals"
        loading={deals.status === 'loading'}
        density="comfortable"
        {...(isMobile
          ? {}
          : {
              onActivate: (row: DealRow) => {
                openDeal(row.dealId);
              },
            })}
        emptyState={
          <EmptyState
            icon="tv"
            title={showEnded ? 'No deals, running or ended' : NO_DEALS_TITLE}
            body={NO_DEALS_TEXT}
            headingLevel={2}
            action={
              <Button
                variant="primary"
                onClick={() => {
                  openTab(AVAILABLE_TAB_ID);
                }}
              >
                See available networks
              </Button>
            }
          />
        }
      />
    </div>
  );
}
