import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, parseId } from '@ringside/engine';
import { createInProcessTransport } from '@/app/engine/transport';
import { useSessionStore } from '@/app/session/sessionStore';
import { ShowDetailSheet } from '@/screens/calendar/ShowDetailSheet';
import { galleryRivalShow, galleryShow } from '@/screens/dev-gallery/fixtures/calendar';
import { BOOKING_WORLD_START, fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { renderWithEngine, venueTestWorld } from '@/test/venueWorld';
import { CROWD_SECTION, attendanceText, forecastShowId, ranShowId } from './ShowCrowdSection';

const LOAD_MS = 10_000;
const TODAY = addDays(BOOKING_WORLD_START, 1);

afterEach(() => {
  useSessionStore.getState().clear();
});

describe('the calendar show sheet’s Crowd section', () => {
  it('sits under the facts, before the result', () => {
    expect(CROWD_SECTION).toMatchObject({ id: 'boxOffice.crowd', order: 5, title: 'Crowd' });
  });

  it('forecasts only the player’s shows still to run', async () => {
    const { ownShow, rivalShow } = await venueTestWorld();
    expect(forecastShowId(ownShow, TODAY)).toBe(ownShow.eventInstanceId);
    expect(forecastShowId(rivalShow, TODAY)).toBeNull();
    expect(forecastShowId({ ...ownShow, status: 'completed' }, TODAY)).toBeNull();
    expect(forecastShowId({ ...ownShow, status: 'cancelled' }, TODAY)).toBeNull();
    expect(forecastShowId(ownShow, addDays(ownShow.date, 1))).toBeNull();
    expect(forecastShowId({ ...ownShow, eventInstanceId: null }, TODAY)).toBeNull();
  });

  it('shows the expected crowd at the suggested venue in the sheet, and the venue not chosen yet', async () => {
    const { transport, ownShow } = await venueTestWorld();
    renderWithEngine(
      transport,
      <ShowDetailSheet
        open
        onClose={() => undefined}
        show={ownShow}
        today={TODAY}
        showPromotion={false}
      />,
    );
    expect(screen.getByText('Venue not chosen yet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Crowd' })).toBeInTheDocument();
    expect(
      await screen.findByText(
        /^Expected .* at Local .*\(suggested; not chosen yet\)$/,
        {},
        {
          timeout: LOAD_MS,
        },
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /^Why is Expected crowd/ })).toBeInTheDocument();
  });

  it('leaves a rival’s show without a Crowd section, and names a generic venue in the facts', () => {
    render(
      <ShowDetailSheet
        open
        onClose={() => undefined}
        show={{
          ...galleryRivalShow(0),
          venue: null,
          genericVenue: { name: 'Local hall, Test Region', capacity: 1_200 },
        }}
        today={TODAY}
        showPromotion
      />,
    );
    expect(screen.getByText('Local hall, Test Region (holds 1,200)')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Crowd' })).toBeNull();
  });

  it('counts the crowd of any show that has run, and nothing else', () => {
    const ran = galleryRivalShow(0, { status: 'completed' });
    expect(ranShowId(ran)).toBe(ran.eventInstanceId);
    expect(ranShowId(galleryShow({ status: 'completed' }))).not.toBeNull();
    expect(ranShowId(galleryShow({ status: 'scheduled' }))).toBeNull();
    expect(ranShowId(galleryShow({ status: 'cancelled' }))).toBeNull();
    expect(attendanceText(4_210, 92, 'Harbor Arena')).toBe('4,210 came · 92% full at Harbor Arena');
    expect(attendanceText(80, null, 'Harbor Arena')).toBe('80 came at Harbor Arena');
  });

  it('shows how many came to a settled show, from the real engine', async () => {
    const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    const install = transport.host.installEngine(fakeEngineState());
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
    const show = galleryShow({
      eventInstanceId: parseId('eventInstance', 'evi_0000000001'),
      status: 'completed',
      name: 'Test Weekly',
    });
    renderWithEngine(
      transport,
      <ShowDetailSheet
        open
        onClose={() => undefined}
        show={show}
        today={addDays(show.date, 1)}
        showPromotion={false}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Crowd' })).toBeInTheDocument();
    expect(
      await screen.findByText(/^2,800 came( · \d+% full)? at /, {}, { timeout: LOAD_MS }),
    ).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\$/u);
  });
});
