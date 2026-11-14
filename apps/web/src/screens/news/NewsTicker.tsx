import type { ReactNode } from 'react';
import type { NewsTop } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Ticker } from '@/components/Ticker';
import type { TickerItem } from '@/components/Ticker';
import '@/text/catalogs/news.en';
import { templatedTextToString } from '@/text/renderTemplatedText';
import { newsKindTone } from './newsTone';

/** What the shell's crawl asks for: the engine's default ticker length. */
const NEWS_TOP_ARGS = {} as const;

/** The badge at the start of the strip: "Breaking" when the lead story is front-page news. */
export function newsTickerLabel(top: NewsTop): string {
  return top.ticker[0]?.frontPage === true ? 'Breaking' : 'News';
}

/**
 * The ticker's headlines: each story's kind as the tag, in its tone, and the headline as text. The
 * crawl draws every item twice, so a headline holds no links; the News screen is the way in.
 */
export function newsTickerItems(top: NewsTop): TickerItem[] {
  return top.ticker.map((item) => ({
    id: item.id,
    tag: item.kindLabel,
    tagTone: newsKindTone(item.kind),
    content: templatedTextToString(item.headline, { names: top.names }),
  }));
}

/**
 * The shell's news crawl from `news.top`, or null with no world, an error or no stories, so the
 * shell draws no strip at all (never sample text). The shell needs null itself, not a component
 * that renders nothing, so this is a hook: the router hands its answer to `AppShell`'s `ticker`.
 */
export function useNewsTicker(): ReactNode {
  const query = useEngineQuery('news.top', NEWS_TOP_ARGS);
  const top = query.status === 'success' ? query.data : undefined;
  if (top === undefined || top.ticker.length === 0) return null;
  return (
    <Ticker label={newsTickerLabel(top)} items={newsTickerItems(top)} ariaLabel="News ticker" />
  );
}

/** The news crawl as a component, for places that only need to draw it. */
export function NewsTicker() {
  return useNewsTicker();
}
