/**
 * MTCH3's results section, registered from its own folder (EVT3's page is not edited beyond one
 * import). The results page loads this with its own chunk, so the section stays out of the main
 * bundle (UI-21).
 */
import { createElement } from 'react';
import { registerResultsSection } from '@/screens/show-results/resultsSectionRegistry';
import { AftermathSection } from './AftermathSection';

/** The section's id in the results registry. */
export const AFTERMATH_SECTION_ID = 'mtch3.aftermath';

export const AFTERMATH_SECTION_LABEL = 'Popularity & momentum';

/** After EVT5's promotion popularity (25): the fan base first, then individual workers. */
export const AFTERMATH_SECTION_ORDER = 30;

registerResultsSection({
  id: AFTERMATH_SECTION_ID,
  label: AFTERMATH_SECTION_LABEL,
  order: AFTERMATH_SECTION_ORDER,
  render: ({ eventInstanceId, view }) => createElement(AftermathSection, { eventInstanceId, view }),
});
