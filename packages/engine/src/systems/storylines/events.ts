/**
 * The storylines system's domain events (CRTV3-01). Payloads hold ids and primitives only
 * (docs/design/day-pipeline.md#payload-rules). CRTV3-02 publishes `storyline.started` for starter
 * storylines and CRTV3-03 publishes all three from the player's commands.
 */

import type {
  EventInstanceId,
  PersonId,
  PromotionId,
  SegmentId,
  StorylineId,
} from '../../core/ids';

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
    /**
     * A linked segment moved a storyline's heat (CRTV4-02): once per counted storyline per
     * segment, on every promotion's shows.
     */
    'storyline.progressed': {
      storylineId: StorylineId;
      promotionId: PromotionId;
      segmentId: SegmentId;
      eventInstanceId: EventInstanceId;
      heatBefore: number;
      heatAfter: number;
    };
    /**
     * An ended storyline's payoff was settled (CRTV4-03): once per ended storyline, also when it
     * paid nothing (`paid: false`, too few counted segments), so news can say it fizzled out.
     * `memberCount` is how many members were paid; `quality` is the payoff's -1..1 quality (times
     * the finale bonus on a gain), 0 when `paid` is false.
     */
    'storyline.paidOff': {
      storylineId: StorylineId;
      promotionId: PromotionId;
      paid: boolean;
      memberCount: number;
      quality: number;
    };
  }
}
