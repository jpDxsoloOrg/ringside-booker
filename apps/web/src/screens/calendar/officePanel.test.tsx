import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGameDate } from '@ringside/engine';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { bookingFakeState } from '@/test/fakeEngine';
import { renderOfficePanel } from '@/test/officePanel';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';
import {
  bookingLinkText,
  daysAwayText,
  NEXT_SHOW_PANEL_ID,
  NextShowPanel,
  NO_SHOWS_TEXT,
  VENUE_NOT_CHOSEN_TEXT,
  venueText,
} from './officePanel';

/** The engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;

afterEach(() => {
  useSessionStore.getState().clear();
});

describe('the Next show panel (DAY2-06)', () => {
  it("shows the player's next show with its date, size, venue and links, never minutes", async () => {
    // The booking world one day in: its shows are stored, the player's Test Weekly the first.
    await renderOfficePanel(NEXT_SHOW_PANEL_ID, { state: bookingFakeState().state, daysPlayed: 1 });

    const panel = await screen.findByRole('region', { name: 'Next show' }, { timeout: LOAD_MS });
    const show = await within(panel).findByRole('heading', { level: 3 }, { timeout: LOAD_MS });
    expect(show).toHaveTextContent('Test Weekly');
    expect(panel).toHaveTextContent(/In \d+ days|Tomorrow|Today/u);
    expect(panel).toHaveTextContent(/\d+ main slots/u);
    expect(panel.textContent).not.toMatch(RUNNING_TIME_WORDS);

    const calendar = within(panel).getByRole('link', { name: 'Open calendar' });
    expect(calendar.getAttribute('href')).toMatch(/^\/game\/calendar\?show=/u);
    const booking = within(panel).getByRole('link', { name: /Book this show|Edit card/u });
    expect(booking.getAttribute('href')).toMatch(/^\/game\/booking\?event=/u);

    // EVT6's forecast, with its Why?.
    expect(
      await within(panel).findByText(/^Expected /u, undefined, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /^Why is expected crowd/iu })).toBeVisible();
  });

  it('says there are no shows on the calendar and links to it', () => {
    render(
      <MemoryRouter>
        <NextShowPanel next={null} today={parseGameDate('2026-04-10')} />
      </MemoryRouter>,
    );
    const panel = screen.getByRole('region', { name: 'Next show' });
    expect(within(panel).getByText(NO_SHOWS_TEXT)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Open calendar' })).toHaveAttribute(
      'href',
      routes.game.calendar(),
    );
  });

  it('words the countdown, the venue and the Booking link', () => {
    expect([0, 1, 2, 9].map(daysAwayText)).toEqual(['Today', 'Tomorrow', 'In 2 days', 'In 9 days']);
    expect(venueText({ venue: null, genericVenue: null })).toBe(VENUE_NOT_CHOSEN_TEXT);
    expect(
      venueText({ venue: null, genericVenue: { name: 'Local hall, Northeast', capacity: 800 } }),
    ).toBe('Local hall, Northeast');
    const today = parseGameDate('2026-04-10');
    const show = { date: parseGameDate('2026-04-16'), segmentCount: 0 };
    expect(bookingLinkText(show, today)).toBe('Book this show');
    expect(bookingLinkText({ ...show, segmentCount: 3 }, today)).toBe('Edit card');
    expect(bookingLinkText({ ...show, date: today }, today)).toBe('Go to the show');
  });
});
