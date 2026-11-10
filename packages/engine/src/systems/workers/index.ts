/**
 * The workers system: the shared answers to the small questions every feature asks about a person.
 *
 * How old are they, can they work today, may they hold this title, which weight class are they in,
 * what grade is a 72, who do they work for. Each question is answered once here, by a plain helper
 * (`helpers/`) or a traced formula (`formulas/`), so the answers cannot drift apart between
 * screens and systems. Nothing those return is stored: every answer is derived on read.
 *
 * It also owns the doors (`doors.ts`): the only code that changes push, alignment, role, regional
 * popularity, momentum and morale once the world exists.
 *
 * Design: docs/design/workers.md.
 */

// The event declarations are types only. Importing them here brings them into every program that
// imports this system, including programs that only see the emitted .d.ts files.
import './events';
import { defineSystem, type SystemBundle } from '../../core/api/system';

export { ageOn, experienceYears } from './helpers/age';
export {
  AVAILABILITY_STATUSES,
  availabilityOf,
  DEBUT_ROLES,
  type Availability,
  type AvailabilityStatus,
} from './helpers/availability';
export {
  isEligibleForTitle,
  TITLE_ELIGIBILITY_CODES,
  type TitleEligibilityCode,
} from './helpers/eligibility';
export { activeEmploymentsOf, isFreeAgent, primaryEmploymentOf } from './helpers/employment';
export { mainRoleOf, RATING_ROLES, ratingRoleOfPersonRole, type RatingRole } from './helpers/roles';
export {
  GRADE_BANDS,
  GRADE_BANDS_REASON,
  GRADES,
  gradeFloorOf,
  gradeOf,
  type Grade,
  type GradeBand,
  type GradeResult,
} from './formulas/grade';
export {
  WEIGHT_CLASS_DOC_REF,
  WEIGHT_CLASS_LABELS,
  WEIGHT_CLASSES,
  weightClass,
  type WeightClass,
  type WeightClassInputs,
} from './formulas/weightClass';
export {
  NO_WEIGHTS_NOTE,
  OCCASIONAL_WRESTLER_NOTE,
  overallByRole,
  overallOf,
  RATING_ROLE_LABELS,
  roleRating,
  type RoleRatingInputs,
} from './formulas/roleRating';
export {
  EXPECTED_PUSH_DOC_REF,
  fanBaseOf,
  FOOTPRINT_TRACE_TOP_REGIONS,
  footprintPopularity,
  footprintPopularityValue,
  NO_FANS_NOTE,
  type FanBase,
  type FanBaseRegion,
  type FootprintPopularityInputs,
  type FootprintRegion,
  type FootprintRegionalPop,
} from './formulas/footprintPopularity';
export {
  CREW_NOT_PUSHED_RULE,
  CREW_ROLES,
  expectedPush,
  PUSH_LABELS,
  pushStanding,
  STAR_REASON,
  type ExpectedPushInputs,
  type PushStanding,
} from './formulas/expectedPush';
export { expectedPushAt, footprintPopularityAt } from './helpers/expectedPushAt';
export {
  DEFAULT_RATING_WEIGHTS,
  RATING_WEIGHTS_CATEGORY,
  ratingWeightKey,
  ratingWeightTunables,
  ROLE_RATINGS_DOC_REF,
  type RatingWeightKey,
} from './ratingWeights';
export {
  applyMomentumChange,
  applyMoraleChange,
  applyPopularityChange,
  DOOR_TRACE_KINDS,
  DOORS_DOC_REF,
  ROLE_CHANGED_REASON_KEY,
  SET_ROLE_PROBLEM_CODES,
  setAlignment,
  setPush,
  setRole,
  setRoleProblems,
  type ApplyMomentumChangeArgs,
  type ApplyMoraleChangeArgs,
  type ApplyPopularityChangeArgs,
  type DoorContext,
  type DoorReason,
  type DoorResult,
  type DoorSource,
  type PopularityDoorResult,
  type PopularitySubject,
  type SetAlignmentArgs,
  type SetPushArgs,
  type SetRoleArgs,
  type SetRoleProblemCode,
} from './doors';
export {
  POPULARITY_DOC_REF,
  popularityAnchor,
  type PopularityAnchorInputs,
} from './formulas/popularityAnchor';
export {
  popularityChange,
  type PopularityChangeInputs,
  type PopularitySubjectKind,
} from './formulas/popularityChange';
export { workersTunables } from './tunables';

export const workersSystem: SystemBundle = defineSystem({
  id: 'workers',
  queries: [],
});
