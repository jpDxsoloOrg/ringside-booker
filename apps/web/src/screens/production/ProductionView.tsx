import { useEffect, useRef, useState } from 'react';
import type { ProductionArea, ProductionOverview, PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { classNames } from '@/components/classNames';
import { EmptyState } from '@/components/EmptyState';
import { ProductionAreaList, tvFloorText } from './ProductionAreaRow';
import { CashRunwayBanner } from './cashRunway';
import { ProductionChangeDialog } from './ProductionChangeDialog';
import { ProductionHeader } from './ProductionHeader';
import { queryErrorText } from './productionText';
import styles from './ProductionScreen.module.css';

export interface ProductionOverviewViewProps {
  readonly overview: ProductionOverview;
  /**
   * − or + on an area: the level asked for. Left out (or for a rival's production) the rows have
   * no buttons.
   */
  readonly onRequestChange?: (area: ProductionArea, level: number) => void;
}

/**
 * One promotion's production from `production.overview`: the header cards and the eight areas.
 * With `overview.mine` false (a rival's, for the AIP screens) it is read-only: levels and effect
 * lines, the popularity ceiling, and no costs.
 */
export function ProductionOverviewView({ overview, onRequestChange }: ProductionOverviewViewProps) {
  const deal = overview.tvDeal;
  return (
    <>
      <ProductionHeader overview={overview} />
      <ProductionAreaList
        rows={overview.rows}
        mine={overview.mine}
        tvNetworkName={deal?.networkName ?? null}
        {...(overview.mine && onRequestChange !== undefined ? { onRequestChange } : {})}
      />
    </>
  );
}

interface ChangeRequest {
  readonly area: ProductionArea;
  readonly level: number;
}

export interface ProductionViewProps {
  readonly promotionId: PromotionId;
}

/**
 * The live Production screen body for the seat's promotion: the overview, kept on screen (dimmed)
 * while it refreshes, and the change dialog that − and + open.
 */
export function ProductionView({ promotionId }: ProductionViewProps) {
  const overview = useEngineQuery('production.overview', { promotionId });
  const [change, setChange] = useState<ChangeRequest | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** The row button that opened the dialog ("Raise Camera"), to take focus back when it closes. */
  const openerLabel = useRef<string | null>(null);

  // The dialog unmounts as it closes, so it cannot hand focus back itself: put it on the − or +
  // that opened it (found by its label, as Safari does not focus a pressed button).
  useEffect(() => {
    if (change !== null || openerLabel.current === null) return;
    const label = openerLabel.current;
    openerLabel.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const opener = bodyRef.current?.querySelector<HTMLElement>(
      `button[aria-label="${CSS.escape(label)}"]`,
    );
    opener?.focus();
  }, [change]);

  if (overview.data === undefined) {
    return overview.status === 'error' ? (
      <EmptyState
        icon="warning"
        title="Production can't be shown"
        body={queryErrorText(overview.error)}
        headingLevel={2}
      />
    ) : (
      <p className={styles['muted']} role="status">
        Loading production…
      </p>
    );
  }

  const data = overview.data;
  const row = change === null ? undefined : data.rows.find((entry) => entry.area === change.area);
  return (
    <div
      ref={bodyRef}
      className={classNames(styles['body'], overview.isStale && styles['stale'])}
      aria-busy={overview.isStale || undefined}
    >
      {data.mine && <CashRunwayBanner promotionId={promotionId} />}
      <ProductionOverviewView
        overview={data}
        onRequestChange={(area, level) => {
          const row = data.rows.find((entry) => entry.area === area);
          if (row !== undefined) {
            openerLabel.current = `${level > row.level ? 'Raise' : 'Lower'} ${row.label}`;
          }
          setChange({ area, level });
        }}
      />
      {change !== null && row !== undefined && (
        <ProductionChangeDialog
          promotionId={promotionId}
          area={row.area}
          label={row.label}
          from={row.level}
          initialLevel={change.level}
          minLevel={row.minLevel}
          {...(row.minLevel > 0
            ? { minReason: tvFloorText(row.minLevel, data.tvDeal?.networkName ?? null) }
            : {})}
          onClose={() => {
            setChange(null);
          }}
        />
      )}
    </div>
  );
}
