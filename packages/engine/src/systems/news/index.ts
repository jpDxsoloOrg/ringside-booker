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
 * seasons).
 *
 * DAY1-03 adds the reads the News screen needs (`news.feed`, `news.top`, `news.item`, with the
 * names of everything a story mentions), the front-page rule, and skip alerts: the per-player
 * alert rules (`alerts.ts`), the `news.matchAlerts` reaction, the `news.alert` gate and the
 * `news.setAlertRules` / `news.ackAlerts` commands. Later DAY1 tickets add the screen.
 * Design: docs/design/news.md.
 */

// The event declarations are types only. Importing them here brings them into every program that
// imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './setup';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { matchAlertsSubscription, newsAlertGate } from './alerts';
import { newsCommands } from './commands';
import { newsPhases } from './phases';
import { newsQueries } from './queries';

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

export {
  alertPendingKey,
  alertRuleKey,
  alertSettingsOf,
  alertStopSkipKey,
  BUILT_IN_NEWS_ALERT_RULES,
  defineNewsAlertRule,
  firstMatchingRule,
  MATCH_ALERTS_SUBSCRIPTION_ID,
  matchAlertsSubscription,
  NEWS_ACTION_HINT,
  aboutOwnShow,
  NEWS_ALERT_GATE_ID,
  NEWS_ALERT_RULE_ID_PATTERN,
  NEWS_ALERT_STOP_SKIP_DEFAULT,
  NEWS_ALERTS_SETTINGS_PREFIX,
  newsAlertGate,
  newsAlertReason,
  newsAlertRule,
  newsAlertRules,
  pendingAlertOf,
  promotionsOfPlayer,
  registerNewsAlertRule,
  ruleEnabledFor,
  stopSkipOf,
  withAlertSettings,
  type AlertSettings,
  type AlertSettingsPatch,
  type NewsAlertRule,
  type NewsAlertRuleContext,
} from './alerts';
export {
  ackAlertsCommand,
  issuingPlayerId,
  NOT_A_PLAYER,
  newsCommands,
  setAlertRulesCommand,
} from './commands';
export {
  compareFeed,
  frontPageRank,
  isFrontPage,
  isShownOn,
  rankedWindow,
  storiesBetween,
} from './frontPage';
export {
  NEWS_FEED_DEFAULT_LIMIT,
  NEWS_FEED_MAX_LIMIT,
  NEWS_ITEM_NOT_FOUND,
  NEWS_TICKER_DEFAULT_COUNT,
  NEWS_TICKER_MAX_COUNT,
  NEWS_TICKER_MIN_FROM_WINDOW,
  newsAlertRulesQuery,
  newsFeedQuery,
  newsItemQuery,
  newsQueries,
  newsTopQuery,
  type NewsAlertRulesView,
  type NewsAlertRuleView,
  type NewsFeed,
  type NewsFeedArgs,
  type NewsItemResult,
  type NewsTop,
  type NewsTopArgs,
} from './queries';
export {
  collectNames,
  NAMED_KINDS,
  NO_LONGER_IN_RECORDS,
  newsBuzzTraceRef,
  toNewsItemView,
  type NewsItemView,
  type NewsNames,
} from './views';

export const newsSystem: SystemBundle = defineSystem({
  id: 'news',
  phases: newsPhases,
  queries: newsQueries,
  commands: newsCommands,
  gates: [newsAlertGate],
  subscriptions: [matchAlertsSubscription],
});
