import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { parseGameDate } from '@ringside/engine';
import type { CalendarShow } from '@ringside/engine';
import {
  GALLERY_CALENDAR_MONTH,
  GALLERY_CALENDAR_TODAY,
  galleryMonthShows,
} from '@/screens/dev-gallery/fixtures/calendar';
import { AgendaList } from './AgendaList';
import { groupByDate, monthWeeks } from './calendarMonth';
import { MonthGrid } from './MonthGrid';
import type { CalendarDayMarker } from './registry';

const MARKERS: readonly CalendarDayMarker[] = [
  { date: parseGameDate('2027-01-18'), label: 'Draft day', tone: 'prestige' },
];

function viewProps(onOpenShow: (show: CalendarShow) => void = () => undefined) {
  return {
    month: GALLERY_CALENDAR_MONTH,
    weeks: monthWeeks(GALLERY_CALENDAR_MONTH),
    today: GALLERY_CALENDAR_TODAY,
    showsByDate: groupByDate(galleryMonthShows()),
    markersByDate: groupByDate(MARKERS),
    tag: 'promotion' as const,
    onOpenShow,
  };
}

function dayCell(name: RegExp): HTMLElement {
  return screen.getByRole('gridcell', { name });
}

/** Focus from a script updates the grid's tab stop, so it is wrapped like any other event. */
function focus(element: HTMLElement | undefined): void {
  act(() => {
    element?.focus();
  });
}

describe('MonthGrid', () => {
  it('is a grid named by its month with Monday-first weekday headings', () => {
    render(<MonthGrid {...viewProps()} />);
    const grid = screen.getByRole('grid', { name: 'January 2027' });
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((header) => header.getAttribute('abbr')),
    ).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    // Five weeks: Monday 28 December to Sunday 31 January.
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(35);
  });

  it('marks today and the days outside the month', () => {
    render(<MonthGrid {...viewProps()} />);
    const today = dayCell(/^Wednesday, January 6, 2027, today/);
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(today).toHaveAttribute('data-today', 'true');
    expect(within(today).getByText('Today')).toBeInTheDocument();
    expect(dayCell(/^Monday, December 28, 2026/)).toHaveAttribute('data-outside', 'true');
    expect(dayCell(/^Friday, January 1, 2027/)).not.toHaveAttribute('data-outside');
  });

  it('lists a day’s shows as chips and says how many in the day’s name', () => {
    render(<MonthGrid {...viewProps()} />);
    const wednesday = dayCell(/^Wednesday, January 20, 2027, 1 show$/);
    expect(within(wednesday).getByRole('button', { name: /Altura Overclock/ })).toBeInTheDocument();
    expect(dayCell(/^Thursday, January 21, 2027, no shows$/)).toBeInTheDocument();
  });

  it('shows a day marker on its day', () => {
    render(<MonthGrid {...viewProps()} />);
    const draftDay = dayCell(/^Monday, January 18, 2027, Draft day, no shows$/);
    expect(within(draftDay).getByText('Draft day')).toBeInTheDocument();
  });

  it('keeps three chips on a busy day and puts every show behind "+N more"', async () => {
    const onOpenShow = vi.fn();
    const user = userEvent.setup();
    render(<MonthGrid {...viewProps(onOpenShow)} />);

    const saturday = dayCell(/^Saturday, January 9, 2027, 5 shows$/);
    // Three chips and the "+2 more" button.
    expect(within(saturday).getAllByRole('button')).toHaveLength(4);
    await user.click(within(saturday).getByRole('button', { name: '+2 more on Sat 9 Jan 2027' }));

    const popover = await screen.findByRole('dialog', { name: 'Sat 9 Jan 2027' });
    const listed = within(popover).getAllByRole('button', { name: /Showdown|Reckoning/ });
    expect(listed).toHaveLength(5);

    await user.click(within(popover).getByRole('button', { name: /Altura Winter Reckoning/ }));
    expect(onOpenShow).toHaveBeenCalledOnce();
    expect(onOpenShow.mock.calls[0]?.[0]).toMatchObject({ name: 'Altura Winter Reckoning' });
  });

  it('has one day in the Tab order: today', () => {
    render(<MonthGrid {...viewProps()} />);
    const tabStops = screen
      .getAllByRole('gridcell')
      .filter((cell) => cell.getAttribute('tabindex') === '0');
    expect(tabStops).toEqual([dayCell(/^Wednesday, January 6, 2027/)]);
  });

  it('puts the 1st in the Tab order when today is not on screen', () => {
    render(<MonthGrid {...viewProps()} today={parseGameDate('2027-06-15')} />);
    const tabStops = screen
      .getAllByRole('gridcell')
      .filter((cell) => cell.getAttribute('tabindex') === '0');
    expect(tabStops).toEqual([dayCell(/^Friday, January 1, 2027/)]);
  });

  it('moves between days with the arrow keys, Home and End', async () => {
    const user = userEvent.setup();
    render(<MonthGrid {...viewProps()} />);
    focus(dayCell(/^Wednesday, January 6, 2027/));

    await user.keyboard('{ArrowRight}');
    expect(dayCell(/^Thursday, January 7, 2027/)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(dayCell(/^Thursday, January 14, 2027/)).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(dayCell(/^Tuesday, January 12, 2027/)).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(dayCell(/^Tuesday, January 5, 2027/)).toHaveFocus();
    await user.keyboard('{End}');
    expect(dayCell(/^Sunday, January 10, 2027/)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(dayCell(/^Monday, January 4, 2027/)).toHaveFocus();
    // The focused day is now the one in the Tab order.
    expect(dayCell(/^Monday, January 4, 2027/)).toHaveAttribute('tabindex', '0');
    expect(dayCell(/^Wednesday, January 6, 2027/)).toHaveAttribute('tabindex', '-1');
  });

  it('stays put at the edges of the grid', async () => {
    const user = userEvent.setup();
    render(<MonthGrid {...viewProps()} />);
    const first = dayCell(/^Monday, December 28, 2026/);
    focus(first);
    await user.keyboard('{ArrowLeft}{ArrowUp}');
    expect(first).toHaveFocus();
  });

  it('opens a day’s first show with Enter, and does nothing on an empty day', async () => {
    const onOpenShow = vi.fn();
    const user = userEvent.setup();
    render(<MonthGrid {...viewProps(onOpenShow)} />);

    focus(dayCell(/^Thursday, January 7, 2027/));
    await user.keyboard('{Enter}');
    expect(onOpenShow).not.toHaveBeenCalled();

    focus(dayCell(/^Sunday, January 31, 2027/));
    await user.keyboard('{Enter}');
    expect(onOpenShow).toHaveBeenCalledOnce();
    expect(onOpenShow.mock.calls[0]?.[0]).toMatchObject({ name: 'Altura Crown of the Valley' });
  });

  it('moves days from a focused chip too, and Enter on the chip opens that chip', async () => {
    const onOpenShow = vi.fn();
    const user = userEvent.setup();
    render(<MonthGrid {...viewProps(onOpenShow)} />);
    const saturday = dayCell(/^Saturday, January 16, 2027/);
    const [, secondChip] = within(saturday).getAllByRole('button');
    focus(secondChip);

    await user.keyboard('{Enter}');
    expect(onOpenShow).toHaveBeenCalledOnce();
    expect(onOpenShow.mock.calls[0]?.[0]).toMatchObject({ importance: 'minor' });

    await user.keyboard('{ArrowRight}');
    expect(dayCell(/^Sunday, January 17, 2027/)).toHaveFocus();
  });
});

describe('AgendaList', () => {
  it('heads each week by its Monday', () => {
    render(<AgendaList {...viewProps()} />);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      'Week of Mon 28 Dec',
      'Week of Mon 4 Jan',
      'Week of Mon 11 Jan',
      'Week of Mon 18 Jan',
      'Week of Mon 25 Jan',
    ]);
  });

  it('lists the days that have shows, with the weekday and the date', () => {
    render(<AgendaList {...viewProps()} />);
    const week = screen.getByRole('region', { name: 'Week of Mon 18 Jan' });
    expect(within(week).getByText('Wed 20')).toBeInTheDocument();
    expect(within(week).getByText('Sat 23')).toBeInTheDocument();
    expect(within(week).getAllByRole('button')).toHaveLength(3);
    // A day marker gets its day a row even with no show on it.
    expect(within(week).getByText('Mon 18')).toBeInTheDocument();
    expect(within(week).getByText('Draft day')).toBeInTheDocument();
  });

  it('keeps the month on a day that belongs to a neighbouring month', () => {
    const shows = [
      ...galleryMonthShows(),
      ...galleryMonthShows()
        .slice(0, 1)
        .map((show) => ({
          ...show,
          key: 'evi_december',
          date: parseGameDate('2026-12-30'),
          airDate: parseGameDate('2026-12-30'),
        })),
    ];
    render(<AgendaList {...viewProps()} showsByDate={groupByDate(shows)} />);
    const week = screen.getByRole('region', { name: 'Week of Mon 28 Dec' });
    expect(within(week).getByText('Wed 30 Dec')).toBeInTheDocument();
    expect(within(week).getByText('Sat 2')).toBeInTheDocument();
  });

  it('highlights today', () => {
    render(<AgendaList {...viewProps()} />);
    const today = screen.getByText('Wed 6').closest('li');
    if (today === null) throw new Error('Today has no row.');
    expect(today).toHaveAttribute('data-today', 'true');
    expect(within(today).getByText('Today')).toBeInTheDocument();
  });

  it('says so when a week has no shows', () => {
    render(<AgendaList {...viewProps()} showsByDate={new Map()} />);
    expect(screen.getAllByText('No shows this week')).toHaveLength(5);
    // Today still has its row, so the player can find the date.
    expect(screen.getByText('Wed 6')).toBeInTheDocument();
  });

  it('opens a show from its row', async () => {
    const onOpenShow = vi.fn();
    render(<AgendaList {...viewProps(onOpenShow)} />);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /Altura Crown of the Valley/ }));
    expect(onOpenShow).toHaveBeenCalledOnce();
  });
});
