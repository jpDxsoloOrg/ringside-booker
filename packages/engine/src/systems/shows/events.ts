/**
 * The shows system's domain events: what show night announces for later features (morale,
 * popularity, money, news, awards) to subscribe to. Payloads carry ids and primitives only.
 * See docs/design/show-night.md#events.
 */

import type { ContentKey } from '../../core/content-key';
import type { GameDate } from '../../core/date';
import type {
  BrandId,
  EventInstanceId,
  PersonId,
  PromotionId,
  SegmentId,
  StorylineId,
  TitleId,
  TitleReignId,
} from '../../core/ids';
import type { EventImportance } from '../../model/entities/event-definition';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /**
     * A segment was run and rated. The three id lists hold competitors only: a no contest and a
     * talking segment have all three empty. `finishKey` stays null until MTCH2's finishes are
     * wired into show night.
     */
    'segment.completed': {
      segmentId: SegmentId;
      eventInstanceId: EventInstanceId;
      promotionId: PromotionId;
      brandId: BrandId | null;
      kind: 'match' | 'angle';
      slot: number;
      preShow: boolean;
      winnerIds: PersonId[];
      loserIds: PersonId[];
      drawIds: PersonId[];
      storylineIds: StorylineId[];
      titleIds: TitleId[];
      finishKey: ContentKey | null;
      methodKey: ContentKey | null;
      score: number;
    };
    /**
     * A show was run, on screen or off it. `rawScore` is the score before any cap; `offscreen` is
     * true for a show scored without running its card.
     */
    'show.completed': {
      eventInstanceId: EventInstanceId;
      promotionId: PromotionId;
      brandId: BrandId | null;
      date: GameDate;
      importance: EventImportance;
      score: number;
      rawScore: number;
      offscreen: boolean;
      segmentCount: number;
    };
    /** A title changed hands in a segment. `fromReignId` is null when the title was vacant. */
    'title.changed': {
      titleId: TitleId;
      promotionId: PromotionId;
      fromReignId: TitleReignId | null;
      toReignId: TitleReignId;
      segmentId: SegmentId;
      eventInstanceId: EventInstanceId;
      newHolderIds: PersonId[];
      previousHolderIds: PersonId[];
    };
    /** A champion kept their title in a segment. `defences` counts the reign's defences so far. */
    'title.defended': {
      titleId: TitleId;
      promotionId: PromotionId;
      reignId: TitleReignId;
      segmentId: SegmentId;
      eventInstanceId: EventInstanceId;
      defences: number;
    };
  }
}

export {};
