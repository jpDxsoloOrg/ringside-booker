/**
 * MTCH4's parts of the results page (MTCH4-06), registered from their own folder: the "Injured"
 * banner on a hurt worker's match card. The results page loads this with its own chunk, so it
 * stays out of the main bundle.
 */
import { registerResultsCardBanner } from '@/screens/show-results/resultsCardBannerRegistry';
import { InjuryCardBanner } from './InjuryBanners';

/** The banner's id in the card banner registry. */
export const INJURY_BANNER_ID = 'mtch4.injuries';

registerResultsCardBanner({ id: INJURY_BANNER_ID, order: 10, Banner: InjuryCardBanner });
