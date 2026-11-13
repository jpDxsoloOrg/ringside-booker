/**
 * EVT6's results section and show report line, registered from the box office's own folder
 * (EVT3's page is not edited beyond one import). The results page loads this with its own chunk,
 * so the section stays out of the main bundle (UI-21).
 */
import { createElement } from 'react';
import type { ShowResultsView } from '@ringside/engine';
import { registerResultsSection } from '@/screens/show-results/resultsSectionRegistry';
import { registerShowReportLine } from '@/screens/show-results/showReportLineRegistry';
import { useBoxOfficeReportLine } from './boxOfficeReportLine';
import { BoxOfficeSection } from './BoxOfficeSection';

/** The section's id in the results registry. */
export const BOX_OFFICE_SECTION_ID = 'boxOffice';

export const BOX_OFFICE_SECTION_LABEL = 'Box office';

/**
 * After EVT4's card flow (20), EVT5's popularity (25) and MTCH3's workers (30), and before ECO1's
 * Show money (60): how many came, then what the show cost.
 */
export const BOX_OFFICE_SECTION_ORDER = 35;

/** Whether the section draws for this show: any show that has run, the player's or a rival's. */
export function showsBoxOffice(view: ShowResultsView): boolean {
  return view.status === 'completed';
}

registerResultsSection({
  id: BOX_OFFICE_SECTION_ID,
  label: BOX_OFFICE_SECTION_LABEL,
  order: BOX_OFFICE_SECTION_ORDER,
  render: ({ eventInstanceId, view }) =>
    showsBoxOffice(view)
      ? createElement(BoxOfficeSection, { eventInstanceId, showName: view.name, mine: view.mine })
      : null,
});

// The show report's "Box office" line (EVT3-09), in the section's place in the order.
registerShowReportLine({
  id: 'boxOffice.crowd',
  order: BOX_OFFICE_SECTION_ORDER,
  line: useBoxOfficeReportLine,
});
