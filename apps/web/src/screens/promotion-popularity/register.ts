/**
 * EVT5's results section, registered from its own folder (EVT3's page is not edited beyond one
 * import). The results page loads this with its own chunk, so the section stays out of the main
 * bundle (UI-21).
 */
import { createElement } from 'react';
import { registerResultsSection } from '@/screens/show-results/resultsSectionRegistry';
import { registerShowReportLine } from '@/screens/show-results/showReportLineRegistry';
import { usePopularityReportLine } from './popularityReportLine';
import { PopularitySection } from './PopularitySection';

/** The section's id in the results registry. */
export const POPULARITY_SECTION_ID = 'evt5.popularity';

/**
 * After EVT4's card flow (20) and before MTCH3's workers (30): the promotion's fan base comes
 * before individual workers.
 */
export const POPULARITY_SECTION_ORDER = 25;

registerResultsSection({
  id: POPULARITY_SECTION_ID,
  label: 'Popularity',
  order: POPULARITY_SECTION_ORDER,
  render: ({ eventInstanceId }) => createElement(PopularitySection, { eventInstanceId }),
});

// The show report's "Fans" line (EVT3-09), in the section's place in the order.
registerShowReportLine({
  id: 'evt5.fans',
  order: POPULARITY_SECTION_ORDER,
  line: usePopularityReportLine,
});
