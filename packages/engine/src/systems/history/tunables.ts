/**
 * The history roll-up's one knob (POL4-08): how many days of play the save keeps in detail.
 *
 * Every history prune reads it: the weekly `history.rollUp` (show cards, participants, ledger rows
 * and popularity show records), the rival decision log (`aip.pruneDecisionLog`) and the rival card
 * Why? demotion (`aip.pruneCardDetail`). Older history is rolled into totals, never into nothing;
 * current numbers are never touched. Design: docs/design/save-format.md#history-retention.
 */

import { defineTunables } from '../../core/tunables/define';

export const HISTORY_DOC_REF = 'save-format.md#history-retention';

export const historyTunables = defineTunables({
  'history.keepDetailDays': {
    kind: 'integer',
    default: 28,
    min: 0,
    max: 3650,
    unit: 'days',
    category: 'History',
    description:
      'How many days of shows, cards, money rows and rival decisions are kept in full; older ones are kept as totals and summaries',
    docRef: HISTORY_DOC_REF,
  },
});
