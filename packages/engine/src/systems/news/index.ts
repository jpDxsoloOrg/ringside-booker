/**
 * The news wire (DAY1): the public stories of the wrestling world.
 *
 * DAY1-01 adds the posting core every system uses to tell the world something: `postNews` (topic
 * check, dedupe, buzz, expiry, the `news.buzz` trace and `news.posted`), the traced `buzzScore`,
 * the topic registry and the `news.*` tunables.
 *
 * DAY1-02 adds the first stories and the clean-up: the "Season one begins" setup step
 * (`setup.ts`), the daily `news.expire` phase, and the weekly `news.milestones` phase fed by the
 * milestone source registry (`milestones/`: reigns, reign records, careers, promotions and later
 * seasons). Later DAY1 tickets add the feed queries and the screen. Design: docs/design/news.md.
 */

// The event declarations are types only. Importing them here brings them into every program that
// imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './setup';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { newsPhases } from './phases';

export {
  BUZZ_KIND_BASE_KEYS,
  BUZZ_MAX,
  BUZZ_MIN,
  BUZZ_SCORE_DOC_REF,
  buzzScore,
  type BuzzScoreInputs,
  type BuzzSubject,
} from './formulas/buzzScore';
export {
  FRONT_PAGE_KEPT_REASON,
  NEWS_BUZZ_TRACE_KIND,
  postNews,
  type NewsParams,
  type PostNewsInput,
} from './post';
export { buzzSubjectsOf, displayNameOf, type BuzzSubjects } from './subjects';
export {
  NEWS_PARAM_PATTERN,
  newsTopic,
  newsTopicKeys,
  newsTopics,
  registerNewsTopic,
  type NewsTopic,
  type NewsTopicSpec,
} from './topics';
export { newsTunables } from './tunables';
export {
  CAREER_ANNIVERSARY_TOPIC,
  CAREER_MAJOR_YEARS,
  milestoneSources,
  PROMOTION_ANNIVERSARY_TOPIC,
  PROMOTION_MAJOR_YEARS,
  REIGN_MILESTONE_DAYS,
  REIGN_MILESTONE_TOPIC,
  REIGN_RECORD_TOPIC,
  registerMilestoneSource,
  SEASON_START_TOPIC,
  seasonStartDedupeKey,
  type MilestoneCandidate,
  type MilestoneDeps,
  type MilestoneSource,
  type MilestoneWindow,
} from './milestones';
export {
  compareMilestones,
  EXPIRE_NEWS_PHASE_ID,
  expireNewsPhase,
  MILESTONES_PHASE_ID,
  milestonesPhase,
  newsPhases,
} from './phases';
export { NEWS_OPENING_STORY_STEP } from './setup';

export const newsSystem: SystemBundle = defineSystem({ id: 'news', phases: newsPhases });
