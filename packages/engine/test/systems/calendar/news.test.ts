// Cancelled shows on the news wire (DAY1-06). Design: docs/design/news.md#integration
import { describe, expect, it } from 'vitest';
import { parseGameDate } from '../../../src/core/date';
import type { EventInstanceId } from '../../../src/core/ids';
import type { EventImportance } from '../../../src/model/entities/event-definition';
import {
  SHOW_CANCELLED_TOPIC,
  calendarSystem,
  cancelShow,
  showCancelledDedupeKey,
} from '../../../src/systems/calendar';
import { anEventInstance, worldBuilder } from '../../support';
import { newsWire, storiesWithTopic } from '../../support/news-wire';
import { PLAYER_ONE } from './lifecycle-world';

const SHOW_DATE = parseGameDate('2026-02-02');

type Shows = Record<'mine' | 'rival', Record<EventImportance, EventInstanceId>>;

/** My promotion (player-1) and a computer rival, each with one show of every size on 2 February. */
function cancelWorld() {
  let shows: Shows | undefined;
  const { world, ids } = worldBuilder({
    players: [{ playerId: 'player-1', displayName: 'Test Player 1' }],
  })
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE })
    .withPromotion({ name: 'Test Promotion B' })
    .with('shows', (context) => {
      const { A, B } = context.ids.promotions;
      const regionId = context.ids.regions[0];
      if (A === undefined || B === undefined || regionId === undefined) {
        throw new Error('the cancel world is missing rows');
      }
      const make = (promotionId: typeof A, importance: EventImportance): EventInstanceId =>
        context.insert(
          'eventInstances',
          anEventInstance(
            { name: `Show ${importance}`, promotionId, regionId, date: SHOW_DATE, importance },
            context.sequence,
          ),
        ).id;
      const all = (promotionId: typeof A): Record<EventImportance, EventInstanceId> => ({
        house: make(promotionId, 'house'),
        minor: make(promotionId, 'minor'),
        regular: make(promotionId, 'regular'),
        major: make(promotionId, 'major'),
        flagship: make(promotionId, 'flagship'),
      });
      shows = { mine: all(A), rival: all(B) };
    })
    .build();
  if (shows === undefined || ids.promotions.B === undefined) {
    throw new Error('the cancel world has no shows');
  }
  return { world, shows, rival: ids.promotions.B };
}

describe('cancelled shows on the news wire', () => {
  it("posts one business story for a rival's major or flagship show, and none for mine", async () => {
    const built = cancelWorld();
    const wire = newsWire(built.world, [calendarSystem]);
    const everyShow = [...Object.values(built.shows.mine), ...Object.values(built.shows.rival)];
    wire.steps.push((ctx) => {
      for (const id of everyShow) {
        cancelShow(ctx, ctx.read.tables.eventInstances.require(id), 'byPromotion');
      }
    });
    await wire.engine.advanceDays({ maxDays: 1 });

    const stories = storiesWithTopic(wire.engine, SHOW_CANCELLED_TOPIC);
    expect(stories.map((story) => story.dedupeKey).sort()).toEqual(
      [built.shows.rival.major, built.shows.rival.flagship].map(showCancelledDedupeKey).sort(),
    );
    const major = stories.find(
      (story) => story.dedupeKey === showCancelledDedupeKey(built.shows.rival.major),
    );
    expect(major).toMatchObject({
      kind: 'business',
      importance: 1,
      headline: { params: { eventInstanceId: built.shows.rival.major, promotionId: built.rival } },
      // No results to link to, so the show is not in the refs.
      refs: { personIds: [], promotionIds: [built.rival], eventInstanceId: null },
    });
  });

  it('posts the story once when the event comes again', async () => {
    const built = cancelWorld();
    const wire = newsWire(built.world, [calendarSystem]);
    const payload = {
      eventInstanceId: built.shows.rival.flagship,
      promotionId: built.rival,
      date: SHOW_DATE,
      reason: 'notRun',
    } as const;
    wire.events.push({ type: 'show.cancelled', payload });
    await wire.engine.advanceDays({ maxDays: 1 });
    wire.events.push({ type: 'show.cancelled', payload });
    await wire.engine.advanceDays({ maxDays: 1 });
    expect(storiesWithTopic(wire.engine, SHOW_CANCELLED_TOPIC)).toHaveLength(1);
  });
});
