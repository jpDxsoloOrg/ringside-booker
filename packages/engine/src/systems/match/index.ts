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

export const matchSystem: SystemBundle = defineSystem({
  id: 'match',
  queries: matchQueries,
});
