/**
 * What the news queries return: one story as the screen shows it, and the names of everything the
 * stories mention, so the web renders a story without one query per name.
 *
 * News is public (D-07): every viewer gets the same view, so nothing here is filtered by viewer,
 * and nothing hidden (development, hidden vices, rival finances) is ever in a story to begin with.
 *
 * Design: docs/design/news.md#queries.
 */

import type { GameDate } from '../../core/date';
import { isId, kindOfId, type EntityKind, type NewsId } from '../../core/ids';
import type { TraceReader } from '../../core/api/query';
import type { TraceRef } from '../../core/trace/store';
import type { MessageRefs } from '../../model/entities/mail';
import {
  NEWS_KIND_LABELS,
  type News,
  type NewsImportance,
  type NewsKind,
} from '../../model/entities/news';
import type { TemplatedText } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';
import { isFrontPage } from './frontPage';
import { NEWS_BUZZ_TRACE_KIND } from './post';
import { displayNameOf } from './subjects';

/** One story as the News screen shows it. Plain JSON. */
export interface NewsItemView {
  readonly id: NewsId;
  readonly date: GameDate;
  readonly kind: NewsKind;
  /** The kind's name on screen ("Title change"). */
  readonly kindLabel: string;
  readonly headline: TemplatedText;
  readonly body: TemplatedText;
  readonly refs: MessageRefs;
  readonly importance: NewsImportance;
  /** 0..100, fixed when the story was posted. */
  readonly buzz: number;
  /** The story's `news.buzz` trace while the trace store still holds it, else null. */
  readonly buzzTraceRef: TraceRef | null;
  /** True for importance 3 or buzz at least `news.frontPage.minBuzz`. */
  readonly frontPage: boolean;
  /** The first day the story is gone from the feed, or null when it is kept. */
  readonly expiresOn: GameDate | null;
}

/** The name of every id the stories mention, keyed by id. */
export type NewsNames = Record<string, { kind: EntityKind; name: string }>;

/** The name an id gets when what it names has been deleted. */
export const NO_LONGER_IN_RECORDS = '(no longer in the records)';

/** The `news.buzz` trace of a story. */
export function newsBuzzTraceRef(newsId: NewsId): TraceRef {
  return { kind: NEWS_BUZZ_TRACE_KIND, id: newsId };
}

/** A story as the screen shows it. */
export function toNewsItemView(
  news: DeepReadonly<News>,
  deps: { readonly traces: Pick<TraceReader, 'has'>; readonly tunables: EngineTunables },
): NewsItemView {
  const ref = newsBuzzTraceRef(news.id);
  return {
    id: news.id,
    date: news.date,
    kind: news.kind,
    kindLabel: NEWS_KIND_LABELS[news.kind],
    headline: { key: news.headline.key, params: { ...news.headline.params } },
    body: { key: news.body.key, params: { ...news.body.params } },
    refs: {
      personIds: [...news.refs.personIds],
      promotionIds: [...news.refs.promotionIds],
      eventInstanceId: news.refs.eventInstanceId,
      employmentId: news.refs.employmentId,
    },
    importance: news.importance,
    buzz: news.buzz,
    buzzTraceRef: deps.traces.has(ref) ? ref : null,
    frontPage: isFrontPage(news, deps.tunables),
    expiresOn: news.expiresOn,
  };
}

/** Every id a story mentions: its refs, then each param value (or comma-joined part) that is an id. */
function idsOf(item: NewsItemView): string[] {
  const ids: string[] = [...item.refs.personIds, ...item.refs.promotionIds];
  if (item.refs.eventInstanceId !== null) {
    ids.push(item.refs.eventInstanceId);
  }
  if (item.refs.employmentId !== null) {
    ids.push(item.refs.employmentId);
  }
  for (const params of [item.headline.params, item.body.params]) {
    for (const value of Object.values(params)) {
      if (typeof value !== 'string') {
        continue;
      }
      for (const part of value.split(',')) {
        ids.push(part.trim());
      }
    }
  }
  return ids;
}

/** The name of one id, or null when its row is gone or stories do not name its kind. */
function nameOf(read: GameWorldView, id: string, date: GameDate): string | null {
  const { tables } = read;
  if (isId('person', id)) {
    return tables.people.has(id) ? displayNameOf(read, id, date) : null;
  }
  if (isId('promotion', id)) {
    return tables.promotions.get(id)?.name ?? null;
  }
  if (isId('title', id)) {
    return tables.titles.get(id)?.name ?? null;
  }
  if (isId('eventInstance', id)) {
    return tables.eventInstances.get(id)?.name ?? null;
  }
  if (isId('employment', id)) {
    return tables.employments.get(id)?.ringName ?? null;
  }
  if (isId('season', id)) {
    const season = tables.seasons.get(id);
    return season === undefined ? null : `Season ${String(season.number)}`;
  }
  return null;
}

/** The kinds of id `collectNames` names. Any other id in a story is left out of `names`. */
export const NAMED_KINDS: readonly EntityKind[] = [
  'person',
  'promotion',
  'title',
  'eventInstance',
  'employment',
  'season',
];

/**
 * The names of every id in `items`' refs and params: people by `displayNameOf` on `date`,
 * promotions, titles, shows and contracts by name, seasons as "Season <n>". An id whose row is
 * gone is named "(no longer in the records)".
 */
export function collectNames(
  read: GameWorldView,
  items: readonly NewsItemView[],
  date: GameDate,
): NewsNames {
  const names: NewsNames = {};
  for (const item of items) {
    for (const id of idsOf(item)) {
      if (Object.hasOwn(names, id)) {
        continue;
      }
      const kind = kindOfId(id);
      if (kind === null || !NAMED_KINDS.includes(kind)) {
        continue;
      }
      names[id] = { kind, name: nameOf(read, id, date) ?? NO_LONGER_IN_RECORDS };
    }
  }
  return names;
}
