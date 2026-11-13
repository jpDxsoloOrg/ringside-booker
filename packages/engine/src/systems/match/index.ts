/**
 * The match system: everything about a single segment on a card.
 *
 * So far: the slot derivations of D-10 (`slots.ts`: role, duration class and weight from a slot's
 * position, never stored), the match tunables (`tunables.ts`) and the queries (`queries.ts`):
 * `match.catalog`, `match.slotRoles` and `match.finishes`. The rating formulas (`formulas/`):
 * worker performance, side aggregation and work rate (MTCH1-03); star power, crowd expectation,
 * crowd score, soft compression, segment score, star rating and speaker score (MTCH1-04).
 * Finishes (MTCH2): the catalog check (`catalog/finishes.ts`), the allowed-finish rule and filter
 * seam (`finishes/allowed.ts`) and the segment finish check (`catalog/checkSegmentFinishes.ts`).
 * The rating pipeline (`rating/`, MTCH1-05): `rateSegment`, the rater registry, rating modifiers,
 * the rating policy door, segment warnings and the stored-segment adapter.
 * The runtime catalogs it reads live in `model/catalogs.ts`. No phase yet. Design:
 * docs/design/match-rating.md and match-finishes.md.
 */

import { defineSystem, type SystemBundle } from '../../core/api/system';
import { matchQueries } from './queries';
import { aftermathQueries } from './aftermath/queries';
import { recentFormQueries } from './aftermath/recentFormQuery';
import { pruneAftermathsPhase } from './aftermath/prune';
import { momentumDriftPhase } from './aftermath/drift';
// Registers the built-in `match` and `angle` raters at module load.
import './rating/builtins';
// Registers the Random winners new-game setting at module load (MTCH2-03).
import './settings';
// Registers the `match.finish` booking check at module load (EVT2-07).
import './finishes/bookingCheck';
// Registers MTCH2's match outcome resolver with show night at module load (EVT3-07).
import './finishes/showNight';
// Registers the aftermath applier with show night and the TV reach provider at module load
// (MTCH3-05).
import './aftermath/showNight';
import './aftermath/tvReach';
// Declares the physical toll's `match.wear` stream (MTCH4-01).
import './physical/streams';
// Registers the physical toll applier with show night at module load (MTCH4-04).
import './physical/showNight';
// Registers the Match lab's `physical` preview extension at module load (MTCH4-05).
import './physical/preview';
import { prunePhysicalDetailPhase } from './physical/prune';
import { physicalQueries } from './physical/queries';

export {
  DURATION_CLASSES,
  DURATION_CLASS_LABELS,
  SLOT_ROLES,
  SLOT_ROLE_LABELS,
  SLOTS_DOC_REF,
  durationClassOf,
  slotRoleOf,
  slotWeightOf,
  type DurationClass,
  type DurationClassInputs,
  type SlotDeps,
  type SlotPosition,
  type SlotRole,
  type SlotWeightInputs,
} from './slots';
export {
  SLOT_ROLES_MAX_PRE_SHOW_SLOTS,
  SLOT_ROLES_MAX_SLOTS,
  SLOT_ROLES_MIN_SLOTS,
  type AngleTypeOption,
  type CountRange,
  type MatchCatalog,
  type MatchTypeOption,
  type MethodOption,
  type SlotInfo,
  type SlotInfoArgs,
  type SlotRoleRow,
  type SlotRolesArgs,
} from './queries';
export { matchTunables } from './tunables';
export { MATCH_RATING_STREAM } from './streams';
export {
  ALL_WEIGHTS_ZERO_NOTE,
  NON_WRESTLER_LABEL,
  PERFORMANCE_AXES,
  PERFORMANCE_AXIS_LABELS,
  PERFORMANCE_MAX,
  PERFORMANCE_MIN,
  SUITS_MATCH_TYPE_LABEL,
  WORKER_PERFORMANCE_DOC_REF,
  WORKING_HURT_LABEL,
  workerPerformance,
  type PerformanceAttributeKey,
  type PerformanceAxis,
  type TalkWeights,
  type WorkerPerformanceInputs,
} from './formulas/workerPerformance';
export {
  SIDES_DOC_REF,
  aggregateWeights,
  rankLabel,
  rankMembers,
  sideAggregate,
  type SideAggregateInputs,
  type SideAggregateMember,
  type SideDecayKey,
} from './formulas/sideAggregate';
export {
  ACROSS_SIDES_LABEL,
  NO_VARIANCE_NOTE,
  VARIANCE_LABEL,
  WORK_RATE_DOC_REF,
  matchLeaderOf,
  sideLabel,
  workRate,
  type MatchLeader,
  type WorkRateInputs,
  type WorkRateSide,
  type WorkRateWorker,
} from './formulas/workRate';

export {
  STAR_POWER_DOC_REF,
  starPower,
  type StarPowerInputs,
  type StarPowerMember,
} from './formulas/starPower';
export {
  EVENT_IMPORTANCE_LABELS,
  EXPECTATION_DOC_REF,
  EXPECTATION_LABEL,
  NOT_TELEVISED_LABEL,
  crowdExpectation,
  type CrowdExpectationInputs,
} from './formulas/crowdExpectation';
export {
  CROWD_LABEL,
  CROWD_VARIANCE_LABEL,
  CROWD_WEIGHTS_ZERO_NOTE,
  DELIVERED_LABEL,
  crowdScore,
  type CrowdScoreInputs,
} from './formulas/crowdScore';
export {
  COMPRESSION_DOC_REF,
  softCompression,
  type SoftCompressionInputs,
} from './formulas/softCompression';
export {
  DEFAULT_POLICY_LABEL,
  PROMOTION_STYLE_LABELS,
  SEGMENT_PERFORMANCE_LABELS,
  SEGMENT_SCORE_DOC_REF,
  SEGMENT_SCORE_LABEL,
  segmentScore,
  type SegmentScoreInputs,
} from './formulas/segmentScore';
export {
  NEAREST_QUARTER_LABEL,
  POINTS_PER_STAR_ZERO_NOTE,
  STARS_DOC_REF,
  STARS_LABEL,
  starRating,
  type StarRatingInputs,
} from './formulas/starRating';
export {
  PROMO_VARIANCE_LABEL,
  TALKING_DOC_REF,
  speakerScore,
  type SpeakerScoreInputs,
  type SpeakerScoreSide,
  type SpeakerScoreSpeaker,
} from './formulas/speakerScore';
export { signedNumber, summaryOf } from './formulas/shared';
export { staminaCheckOf, type StaminaCheck } from './formulas/workRate';

// The rating pipeline (MTCH1-05). Design: docs/design/match-rating.md#pipeline-and-seams.
export {
  RATING_STAGES,
  SEGMENT_WARNING_CODES,
  type RatingStage,
  type RatingSubject,
  type RatingPolicySummary,
  type SegmentKind,
  type SegmentRatingEvent,
  type SegmentRatingInput,
  type SegmentRatingResult,
  type SegmentRatingSide,
  type SegmentRatingSlot,
  type SegmentWarning,
  type SegmentWarningCode,
  type SideSubject,
  type SlotDerivation,
  type WorkerLine,
  type WorkerStaminaLine,
  type WorkerSubject,
} from './rating/types';
export type { RatingContext, RatingMode } from './rating/context';
export {
  NEUTRAL_RATING_POLICY,
  NEUTRAL_RATING_POLICY_LABEL,
  ratingPolicyFor,
  registerRatingPolicyProvider,
  type RatingPolicy,
  type RatingPolicyProvider,
} from './rating/policy';
export {
  RATING_ORDER,
  RATING_ORDER_MAX,
  RATING_ORDER_MIN,
  ratingModifiersFor,
  registerRatingModifier,
  registerSegmentRater,
  segmentRaterFor,
  type RatingModifier,
  type SegmentRater,
} from './rating/registry';
export {
  PIPELINE_DOC_REF,
  RATING_STAGE_LABELS,
  runStage,
  skippedDetailNote,
} from './rating/runStage';
export {
  ENTERTAINMENT_LABEL,
  NOT_UNDER_CONTRACT_NOTE,
  NO_MOMENTUM_NOTE,
  durationLabelOf,
  slotWeightLine,
} from './rating/common';
export { matchRater } from './rating/matchRater';
export { ANGLE_CROWD_FACTOR, angleRater } from './rating/angleRater';
export {
  GIVEN_ROLE_NOTE,
  RATE_SEGMENT_REASON_CODES,
  rateSegment,
  type RateSegmentOptions,
} from './rating/rateSegment';
export { segmentWarnings } from './rating/segmentWarnings';
export { ratingInputFromSegment } from './rating/fromSegment';
export { resetMatchRegistriesForTests } from './rating/builtins';

// Finishes (MTCH2): the catalog check, the allowed-finish rule and its filter seam, the segment
// finish check and the `match.finishes` query. Design: docs/design/match-finishes.md.
export {
  FINISH_CATALOG_ISSUE_CODES,
  checkFinishCatalog,
  finishAdmitsMatchType,
  type FinishCatalogIssue,
} from './catalog/finishes';
export {
  allowedFinishes,
  finishSideCount,
  registerFinishFilter,
  type AllowedFinishesArgs,
  type FinishEntry as ReadonlyFinishEntry,
  type FinishFilter,
  type FinishFilterContext,
} from './finishes/allowed';
export { SEGMENT_FINISH_ISSUE_CODES, checkSegmentFinishes } from './catalog/checkSegmentFinishes';
export {
  FINISHES_REASON_CODES,
  type FinishMethodOption,
  type FinishOption,
  type FinishesArgs,
} from './queries';

// The Match lab's previews (MTCH1-06): `match.preview`, `match.previewBatch`, `match.labOptions`
// and `match.labWorkers`, the preview arguments and the batch statistics.
// Design: docs/design/match-rating.md#previews.
export { MATCH_PREVIEW_STREAM } from './streams';
export {
  PREVIEW_BATCH_MAX_RUNS,
  PREVIEW_MAX_SIDE_SIZE,
  PREVIEW_SEED_MAX,
  PreviewArgsSchema,
  PreviewBatchArgsSchema,
  previewInputOf,
  type PreviewArgs,
  type PreviewBatchArgs,
} from './previewArgs';
export {
  PREVIEW_REASON_CODES,
  type PreviewBatchResult,
  type PreviewResult,
  type StarStats,
} from './previewQueries';
// The preview extension seam (MTCH4-05) and the Match lab's `physical` extension.
export {
  checkPreviewExtensions,
  previewExtensionIds,
  registerPreviewExtension,
  type PreviewExtensionArgs,
  type PreviewExtensionContext,
  type PreviewExtensionDefinition,
  type PreviewExtensionId,
  type PreviewExtensionMap,
  type PreviewExtensionResults,
  type PreviewExtensionSummaries,
} from './previewExtensions';
export {
  FATIGUE_OVERRIDE_RANGE_MESSAGE,
  PHYSICAL_PREVIEW_ID,
  PhysicalPreviewArgsSchema,
  labSegmentSpec,
  runPhysicalPreview,
  summarisePhysicalPreview,
  type PhysicalPreviewArgs,
  type PhysicalPreviewPersonSummary,
  type PhysicalPreviewResult,
  type PhysicalPreviewSummary,
  type PhysicalPreviewWorker,
} from './physical/preview';
export {
  LAB_WORKERS_DEFAULT_LIMIT,
  LAB_WORKERS_MAX_LIMIT,
  LAB_WORKERS_MAX_SEARCH,
  LAB_WORKER_SCOPES,
  type LabDefaults,
  type LabImportance,
  type LabOptions,
  type LabPromotion,
  type LabRateAsOption,
  type LabRegion,
  type LabWorkerRow,
  type LabWorkerScope,
  type LabWorkers,
  type LabWorkersArgs,
} from './labQueries';
export {
  SCORE_HISTOGRAM_BINS,
  SCORE_HISTOGRAM_WIDTH,
  quantileOfSorted,
  quarterCounts,
  roundTenth,
  scoreHistogram,
  statsOf,
  type HistogramBin,
  type QuarterCount,
  type Stats,
} from './stats';

// Finish effects, finish on the night, method and the title rule (MTCH2-02).
// Design: docs/design/match-finishes.md#finish-effects.
export { MATCH_FINISH_STREAM } from './streams';
export { MatchResolutionSchema, type MatchResolution } from './finishes/resolution';
export {
  DRAW_CROWD_PENALTY_LABEL,
  FINISH_EFFECTS_DOC_REF,
  finishEffect,
  finishEffectLabel,
  type FinishEffectInputs,
  type FinishEffectTarget,
} from './formulas/finishEffect';
export {
  FINISH_CROWD_MODIFIER_ID,
  FINISH_WORK_RATE_MODIFIER_ID,
  finishCrowdModifier,
  finishWorkRateModifier,
  registerFinishModifiers,
  unknownFinishNote,
} from './finishes/modifiers';
export {
  ALL_WEIGHTS_ZERO_FINISH_NOTE,
  AUTO_FINISH_LABEL,
  AUTO_FINISH_RULE,
  FINISH_ON_THE_NIGHT_DOC_REF,
  NEVER_PICKED_REASON,
  ONLY_FINISH_NOTE,
  PICKED_BY_ROLL_REASON,
  autoFinish,
  winnerAlignmentOf,
  type AutoFinishCandidate,
  type AutoFinishDeps,
  type AutoFinishInputs,
} from './finishes/autoFinish';
export {
  BOOKED_METHOD_REASON,
  METHOD_BY_ROLL_REASON,
  METHOD_DECISION_LABEL,
  METHOD_DOC_REF,
  NO_METHOD_NOTE,
  NO_METHOD_OPTION,
  ONLY_METHOD_REASON,
  chooseMethod,
  type ChooseMethodInputs,
} from './finishes/chooseMethod';
export {
  NO_WINNER_RULE,
  TITLE_CAN_CHANGE_REASON,
  TITLE_CHANGES_DOC_REF,
  TITLE_RULE_LABEL,
  titleCanChange,
  type TitleCanChangeInputs,
} from './finishes/titleRule';

// The auto-winner, resolveMatchOutcome and the Random winners setting (MTCH2-03).
// Design: docs/design/match-finishes.md#auto-winner.
export { MATCH_AUTO_WINNER_STREAM } from './streams';
export { RANDOM_WINNERS_SETTING } from './settings';
export {
  AUTO_WINNER_ALIGNMENT_LABEL,
  AUTO_WINNER_DOC_REF,
  AUTO_WINNER_MOMENTUM_LABEL,
  AUTO_WINNER_PUSH_LABEL,
  NOT_EMPLOYED_HERE_NOTE,
  NO_COMPETITORS_NOTE,
  NO_MOMENTUM_COUNTS_ZERO_NOTE,
  autoWinnerPopularityLabel,
  autoWinnerScore,
  type AutoWinnerCompetitor,
  type AutoWinnerScoreInputs,
} from './formulas/autoWinnerScore';
// MTCH2-09: how the match would go (ring skill, stamina, fatigue, body wear, storyline heat).
export {
  AUTO_WINNER_CONDITION_LABEL,
  AUTO_WINNER_FATIGUE_LABEL,
  AUTO_WINNER_HEAT_LABEL,
  AUTO_WINNER_SKILL_LABEL,
  AUTO_WINNER_STAMINA_LABEL,
  NO_STORYLINE_HEAT_NOTE,
  ringSkillOf,
  type AutoWinnerStorylineHeat,
} from './formulas/autoWinnerScore';
export { upsetNote } from './finishes/autoWinner';
export {
  autoWinnerInputsOf,
  competitorSidesOf,
  type AutoWinnerInputsArgs,
  type AutoWinnerSide,
  type AutoWinnerSideIds,
} from './finishes/autoWinnerInputs';
export {
  AUTO_WINNER_LABEL,
  HIGHEST_SCORE_REASON,
  HIGHEST_SCORE_RULE,
  NO_UNPREDICTABILITY_NOTE,
  RANDOM_WINNERS_LABEL,
  TIE_BREAK_REASON,
  TIE_BREAK_RULE,
  autoWinner,
  unpredictabilityLabel,
  type AutoWinnerInputs,
  type AutoWinnerMode,
  type AutoWinnerSideScore,
} from './finishes/autoWinner';
export { randomWinnersActive, type RandomWinnersArgs } from './finishes/randomWinners';
export {
  FINISH_BOOKING_CHECK_ID,
  FINISH_BOOKING_CODES,
  finishBookingCheck,
} from './finishes/bookingCheck';
export {
  BOOKED_FINISH_LABEL,
  BOOKED_FINISH_REASON,
  BOOKED_WINNER_REASON,
  MATCH_RESULT_LABEL,
  NO_WINNER_OPTION,
  RANDOM_WINNERS_MESSAGE,
  RESOLVE_MATCH_REASON_CODES,
  RESOLVING_A_MATCH_DOC_REF,
  WINNER_DECISION_LABEL,
  resolveMatchOutcome,
  type MatchPlan,
  type PlannedWinner,
  type ResolveMatchOutcomeDeps,
  type ResolveMatchOutcomeInput,
  type ResolveMatchOutcomeResult,
  type ResolveMatchReasonCode,
  type ResolveStreamName,
} from './finishes/resolve';

// How a match ends on show night (EVT3-07). Design: docs/design/match-finishes.md#integration.
export {
  BOOKED_NO_CONTEST_REASON,
  MATCH_OUTCOME_RESOLVER_ID,
  RANDOM_WINNERS_SET_ASIDE_NOTE,
  bookedResultFallbackNote,
  planSetAsideNote,
  resolveOnShowNight,
  showNightOutcomeResolver,
} from './finishes/showNight';

// The Match lab's Simulate and the result mode (MTCH2-04), and its batch (MTCH2-07).
// Design: docs/design/match-finishes.md#simulate.
export {
  SIMULATE_REASON_CODES,
  SimulateArgsSchema,
  SimulateBatchArgsSchema,
  type FinishCount,
  type ResultMode,
  type SideWinCount,
  type SimulateArgs,
  type SimulateBatchArgs,
  type SimulateBatchResult,
  type SimulateResult,
  type SimulatedFinish,
} from './simulateQuery';

// Aftermath: what one match result is worth in popularity (MTCH3-01).
// Design: docs/design/match-aftermath.md#popularity-gain.
export { aftermathTunables } from './aftermath/tunables';
export {
  CLASSIC_MATCH_LABEL,
  NO_CONTEST_LABEL,
  NO_CONTEST_REASON,
  NO_FINISH_LABEL,
  NO_MOMENTUM_LABEL,
  NO_OPPONENTS_NOTE,
  NO_SCORE_LABEL,
  PER_MATCH_LIMIT_LABEL,
  POPULARITY_GAIN_DOC_REF,
  POPULARITY_GAIN_LABEL,
  PRE_SHOW_LABEL,
  WIN_FLOOR_LABEL,
  popularityGain,
  type PopularityFinish,
  type PopularityGainInputs,
  type PopularityOpponent,
  type PopularityOutcome,
} from './aftermath/formulas/popularityGain';

export const matchSystem: SystemBundle = defineSystem({
  id: 'match',
  // MTCH3-03: the weekly prune of stored aftermaths. MTCH3-07: the weekly momentum drift.
  // MTCH4-04: the daily prune of the player's physical toll traces past the history window.
  phases: [momentumDriftPhase, pruneAftermathsPhase, prunePhysicalDetailPhase],
  queries: [...matchQueries, ...aftermathQueries, ...recentFormQueries, ...physicalQueries],
});

// Momentum from a match result and a worker's earlier matches (MTCH3-02). Design:
// docs/design/match-aftermath.md#momentum-gain and #prior-matches.
export {
  AFTERMATH_TUNABLES_CATEGORY,
  MOMENTUM_GAIN_TUNABLES_DOC,
  momentumTunables,
} from './aftermath/momentumTunables';
export {
  MOMENTUM_GAIN_DOC_REF,
  MOMENTUM_GAIN_LABEL,
  NO_CONTEST_MOMENTUM_NOTE,
  NO_CONTRACT_MOMENTUM_REASON,
  momentumGain,
  noContractMomentum,
  type MomentumGainInputs,
  type MomentumOpponent,
} from './aftermath/formulas/momentumGain';
// Momentum drift back toward a resting point each week (MTCH3-07). Design:
// docs/design/match-aftermath.md#momentum-drift.
export { MOMENTUM_DRIFT_TUNABLES_DOC } from './aftermath/momentumTunables';
export {
  ACTIVE_DRIFT_LABEL,
  AT_REST_NOTE,
  DRIFT_OFF_NOTE,
  MOMENTUM_DRIFT_DOC_REF,
  SETTLE_WITHIN,
  driftShare,
  momentumDrift,
  momentumDriftLabel,
  type MomentumDriftInputs,
} from './aftermath/formulas/momentumDrift';
export {
  MOMENTUM_DRIFT_PHASE_ID,
  MOMENTUM_DRIFT_PHASE_ORDER,
  MOMENTUM_DRIFT_REASON_KEY,
  applyMomentumDrift,
  driftingEmployments,
  lastMatchDates,
  momentumDriftPhase,
  weeksIdleSince,
  type DriftingEmployment,
} from './aftermath/drift';
export {
  priorMatchesOf,
  resultOf,
  winStreakBefore,
  type MatchPosition,
  type MatchResultForSide,
  type PriorMatch,
  type WinStreak,
} from './aftermath/history';

// The aftermath engine (MTCH3-03): regional spread, the reach seam, the aftermath of one match
// (Simulate and show night), the applier, the stored rows' prune phase and `match.aftermath`.
// Design: docs/design/match-aftermath.md#regional-spread onwards.
export {
  listPopularityReach,
  registerPopularityReach,
  resetPopularityReachForTests,
  type PopularityReachProvider,
  type ReachContext,
  type ReachRegion,
} from './aftermath/reach';
export {
  SHOW_REGION_REASON,
  segmentRegionWeights,
  type RegionWeightLine,
  type RegionWeightSource,
  type SegmentRegionWeights,
} from './aftermath/regionWeights';
export {
  AFTERMATH_DOC_REF,
  computeSegmentAftermath,
  hasMomentum,
  listNames,
  type AftermathInput,
  type AftermathMomentum,
  type AftermathNoMomentum,
  type AftermathPopularity,
  type AftermathRegionRow,
  type AftermathRollupRow,
  type AftermathWorker,
  type SegmentAftermath,
  type SimulatedAftermathInput,
} from './aftermath/computeSegmentAftermath';
export {
  AFTERMATH_TRACE_KINDS,
  applySegmentAftermath,
  momentumGainTraceRef,
  popularityGainTraceRef,
  type AppliedAftermath,
} from './aftermath/apply';
export { aftermathsToPrune, pruneAftermathsPhase } from './aftermath/prune';
export {
  AFTERMATH_NOT_FOUND_MESSAGES,
  type AftermathQueryArgs,
  type AftermathRegionView,
  type AftermathResult,
  type AftermathSegmentView,
  type AftermathWorkerView,
} from './aftermath/queries';

// Recent form (MTCH3-04). Design: docs/design/match-aftermath.md#recent-form.
export {
  RECENT_FORM_DEFAULT_LIMIT,
  RECENT_FORM_MAX_LIMIT,
  RECENT_FORM_NOT_FOUND_MESSAGE,
  type RecentFormArgs,
  type RecentFormOpponent,
  type RecentFormResult,
  type RecentFormRow,
} from './aftermath/recentFormQuery';

// MTCH3 wired into its partners (MTCH3-05): show night's aftermath applier and TV reach for worker
// popularity. Design: docs/design/match-aftermath.md#integrations.
export {
  AFTERMATH_APPLIER_ID,
  AFTERMATH_APPLIER_ORDER,
  aftermathApplier,
  applyAftermathOnShowNight,
} from './aftermath/showNight';
export {
  TV_REACH_PROVIDER_ID,
  TV_REACH_PROVIDER_ORDER,
  tvReachReason,
  tvReachRegions,
} from './aftermath/tvReach';

// The physical toll (MTCH4-01): fatigue gain, condition wear, wear by part, the physical inputs and
// the risk modifier seam. Design: docs/design/physical-toll.md.
export {
  CONDITION_WEAR_DOC_REF,
  FATIGUE_GAIN_DOC_REF,
  MAX_RISK_MODIFIER_ORDER,
  ROUGHNESS_ROLL_LABEL,
  WEAR_STREAM,
  applyRepeatMatch,
  collectPhysicalInputs,
  collectRiskContributions,
  computeConditionWear,
  computeFatigueGain,
  computeWearByPart,
  earlierMatchesOnCard,
  keepItSafeSource,
  loadCarriersBySide,
  physicalTunables,
  registerRiskModifier,
  repeatMatchFactor,
  repeatMatchLabel,
  riskModifierIds,
  roughestOpponentOf,
  type AppliedRiskContribution,
  type ConditionWearInputs,
  type FatigueGainInputs,
  type PhysicalCardPosition,
  type PhysicalOpponent,
  type PhysicalParticipant,
  type PhysicalSegmentSpec,
  type PhysicalWorkerInputs,
  type RiskContext,
  type RiskContribution,
  type RiskModifierSpec,
} from './physical';

// A match booked as Random is a coin flip; an auto-winner upset is noted (MTCH2-08).
export {
  COIN_FLIP_LABEL,
  COIN_FLIP_REASON,
  COIN_FLIP_RULE,
  coinFlipDrawLabel,
} from './finishes/autoWinner';
// In-match injuries (MTCH4-02): the injury chance, the roll, the handler seam and the physical
// toll's trace refs. Design: docs/design/physical-toll.md#injury-chance.
export {
  END_FATIGUE_LABEL,
  LAB_WHAT_IF_FATIGUE_LABEL,
  FATIGUE_TRACE_KIND,
  INJURIES_OFF_LABEL,
  INJURY_CHANCE_DOC_REF,
  INJURY_CHANCE_TRACE_KIND,
  INJURY_DECISION_LABEL,
  INJURY_ROLL_DOC_REF,
  INJURY_ROLL_TRACE_KIND,
  INJURY_STREAM,
  LEARNING_TRACE_KIND,
  RIVAL_NO_INJURIES_LABEL,
  WEAR_TRACE_KIND,
  computeInjuryChance,
  conditionAfterWear,
  fatigueTraceRef,
  clearInjuryHandler,
  getInjuryHandler,
  injuryChanceTraceRef,
  injuryLimitLine,
  injuryPolicyFor,
  injuryRollTraceRef,
  learningTraceRef,
  leastSafeOpponentOf,
  registerInjuryHandler,
  restoreBuiltInInjuryHandler,
  riskiestOpponentOf,
  rollSegmentInjuries,
  wearTraceRef,
  worstBodyPart,
  type InjuryChanceInputs,
  type InjuryHandler,
  type InjuryOutcome,
  type InjuryRequest,
  type InjuryRollEntry,
  type InjuryRollResult,
  type RepeatMatchKey,
} from './physical';

// Ring learning (MTCH4-03). Design: docs/design/physical-toll.md#ring-learning.
export {
  IN_MATCH_LEARNING,
  LIMITED_BY_POTENTIAL_LABEL,
  PRODUCED_ATTRIBUTES,
  RING_LEARNING_DOC_REF,
  collectRingLearning,
  computeRingLearning,
  computeRingLearningTotal,
  isTaughtAttribute,
  learningTunables,
  mentorOnCard,
  type InMatchLearningAttribute,
  type InMatchLearningEntry,
  type LearningPeer,
  type LearningProducer,
  type MentorOnCard,
  type RingLearningInputs,
  type WorkerRingLearning,
} from './physical';

// The physical toll in one fixed order, its show-night applier, the prune of its traces and
// `match.physicalForSegment` (MTCH4-04). Design: docs/design/physical-toll.md#show-night.
export {
  ALREADY_INJURED_LABEL,
  ALREADY_INJURED_TONIGHT_LABEL,
  CONDITION_LOST_LABEL,
  FATIGUE_AFTER_LABEL,
  FATIGUE_FROM_MATCH_LABEL,
  NO_INJURY_HANDLER_LOG,
  PHYSICAL_FOR_SEGMENT_NOT_FOUND,
  PHYSICAL_TOLL_APPLIER_ID,
  PHYSICAL_TOLL_APPLIER_ORDER,
  PRUNE_PHYSICAL_DETAIL_PHASE_ID,
  applyPhysicalToll,
  applyPhysicalTollOnShowNight,
  cardPersonIdsOf,
  computePhysicalToll,
  conditionLostTrace,
  fatigueAfterTrace,
  physicalForSegmentQuery,
  physicalTollApplier,
  prunePhysicalDetailPhase,
  segmentSpecFromWorld,
  type AlreadyInjured,
  type PhysicalForSegmentArgs,
  type PhysicalForSegmentResult,
  type PhysicalNumber,
  type PhysicalTollDeps,
  type PhysicalTollPolicy,
  type PhysicalTollResult,
  type PhysicalWorkerRow,
  type WorkerInjuryResult,
  type WorkerPhysicalToll,
} from './physical';
