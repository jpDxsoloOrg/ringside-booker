/**
 * CRTV4-05's results section, registered from the storylines folder (EVT3's page is not edited
 * beyond one import): "Storylines" on the player's show when a segment was linked to a storyline.
 * The results page loads this with its own chunk.
 */
import { createElement } from 'react';
import { registerResultsSection } from '@/screens/show-results/resultsSectionRegistry';
import { showsStorylines, StorylinesResultsSection } from './StorylinesResultsSection';

export const STORYLINES_SECTION_ID = 'storylines';
export const STORYLINES_SECTION_LABEL = 'Storylines';
/** Right after EVT4's card flow (20) and before EVT5's popularity (25): what the card built. */
export const STORYLINES_SECTION_ORDER = 22;

registerResultsSection({
  id: STORYLINES_SECTION_ID,
  label: STORYLINES_SECTION_LABEL,
  order: STORYLINES_SECTION_ORDER,
  render: ({ eventInstanceId, view }) =>
    showsStorylines(view)
      ? createElement(StorylinesResultsSection, { eventInstanceId, view })
      : null,
});
