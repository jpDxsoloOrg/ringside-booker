/**
 * MTCH4's parts of the results page (MTCH4-06), registered from their own folder: the "Injured"
 * banner on a hurt worker's match card and the "Physical toll" section. The results page loads
 * this with its own chunk, so it stays out of the main bundle.
 */
import { createElement } from 'react';
import { registerResultsCardBanner } from '@/screens/show-results/resultsCardBannerRegistry';
import { registerResultsSection } from '@/screens/show-results/resultsSectionRegistry';
import { InjuryCardBanner } from './InjuryBanners';
import { PhysicalResultsSection } from './PhysicalResults';

/** The banner's id in the card banner registry. */
export const INJURY_BANNER_ID = 'mtch4.injuries';

registerResultsCardBanner({ id: INJURY_BANNER_ID, order: 10, Banner: InjuryCardBanner });

/** The section's id in the results registry. */
export const PHYSICAL_SECTION_ID = 'mtch4.physical';

export const PHYSICAL_SECTION_LABEL = 'Physical toll';

/** After MTCH3's "Popularity & momentum" (30): what the matches did to the workers' bodies. */
export const PHYSICAL_SECTION_ORDER = 40;

registerResultsSection({
  id: PHYSICAL_SECTION_ID,
  label: PHYSICAL_SECTION_LABEL,
  order: PHYSICAL_SECTION_ORDER,
  render: ({ view }) => createElement(PhysicalResultsSection, { view }),
});
