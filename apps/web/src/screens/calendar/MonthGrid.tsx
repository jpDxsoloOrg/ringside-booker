import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { dayOfMonth } from '@ringside/engine';
import type { CalendarShow, GameDate } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { formatGameDate } from '@/components/format';
import { VisuallyHidden } from '@/components/layout';
import { Popover } from '@/components/Popover';
import { ShowChip } from '@/components/ShowChip';
import type { ShowChipTag } from '@/components/ShowChip';
import styles from './Calendar.module.css';
import { isSameMonth, monthTitle, WEEKDAY_HEADINGS } from './calendarMonth';
import type { CalendarDayMarker } from './registry';

/** How many chips a day shows before the rest go behind "+N more". */
export const MAX_CHIPS_PER_DAY = 3;

/** The attribute every day carries, on the grid and in the agenda, so focus can find a date. */
export const CALENDAR_DATE_ATTRIBUTE = 'data-calendar-date';

const NO_SHOWS: readonly CalendarShow[] = [];
const NO_MARKERS: readonly CalendarDayMarker[] = [];

/** How far each key moves the focused day. */
const KEY_DAY_STEPS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

export interface MonthGridProps {
  /** Any day of the month on show. Days of its neighbours are drawn muted. */
  readonly month: GameDate;
  /** The weeks to draw, Monday first, from `monthWeeks`. */
  readonly weeks: readonly (readonly GameDate[])[];
  readonly today: GameDate;
  readonly showsByDate: ReadonlyMap<GameDate, readonly CalendarShow[]>;
  readonly markersByDate: ReadonlyMap<GameDate, readonly CalendarDayMarker[]>;
  /** What each chip's tag names: the brand, or the promotion when the list mixes promotions. */
  readonly tag: ShowChipTag;
  readonly onOpenShow: (show: CalendarShow) => void;
}

function showCountText(count: number): string {
  if (count === 0) return 'no shows';
  return count === 1 ? '1 show' : `${String(count)} shows`;
}

interface DayCellProps {
  readonly date: GameDate;
  readonly isOutsideMonth: boolean;
  readonly isToday: boolean;
  readonly isTabStop: boolean;
  readonly shows: readonly CalendarShow[];
  readonly markers: readonly CalendarDayMarker[];
  readonly tag: ShowChipTag;
  readonly onOpenShow: (show: CalendarShow) => void;
  readonly onFocusDay: (date: GameDate) => void;
}

function DayCell({
  date,
  isOutsideMonth,
  isToday,
  isTabStop,
  shows,
  markers,
  tag,
  onOpenShow,
  onFocusDay,
}: DayCellProps) {
  const moreButtonId = useId();
  const shown = shows.slice(0, MAX_CHIPS_PER_DAY);
  const hiddenCount = shows.length - shown.length;
  const dayText = formatGameDate(date, 'dayMonthYear');
  const label = [
    formatGameDate(date, 'long'),
    ...(isToday ? ['today'] : []),
    ...markers.map((marker) => marker.label),
    showCountText(shows.length),
  ].join(', ');

  return (
    <td
      role="gridcell"
      className={styles['day']}
      tabIndex={isTabStop ? 0 : -1}
      aria-label={label}
      aria-current={isToday ? 'date' : undefined}
      data-outside={isOutsideMonth ? 'true' : undefined}
      data-today={isToday ? 'true' : undefined}
      data-calendar-date={date}
      onFocus={() => {
        onFocusDay(date);
      }}
    >
      <div className={styles['dayHead']}>
        <span className={styles['dayNumber']}>{dayOfMonth(date)}</span>
        {isToday && <VisuallyHidden>Today</VisuallyHidden>}
        {markers.map((marker) => (
          <Badge key={`${marker.label}|${marker.tone}`} tone={marker.tone}>
            {marker.label}
          </Badge>
        ))}
      </div>
      {shown.length > 0 && (
        <ul className={styles['dayShows']}>
          {shown.map((show) => (
            <li key={show.key}>
              <ShowChip show={show} onOpen={onOpenShow} density="grid" tag={tag} />
            </li>
          ))}
        </ul>
      )}
      {hiddenCount > 0 && (
        <Popover
          title={dayText}
          trigger={
            <Button id={moreButtonId} size="sm" variant="ghost" className={styles['moreButton']}>
              +{hiddenCount} more
              <VisuallyHidden> on {dayText}</VisuallyHidden>
            </Button>
          }
        >
          {/*
            A chip picked here opens the sheet, which closes this list, so the sheet hands focus
            back to the button instead (RETURN_FOCUS_ATTRIBUTE in components/Sheet).
          */}
          <ul className={styles['moreShows']} data-return-focus-to={moreButtonId}>
            {shows.map((show) => (
              <li key={show.key}>
                <ShowChip show={show} onOpen={onOpenShow} density="row" tag={tag} />
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </td>
  );
}

/**
 * A month as a grid of days, Monday first, for desktop. Each day lists its shows as chips (three,
 * then "+N more" in a popover) and any day markers; today has a ring.
 *
 * Keyboard: one day is in the Tab order. The arrow keys move a day or a week at a time, Home and
 * End go to the ends of the week, and Enter on a day opens its first show. The chips are buttons
 * of their own, reached with Tab from their day.
 */
export function MonthGrid({
  month,
  weeks,
  today,
  showsByDate,
  markersByDate,
  tag,
  onOpenShow,
}: MonthGridProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [focusedDay, setFocusedDay] = useState<GameDate | null>(null);
  const days = weeks.flat();
  // The one day in the Tab order: the last one focused, else today, else the 1st of the month.
  const tabStop =
    (focusedDay !== null && days.includes(focusedDay) ? focusedDay : null) ??
    (days.includes(today) ? today : null) ??
    days.find((date) => isSameMonth(date, month)) ??
    null;

  const focusDay = (date: GameDate): boolean => {
    const cell = tableRef.current?.querySelector<HTMLElement>(
      `[${CALENDAR_DATE_ATTRIBUTE}="${date}"]`,
    );
    if (cell === null || cell === undefined) return false;
    cell.focus();
    return true;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTableElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!(event.target instanceof Element)) return;
    // Keys pressed inside the "+N more" popover arrive here through React but are not in a day.
    const cell = event.target.closest<HTMLElement>(`[${CALENDAR_DATE_ATTRIBUTE}]`);
    const date = days.find((day) => day === cell?.getAttribute(CALENDAR_DATE_ATTRIBUTE));
    if (cell === null || date === undefined || tableRef.current?.contains(cell) !== true) return;

    if (event.key === 'Enter') {
      // Enter on a chip or on "+N more" is that button's own click.
      if (event.target !== cell) return;
      const [firstShow] = showsByDate.get(date) ?? NO_SHOWS;
      if (firstShow === undefined) return;
      event.preventDefault();
      onOpenShow(firstShow);
      return;
    }

    const weekIndex = days.indexOf(date) % 7;
    const step =
      event.key === 'Home'
        ? -weekIndex
        : event.key === 'End'
          ? 6 - weekIndex
          : KEY_DAY_STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const target = days[days.indexOf(date) + step];
    if (target !== undefined) focusDay(target);
  };

  return (
    // The grid takes the arrow keys for its days, which is what role="grid" promises.
    <table
      ref={tableRef}
      role="grid"
      className={styles['grid']}
      aria-label={monthTitle(month)}
      onKeyDown={handleKeyDown}
    >
      <thead>
        <tr>
          {WEEKDAY_HEADINGS.map((heading) => (
            <th key={heading.short} scope="col" abbr={heading.full} className={styles['weekday']}>
              <span aria-hidden="true">{heading.short}</span>
              <VisuallyHidden>{heading.full}</VisuallyHidden>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0] ?? ''}>
            {week.map((date) => (
              <DayCell
                key={date}
                date={date}
                isOutsideMonth={!isSameMonth(date, month)}
                isToday={date === today}
                isTabStop={date === tabStop}
                shows={showsByDate.get(date) ?? NO_SHOWS}
                markers={markersByDate.get(date) ?? NO_MARKERS}
                tag={tag}
                onOpenShow={onOpenShow}
                onFocusDay={setFocusedDay}
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
