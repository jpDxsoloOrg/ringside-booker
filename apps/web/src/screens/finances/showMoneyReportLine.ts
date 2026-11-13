import { cents } from '@ringside/engine';
import type { FinanceLedgerRow, ShowResultsView } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { useSettingsStore } from '@/app/settings/settingsStore';
import { formatSignedMoney } from '@/components/format';
import type { MoneyStyle } from '@/components/format';
import type { ResultsSectionProps } from '@/screens/show-results/resultsSectionRegistry';
import { resultsSectionAnchor } from '@/screens/show-results/showReportLineRegistry';
import type { ShowReportLineContent } from '@/screens/show-results/showReportLineRegistry';

/** The section the line links to: ECO1's "Show money" results section. */
const SHOW_MONEY_SECTION = 'finance.showMoney';

/** The most rows one show posts, as the section asks, so both share one engine answer. */
const ROW_LIMIT = 50;

/**
 * ECO's line in the show report: the show's net money, "+$12,400 net" or "−$3,100 net". Null
 * when the show posted nothing.
 */
export function showMoneyReportLine(
  rows: readonly FinanceLedgerRow[],
  style: MoneyStyle,
): ShowReportLineContent | null {
  if (rows.length === 0) return null;
  const net = rows.reduce((sum, row) => sum + row.amount, 0);
  return {
    label: 'Money',
    text: `${formatSignedMoney(cents(net), { showPlus: true, style })} net for this show`,
    tone: net > 0 ? 'positive' : net < 0 ? 'negative' : 'neutral',
    targetId: resultsSectionAnchor(SHOW_MONEY_SECTION),
  };
}

/** Only the viewer's own shows that have run: a rival's books are private. */
function showsMoney(view: ShowResultsView): boolean {
  return view.mine && view.status === 'completed';
}

/** The line as the report asks for it: a hook reading the show's `finance.ledger` rows. */
export function useShowMoneyReportLine({
  view,
}: ResultsSectionProps): ShowReportLineContent | null {
  const style = useSettingsStore((state) => state.settings.moneyStyle);
  const query = useEngineQuery(
    'finance.ledger',
    { promotionId: view.promotion.id, eventInstanceId: view.eventInstanceId, limit: ROW_LIMIT },
    { enabled: showsMoney(view) },
  );
  if (!showsMoney(view) || query.data === undefined) return null;
  return showMoneyReportLine(query.data.rows, style);
}
