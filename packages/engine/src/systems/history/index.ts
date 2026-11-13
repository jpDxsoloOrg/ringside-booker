/**
 * History retention (POL4-08): the save keeps the last `history.keepDetailDays` days of play in
 * detail and older play as totals and summaries, for every promotion. The weekly `history.rollUp`
 * phase does the rolling up; `note.ts` gives screens the plain note they show past the window.
 *
 * Design: docs/design/save-format.md#history-retention.
 */

import { defineSystem, type SystemBundle } from '../../core/api/system';
import { historyRollUpPhase } from './rollUp';

export { matchesKeptPerWorker, segmentsToKeep } from './keep';
export {
  detailKeptFrom,
  detailKeptNote,
  detailKeptNoteFor,
  isPastDetailWindow,
  keepDetailPeriodText,
} from './note';
export {
  HISTORY_ROLL_UP_PHASE_ID,
  HISTORY_ROLL_UP_PHASE_ORDER,
  historyRollUpPhase,
  rollUpHistory,
  showHistoryOf,
  type RollUpCounts,
} from './rollUp';
export { HISTORY_DOC_REF, historyTunables } from './tunables';

export const historySystem: SystemBundle = defineSystem({
  id: 'history',
  phases: [historyRollUpPhase],
});
