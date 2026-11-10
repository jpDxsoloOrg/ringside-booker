/**
 * The workers system: the shared answers to the small questions every feature asks about a person.
 *
 * How old are they, can they work today, may they hold this title, which weight class are they in,
 * what grade is a 72, who do they work for. Each question is answered once here, by a plain helper
 * (`helpers/`) or a traced formula (`formulas/`), so the answers cannot drift apart between
 * screens and systems. Nothing here is stored: every answer is derived on read.
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
export { workersTunables } from './tunables';

export const workersSystem: SystemBundle = defineSystem({
  id: 'workers',
  queries: [],
});
