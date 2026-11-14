/**
 * The front page: which stories are big news, and the order the hero stories and the ticker
 * show them in.
 *
 * A story is front page when its importance is 3 or its buzz reaches `news.frontPage.minBuzz`.
 * The ranking is `buzz − ageDays × news.frontPage.agePenaltyPerDay` over the last
 * `news.frontPage.windowDays` days, ties newest first, then by id. The rank is an ordering, not a
 * number the player sees, so it has no Why? of its own; a story's buzz has one.
 *
 * Design: docs/design/news.md#front-page.
 */

import { addDays, compareDates, diffDays, type GameDate } from '../../core/date';
import type { News } from '../../model/entities/news';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';

type Story = DeepReadonly<News>;

/** True when the story is front page: importance 3, or buzz at least `news.frontPage.minBuzz`. */
export function isFrontPage(news: Story, tunables: EngineTunables): boolean {
  return news.importance === 3 || news.buzz >= tunables.get('news.frontPage.minBuzz');
}

/** The ranking score of a story on `date`: its buzz minus the age penalty. Not shown to players. */
export function frontPageRank(news: Story, date: GameDate, tunables: EngineTunables): number {
  const ageDays = Math.max(0, diffDays(news.date, date));
  return news.buzz - ageDays * tunables.get('news.frontPage.agePenaltyPerDay');
}

/** True while the story is on the feed on `date`: it never expires or expires after `date`. */
export function isShownOn(news: Story, date: GameDate): boolean {
  return news.expiresOn === null || compareDates(news.expiresOn, date) > 0;
}

/** Newest first, then the higher buzz, then by id: the feed's order. */
export function compareFeed(left: Story, right: Story): number {
  return (
    compareDates(right.date, left.date) ||
    right.buzz - left.buzz ||
    compareIds(left.id, right.id)
  );
}

/**
 * The stories posted from `from` to `to` (both included) that are still shown on `today`, newest
 * day first. Walks the `byDate` index keys, never the whole table.
 */
export function storiesBetween(
  read: GameWorldView,
  from: GameDate | null,
  to: GameDate | null,
  today: GameDate,
): Story[] {
  const keys = read.tables.news.indexKeys('byDate');
  const stories: Story[] = [];
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index];
    if (key === undefined) {
      continue;
    }
    if (to !== null && key > to) {
      continue;
    }
    if (from !== null && key < from) {
      break;
    }
    for (const news of read.tables.news.lookup('byDate', key)) {
      if (isShownOn(news, today)) {
        stories.push(news);
      }
    }
  }
  return stories;
}

/**
 * The stories competing for the front page on `date`, best ranked first: those posted in the last
 * `news.frontPage.windowDays` days (today included) and still shown. Ties go to the newer story,
 * then the lower id.
 */
export function rankedWindow(
  read: GameWorldView,
  date: GameDate,
  tunables: EngineTunables,
): Story[] {
  const from = addDays(date, 1 - tunables.get('news.frontPage.windowDays'));
  const ranked = storiesBetween(read, from, date, date).map((news) => ({
    news,
    rank: frontPageRank(news, date, tunables),
  }));
  ranked.sort(
    (left, right) =>
      right.rank - left.rank ||
      compareDates(right.news.date, left.news.date) ||
      compareIds(left.news.id, right.news.id),
  );
  return ranked.map((entry) => entry.news);
}
