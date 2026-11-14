/**
 * Show night on the news wire (DAY1-06, wiring EVT3 into DAY1): every completed show posts a
 * `result` story and every title change a `titleChange` story, through `postNews`.
 *
 * - `show.completed` posts topic `show-result`, importance by the show's importance (flagship 3,
 *   major 2, regular 1, house and minor 0, so routine shows are short-lived filler), about the
 *   promotion and the main event's people. Dedupe `show-result:<eventInstanceId>`.
 * - `title.changed` posts topic `title-change`, importance 2, or 3 for a title whose prestige is
 *   at least `news.milestones.majorTitlePrestige`. Dedupe `title-change:<toReignId>`.
 *
 * Both stories carry the show in `refs.eventInstanceId`, so the story sheet can link to its
 * results. Results are public once the show has run, whoever booked them (D-07); a story never
 * changes morale, popularity or money (D-09).
 *
 * Design: docs/design/news.md#integration.
 */

import { defineSubscription } from '../../core/api/system';
import type { EventInstanceId, PersonId } from '../../core/ids';
import type { EventImportance } from '../../model/entities/event-definition';
import type { NewsImportance } from '../../model/entities/news';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import { postNews } from '../news/post';
import { registerNewsTopic } from '../news/topics';

export const SHOW_RESULT_TOPIC = 'show-result';
export const TITLE_CHANGE_TOPIC = 'title-change';

registerNewsTopic(SHOW_RESULT_TOPIC, {
  params: ['eventInstanceId', 'promotionId', 'score', 'mainEventIds'],
});
registerNewsTopic(TITLE_CHANGE_TOPIC, {
  params: ['titleId', 'newHolderIds', 'previousHolderIds', 'eventInstanceId'],
});

export const SHOW_RESULT_NEWS_SUBSCRIPTION_ID = 'shows.newsOnShowCompleted';
export const TITLE_CHANGE_NEWS_SUBSCRIPTION_ID = 'shows.newsOnTitleChanged';

/** A show's news importance: the size of the show. */
export const SHOW_RESULT_IMPORTANCE: Readonly<Record<EventImportance, NewsImportance>> = {
  flagship: 3,
  major: 2,
  regular: 1,
  minor: 0,
  house: 0,
};

/** Most main-event people a result story names (a battle royal main event names the first few). */
export const SHOW_RESULT_MAX_PEOPLE = 6;

/** `show-result:<eventInstanceId>` */
export function showResultDedupeKey(eventInstanceId: EventInstanceId): string {
  return `show-result:${eventInstanceId}`;
}

/** `title-change:<reignId>`: one story per new reign. */
export function titleChangeDedupeKey(toReignId: string): string {
  return `title-change:${toReignId}`;
}

/**
 * The people in the show's main event (the last main-card slot): competitors, or the speakers of
 * a talking segment, in id order, at most {@link SHOW_RESULT_MAX_PEOPLE}. Empty for a show scored
 * off-screen, which has no card.
 */
export function mainEventPeople(read: GameWorldView, eventInstanceId: EventInstanceId): PersonId[] {
  const instance = read.tables.eventInstances.get(eventInstanceId);
  if (instance === undefined) {
    return [];
  }
  const mainSlot = instance.format.slots - 1;
  const main = read.tables.segments
    .lookup('byEventInstance', eventInstanceId)
    .find((segment) => !segment.preShow && segment.slot === mainSlot);
  if (main === undefined) {
    return [];
  }
  const people = new Set<PersonId>();
  for (const participant of read.tables.participants.lookup('bySegment', main.id)) {
    if (participant.role === 'competitor' || participant.role === 'speaker') {
      people.add(participant.personId);
    }
  }
  return [...people].sort(compareIds).slice(0, SHOW_RESULT_MAX_PEOPLE);
}

/** `show.completed` → a `show-result` story. */
export const showResultNewsSubscription = defineSubscription({
  id: SHOW_RESULT_NEWS_SUBSCRIPTION_ID,
  type: 'show.completed',
  handler: (event, ctx) => {
    const { eventInstanceId, promotionId, importance, score } = event.payload;
    const people = mainEventPeople(ctx.read, eventInstanceId);
    postNews(ctx, {
      kind: 'result',
      topic: SHOW_RESULT_TOPIC,
      params: {
        eventInstanceId,
        promotionId,
        score: Math.round(score),
        mainEventIds: people.join(','),
      },
      refs: { personIds: people, promotionIds: [promotionId], eventInstanceId },
      importance: SHOW_RESULT_IMPORTANCE[importance],
      dedupeKey: showResultDedupeKey(eventInstanceId),
    });
  },
});

/** `title.changed` → a `title-change` story. */
export const titleChangeNewsSubscription = defineSubscription({
  id: TITLE_CHANGE_NEWS_SUBSCRIPTION_ID,
  type: 'title.changed',
  handler: (event, ctx) => {
    const { titleId, promotionId, toReignId, eventInstanceId, newHolderIds, previousHolderIds } =
      event.payload;
    const title = ctx.read.tables.titles.get(titleId);
    const major =
      title !== undefined &&
      title.prestige >= ctx.tunables.get('news.milestones.majorTitlePrestige');
    postNews(ctx, {
      kind: 'titleChange',
      topic: TITLE_CHANGE_TOPIC,
      params: {
        titleId,
        newHolderIds: newHolderIds.join(','),
        previousHolderIds: previousHolderIds.join(','),
        eventInstanceId,
      },
      refs: {
        personIds: [...newHolderIds, ...previousHolderIds],
        promotionIds: [promotionId],
        eventInstanceId,
      },
      importance: major ? 3 : 2,
      dedupeKey: titleChangeDedupeKey(toReignId),
    });
  },
});

export const showsNewsSubscriptions = [showResultNewsSubscription, titleChangeNewsSubscription];
