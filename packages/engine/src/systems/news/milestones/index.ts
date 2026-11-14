/**
 * The weekly milestone stories (DAY1-02): the source registry and the five built-in sources.
 *
 * The built-ins are registered here, in one fixed order (reigns, reign records, careers,
 * promotions, seasons), so the order never depends on which module happened to load first.
 * Design: docs/design/news.md#milestones.
 */

import { careersSource } from './careers';
import { promotionsSource } from './promotions';
import { registerMilestoneSource } from './registry';
import { reignRecordsSource } from './reignRecords';
import { reignsSource } from './reigns';
import { seasonsSource } from './seasons';

for (const source of [
  reignsSource,
  reignRecordsSource,
  careersSource,
  promotionsSource,
  seasonsSource,
]) {
  registerMilestoneSource(source);
}

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
export { PROMOTION_ANNIVERSARY_TOPIC, PROMOTION_MAJOR_YEARS, promotionsSource } from './promotions';
export {
  SEASON_START_TOPIC,
  seasonStartBodyParams,
  seasonStartDedupeKey,
  seasonsSource,
} from './seasons';
