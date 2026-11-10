import { useMemo, useState } from 'react';
import { parseGameDate } from '@ringside/engine';
import type { CalendarShow } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { AgendaList } from '@/screens/calendar/AgendaList';
import { groupByDate, monthWeeks } from '@/screens/calendar/calendarMonth';
import { MonthGrid } from '@/screens/calendar/MonthGrid';
import type { CalendarDayMarker } from '@/screens/calendar/registry';
import type { GalleryEntry } from '../galleryEntry';
import {
  GALLERY_CALENDAR_MONTH,
  GALLERY_CALENDAR_TODAY,
  galleryMonthShows,
} from '../fixtures/calendar';
import calendarStyles from './calendar.module.css';
import styles from './entries.module.css';

/** A day marker, as a feature would add through the day-marker slot. */
const MARKERS: readonly CalendarDayMarker[] = [
  { date: parseGameDate('2027-01-18'), label: 'Draft day', tone: 'prestige' },
];

function CalendarMonthDemo() {
  const shows = useMemo(() => galleryMonthShows(), []);
  const [lastOpened, setLastOpened] = useState<CalendarShow | null>(null);
  const view = {
    month: GALLERY_CALENDAR_MONTH,
    weeks: monthWeeks(GALLERY_CALENDAR_MONTH),
    today: GALLERY_CALENDAR_TODAY,
    showsByDate: groupByDate(shows),
    markersByDate: groupByDate(MARKERS),
    tag: 'promotion' as const,
    onOpenShow: setLastOpened,
  };

  return (
    <Stack gap={6}>
      <p className={styles['caption']} role="status">
        {lastOpened === null
          ? 'Pick a show to open it. On the screen that opens the show sheet.'
          : `Opened: ${lastOpened.name}`}
      </p>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Month grid (desktop)</h3>
        <p className={styles['caption']}>
          Today is Wednesday the 6th. Saturday the 9th has five shows, so two sit behind &ldquo;+2
          more&rdquo;. The arrow keys move between days; Enter opens a day&apos;s first show.
        </p>
        <MonthGrid {...view} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Agenda (phones)</h3>
        <p className={styles['caption']}>
          The same month as a list of weeks, at phone width. The screen shows this in place of the
          grid below the mobile breakpoint.
        </p>
        <div className={calendarStyles['phoneWidth']}>
          <AgendaList {...view} />
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'calendar-month',
  title: 'Calendar month',
  group: 'Office',
  notes:
    'Fed by calendar.range (stored shows) and calendar.projected (dashed, past the horizon). Whole world view, so each chip is tagged with its promotion.',
  render: () => <CalendarMonthDemo />,
};
