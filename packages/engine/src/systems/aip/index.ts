/**
 * The rival desk (`aip`): what the computer does for the promotions and brands it runs.
 *
 * AIP1-01 lays the ground floor: the `aiProfiles` and `aiDecisions` tables, the units helper
 * (`units.ts`: which promotions and brands the computer runs), `ensureProfile` and the new-game
 * step that gives every computer unit a profile (`setup.ts`), the taste shape (`taste.ts`) and the
 * decision log's retention rule. Phases and queries come with the turn runner (AIP1-03) and the
 * Promotions screens (AIP1-06). Layout follows `systems/condition/`. See
 * docs/design/rival-desk.md.
 */

// The stream and event declarations are types only, and the setup step registers itself on import.
import './events';
import './streams';
import './setup';
import { defineSystem, type SystemBundle } from '../../core/api/system';

export { AIP_CREATE_PROFILES_STEP } from './setup';
export { ensureProfile, profileOf } from './profiles';
export { computerUnits, unitControllerOf, unitCovers, type AiUnit } from './units';
export { TASTE_AXES, TASTE_AXIS_LABELS, TasteSchema, type Taste, type TasteAxis } from './taste';
export { decisionLogPruneThrough, isDecisionExpired } from './formulas/decisionLogCutoff';
export { pruneDecisionLog } from './jobs/pruneDecisionLog';
// AIP1-04: taste, card value and roster needs.
export { storedTaste, STORED_TASTE_LABEL, tasteOf, type TracedTaste } from './taste';
export {
  DEFAULT_STYLE_TASTE,
  STYLE_TASTE_CATEGORY,
  styleTasteKey,
  styleTasteTunables,
  type StyleTasteKey,
} from './tasteTunables';
export {
  defaultTaste,
  mapTasteAxes,
  styleTasteLabel,
  tasteFromAxes,
  type DefaultTasteInputs,
} from './formulas/defaultTaste';
export {
  CARD_VALUE_GROUPS,
  CARD_VALUE_MAX,
  CARD_VALUE_MIN,
  cardValue,
  NO_MOMENTUM_LABEL,
  noFansNote,
  PRIME_AGE_NOTE,
  type CardValueInputs,
} from './formulas/cardValue';
export {
  NEED_BANDS,
  NEED_CREW_ROLES,
  needSummaryText,
  NO_NEEDS_REASON,
  rosterNeeds,
  rosterReviewDecision,
  slotsDemanded,
  TOP_NEED_REASON,
  type DivisionGender,
  type Need,
  type NeedBand,
  type NeedCrewRole,
  type NeedKind,
  type NeedRefs,
  type NeedsChampion,
  type NeedsInputs,
  type NeedsWrestler,
} from './formulas/needs';

export const aipSystem: SystemBundle = defineSystem({
  id: 'aip',
  phases: [],
  queries: [],
});
