/**
 * The words the promotion popularity formulas use for how a region saw a show and how big the show
 * was. Shared with the web results page so the engine's trace and the screen say the same thing.
 *
 * Design: docs/design/promotion-popularity.md#show-reach.
 */

import type { EventImportance } from '../../../model/entities/event-definition';
import type { NetworkId } from '../../../core/ids';
import { shortViewers } from '../../broadcast/formulas/audience';
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
      /** What the airing drew (ECO8-07), once it has aired; null or left out before then. */
      readonly audience?: ReachAudience | null;
    };

/** What a show's airing on a network drew: viewers, or buys on pay-per-view. */
export interface ReachAudience {
  readonly count: number;
  readonly noun: 'viewers' | 'buys';
}

/**
 * "Show region", "Neighbour of Texas", "TV: National Signal Network", or once the show has aired
 * there "TV: National Signal Network, 2.4M viewers".
 */
export function reachLabel(route: ReachRoute): string {
  switch (route.source) {
    case 'show':
      return 'Show region';
    case 'neighbour':
      return `Neighbour of ${route.showRegionName}`;
    case 'tv':
      return route.audience === undefined || route.audience === null
        ? `TV: ${route.networkName}`
        : `TV: ${route.networkName}, ${shortViewers(route.audience.count)} ${route.audience.noun}`;
  }
}

/**
 * The display name of an event importance ("Regular", "Flagship"), the same words the match
 * expectation's "Event size" line uses.
 */
export function importanceLabel(importance: EventImportance): string {
  return EVENT_IMPORTANCE_LABELS[importance];
}
