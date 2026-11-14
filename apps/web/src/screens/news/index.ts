// The news wire's words, registered before any story is drawn.
import '@/text/catalogs/news.en';

export { NewsScreen } from './NewsScreen';
export {
  ALERTS_FOR_PLAYERS,
  alertSettingsChange,
  NEWS_ALERT_NOTE,
  NEWS_ALERT_SHEET_TITLE,
  NewsAlertSheet,
  NewsAlertSheetView,
  STOP_SKIP_LABEL,
} from './NewsAlertSheet';
export type {
  NewsAlertChange,
  NewsAlertSettings,
  NewsAlertSheetProps,
  NewsAlertSheetViewProps,
} from './NewsAlertSheet';
export { NewsHeroCard } from './NewsHeroCard';
export type { NewsHeroCardProps, NewsHeroCardSize } from './NewsHeroCard';
export { NewsStorySheet, archiveText } from './NewsStorySheet';
export type { NewsStorySheetProps, NewsStoryState } from './NewsStorySheet';
export { NewsTicker, newsTickerItems, newsTickerLabel, useNewsTicker } from './NewsTicker';
export { newsKindTone, NEWS_IMPORTANCE_LABELS } from './newsTone';
