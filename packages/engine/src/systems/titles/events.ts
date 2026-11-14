/**
 * The titles system's domain events. CRTV1-03's commands and orphan rule publish them; EVT3's
 * show-night `title.changed` and `title.defended` stay in the shows system.
 *
 * `source` is who asked for the change (WRK1's `DoorSource`): the player, a rival booker (`ai`) or
 * the game itself (`system`, such as the orphaned-champion rule). Payloads hold IDs and small
 * primitives only.
 *
 * Design: docs/design/titles.md.
 */

import type { BrandId, PersonId, PromotionId, TeamId, TitleId, TitleReignId } from '../../core/ids';
import type { DoorSource } from '../workers/events';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /** A promotion created a title. */
    'title.created': {
      titleId: TitleId;
      promotionId: PromotionId;
      brandId: BrandId | null;
      source: DoorSource;
    };
    /** Someone was made champion outside a match. `previousReignId` is the reign it replaced. */
    'title.awarded': {
      titleId: TitleId;
      promotionId: PromotionId;
      reignId: TitleReignId;
      holderIds: PersonId[];
      teamId: TeamId | null;
      previousReignId: TitleReignId | null;
      source: DoorSource;
    };
    /** A title was left without a champion. `reasonKey` is `booker`, `orphaned` or a caller's own. */
    'title.vacated': {
      titleId: TitleId;
      promotionId: PromotionId;
      reignId: TitleReignId;
      holderIds: PersonId[];
      reasonKey: string;
      source: DoorSource;
    };
    /** A title stopped being defended. `endedReignId` is the reign it closed, if it had a champion. */
    'title.retired': {
      titleId: TitleId;
      promotionId: PromotionId;
      endedReignId: TitleReignId | null;
      source: DoorSource;
    };
    /** A retired title came back, vacant. */
    'title.reactivated': {
      titleId: TitleId;
      promotionId: PromotionId;
      source: DoorSource;
    };
  }
}

export {};
