/**
 * ECO8's results section (ECO8-07), registered from the Networks folder (EVT3's page is not edited
 * beyond one import). The results page loads this with its own chunk.
 */
import { createElement } from 'react';
import type { ShowResultsView } from '@ringside/engine';
import { registerResultsSection } from '@/screens/show-results/resultsSectionRegistry';
import { ON_TV_TEXT } from '../airingText';
import { ResultsBroadcastSection } from './ResultsBroadcastSection';

/** The section's id in the results registry. */
export const RESULTS_BROADCAST_SECTION_ID = 'eco.broadcast';

/**
 * After the box office (35), before ECO1's Show money (60): who watched, then what the show cost.
 */
export const RESULTS_BROADCAST_SECTION_ORDER = 40;

/**
 * Whether the section draws: only your own shows that ran and drew viewers on TV. A rival's
 * viewers are on its score bug; its money is private.
 */
export function showsBroadcast(view: ShowResultsView): boolean {
  return (
    view.mine && view.status === 'completed' && view.result !== null && view.result.viewers !== null
  );
}

registerResultsSection({
  id: RESULTS_BROADCAST_SECTION_ID,
  label: ON_TV_TEXT.title,
  order: RESULTS_BROADCAST_SECTION_ORDER,
  render: ({ eventInstanceId, view }) =>
    showsBroadcast(view) ? createElement(ResultsBroadcastSection, { eventInstanceId }) : null,
});
