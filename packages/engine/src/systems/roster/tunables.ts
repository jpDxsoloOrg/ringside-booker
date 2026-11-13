/**
 * The roster's balance numbers.
 *
 * Design: docs/design/roster.md#push-verdict.
 */

import { defineTunables } from '../../core/tunables/define';

export const rosterTunables = defineTunables({
  'roster.expectsMoreSteps': {
    kind: 'integer',
    default: 1,
    // Not 0 on purpose: a gap of 0 or more would flag every row.
    min: 1,
    max: 4,
    step: 1,
    unit: 'count',
    category: 'Roster',
    description:
      'How many card positions below the push they expect a worker must sit before the roster marks them as expecting more (and above it, as pushed beyond expectations)',
    docRef: 'roster.md#push-verdict',
  },
});
