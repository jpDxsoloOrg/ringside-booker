/**
 * The Skip days sheet's "Until next show" choice (EVT1-05, registered by DAY1-06 through DAY1-05's
 * skip-target registry), from the calendar's own folder: skips to the day of the player's next
 * show from `calendar.nextShow { scope: 'mine' }` and stops there, so the day starts with
 * "Tonight: <Show>". Hidden with no show of the player's on the calendar, and on the show's own
 * day (there is nothing to skip to). The line under it reads "Mon 11 Jan · 7 days".
 */
import type { CalendarShow } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { dayCount } from '@/app/AppShell/day/advanceSummaryText';
import { registerSkipTarget } from '@/app/AppShell/day/skipTargets';
import type { SkipTargetChoice } from '@/app/AppShell/day/skipTargets';
import { formatGameDate } from '@/components/format';

/** The target's id, remembered per browser as the last choice. */
export const NEXT_SHOW_SKIP_TARGET_ID = 'calendar.nextShow';

/** The chip's words. */
export const NEXT_SHOW_SKIP_LABEL = 'Until next show';

const MY_SHOWS = { scope: 'mine' } as const;

/** What the chip asks for: up to the show's day, stopping there. Null when there is none to skip to. */
export function nextShowChoice(
  next: { readonly show: Pick<CalendarShow, 'date'>; readonly daysUntil: number } | null,
): SkipTargetChoice | null {
  if (next === null || next.daysUntil <= 0) return null;
  return {
    request: { maxDays: next.daysUntil, stopAtDate: next.show.date },
    detail: `${formatGameDate(next.show.date, 'dayMonth')} · ${dayCount(next.daysUntil)}`,
  };
}

/** The target's hook: reads the player's next show (the engine knows today). */
export function useNextShowChoice(): SkipTargetChoice | null {
  const query = useEngineQuery('calendar.nextShow', MY_SHOWS, { keepPreviousData: true });
  return query.status === 'error' || query.data === undefined ? null : nextShowChoice(query.data);
}

registerSkipTarget({
  id: NEXT_SHOW_SKIP_TARGET_ID,
  label: NEXT_SHOW_SKIP_LABEL,
  order: 5,
  useResolve: useNextShowChoice,
});
