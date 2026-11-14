import type { NewsImportance, NewsKind } from '@ringside/engine';
import type { TickerTagTone } from '@/components/Ticker';

const NEWS_KIND_TONES: Readonly<Record<NewsKind, TickerTagTone>> = {
  result: 'action',
  titleChange: 'prestige',
  signing: 'data',
  release: 'data',
  injury: 'action',
  retirement: 'data',
  rumour: 'data',
  business: 'data',
  milestone: 'data',
  backstage: 'data',
  personal: 'data',
  season: 'prestige',
  award: 'prestige',
  rivalry: 'action',
};

/**
 * The colour of a story's kind tag, shared by the ticker, the hero cards, the feed and the story
 * sheet: titles, awards and seasons are prestige; results, rivalries and injuries are action; the
 * rest are data. Kept apart from the screen so the shell-wide ticker stays small.
 */
export function newsKindTone(kind: NewsKind): TickerTagTone {
  return NEWS_KIND_TONES[kind];
}

/** Importance 0..3 in words. */
export const NEWS_IMPORTANCE_LABELS: Readonly<Record<NewsImportance, string>> = {
  0: 'Filler',
  1: 'Minor',
  2: 'Major',
  3: 'Front page',
};
