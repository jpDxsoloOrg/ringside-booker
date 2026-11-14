/**
 * The news system's domain events. Payloads carry ids and primitives only.
 * See docs/design/day-pipeline.md#domain-events and docs/design/news.md#posting.
 */

import type { NewsId } from '../../core/ids';
import type { NewsImportance, NewsKind } from '../../model/entities/news';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /**
     * A story went on the news feed through `postNews`. `buzz` is the score stored on the row
     * (0..100); a dedupe hit posts nothing and publishes nothing.
     */
    'news.posted': {
      newsId: NewsId;
      kind: NewsKind;
      importance: NewsImportance;
      buzz: number;
    };
  }
}

export {};
