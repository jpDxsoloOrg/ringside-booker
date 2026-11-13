/**
 * The Fan base sheet's "This month" figure (DAY2-06, as EVT5-04 describes it), registered from
 * EVT5's own folder: what the promotion's shows have won it in each region this calendar month,
 * against the monthly cap (`promoPop.monthlyGainCap`), so the player sees how much room is left.
 * Imported once by the router, so it is in place before the top bar opens the sheet.
 */
import type { PromotionId, RegionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { registerFanBaseColumn } from '@/app/AppShell/status/fanBaseColumnRegistry';
import { formatNumber } from '@/components/format';

/** The column's id in the Fan base registry. */
export const THIS_MONTH_COLUMN_ID = 'evt5.thisMonth';

/** Said before the figure on every row. */
export const THIS_MONTH_LABEL = 'This month';

/** Shown while the gains are loading or could not be read. */
const NO_FIGURE = '–';

const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

/**
 * "+1.2 (cap 3)", "+0.0 (cap 3)", or "+3.0 (cap reached)" once the region's gains hit the cap.
 * A cap of 0 means shows win nothing anywhere this month.
 */
export function thisMonthText(gain: number, cap: number): string {
  // Shows only ever win popularity here (losses are not capped), so the figure is never negative.
  const shown = `+${formatNumber(Math.max(0, gain), ONE_DECIMAL)}`;
  const capText =
    gain >= cap ? 'cap reached' : `cap ${formatNumber(cap, { maximumFractionDigits: 1 })}`;
  return `${shown} (${capText})`;
}

interface ThisMonthFigureProps {
  readonly promotionId: PromotionId;
  readonly regionId: RegionId;
}

/** One region's figure. Every row asks the same cached query, so the sheet makes one call. */
function ThisMonthFigure({ promotionId, regionId }: ThisMonthFigureProps) {
  const query = useEngineQuery('popularity.monthGains', { promotionId });
  const gains = query.data;
  if (gains === undefined) return <span className="tabular">{NO_FIGURE}</span>;
  return <span className="tabular">{thisMonthText(gains.byRegion[regionId] ?? 0, gains.cap)}</span>;
}

registerFanBaseColumn({
  id: THIS_MONTH_COLUMN_ID,
  label: THIS_MONTH_LABEL,
  render: (regionId, { promotionId }) => (
    <ThisMonthFigure promotionId={promotionId} regionId={regionId} />
  ),
});
