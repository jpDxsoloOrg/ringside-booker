import type { ShowCrowd, ShowMoney, ShowResultsView } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { useSettingsStore } from '@/app/settings/settingsStore';
import { formatMoney, formatNumber } from '@/components/format';
import type { MoneyStyle } from '@/components/format';
import type { ResultsSectionProps } from '@/screens/show-results/resultsSectionRegistry';
import { resultsSectionAnchor } from '@/screens/show-results/showReportLineRegistry';
import type { ShowReportLineContent } from '@/screens/show-results/showReportLineRegistry';

/** The section the line links to: EVT6's "Box office" results section. */
const BOX_OFFICE_SECTION = 'boxOffice';

/**
 * EVT6's line in the show report: "Crowd 4,210 (92% full) · Gate $48,300" for the player's own
 * shows, the crowd alone for a rival's (its takings are private). The gate is the ticket money the
 * company kept, the Gate card's figure. Null until the show is settled.
 */
export function boxOfficeReportLine(
  crowd: ShowCrowd,
  money: ShowMoney | null,
  style: MoneyStyle,
): ShowReportLineContent | null {
  if (crowd.status !== 'settled' || crowd.attendance === null) return null;
  const full = crowd.percentFull === null ? '' : ` (${formatNumber(crowd.percentFull)}% full)`;
  const gate = money === null ? '' : ` · Gate ${formatMoney(money.tickets.amount, { style })}`;
  return {
    label: 'Box office',
    text: `Crowd ${formatNumber(crowd.attendance)}${full}${gate}`,
    tone: 'neutral',
    targetId: resultsSectionAnchor(BOX_OFFICE_SECTION),
  };
}

function runs(view: ShowResultsView): boolean {
  return view.status === 'completed';
}

/** The line as the report asks for it: a hook reading the box office queries. */
export function useBoxOfficeReportLine({
  eventInstanceId,
  view,
}: ResultsSectionProps): ShowReportLineContent | null {
  const style = useSettingsStore((state) => state.settings.moneyStyle);
  const crowd = useEngineQuery('boxOffice.showCrowd', { eventInstanceId }, { enabled: runs(view) });
  const settled = crowd.data?.status === 'settled';
  const money = useEngineQuery(
    'boxOffice.showMoney',
    { eventInstanceId },
    { enabled: view.mine && settled },
  );
  if (!runs(view) || crowd.data === undefined) return null;
  if (view.mine && settled && money.status === 'loading') return null;
  return boxOfficeReportLine(crowd.data, view.mine ? (money.data ?? null) : null, style);
}
