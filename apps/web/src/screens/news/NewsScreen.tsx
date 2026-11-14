import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { To } from 'react-router-dom';
import { isId, NEWS_FEED_MAX_LIMIT, NEWS_ITEM_NOT_FOUND } from '@ringside/engine';
import type { GameDate, NewsId, NewsItemView, NewsNames } from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { useEntityLinkRenderer } from '@/app/entityLinks';
import { useHasPromotion } from '@/app/session/sessionStore';
import { CountBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate, formatNumber } from '@/components/format';
import { Sheet } from '@/components/Sheet';
import { useIsMobile } from '@/styles/useMediaQuery';
import { templatedTextToString } from '@/text/renderTemplatedText';
import { newsColumns } from './newsColumns';
import { NewsFilterBar } from './NewsFilterBar';
import { NewsHeroCard } from './NewsHeroCard';
import {
  activeNewsFilterCount,
  newsFeedArgs,
  newsFiltersFromSearch,
  NO_NEWS_FILTERS,
  searchWithNewsFilters,
  searchWithStory,
  STORY_PARAM,
} from './newsListParams';
import type { NewsFilters } from './newsListParams';
import { NewsStorySheet } from './NewsStorySheet';
import type { NewsStoryState } from './NewsStorySheet';
import styles from './NewsScreen.module.css';

const TITLE = 'News';
const NO_ITEMS: readonly NewsItemView[] = [];
const NO_NAMES: NewsNames = {};
/** The engine host's code for "no game loaded". */
const NO_WORLD_CODE = 'noWorld';
const NEWS_TOP_ARGS = {} as const;

function errorText(error: EngineQueryError | null): string {
  if (error === null) return 'Something went wrong.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

function isNoWorld(error: EngineQueryError | null): boolean {
  return (
    error?.kind === 'rejected' && error.reasons.some((reason) => reason.code === NO_WORLD_CODE)
  );
}

/** The phone's filter button text: "Filters", with the count of active filters beside it. */
export function newsFiltersLabel(activeCount: number): string {
  return activeCount === 0 ? 'Filters' : `Filters, ${String(activeCount)} on`;
}

/** "2 stories" or "Showing 200 of 340 stories". */
export function newsCountText(shown: number, total: number): string {
  const noun = total === 1 ? 'story' : 'stories';
  return shown >= total
    ? `${formatNumber(total)} ${noun}`
    : `Showing ${formatNumber(shown)} of ${formatNumber(total)} ${noun}`;
}

function rowId(item: NewsItemView): string {
  return item.id;
}

interface StorySheetProps {
  readonly newsId: NewsId;
  readonly open: boolean;
  readonly onClose: () => void;
}

/** The story sheet for one id: reads `news.item` while open. */
function StorySheet({ newsId, open, onClose }: StorySheetProps) {
  const query = useEngineQuery('news.item', { newsId }, { enabled: open });
  let story: NewsStoryState = { status: 'loading' };
  if (query.data !== undefined) {
    story = { status: 'found', item: query.data.item, names: query.data.names };
  } else if (query.status === 'error') {
    const reason = query.error?.kind === 'rejected' ? errorText(query.error) : NEWS_ITEM_NOT_FOUND;
    story = { status: 'notFound', reason };
  }
  return <NewsStorySheet open={open} onClose={onClose} story={story} />;
}

/** The front page: up to three hero cards from `news.top`, the first one large. */
function FrontPage({ storyLinkOf }: { readonly storyLinkOf: (item: NewsItemView) => To }) {
  const top = useEngineQuery('news.top', NEWS_TOP_ARGS);
  const hero = top.data?.hero ?? NO_ITEMS;
  if (hero.length === 0) return null;
  const names = top.data?.names ?? NO_NAMES;
  return (
    <section className={styles['frontPage']} aria-labelledby="news-front-page">
      <h2 id="news-front-page" className={styles['sectionTitle']}>
        Front page
      </h2>
      <div className={styles['heroes']} data-count={hero.length}>
        {hero.map((item, index) => (
          <NewsHeroCard
            key={item.id}
            item={item}
            names={names}
            storyLink={storyLinkOf(item)}
            size={index === 0 ? 'large' : 'small'}
          />
        ))}
      </div>
    </section>
  );
}

interface FeedProps {
  readonly today: GameDate;
  readonly filters: NewsFilters;
  readonly onFiltersChange: (filters: NewsFilters) => void;
  readonly storyLinkOf: (item: NewsItemView) => To;
}

/** Every story in the archive, filtered, newest first, in pages of 200. */
function Feed({ today, filters, onFiltersChange, storyLinkOf }: FeedProps) {
  const isMobile = useIsMobile();
  const hasPromotion = useHasPromotion();
  const renderEntityLink = useEntityLinkRenderer();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pages, setPages] = useState(1);
  const args = useMemo(() => newsFeedArgs(filters, today, pages), [filters, today, pages]);
  const feed = useEngineQuery('news.feed', args, { keepPreviousData: true });
  const items = feed.data?.items ?? NO_ITEMS;
  const names = feed.data?.names ?? NO_NAMES;
  const total = feed.data?.total ?? 0;
  const columns = useMemo(
    () => newsColumns({ names, storyLinkOf, renderEntityLink }),
    [names, storyLinkOf, renderEntityLink],
  );
  const activeCount = activeNewsFilterCount(filters);
  const changeFilters = (next: NewsFilters): void => {
    setPages(1);
    onFiltersChange(next);
  };
  // The engine answers at most NEWS_FEED_MAX_LIMIT stories at once; the archive rarely holds 50.
  const limit = args.limit ?? NEWS_FEED_MAX_LIMIT;
  const canShowMore = items.length < total && limit < NEWS_FEED_MAX_LIMIT;
  const filterBar = (layout: 'bar' | 'sheet') => (
    <NewsFilterBar
      filters={filters}
      onChange={changeFilters}
      hasPromotion={hasPromotion}
      layout={layout}
    />
  );

  return (
    <section className={styles['feed']} aria-labelledby="news-feed">
      <div className={styles['feedHeader']}>
        <h2 id="news-feed" className={styles['sectionTitle']}>
          All stories
        </h2>
        {feed.data !== undefined && (
          <p className={styles['count']} role="status">
            {newsCountText(items.length, total)}
          </p>
        )}
      </div>
      {isMobile ? (
        <div className={styles['filterButton']}>
          <Button
            variant="secondary"
            iconStart="settings"
            aria-haspopup="dialog"
            aria-label={newsFiltersLabel(activeCount)}
            onClick={() => {
              setSheetOpen(true);
            }}
          >
            Filters
            <CountBadge count={activeCount} label={`${String(activeCount)} on`} tone="data" />
          </Button>
          <Sheet
            open={sheetOpen}
            onClose={() => {
              setSheetOpen(false);
            }}
            title="Filters"
            side="bottom"
            size="lg"
            footer={
              <div className={styles['sheetFooter']}>
                <Button
                  variant="ghost"
                  disabled={activeCount === 0}
                  onClick={() => {
                    changeFilters(NO_NEWS_FILTERS);
                  }}
                >
                  Clear filters
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setSheetOpen(false);
                  }}
                >
                  Show stories
                </Button>
              </div>
            }
          >
            {filterBar('sheet')}
          </Sheet>
        </div>
      ) : (
        <div className={styles['filterPanel']} role="group" aria-label="Filters">
          {filterBar('bar')}
        </div>
      )}
      {feed.status === 'error' ? (
        <EmptyState
          icon="newspaper"
          title="The news could not be loaded"
          body={errorText(feed.error)}
          headingLevel={3}
        />
      ) : (
        <DataTable
          className={styles['table']}
          rows={items}
          columns={columns}
          getRowId={rowId}
          getRowLabel={(item) => templatedTextToString(item.headline, { names })}
          caption="All stories"
          initialSort={{ columnId: 'date', direction: 'desc' }}
          loading={feed.status === 'loading'}
          emptyState={
            <EmptyState
              icon="newspaper"
              title={activeCount > 0 ? 'No stories match these filters' : 'No news yet'}
              body={
                activeCount > 0
                  ? 'Loosen a filter, or clear them all.'
                  : 'Stories appear here as the world moves on.'
              }
              headingLevel={3}
            />
          }
        />
      )}
      {canShowMore && (
        <div className={styles['more']}>
          <Button
            variant="secondary"
            loading={feed.isPreviousData}
            onClick={() => {
              setPages((previous) => previous + 1);
            }}
          >
            Show older stories
          </Button>
        </div>
      )}
    </section>
  );
}

/** The news screen with a world: the front page, the feed and the open story. */
function LoadedNews({ today }: { readonly today: GameDate }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => newsFiltersFromSearch(searchParams), [searchParams]);
  const storyParam = searchParams.get(STORY_PARAM);
  const openStoryId = isId('news', storyParam) ? storyParam : null;
  // The sheet stays mounted on the last story after it closes, so it can hand focus back.
  const [sheetStoryId, setSheetStoryId] = useState<NewsId | null>(openStoryId);
  if (openStoryId !== null && openStoryId !== sheetStoryId) setSheetStoryId(openStoryId);

  // A filter change replaces the entry, so Back leaves the screen rather than undoing each click.
  const changeFilters = useCallback(
    (next: NewsFilters): void => {
      setSearchParams((current) => searchWithNewsFilters(current, next), { replace: true });
    },
    [setSearchParams],
  );
  const storyLinkOf = useCallback(
    (item: NewsItemView): To => ({
      search: `?${searchWithStory(searchParams, item.id).toString()}`,
    }),
    [searchParams],
  );

  return (
    <>
      <FrontPage storyLinkOf={storyLinkOf} />
      <Feed
        today={today}
        filters={filters}
        onFiltersChange={changeFilters}
        storyLinkOf={storyLinkOf}
      />
      {sheetStoryId !== null && (
        <StorySheet
          key={sheetStoryId}
          newsId={sheetStoryId}
          open={openStoryId !== null}
          onClose={() => {
            setSearchParams((current) => searchWithStory(current, null));
          }}
        />
      )}
    </>
  );
}

/**
 * Office > News: the front page (up to three of the week's biggest stories, the first large), then
 * every story in the archive in a filterable feed whose filters live in the URL. A headline opens
 * the story in a sheet (`?story=<newsId>`). Every buzz number has its Why?.
 *
 * Desktop first: the filters sit in a panel above the table. Below `--bp-mobile` the hero cards
 * stack, the table becomes cards and the filters move into a bottom sheet.
 */
export function NewsScreen() {
  const clock = useEngineQuery('clock.get', {});
  useDocumentTitle(TITLE);
  const today = clock.data?.date;

  let content;
  if (today !== undefined) {
    content = <LoadedNews today={today} />;
  } else if (clock.status === 'loading') {
    content = (
      <p className={styles['notice']} role="status">
        Loading the news…
      </p>
    );
  } else if (isNoWorld(clock.error)) {
    content = (
      <EmptyState
        size="page"
        icon="newspaper"
        title="No game loaded"
        body="Start or load a game to read its news."
        headingLevel={2}
      />
    );
  } else {
    content = (
      <EmptyState
        size="page"
        icon="newspaper"
        title="The news could not be loaded"
        body={errorText(clock.error)}
        headingLevel={2}
      />
    );
  }

  return (
    <div className={styles['screen']}>
      <div className={styles['intro']}>
        <RouteHeading className={styles['heading']}>{TITLE}</RouteHeading>
        {today !== undefined && (
          <p className={styles['today']}>
            <span className="tabular">{formatGameDate(today, 'long')}</span>
          </p>
        )}
        {/* The Alerts button opens DAY1-05's alert settings sheet; it is hidden until that lands. */}
      </div>
      {content}
    </div>
  );
}
