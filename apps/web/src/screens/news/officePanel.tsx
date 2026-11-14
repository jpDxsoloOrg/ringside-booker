/**
 * The Office's "Top stories" panel (DAY1-06, DAY2's panel registry, the 90+ news-and-social band):
 * the front page's hero stories from `news.top` (the ticker's best stories in a quiet week), each with its kind, its headline as a link to the
 * story on the News screen, and its buzz with a Why?, then an "Open news" link. With no stories it
 * says "No news yet"; it never shows sample text. Main column, order 90.
 */
import { Link } from 'react-router-dom';
import type { NewsItemView, NewsNames, TraceNode } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Panel } from '@/components/Panel';
import { Explained } from '@/components/Trace';
import { registerOfficePanel } from '@/screens/office/panels/officePanelRegistry';
import '@/text/catalogs/news.en';
import { templatedTextToString } from '@/text/renderTemplatedText';
import { NewsKindTag } from './NewsKindTag';
import { searchWithStory } from './newsListParams';
import { shownBuzz } from './newsTone';
import styles from './officePanel.module.css';

/** The panel's id in the Office registry. */
export const TOP_STORIES_PANEL_ID = 'news.topStories';

/** The panel's title. */
export const TOP_STORIES_TITLE = 'Top stories';

/** The link to the News screen. */
export const OPEN_NEWS_TEXT = 'Open news';

/** What the panel says before the wrestling world has any stories. */
export const NO_NEWS_TITLE = 'No news yet';

/** Most stories the panel lists: the front page's hero stories. */
export const TOP_STORIES_COUNT = 3;

const NEWS_TOP_ARGS = {} as const;

/** The News screen with one story open. */
export function storyUrl(newsId: string): string {
  return `${routes.game.news()}?${searchWithStory(new URLSearchParams(), newsId).toString()}`;
}

/**
 * The stories to list, at most {@link TOP_STORIES_COUNT}: the front page's hero stories, or, in a
 * week with nothing big enough for the front page, the best-ranked recent stories (the ticker's).
 * Empty only when there is no news at all.
 */
export function topStoriesOf<T>(top: {
  readonly hero: readonly T[];
  readonly ticker: readonly T[];
}): readonly T[] {
  return (top.hero.length > 0 ? top.hero : top.ticker).slice(0, TOP_STORIES_COUNT);
}

export interface TopStoriesPanelProps {
  readonly stories: readonly NewsItemView[];
  readonly names: NewsNames;
  /** The buzz breakdown when the caller already has it (the gallery); else each `buzzTraceRef`. */
  readonly buzzTrace?: TraceNode | undefined;
}

/** The stories and the News link, drawn from data the caller already has. */
export function TopStoriesPanel({ stories, names, buzzTrace }: TopStoriesPanelProps) {
  return (
    <Panel title={TOP_STORIES_TITLE}>
      <div className={styles['body']}>
        {stories.length === 0 ? (
          <EmptyState
            icon="newspaper"
            title={NO_NEWS_TITLE}
            body="The biggest stories in the wrestling world show here as they break."
          />
        ) : (
          <ol className={styles['list']} aria-label={TOP_STORIES_TITLE}>
            {stories.map((item) => (
              <li key={item.id} className={styles['story']}>
                <NewsKindTag kind={item.kind} label={item.kindLabel} />
                <Link className={styles['headline']} to={storyUrl(item.id)}>
                  {templatedTextToString(item.headline, { names })}
                </Link>
                <span className={styles['buzz']}>
                  <span className={styles['buzzLabel']}>Buzz</span>
                  <Explained
                    value={shownBuzz(item.buzz)}
                    label="Buzz"
                    {...(buzzTrace === undefined
                      ? { traceRef: item.buzzTraceRef }
                      : { trace: buzzTrace })}
                  />
                </span>
              </li>
            ))}
          </ol>
        )}
        <Link className={styles['link']} to={routes.game.news()}>
          {OPEN_NEWS_TEXT}
          <Icon name="chevron-right" size="sm" decorative />
        </Link>
      </div>
    </Panel>
  );
}

function TopStoriesLoader() {
  const query = useEngineQuery('news.top', NEWS_TOP_ARGS, { keepPreviousData: true });
  // Nothing until the engine answers; a refused query leaves the panel out.
  if (query.status === 'error' || query.data === undefined) return null;
  return <TopStoriesPanel stories={topStoriesOf(query.data)} names={query.data.names} />;
}

registerOfficePanel({
  id: TOP_STORIES_PANEL_ID,
  order: 90,
  column: 'main',
  render: () => <TopStoriesLoader />,
});
