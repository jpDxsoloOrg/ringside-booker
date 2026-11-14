/**
 * The broadcast system's balance numbers (ECO8). ECO8-01 adds the one key its helpers read: how
 * popular a promotion must be in a region before that region's networks are listed for it. Each
 * later ECO8 ticket appends its own keys here, in the `Broadcast` category.
 *
 * Documented in docs/design/broadcast.md and docs/design/tunables.md#broadcast-tunables.
 */

import { defineTunables } from '../../core/tunables/define';

export const BROADCAST_TUNABLE_CATEGORY = 'Broadcast';
export const BROADCAST_DOC = 'broadcast.md';

export const broadcastTunables = defineTunables({
  'broadcast.networks.minPopularityToList': {
    kind: 'integer',
    default: 1,
    min: 0,
    max: 100,
    unit: 'points',
    category: BROADCAST_TUNABLE_CATEGORY,
    description:
      'Popularity a promotion needs in a region before the networks covering it are listed for the promotion; 0 lists every network in the world',
    docRef: `${BROADCAST_DOC}#which-networks-a-promotion-can-deal-with`,
  },
});
