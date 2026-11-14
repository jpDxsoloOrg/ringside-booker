/**
 * The storylines system's domain events (CRTV3-01). Payloads hold ids and primitives only
 * (docs/design/day-pipeline.md#payload-rules). CRTV3-02 publishes `storyline.started` for starter
 * storylines and CRTV3-03 publishes all three from the player's commands.
 */

import type { PersonId, PromotionId, StorylineId } from '../../core/ids';

/** Who started a storyline: the player, new-game setup (starter storylines) or a rival. */
export const STORYLINE_START_SOURCES = ['player', 'setup', 'ai'] as const;
export type StorylineStartSource = (typeof STORYLINE_START_SOURCES)[number];

declare module '../../core/events/types' {
  interface DomainEventMap {
    /** A storyline was created. */
    'storyline.started': {
      storylineId: StorylineId;
      promotionId: PromotionId;
      source: StorylineStartSource;
    };
    /** A storyline ended; `linkedSegments` is how many segments linked it when it ended. */
    'storyline.ended': {
      storylineId: StorylineId;
      promotionId: PromotionId;
      linkedSegments: number;
    };
    /** People joined or left a storyline, or changed side in it. */
    'storyline.membersChanged': {
      storylineId: StorylineId;
      promotionId: PromotionId;
      added: PersonId[];
      removed: PersonId[];
      sideChanged: PersonId[];
    };
  }
}
