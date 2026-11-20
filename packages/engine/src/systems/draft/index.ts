/**
 * The draft (DRF epic): the draft-start option (DRF-01), contracts at the pick (DRF-03), active
 * promotions (DRF-06) and the pool's size and mix (DRF-07).
 *
 * Importing this module registers the draft settings, the `wld.activePromotions` (350) and
 * `draft.setup` (650) new-game steps, and the draft's tunables come in through
 * `systems/tunables.ts`. The bundle adds the queries, commands and the `draft.unfinished` gate.
 *
 * Reusable pieces for later drafts (BRW1 brand drafts): `draftValue`/`draftValueParts`
 * (`draftValue.ts`), `draftCandidates`, `DraftBoard` and the pick order (`order.ts`).
 *
 * Design: docs/design/draft.md.
 */

import './events';
import './settings';
import './activePromotions';
import './setup';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { draftCommands } from './commands';
import { draftUnfinishedGate } from './gate';
import { draftQueries } from './queries';

export { ACTIVE_PROMOTIONS_STEP, closeInactivePromotions } from './activePromotions';
export {
  boardWeights,
  DraftBoard,
  STYLE_FITS,
  type BoardWeights,
  type PickChoice,
  type RosterCount,
} from './board';
export {
  DRAFT_STAFF_ROLES,
  DRAFT_WEIGHT_CLASSES,
  draftCandidates,
  type DraftCandidate,
  type DraftStaffRole,
  type DraftWeightClass,
} from './candidates';
export { DRAFT_REASON_CODES, draftCommands, type DraftAdvanceResult } from './commands';
export {
  DRAFT_VALUE_DOC_REF,
  draftValue,
  draftValueParts,
  draftValueWeights,
  type DraftValueInputs,
  type DraftValueParts,
  type DraftValueWeights,
} from './draftValue';
export type { FinishSummary } from './flow';
export { DRAFT_ACTION_HINT, DRAFT_GATE_ID, draftUnfinishedGate } from './gate';
export { EQUALISED, medianLevel, NOT_EQUALISED } from './level';
export { nextTurn, roundOrder, type Turn } from './order';
export {
  CARD_LEVEL_LABELS,
  CARD_LEVELS,
  choosePool,
  type CardLevel,
  type PoolMixLevel,
} from './pool';
export {
  draftQueries,
  POOL_SORTS,
  type DraftClockView,
  type DraftPickView,
  type DraftPoolRow,
  type DraftPoolView,
  type DraftPreviewView,
  type DraftRosterSummary,
  type DraftStateView,
  type PickContract,
  type PoolSort,
} from './queries';
export {
  DRAFT_RIGHTS_REASON_CODE,
  isSittingOut,
  rightsHolder,
  SITTING_OUT_REASON_CODE,
} from './rights';
export {
  DRAFT_POOL_SIZES,
  DRAFT_ROSTER_SIZES,
  DRAFT_SETTINGS,
  draftSettingsOf,
  type DraftOptions,
  type DraftPoolSize,
  type DraftRosterSize,
} from './settings';
export { DRAFT_SETUP_STEP, planDraft, setUpDraftStart } from './setup';
export { draftTunables } from './tunables';

export const draftSystem: SystemBundle = defineSystem({
  id: 'draft',
  queries: draftQueries,
  commands: draftCommands,
  gates: [draftUnfinishedGate],
});
