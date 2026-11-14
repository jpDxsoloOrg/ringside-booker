import {
  addDays,
  NEWS_FEED_DEFAULT_LIMIT,
  NEWS_FEED_MAX_LIMIT,
  NEWS_KINDS,
} from '@ringside/engine';
import type { GameDate, NewsFeedArgs, NewsKind } from '@ringside/engine';

/**
 * The News feed's filters in the URL, so Back and a shared link keep them: `?kind=` (kinds joined
 * by commas), `?mine=1`, `?period=7|30|90` (Everything when left out) and `?front=1`. The open
 * story is `?story=<newsId>`.
 */

export const NEWS_PERIODS = ['7', '30', '90', 'all'] as const;
export type NewsPeriod = (typeof NEWS_PERIODS)[number];

export const NEWS_PERIOD_LABELS: Readonly<Record<NewsPeriod, string>> = {
  '7': 'Last 7 days',
  '30': 'Last 30 days',
  '90': 'Last 90 days',
  all: 'Everything',
};

export const KIND_PARAM = 'kind';
export const MINE_PARAM = 'mine';
export const PERIOD_PARAM = 'period';
export const FRONT_PAGE_PARAM = 'front';
export const STORY_PARAM = 'story';

export interface NewsFilters {
  /** The kinds shown; empty for every kind. In `NEWS_KINDS` order. */
  readonly kinds: readonly NewsKind[];
  readonly mine: boolean;
  readonly period: NewsPeriod;
  readonly frontPageOnly: boolean;
}

export const NO_NEWS_FILTERS: NewsFilters = {
  kinds: [],
  mine: false,
  period: 'all',
  frontPageOnly: false,
};

/** The story pages the feed asks for at a time. */
export const NEWS_PAGE_SIZE = NEWS_FEED_DEFAULT_LIMIT;

function isNewsKind(value: string): value is NewsKind {
  return NEWS_KINDS.some((kind) => kind === value);
}

function isPeriod(value: string | null): value is NewsPeriod {
  return NEWS_PERIODS.some((period) => period === value);
}

/** The filters a URL holds; anything it cannot read is left at its default. */
export function newsFiltersFromSearch(search: URLSearchParams): NewsFilters {
  const named = new Set(
    (search.get(KIND_PARAM) ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(isNewsKind),
  );
  const period = search.get(PERIOD_PARAM);
  return {
    kinds: NEWS_KINDS.filter((kind) => named.has(kind)),
    mine: search.get(MINE_PARAM) === '1',
    period: isPeriod(period) ? period : 'all',
    frontPageOnly: search.get(FRONT_PAGE_PARAM) === '1',
  };
}

/** `search` with the filters written into it; defaults are left out. Other params are kept. */
export function searchWithNewsFilters(
  search: URLSearchParams,
  filters: NewsFilters,
): URLSearchParams {
  const next = new URLSearchParams(search);
  const set = (name: string, value: string | null): void => {
    if (value === null) next.delete(name);
    else next.set(name, value);
  };
  set(KIND_PARAM, filters.kinds.length === 0 ? null : filters.kinds.join(','));
  set(MINE_PARAM, filters.mine ? '1' : null);
  set(PERIOD_PARAM, filters.period === 'all' ? null : filters.period);
  set(FRONT_PAGE_PARAM, filters.frontPageOnly ? '1' : null);
  return next;
}

/** How many filters are away from their default, for the phone's Filters button. */
export function activeNewsFilterCount(filters: NewsFilters): number {
  return (
    (filters.kinds.length > 0 ? 1 : 0) +
    (filters.mine ? 1 : 0) +
    (filters.period === 'all' ? 0 : 1) +
    (filters.frontPageOnly ? 1 : 0)
  );
}

/** `search` with the story open, or closed with null. */
export function searchWithStory(search: URLSearchParams, newsId: string | null): URLSearchParams {
  const next = new URLSearchParams(search);
  if (newsId === null) next.delete(STORY_PARAM);
  else next.set(STORY_PARAM, newsId);
  return next;
}

/** The `news.feed` arguments for the filters on `today`, asking for `pages` pages of stories. */
export function newsFeedArgs(filters: NewsFilters, today: GameDate, pages: number): NewsFeedArgs {
  const days = filters.period === 'all' ? null : Number(filters.period);
  return {
    ...(days === null ? {} : { from: addDays(today, 1 - days) }),
    ...(filters.kinds.length === 0 ? {} : { kinds: [...filters.kinds] }),
    ...(filters.mine ? { mine: true } : {}),
    ...(filters.frontPageOnly ? { frontPageOnly: true } : {}),
    limit: Math.min(NEWS_PAGE_SIZE * Math.max(1, pages), NEWS_FEED_MAX_LIMIT),
  };
}
