/**
 * ECO1's results section, registered from the Finances folder (EVT3's page is not edited beyond one
 * import). The results page loads this with its own chunk, so the section stays out of the main
 * bundle (UI-21).
 */
import { createElement } from 'react';
import type { ShowResultsView } from '@ringside/engine';
import { registerResultsSection } from '@/screens/show-results/resultsSectionRegistry';
import { registerShowReportLine } from '@/screens/show-results/showReportLineRegistry';
import { useShowMoneyReportLine } from './showMoneyReportLine';
import { ShowMoneySection } from './ShowMoneySection';

/** The section's id in the results registry. */
export const SHOW_MONEY_SECTION_ID = 'finance.showMoney';

export const SHOW_MONEY_SECTION_LABEL = 'Show money';

/** After the popularity (25) and aftermath (30) sections: what the show did first, then its cost. */
export const SHOW_MONEY_SECTION_ORDER = 60;

/**
 * Whether the section draws for this show: only the viewer's own shows that have run. A rival's
 * books are private, and a show that has not run has posted nothing.
 */
export function showsShowMoney(view: ShowResultsView): boolean {
  return view.mine && view.status === 'completed';
}

registerResultsSection({
  id: SHOW_MONEY_SECTION_ID,
  label: SHOW_MONEY_SECTION_LABEL,
  order: SHOW_MONEY_SECTION_ORDER,
  render: ({ view }) => (showsShowMoney(view) ? createElement(ShowMoneySection, { view }) : null),
});

// The show report's "Money" line (EVT3-09), in the section's place in the order.
registerShowReportLine({
  id: 'finance.showMoney',
  order: SHOW_MONEY_SECTION_ORDER,
  line: useShowMoneyReportLine,
});
