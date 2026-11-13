/**
 * The rival desk (`aip`): what the computer does for the promotions and brands it runs.
 *
 * AIP1-01 lays the ground floor: the `aiProfiles` and `aiDecisions` tables, the units helper
 * (`units.ts`: which promotions and brands the computer runs), `ensureProfile` and the new-game
 * step that gives every computer unit a profile (`setup.ts`), the taste shape (`taste.ts`) and the
 * decision log's retention rule. Phases and queries come with the turn runner (AIP1-03) and the
 * Promotions screens (AIP1-06). Layout follows `systems/condition/`.
 *
 * AIP1-03 adds the turn runner: the job registry (`jobs/registry.ts`), the per-unit spreading of
 * weekly and monthly jobs (`jobs/spread.ts`), the job context and its buffer (`jobs/context.ts`),
 * the decision-kind registry (`decisionKinds.ts`), the decision writer (`decisions.ts`) and the
 * phases `aip.runTurns` and `aip.pruneDecisionLog` (`phases.ts`). See docs/design/rival-desk.md.
 */

// The stream and event declarations are types only, and the setup step registers itself on import.
import './events';
import './streams';
import './setup';
import './decisionKinds';
// AIP1-05: the weekly roster review registers itself as a job on import.
import './jobs/rosterReview';
// AIP1-07: the rating policy provider (MTCH1's door) registers itself on import.
import './ratingPolicy';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { aipPhases } from './phases';

export { AIP_CREATE_PROFILES_STEP } from './setup';
export { ensureProfile, profileOf } from './profiles';
export { computerUnits, unitControllerOf, unitCovers, type AiUnit } from './units';
export { TASTE_AXES, TASTE_AXIS_LABELS, TasteSchema, type Taste, type TasteAxis } from './taste';
export { decisionLogPruneThrough, isDecisionExpired } from './formulas/decisionLogCutoff';
export { pruneDecisionLog, pruneDecisionLogOn } from './jobs/pruneDecisionLog';
export {
  AI_JOB_CADENCES,
  aiJobs,
  registerAiJob,
  type AiJob,
  type AiJobCadence,
  type AiJobSpec,
  type AiJobUnits,
} from './jobs/registry';
export {
  isDue,
  monthlyDayOf,
  MONTHLY_SPREAD_DAYS,
  nextDueOn,
  unitOffset,
  unitShowsOn,
  WEEKLY_SPREAD_DAYS,
} from './jobs/spread';
export type { AiJobContext } from './jobs/context';
export {
  decisionKindOf,
  decisionKinds,
  registerDecisionKind,
  ROSTER_REVIEW_DECISION_KIND,
  type DecisionKind,
  type DecisionKindSpec,
} from './decisionKinds';
export {
  decisionTraceRef,
  MAX_DECISION_IMPORTANCE,
  writeAiDecision,
  type DecisionWriteContext,
  type RecordDecisionSpec,
} from './decisions';
export {
  AIP_PRUNE_DECISION_LOG_PHASE_ID,
  AIP_RUN_TURNS_PHASE_ID,
  jobSavepointLabel,
  pruneDecisionLogPhase,
  runTurnsPhase,
} from './phases';
import { aipRulesQuery } from './queries/rules';
import { aipDecisionLogQuery } from './queries/decisionLog';
import { aipNeedsQuery } from './queries/needs';
import { promotionProfileQuery } from './queries/promotionProfile';
import { promotionRosterQuery } from './queries/promotionRoster';
import { promotionsListQuery } from './queries/promotionsList';

// Rival rules shortcuts and viewer redaction (AIP1-02).
export {
  AI_SHORTCUT_KEYS,
  AI_SHORTCUTS,
  aiShortcutTunables,
  isAiShortcutFlag,
  type AiShortcutFlagKey,
  type AiShortcutInfo,
  type AiShortcutKey,
  type AiShortcutValue,
} from './shortcuts';
export {
  AI_SHORTCUT_RULES,
  aiShortcut,
  aiShortcutConsumers,
  aiShortcutOn,
  aiShortcutsFor,
  registerAiShortcutConsumer,
  type AiShortcutConsumer,
  type AiShortcutSet,
} from './aiShortcut';
export {
  CASH_DISPLAY_BANDS,
  CASH_DISPLAY_BANDS_REASON,
  canSeePrivate,
  privateInputOf,
  redactForViewer,
  visibilityOf,
  type Band,
  type Redacted,
  type Visibility,
} from './visibility';
export { aipRulesQuery, type AipRulesView, type AiShortcutRuleView } from './queries/rules';
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

// AIP1-05: the roster rule and formula inputs, the reveal rule, the weekly roster review and the
// Promotions queries.
export {
  cardValueInputsFor,
  deciderBrandOf,
  employmentAt,
  holderNamesOf,
  needsInputsFor,
  openReignOf,
  unitNameOf,
  unitRoster,
  unitTitles,
  type CardValueShared,
  type RosterUnit,
} from './inputs';
export { unitOf } from './units';
export { isRevealedTo } from './reveal';
export {
  ROSTER_REVIEW_JOB_ID,
  ROSTER_REVIEW_SUMMARY_KEY,
  rosterReviewSummary,
  rosterReviewSummaryText,
  runRosterReview,
} from './jobs/rosterReview';
export {
  promotionsListQuery,
  type PromotionChampion,
  type PromotionListRow,
} from './queries/promotionsList';
export {
  promotionProfileQuery,
  SHOWS_PER_MONTH_DAYS,
  datedShowsAhead,
  showDatesAhead,
  type PromotionProfile,
  type PromotionProfileArgs,
  type PromotionProfileBrand,
  type PromotionProfileShortcut,
  type PromotionProfileShow,
} from './queries/promotionProfile';
export {
  promotionRosterQuery,
  type PromotionRoster,
  type PromotionRosterArgs,
  type PromotionRosterRow,
  type PromotionRosterTasteAxis,
} from './queries/promotionRoster';
export { aipNeedsQuery, type AipNeeds, type AipNeedsArgs, type AipNeedView } from './queries/needs';
export {
  aipDecisionLogQuery,
  DECISION_NOT_FOUND,
  decisionSummaryText,
  DEFAULT_DECISION_LOG_LIMIT,
  MAX_DECISION_LOG_LIMIT,
  type AipDecisionLog,
  type AipDecisionLogArgs,
  type AipDecisionLogEntry,
  type AipDecisionLogKind,
} from './queries/decisionLog';
export {
  BRAND_NOT_FOUND,
  PROMOTION_NOT_FOUND,
  type ChampionLine,
  type ControlledBy,
  type PlaceRef,
} from './queries/shared';

export const aipSystem: SystemBundle = defineSystem({
  id: 'aip',
  phases: aipPhases,
  queries: [
    aipRulesQuery,
    promotionsListQuery,
    promotionProfileQuery,
    promotionRosterQuery,
    aipNeedsQuery,
    aipDecisionLogQuery,
  ],
});
// AIP1-07: the rating policy provider behind MTCH1's policy door.
export {
  FULL_RULES_POLICY_LABEL,
  NO_RIVAL_BONUS_LINE,
  RIVAL_POLICY_LABEL,
  RIVAL_RATING_POLICY_ID,
  rivalRatingPolicy,
  rivalShortcutLine,
} from './ratingPolicy';
// AIP1-07: ECO1's company size on the Promotions list.
export {
  companySizeOf,
  eco1CompanySize,
  setCompanySizeSource,
  type CompanySize,
  type CompanySizeSource,
} from './companySize';
// AIP4-01: the card planner's groundwork (tunables, streams, the card pool and the card shape).
export {
  aipCardTunables,
  appearanceCapReason,
  AUTOFILL_STREAM,
  buildCardPool,
  CARD_EMPLOYMENT_ROLES,
  CARD_PLAN_STREAM,
  CARD_POOL_DOC_REF,
  CARD_SHAPE_DOC_REF,
  MAIN_EVENT_RULE,
  mainEventMustBeMatch,
  NEUTRAL_TALK_TASTE,
  NO_BACK_TO_BACK_REASON,
  NO_HOUSE_SHOWS_REASON,
  RIVAL_BOOKING_CATEGORY,
  talkShareKey,
  talkSlotsFor,
  talkValueOf,
  tiredReason,
  TITLE_CAP_DOC_REF,
  titleCapKey,
  titleMatchCapFor,
  type CardCandidate,
  type CardExclusion,
  type CardPool,
  type CardPoolArgs,
  type CardPoolShow,
  type CardTeam,
  type CardTitle,
  type ContractBlock,
  type TalkShareKey,
  type TalkSlotsInputs,
  type TitleCapKey,
  type TitleMatchCapInputs,
} from './card';
