/**
 * The weekly milestone stories (DAY1-02): the source registry and the five built-in sources,
 * registered in this order: reigns, reign records, careers, promotions, seasons.
 * Design: docs/design/news.md#milestones.
 */

export {
  milestoneSources,
  registerMilestoneSource,
  type MilestoneCandidate,
  type MilestoneDeps,
  type MilestoneSource,
  type MilestoneWindow,
} from './registry';
export { REIGN_MILESTONE_DAYS, REIGN_MILESTONE_TOPIC, reignsSource } from './reigns';
export { REIGN_RECORD_TOPIC, reignRecordsSource } from './reignRecords';
export { CAREER_ANNIVERSARY_TOPIC, CAREER_MAJOR_YEARS, careersSource } from './careers';
export {
  PROMOTION_ANNIVERSARY_TOPIC,
  PROMOTION_MAJOR_YEARS,
  promotionsSource,
} from './promotions';
export {
  SEASON_START_TOPIC,
  seasonStartBodyParams,
  seasonStartDedupeKey,
  seasonsSource,
} from './seasons';
