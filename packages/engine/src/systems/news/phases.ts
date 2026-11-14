/**
 * The news system's day phases (DAY1-02): the daily expiry clean-up and the weekly milestone
 * stories.
 *
 * Neither draws random numbers; both visit rows in id order, so a day's news is a pure function of
 * the world. Design: docs/design/news.md#expiry and docs/design/news.md#milestones.
 */

import { addDays, compareDates } from '../../core/date';
import type { NewsId } from '../../core/ids';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { milestoneSources, type MilestoneCandidate } from './milestones';
import { postNews } from './post';

export const EXPIRE_NEWS_PHASE_ID = 'news.expire';
/** The phase's slot in the `housekeeping` group: after the calendar (20) and appearances (22). */
export const EXPIRE_NEWS_PHASE_ORDER = 24;

export const MILESTONES_PHASE_ID = 'news.milestones';
/** The phase's slot in the `periodic` group: early, before the weekly snapshots and prunes. */
export const MILESTONES_PHASE_ORDER = 12;

/** Days before the Monday the milestone window reaches back: the week up to and including it. */
const MILESTONE_WINDOW_BACK_DAYS = 6;

/**
 * Daily: deletes every story whose `expiresOn` is on or before today. It walks the `byExpiresOn`
 * keys from the oldest up to today (stories that never expire are not in that index) and deletes
 * in id order. Overdue stories, from a 0-day story posted after this phase ran or an old save,
 * go the same way.
 */
export const expireNewsPhase: PhaseDefinition = definePhase({
  id: EXPIRE_NEWS_PHASE_ID,
  group: 'housekeeping',
  order: EXPIRE_NEWS_PHASE_ORDER,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    const news = ctx.read.tables.news;
    const due: NewsId[] = [];
    // `YYYY-MM-DD` keys sort in date order, so the walk stops at the first key after today.
    for (const key of news.indexKeys('byExpiresOn')) {
      if (key > ctx.date) {
        break;
      }
      due.push(...news.lookup('byExpiresOn', key).map((story) => story.id));
    }
    due.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    for (const id of due) {
      ctx.tx.delete('news', id);
    }
    if (due.length > 0) {
      ctx.log(`Expired ${String(due.length)} stories`);
    }
  },
});

/** Most important first, then the earliest day, then the dedupe key: a fixed order. */
export function compareMilestones(left: MilestoneCandidate, right: MilestoneCandidate): number {
  if (left.importance !== right.importance) {
    return right.importance - left.importance;
  }
  const byDate = compareDates(left.onDate, right.onDate);
  if (byDate !== 0) {
    return byDate;
  }
  return left.dedupeKey < right.dedupeKey ? -1 : left.dedupeKey > right.dedupeKey ? 1 : 0;
}

/**
 * Mondays: collects the milestones of the week up to today (never before the game's start) from
 * every source in registration order, sorts them with {@link compareMilestones} and posts the first
 * `news.milestones.maxPerWeek`. Each story is dated today and its body names the real day
 * (`onDate`). Dedupe keys make a rerun of the same Monday post nothing new.
 */
export const milestonesPhase: PhaseDefinition = definePhase({
  id: MILESTONES_PHASE_ID,
  group: 'periodic',
  order: MILESTONES_PHASE_ORDER,
  cadence: { kind: 'weekly', weekday: 'mon' },
  run: (ctx) => {
    const weekStart = addDays(ctx.date, -MILESTONE_WINDOW_BACK_DAYS);
    const gameStart = ctx.read.meta.startDate;
    const window = {
      from: compareDates(weekStart, gameStart) < 0 ? gameStart : weekStart,
      to: ctx.date,
    };
    const deps = { tunables: ctx.tunables };
    const candidates = milestoneSources()
      .flatMap((source) => source.collect(ctx.read, window, deps))
      .sort(compareMilestones);
    const cap = ctx.tunables.get('news.milestones.maxPerWeek');
    const chosen = candidates.slice(0, cap);
    const before = ctx.read.tables.news.size;
    for (const candidate of chosen) {
      postNews(ctx, {
        kind: candidate.kind,
        topic: candidate.topic,
        params: candidate.params,
        bodyParams: { ...candidate.params, ...candidate.bodyParams, onDate: candidate.onDate },
        refs: candidate.refs,
        importance: candidate.importance,
        dedupeKey: candidate.dedupeKey,
      });
    }
    const posted = ctx.read.tables.news.size - before;
    const dropped = candidates.length - chosen.length;
    if (candidates.length > 0) {
      ctx.log(
        `Posted ${String(posted)} milestone stories (${String(chosen.length - posted)} already on file); dropped ${String(dropped)} over the weekly cap of ${String(cap)}`,
      );
    }
  },
});

export const newsPhases: readonly PhaseDefinition[] = [expireNewsPhase, milestonesPhase];
