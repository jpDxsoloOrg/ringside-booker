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
// Registers the built-in `match` and `angle` raters at module load.
import './rating/builtins';
// Registers the Random winners new-game setting at module load (MTCH2-03).
import './settings';
// Registers the `match.finish` booking check at module load (EVT2-07).
import './finishes/bookingCheck';
// Registers MTCH2's match outcome resolver with show night at module load (EVT3-07).
import './finishes/showNight';

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
export {
  LAB_WORKERS_DEFAULT_LIMIT,
  LAB_WORKERS_MAX_LIMIT,
  LAB_WORKERS_MAX_SEARCH,
  LAB_WORKER_SCOPES,
  type LabDefaults,
  type LabImportance,
  type LabOptions,
  type LabPromotion,
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
  queries: matchQueries,
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
  PER_MATCH_LIMIT_LABEL,
  momentumGain,
  noContractMomentum,
  type MomentumGainInputs,
  type MomentumOpponent,
} from './aftermath/formulas/momentumGain';
export {
  priorMatchesOf,
  resultOf,
  winStreakBefore,
  type MatchPosition,
  type MatchResultForSide,
  type PriorMatch,
  type WinStreak,
} from './aftermath/history';
