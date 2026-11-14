/**
 * `postNews`: the one way a story goes on the news feed.
 *
 * It checks the topic and its parameters, skips a story that was already posted under the same
 * dedupe key, scores the story's buzz, sets its expiry from its importance, writes the row, stores
 * the `news.buzz` trace and publishes `news.posted`, all inside the caller's step, so a failed step
 * leaves no story behind.
 *
 * News is flavour: posting a story never changes morale, popularity or money. News is also public
 * (D-07), so a caller must never put hidden facts in a story (development, hidden vices, a rival's
 * finances, contract terms).
 *
 * Design: docs/design/news.md#posting.
 */

import { addDays } from '../../core/date';
import { InvalidArgumentError } from '../../core/errors';
import type { NewsId } from '../../core/ids';
import type { StepContext } from '../../core/pipeline/context';
import type { MessageRefs } from '../../model/entities/mail';
import type { NewsImportance, NewsKind } from '../../model/entities/news';
import { geographyOf } from '../world/geography';
import { buzzScore } from './formulas/buzzScore';
import { buzzSubjectsOf } from './subjects';
import { newsTopic } from './topics';

/** The trace kind every story's buzz is stored under, keyed by the story's ID. */
export const NEWS_BUZZ_TRACE_KIND = 'news.buzz';

/**
 * A design rule, not a tunable: importance 3 is the front page, and front-page stories are kept
 * as history, so they never expire.
 */
export const FRONT_PAGE_KEPT_REASON = 'Front-page stories are kept as history';

export type NewsParams = Record<string, string | number>;

export interface PostNewsInput {
  readonly kind: NewsKind;
  /** The registered topic whose keys write the text: `news.<topic>.headline` and `.body`. */
  readonly topic: string;
  /** Parameters of the headline (and of the body when `bodyParams` is left out). */
  readonly params?: NewsParams;
  /** Parameters of the body, when it needs other ones than the headline. */
  readonly bodyParams?: NewsParams;
  /** Who and what the story is about. People and promotions also feed its buzz. */
  readonly refs?: Partial<MessageRefs>;
  readonly importance: NewsImportance;
  /**
   * Days the story stays on the feed after the day it is posted (`expiresOn` is the first day it
   * is gone). Left out: the importance's `news.expiry.*` tunable. Null: it never expires.
   * Importance 3 never expires whatever this says.
   */
  readonly expiresInDays?: number | null;
  /** "Only once": a story with this key already on file is returned instead of posting again. */
  readonly dedupeKey?: string;
}

const EXPIRY_KEYS = {
  0: 'news.expiry.importance0Days',
  1: 'news.expiry.importance1Days',
  2: 'news.expiry.importance2Days',
} as const;

function checkParams(topic: string, declared: readonly string[], params: NewsParams | undefined) {
  for (const name of Object.keys(params ?? {})) {
    if (!declared.includes(name)) {
      throw new InvalidArgumentError(
        'postNews',
        'params',
        name,
        `a parameter declared by news topic "${topic}" (${declared.join(', ') || 'none'})`,
      );
    }
  }
}

function expiryDays(ctx: StepContext, input: PostNewsInput): number | null {
  if (input.importance === 3) {
    ctx.log(`news: no expiry. ${FRONT_PAGE_KEPT_REASON}`);
    return null;
  }
  if (input.expiresInDays === null) {
    return null;
  }
  if (input.expiresInDays === undefined) {
    return ctx.tunables.get(EXPIRY_KEYS[input.importance]);
  }
  if (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 0) {
    throw new InvalidArgumentError(
      'postNews',
      'expiresInDays',
      input.expiresInDays,
      'a whole number of days, 0 or more, or null',
    );
  }
  return input.expiresInDays;
}

/**
 * Posts a story and returns its ID, or the ID of the story already posted under the same
 * `dedupeKey` (posting nothing).
 *
 * @throws InvalidArgumentError for an unregistered topic, an undeclared parameter or a bad
 *   `expiresInDays`; the caller's step rolls back and the failure is logged.
 */
export function postNews(ctx: StepContext, input: PostNewsInput): NewsId {
  const topic = newsTopic(input.topic);
  if (topic === undefined) {
    throw new InvalidArgumentError('postNews', 'topic', input.topic, 'a registered news topic');
  }
  checkParams(topic.topic, topic.params, input.params);
  checkParams(topic.topic, topic.params, input.bodyParams);

  if (input.dedupeKey !== undefined) {
    const [existing] = ctx.read.tables.news.lookup('byDedupeKey', input.dedupeKey);
    if (existing !== undefined) {
      return existing.id;
    }
  }

  const refs: MessageRefs = {
    personIds: [...(input.refs?.personIds ?? [])],
    promotionIds: [...(input.refs?.promotionIds ?? [])],
    eventInstanceId: input.refs?.eventInstanceId ?? null,
    employmentId: input.refs?.employmentId ?? null,
  };
  const { subjects, skipped } = buzzSubjectsOf(ctx.read, refs, geographyOf(ctx.read), ctx.date);
  const buzz = buzzScore(
    { kind: input.kind, importance: input.importance, subjects, skipped },
    { tunables: ctx.tunables },
  );
  const days = expiryDays(ctx, input);
  const params = input.params ?? {};

  const row = ctx.tx.create('news', {
    date: ctx.date,
    kind: input.kind,
    headline: { key: topic.headlineKey, params: { ...params } },
    body: { key: topic.bodyKey, params: { ...(input.bodyParams ?? params) } },
    refs,
    importance: input.importance,
    expiresOn: days === null ? null : addDays(ctx.date, days),
    buzz: buzz.value,
    dedupeKey: input.dedupeKey ?? null,
  });
  ctx.recordTrace({ kind: NEWS_BUZZ_TRACE_KIND, id: row.id }, ctx.date, buzz);
  ctx.publish('news.posted', {
    newsId: row.id,
    kind: row.kind,
    importance: row.importance,
    buzz: row.buzz,
  });
  return row.id;
}
