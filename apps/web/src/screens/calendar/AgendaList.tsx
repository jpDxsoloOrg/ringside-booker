import { useId } from 'react';
import { dayOfMonth, weekday } from '@ringside/engine';
import type { CalendarShow, GameDate } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { formatGameDate } from '@/components/format';
import { ShowChip } from '@/components/ShowChip';
import type { ShowChipTag } from '@/components/ShowChip';
import styles from './Calendar.module.css';
import { isSameMonth, weekLabel, WEEKDAY_HEADINGS } from './calendarMonth';
import type { CalendarDayMarker } from './registry';

const NO_SHOWS: readonly CalendarShow[] = [];
const NO_MARKERS: readonly CalendarDayMarker[] = [];

export interface AgendaListProps {
  /** Any day of the month on show. */
  readonly month: GameDate;
  /** The weeks to list, Monday first, from `monthWeeks`. */
  readonly weeks: readonly (readonly GameDate[])[];
  readonly today: GameDate;
  readonly showsByDate: ReadonlyMap<GameDate, readonly CalendarShow[]>;
  readonly markersByDate: ReadonlyMap<GameDate, readonly CalendarDayMarker[]>;
  /** What each chip's tag names: the brand, or the promotion when the list mixes promotions. */
  readonly tag: ShowChipTag;
  readonly onOpenShow: (show: CalendarShow) => void;
}

/** "Mon 4" inside the month on show; a neighbour month's day keeps its month: "Mon 1 Feb". */
function agendaDayText(date: GameDate, month: GameDate): string {
  if (!isSameMonth(date, month)) return formatGameDate(date, 'dayMonth');
  return `${WEEKDAY_HEADINGS[weekday(date)]?.short ?? ''} ${String(dayOfMonth(date))}`;
}

/**
 * A month as a list for phones: one section per week, headed "Week of Mon 4 Jan". Only the days
 * with something on them are listed (shows, a day marker, or today), each show as a full-width
 * row. A week with nothing says so.
 */
export function AgendaList({
  month,
  weeks,
  today,
  showsByDate,
  markersByDate,
  tag,
  onOpenShow,
}: AgendaListProps) {
  const headingIdPrefix = useId();

  return (
    <div className={styles['agenda']}>
      {weeks.map((week) => {
        const monday = week[0];
        if (monday === undefined) return null;
        const headingId = `${headingIdPrefix}-${monday}`;
        const days = week.filter(
          (date) => showsByDate.has(date) || markersByDate.has(date) || date === today,
        );
        const hasShows = week.some((date) => showsByDate.has(date));
        return (
          <section key={monday} aria-labelledby={headingId} className={styles['agendaWeek']}>
            <h2 id={headingId} className={styles['agendaWeekHeading']}>
              {weekLabel(monday)}
            </h2>
            {days.length > 0 && (
              <ul className={styles['agendaDays']}>
                {days.map((date) => {
                  const shows = showsByDate.get(date) ?? NO_SHOWS;
                  const markers = markersByDate.get(date) ?? NO_MARKERS;
                  return (
                    <li
                      key={date}
                      className={styles['agendaDay']}
                      data-calendar-date={date}
                      data-today={date === today ? 'true' : undefined}
                    >
                      <div className={styles['agendaDayHead']}>
                        <span className={styles['agendaDayText']}>
                          {agendaDayText(date, month)}
                        </span>
                        {date === today && <Badge tone="action">Today</Badge>}
                        {markers.map((marker) => (
                          <Badge key={`${marker.label}|${marker.tone}`} tone={marker.tone}>
                            {marker.label}
                          </Badge>
                        ))}
                      </div>
                      {shows.length > 0 && (
                        <ul className={styles['agendaShows']}>
                          {shows.map((show) => (
                            <li key={show.key}>
                              <ShowChip show={show} onOpen={onOpenShow} density="row" tag={tag} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {!hasShows && <p className={styles['agendaEmpty']}>No shows this week</p>}
          </section>
        );
      })}
    </div>
  );
}
