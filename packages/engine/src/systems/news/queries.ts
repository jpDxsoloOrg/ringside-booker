/**
 * The news queries: the filterable feed, the front page (hero stories and the ticker), one story,
 * and the viewer's alert rules.
 *
 * Every story is public (D-07), so the feed, the front page and a story look the same to every
 * viewer; only `mine` and `news.alertRules` read who is asking. Each result carries the names of
 * every id its stories mention (`names`).
 *
 * Design: docs/design/news.md#queries.
 */

import { z } from 'zod';
import { viewerPromotionIds } from '../../core/api/controller';
import { defineQuery, type QueryContext } from '../../core/api/query';
import { refuseQuery } from '../../core/api/result';
import type { GameDate } from '../../core/date';
import type { NewsId, PersonId, PromotionId } from '../../core/ids';
import { NewsKindSchema, type News, type NewsKind } from '../../model/entities/news';
import { zGameDate, zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { alertSettingsOf, newsAlertRules } from './alerts';
import { issuingPlayerId } from './commands';
import {
  compareFeed,
  isFrontPage,
  isShownOn,
  rankedWindow,
  storiesBetween,
} from './frontPage';
import { collectNames, toNewsItemView, type NewsItemView, type NewsNames } from './views';

type Story = DeepReadonly<News>;

/** The most stories one `news.feed` call returns, and the default. */
export const NEWS_FEED_MAX_LIMIT = 500;
export const NEWS_FEED_DEFAULT_LIMIT = 200;

/** The default number of ticker stories, and the most. */
export const NEWS_TICKER_DEFAULT_COUNT = 12;
export const NEWS_TICKER_MAX_COUNT = 20;

/** Below this many stories in the window, the ticker is filled with the latest ones. */
export const NEWS_TICKER_MIN_FROM_WINDOW = 3;

/** The message `news.item` refuses with when the story is gone. */
export const NEWS_ITEM_NOT_FOUND = 'This story is no longer in the news archive';

export interface NewsFeedArgs {
  from?: GameDate | undefined;
  to?: GameDate | undefined;
  kinds?: NewsKind[] | undefined;
  promotionId?: PromotionId | undefined;
  personId?: PersonId | undefined;
  minImportance?: number | undefined;
  frontPageOnly?: boolean | undefined;
  /** Only stories naming one of the viewer's promotions (or one of their shows). */
  mine?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface NewsFeed {
  items: NewsItemView[];
  names: NewsNames;
  /** How many stories match, before `limit` and `offset`. */
  total: number;
}

export interface NewsTopArgs {
  heroCount?: number | undefined;
  tickerCount?: number | undefined;
}

export interface NewsTop {
  /** The best-ranked front-page stories of the window. */
  hero: NewsItemView[];
  /** The best-ranked stories of the window, topped up with the latest when the window is thin. */
  ticker: NewsItemView[];
  names: NewsNames;
}

export interface NewsItemResult {
  item: NewsItemView;
  names: NewsNames;
}

/** One rule as the alert settings list shows it. */
export interface NewsAlertRuleView {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  defaultOn: boolean;
}

export interface NewsAlertRulesView {
  rules: NewsAlertRuleView[];
  stopSkip: boolean;
  pending: NewsId | null;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'news.feed': { args: NewsFeedArgs; result: NewsFeed };
    'news.top': { args: NewsTopArgs; result: NewsTop };
    'news.item': { args: { newsId: NewsId }; result: NewsItemResult };
    'news.alertRules': { args: Record<string, never>; result: NewsAlertRulesView };
  }
}

function itemViews(ctx: QueryContext, stories: readonly Story[]): NewsItemView[] {
  return stories.map((news) =>
    toNewsItemView(news, { traces: ctx.traces, tunables: ctx.tunables }),
  );
}

/** True when the story names one of `promotionIds`, directly or through its show. */
function touches(read: GameWorldView, news: Story, promotionIds: readonly PromotionId[]): boolean {
  if (news.refs.promotionIds.some((id) => promotionIds.includes(id))) {
    return true;
  }
  const showId = news.refs.eventInstanceId;
  const show = showId === null ? undefined : read.tables.eventInstances.get(showId);
  return show !== undefined && promotionIds.includes(show.promotionId);
}

export const newsFeedQuery = defineQuery('news.feed', {
  args: z.strictObject({
    from: zGameDate.optional(),
    to: zGameDate.optional(),
    kinds: z.array(NewsKindSchema).optional(),
    promotionId: zId('promotion').optional(),
    personId: zId('person').optional(),
    minImportance: z.number().int().min(0).max(3).optional(),
    frontPageOnly: z.boolean().optional(),
    mine: z.boolean().optional(),
    limit: z.number().int().min(1).max(NEWS_FEED_MAX_LIMIT).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  run: (ctx, args) => {
    const { read } = ctx;
    const mine = args.mine === true ? viewerPromotionIds(read, ctx.viewer) : null;
    const matching = storiesBetween(read, args.from ?? null, args.to ?? null, ctx.date).filter(
      (news) =>
        (args.kinds === undefined || args.kinds.includes(news.kind)) &&
        (args.promotionId === undefined || news.refs.promotionIds.includes(args.promotionId)) &&
        (args.personId === undefined || news.refs.personIds.includes(args.personId)) &&
        news.importance >= (args.minImportance ?? 0) &&
        (args.frontPageOnly !== true || isFrontPage(news, ctx.tunables)) &&
        (mine === null || touches(read, news, mine)),
    );
    matching.sort(compareFeed);
    const offset = args.offset ?? 0;
    const page = matching.slice(offset, offset + (args.limit ?? NEWS_FEED_DEFAULT_LIMIT));
    const items = itemViews(ctx, page);
    return { items, names: collectNames(read, items, ctx.date), total: matching.length };
  },
});

/** The latest shown stories, newest first, for filling a thin ticker. */
function latestStories(read: GameWorldView, date: GameDate, count: number): Story[] {
  const latest: Story[] = [];
  const keys = read.tables.news.indexKeys('byDate');
  for (let index = keys.length - 1; index >= 0 && latest.length < count; index -= 1) {
    const key = keys[index];
    if (key === undefined) {
      continue;
    }
    const day = read.tables.news
      .lookup('byDate', key)
      .filter((news) => isShownOn(news, date))
      .sort(compareFeed);
    latest.push(...day);
  }
  return latest.slice(0, count);
}

export const newsTopQuery = defineQuery('news.top', {
  args: z.strictObject({
    heroCount: z.number().int().min(1).max(5).optional(),
    tickerCount: z.number().int().min(1).max(NEWS_TICKER_MAX_COUNT).optional(),
  }),
  run: (ctx, args) => {
    const { read } = ctx;
    const heroCount = args.heroCount ?? ctx.tunables.get('news.frontPage.heroCount');
    const tickerCount = args.tickerCount ?? NEWS_TICKER_DEFAULT_COUNT;
    const ranked = rankedWindow(read, ctx.date, ctx.tunables);
    const hero = ranked.filter((news) => isFrontPage(news, ctx.tunables)).slice(0, heroCount);
    let ticker = ranked.slice(0, tickerCount);
    if (ranked.length < NEWS_TICKER_MIN_FROM_WINDOW) {
      const seen = new Set(ticker.map((news) => news.id));
      const fill = latestStories(read, ctx.date, tickerCount).filter((news) => !seen.has(news.id));
      ticker = [...ticker, ...fill].slice(0, tickerCount);
    }
    const heroViews = itemViews(ctx, hero);
    const tickerViews = itemViews(ctx, ticker);
    return {
      hero: heroViews,
      ticker: tickerViews,
      names: collectNames(read, [...heroViews, ...tickerViews], ctx.date),
    };
  },
});

export const newsItemQuery = defineQuery('news.item', {
  args: z.strictObject({ newsId: zId('news') }),
  run: (ctx, args) => {
    const news = ctx.read.tables.news.get(args.newsId);
    if (news === undefined || !isShownOn(news, ctx.date)) {
      return refuseQuery({ code: 'notFound', message: NEWS_ITEM_NOT_FOUND });
    }
    const [item] = itemViews(ctx, [news]);
    if (item === undefined) {
      return refuseQuery({ code: 'notFound', message: NEWS_ITEM_NOT_FOUND });
    }
    return { item, names: collectNames(ctx.read, [item], ctx.date) };
  },
});

export const newsAlertRulesQuery = defineQuery('news.alertRules', {
  args: z.strictObject({}),
  run: (ctx) => {
    const { viewer, read } = ctx;
    const playerId =
      viewer.kind === 'controller' ? issuingPlayerId(read, viewer.controller) : null;
    // The omniscient viewer and computer seats get the defaults, with nothing pending.
    const settings =
      playerId === null
        ? alertSettingsOf({ settings: { ...read.meta.settings, extra: {} } }, '')
        : alertSettingsOf(read.meta, playerId);
    return {
      rules: newsAlertRules().map((rule) => ({
        id: rule.id,
        label: rule.label,
        description: rule.description,
        enabled: settings.rules[rule.id] ?? rule.defaultOn,
        defaultOn: rule.defaultOn,
      })),
      stopSkip: settings.stopSkip,
      pending: playerId === null ? null : settings.pending,
    };
  },
});

export const newsQueries = [
  newsFeedQuery,
  newsTopQuery,
  newsItemQuery,
  newsAlertRulesQuery,
] as const;
