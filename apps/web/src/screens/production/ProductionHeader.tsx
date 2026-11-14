import { Fragment } from 'react';
import { cents, monthlyOverheadTraceRef } from '@ringside/engine';
import type { ProductionOverview, PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge } from '@/components/Badge';
import { formatGameDate, formatPopularity, useMoneyFormatter } from '@/components/format';
import { KpiCard, KpiCardGrid } from '@/components/KpiCard';
import { WhyButton } from '@/components/Trace';
import {
  registerBuiltinProductionHeaderItem,
  useProductionHeaderItems,
} from './productionHeaderRegistry';
import { forecastWindowText, showCountText } from './productionText';
import styles from './ProductionScreen.module.css';

/** The header's three built-in cards and their places, so EVT4 can sit first at 10. */
export const PRODUCTION_HEADER_ORDERS = {
  popularityCeiling: 20,
  monthlyOverhead: 30,
  upcomingShows: 40,
} as const;

export interface PopularityCeilingCardProps {
  readonly overview: ProductionOverview;
}

/** "3 regions above it" when popularity has outgrown marketing and back office somewhere. */
export function regionsAboveText(count: number): string {
  return count === 1 ? '1 region above it' : `${String(count)} regions above it`;
}

/** How popular the promotion can stay, and where it is already above that. */
export function PopularityCeilingCard({ overview }: PopularityCeilingCardProps) {
  const { value, trace } = overview.popularityCeiling;
  const above = overview.regionsAboveCeiling;
  return (
    <KpiCard
      label="Popularity ceiling"
      icon="star"
      value={formatPopularity(value)}
      footer={
        above > 0 ? (
          <span className={styles['footerLine']}>
            <Badge tone="warning">{regionsAboveText(above)}</Badge>
            <span>Popularity there slowly falls back</span>
          </span>
        ) : (
          'Set by marketing and back office'
        )
      }
      why={<WhyButton label="Popularity ceiling" value={value} unit="points" source={{ trace }} />}
    />
  );
}

export interface MonthlyOverheadCardProps {
  readonly promotionId: PromotionId;
  readonly overhead: NonNullable<ProductionOverview['monthlyOverhead']>;
}

/** The last 1st-of-the-month charge, from its stored Why?. Nothing before the first one. */
function LastCharged({ promotionId }: { readonly promotionId: PromotionId }) {
  const traceRef = monthlyOverheadTraceRef(promotionId);
  const stored = useEngineQuery('trace.get', { ref: traceRef });
  const formatMoney = useMoneyFormatter();
  const entry = stored.data;
  if (entry === undefined || entry === null || typeof entry.value !== 'number') return null;
  return (
    <span className={styles['lastCharged']}>
      Last charged {formatGameDate(entry.date)}: {formatMoney(cents(entry.value))}
      <WhyButton
        label={`Overhead charged ${formatGameDate(entry.date)}`}
        value={entry.value}
        unit="money"
        source={{ traceRef }}
      />
    </span>
  );
}

/** What the monthly areas cost, split the way the ledger books it, and the last charge. */
export function MonthlyOverheadCard({ promotionId, overhead }: MonthlyOverheadCardProps) {
  const formatMoney = useMoneyFormatter();
  const split = [
    ['Production', overhead.byCategory.production],
    ['Marketing', overhead.byCategory.marketing],
    ['Back office', overhead.byCategory.backOffice],
  ] as const;
  return (
    <KpiCard
      label="Monthly overhead"
      icon="money"
      value={formatMoney(cents(overhead.total))}
      unit="/month"
      footer={
        <span className={styles['footerStack']}>
          <span className={styles['split']}>
            {split.map(([label, amount]) => (
              <span key={label} className={styles['splitLine']}>
                <span>{label}</span>
                <span className="tabular">{formatMoney(cents(amount))}</span>
              </span>
            ))}
          </span>
          <span>Charged on the 1st of each month</span>
          <LastCharged promotionId={promotionId} />
        </span>
      }
      why={
        <WhyButton
          label="Monthly overhead"
          value={overhead.total}
          unit="money"
          source={{ trace: overhead.trace }}
        />
      }
    />
  );
}

export interface UpcomingShowsCardProps {
  readonly upcoming: NonNullable<ProductionOverview['upcomingShows']>;
}

/** What stage, camera, editing and pyro will cost on the shows coming up. */
export function UpcomingShowsCard({ upcoming }: UpcomingShowsCardProps) {
  const formatMoney = useMoneyFormatter();
  const windowText = forecastWindowText(upcoming.days);
  return (
    <KpiCard
      label={`Show production, next ${windowText}`}
      icon="video"
      value={formatMoney(cents(upcoming.total))}
      footer={
        upcoming.count === 0
          ? `No shows in the next ${windowText}`
          : `${showCountText(upcoming.count)}, paid on each show night`
      }
      why={
        <WhyButton
          label={`Show production, next ${windowText}`}
          value={upcoming.total}
          unit="money"
          source={{ trace: upcoming.trace }}
        />
      }
    />
  );
}

registerBuiltinProductionHeaderItem({
  id: 'production.popularityCeiling',
  order: PRODUCTION_HEADER_ORDERS.popularityCeiling,
  render: ({ overview }) => <PopularityCeilingCard overview={overview} />,
});

registerBuiltinProductionHeaderItem({
  id: 'production.monthlyOverhead',
  order: PRODUCTION_HEADER_ORDERS.monthlyOverhead,
  render: ({ promotionId, overview }) =>
    overview.monthlyOverhead === null ? null : (
      <MonthlyOverheadCard promotionId={promotionId} overhead={overview.monthlyOverhead} />
    ),
});

registerBuiltinProductionHeaderItem({
  id: 'production.upcomingShows',
  order: PRODUCTION_HEADER_ORDERS.upcomingShows,
  render: ({ overview }) =>
    overview.upcomingShows === null ? null : (
      <UpcomingShowsCard upcoming={overview.upcomingShows} />
    ),
});

export interface ProductionHeaderProps {
  readonly overview: ProductionOverview;
}

/**
 * The cards above the area rows, from the header registry. A rival's production (`mine` false)
 * shows only the popularity ceiling: its costs are private.
 */
export function ProductionHeader({ overview }: ProductionHeaderProps) {
  const items = useProductionHeaderItems();
  if (!overview.mine) {
    return (
      <KpiCardGrid label="Production at a glance" className={styles['header']}>
        <PopularityCeilingCard overview={overview} />
      </KpiCardGrid>
    );
  }
  const props = { promotionId: overview.promotionId, overview };
  return (
    <KpiCardGrid label="Production at a glance" className={styles['header']}>
      {items.map((item) => (
        <Fragment key={item.id}>{item.render(props)}</Fragment>
      ))}
    </KpiCardGrid>
  );
}
