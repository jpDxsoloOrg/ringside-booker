/**
 * Cancelled shows on the news wire (DAY1-06, wiring EVT1 into DAY1).
 *
 * `show.cancelled` posts a `business` story (topic `show-cancelled`, importance 1) when a show run
 * by the computer, and big enough to matter (major or flagship), is called off or not run. A show
 * a human runs posts nothing: the player cancelled it themselves and needs no story to say so.
 * The calendar already shows every promotion's cancelled shows, so the story reveals nothing new
 * (D-07). Dedupe `show-cancelled:<eventInstanceId>`.
 *
 * The show is only in the params, not in `refs.eventInstanceId`: a cancelled show has no results
 * for the story sheet to link to.
 *
 * Design: docs/design/news.md#integration.
 */

import { defineSubscription } from '../../core/api/system';
import type { EventInstanceId } from '../../core/ids';
import type { EventImportance } from '../../model/entities/event-definition';
import { postNews } from '../news/post';
import { registerNewsTopic } from '../news/topics';
import { showControllerOf } from './control';

export const SHOW_CANCELLED_TOPIC = 'show-cancelled';

registerNewsTopic(SHOW_CANCELLED_TOPIC, { params: ['eventInstanceId', 'promotionId'] });

export const SHOW_CANCELLED_NEWS_SUBSCRIPTION_ID = 'calendar.newsOnShowCancelled';

/** The show sizes whose cancellation makes a story. */
export const NEWSWORTHY_CANCELLED_IMPORTANCES: readonly EventImportance[] = ['major', 'flagship'];

/** `show-cancelled:<eventInstanceId>` */
export function showCancelledDedupeKey(eventInstanceId: EventInstanceId): string {
  return `show-cancelled:${eventInstanceId}`;
}

/** `show.cancelled` → a `show-cancelled` story, for a computer promotion's major or flagship show. */
export const showCancelledNewsSubscription = defineSubscription({
  id: SHOW_CANCELLED_NEWS_SUBSCRIPTION_ID,
  type: 'show.cancelled',
  handler: (event, ctx) => {
    const { eventInstanceId, promotionId } = event.payload;
    const show = ctx.read.tables.eventInstances.get(eventInstanceId);
    if (show === undefined || !NEWSWORTHY_CANCELLED_IMPORTANCES.includes(show.importance)) {
      return;
    }
    if (showControllerOf(ctx.read, show).kind === 'human') {
      return;
    }
    postNews(ctx, {
      kind: 'business',
      topic: SHOW_CANCELLED_TOPIC,
      params: { eventInstanceId, promotionId },
      refs: { promotionIds: [promotionId] },
      importance: 1,
      dedupeKey: showCancelledDedupeKey(eventInstanceId),
    });
  },
});
