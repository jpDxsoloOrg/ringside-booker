/**
 * The news wire (DAY1): the public stories of the wrestling world.
 *
 * DAY1-01 adds the posting core every system uses to tell the world something: `postNews` (topic
 * check, dedupe, buzz, expiry, the `news.buzz` trace and `news.posted`), the traced `buzzScore`,
 * the topic registry and the `news.*` tunables. The bundle has no phases, queries or commands
 * yet; later DAY1 tickets add the feed queries, expiry clean-up and the screen. Design:
 * docs/design/news.md.
 */

// The event declarations are types only. Importing them here brings them into every program that
// imports this system, including programs that only see the emitted .d.ts files.
import './events';
import { defineSystem, type SystemBundle } from '../../core/api/system';

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

export const newsSystem: SystemBundle = defineSystem({ id: 'news' });
