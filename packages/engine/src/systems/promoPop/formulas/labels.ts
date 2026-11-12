/**
 * The words the promotion popularity formulas use for how a region saw a show and how big the show
 * was. Shared with the web results page so the engine's trace and the screen say the same thing.
 *
 * Design: docs/design/promotion-popularity.md#show-reach.
 */

import type { EventImportance } from '../../../model/entities/event-definition';
import type { NetworkId } from '../../../core/ids';
import { EVENT_IMPORTANCE_LABELS } from '../../match/formulas/crowdExpectation';

/** How a region came to see a show: in person, as a neighbour, or on television. */
export type ReachSource = 'show' | 'neighbour' | 'tv';

/** One way a region saw a show, with the names its label needs. */
export type ReachRoute =
  | { readonly source: 'show' }
  | { readonly source: 'neighbour'; readonly showRegionName: string }
  | {
      readonly source: 'tv';
      readonly networkId: NetworkId;
      readonly networkName: string;
    };

/** "Show region", "Neighbour of Texas" or "TV: National Signal Network". */
export function reachLabel(route: ReachRoute): string {
  switch (route.source) {
    case 'show':
      return 'Show region';
    case 'neighbour':
      return `Neighbour of ${route.showRegionName}`;
    case 'tv':
      return `TV: ${route.networkName}`;
  }
}

/**
 * The display name of an event importance ("Regular", "Flagship"), the same words the match
 * expectation's "Event size" line uses.
 */
export function importanceLabel(importance: EventImportance): string {
  return EVENT_IMPORTANCE_LABELS[importance];
}
