/**
 * AIP5's results section, registered from the promotions folder (EVT3's page is not edited beyond
 * one import): "Booker's calls" on a rival's show that has run. The results page loads this with
 * its own chunk.
 */
import { createElement } from 'react';
import { registerResultsSection } from '@/screens/show-results/resultsSectionRegistry';
import { BookersCalls, showsBookersCalls } from './BookersCalls';

export const BOOKERS_CALLS_SECTION_ID = 'aip.bookersCalls';
export const BOOKERS_CALLS_SECTION_LABEL = "Booker's calls";
/** Beside the show money (60): what the show was, then how its matches were called. */
export const BOOKERS_CALLS_SECTION_ORDER = 60;

registerResultsSection({
  id: BOOKERS_CALLS_SECTION_ID,
  label: BOOKERS_CALLS_SECTION_LABEL,
  order: BOOKERS_CALLS_SECTION_ORDER,
  render: ({ view }) => (showsBookersCalls(view) ? createElement(BookersCalls, { view }) : null),
});
