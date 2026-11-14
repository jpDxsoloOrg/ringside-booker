/**
 * Date helpers the milestone sources share: is a day inside the window, and which anniversaries
 * of a date fall inside it. Design: docs/design/news.md#milestones.
 */

import { addDays, addYears, compareDates, year, type GameDate } from '../../../core/date';
import type { MilestoneWindow } from './registry';

/** True when `date` is inside the window, both ends included. */
export function inWindow(date: GameDate, window: MilestoneWindow): boolean {
  return compareDates(date, window.from) >= 0 && compareDates(date, window.to) <= 0;
}

/** The day `days` after `origin` when it falls inside the window, else null. */
export function dayMarkIn(
  origin: GameDate,
  days: number,
  window: MilestoneWindow,
): GameDate | null {
  const onDate = addDays(origin, days);
  return inWindow(onDate, window) ? onDate : null;
}

/** One whole-year anniversary of a date. */
export interface Anniversary {
  /** Whole years since the origin, 1 or more. */
  readonly years: number;
  readonly onDate: GameDate;
}

/**
 * The whole-year anniversaries of `origin` inside the window, fewest years first. A window is at
 * most a week, so there is at most one, or two across a New Year. 29 February falls on
 * 28 February in common years (`addYears`).
 */
export function anniversariesIn(origin: GameDate, window: MilestoneWindow): Anniversary[] {
  const originYear = year(origin);
  const candidates = [...new Set([year(window.from) - originYear, year(window.to) - originYear])];
  const found: Anniversary[] = [];
  for (const years of candidates.sort((left, right) => left - right)) {
    if (years < 1) {
      continue;
    }
    const onDate = addYears(origin, years);
    if (inWindow(onDate, window)) {
      found.push({ years, onDate });
    }
  }
  return found;
}
