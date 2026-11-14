// The news wire's words, registered before any story is drawn.
import '@/text/catalogs/news.en';

export { NewsScreen } from './NewsScreen';
export { NewsHeroCard } from './NewsHeroCard';
export type { NewsHeroCardProps, NewsHeroCardSize } from './NewsHeroCard';
export { NewsStorySheet, archiveText } from './NewsStorySheet';
export type { NewsStorySheetProps, NewsStoryState } from './NewsStorySheet';
export { NewsTicker, newsTickerItems, newsTickerLabel, useNewsTicker } from './NewsTicker';
export { newsKindTone, NEWS_IMPORTANCE_LABELS } from './newsTone';
