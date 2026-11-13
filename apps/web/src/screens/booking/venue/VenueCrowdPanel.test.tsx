import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/app/session/sessionStore';
import { registeredBookingPanels } from '@/screens/booking/registries/bookingPanels';
import {
  genericForecast,
  goodFitForecast,
  notChosenForecast,
  sellOutForecast,
} from '@/screens/dev-gallery/fixtures/venues';
import { renderWithEngine, venueTestWorld } from '@/test/venueWorld';
import { VENUE_CROWD_PANEL } from './register';
import { VenueCrowdPanel, VenueCrowdView } from './VenueCrowdPanel';
import { NOT_YOUR_SHOW_TEXT } from './venueText';

const LOAD_MS = 10_000;

afterEach(() => {
  useSessionStore.getState().clear();
});

describe('the Venue and crowd panel', () => {
  it('is registered as a side panel through the booking feature list', async () => {
    await import('@/screens/booking/sections');
    expect(registeredBookingPanels().map((panel) => panel.id)).toContain('boxOffice.venueCrowd');
    expect(VENUE_CROWD_PANEL).toMatchObject({
      order: 20,
      placement: 'side',
      title: 'Venue and crowd',
    });
    expect(VENUE_CROWD_PANEL.phoneSummary).toBeUndefined();
  });

  it('shows the venue, where it is, its capacity, the expected range with a Why? and the fit', () => {
    render(<VenueCrowdView forecast={goodFitForecast} canChange />);
    expect(screen.getByText('Harbor Arena')).toBeInTheDocument();
    expect(screen.getByText('Northeast, United States')).toBeInTheDocument();
    expect(screen.getByText('Arena · Capacity 17,500')).toBeInTheDocument();
    expect(screen.getByText('11,800 – 15,600')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Why is Expected crowd 13,900 people?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Good fit')).toBeInTheDocument();
    expect(screen.queryByText(/Capped by capacity/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Change venue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pick for me' })).toBeNull();
  });

  it('says when the venue caps the range', () => {
    render(<VenueCrowdView forecast={sellOutForecast} canChange />);
    expect(screen.getByText('2,400')).toBeInTheDocument();
    expect(
      screen.getByText('Capped by capacity: about 3,100 people want to come.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Likely sell-out')).toBeInTheDocument();
  });

  it('names a generic local venue', () => {
    render(<VenueCrowdView forecast={genericForecast} canChange />);
    expect(screen.getByText('Local hall, Northeast')).toBeInTheDocument();
    expect(screen.getByText('Hall · Capacity 1,200')).toBeInTheDocument();
  });

  it('shows the suggestion and why while no venue is chosen, with Pick for me', async () => {
    const onPickForMe = vi.fn();
    render(<VenueCrowdView forecast={notChosenForecast} canChange onPickForMe={onPickForMe} />);
    expect(screen.getByText('Not chosen yet: suggested')).toBeInTheDocument();
    expect(screen.getByText(/books the suggested venue the day before the show/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Why is the suggested venue Harbor Arena?' }),
    ).toBeInTheDocument();
    await userEvent
      .setup({ delay: null })
      .click(screen.getByRole('button', { name: 'Pick for me' }));
    expect(onPickForMe).toHaveBeenCalledOnce();
  });

  it('is read-only for a show that can no longer change', () => {
    render(<VenueCrowdView forecast={notChosenForecast} canChange={false} />);
    expect(screen.queryByRole('button', { name: 'Change venue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pick for me' })).toBeNull();
  });

  it('says a rival show has no forecast instead of showing an error', async () => {
    const { transport, rivalShow } = await venueTestWorld();
    renderWithEngine(
      transport,
      <VenueCrowdPanel eventInstanceId={rivalShow.eventInstanceId} canEdit={false} />,
    );
    expect(await screen.findByText(NOT_YOUR_SHOW_TEXT, {}, { timeout: LOAD_MS })).toBeVisible();
  });

  it('picks a venue for the player’s show with Pick for me', async () => {
    const { transport, ownShow } = await venueTestWorld();
    const commands = vi.spyOn(transport.host, 'command');
    renderWithEngine(
      transport,
      <VenueCrowdPanel eventInstanceId={ownShow.eventInstanceId} canEdit />,
    );
    const pick = await screen.findByRole('button', { name: 'Pick for me' }, { timeout: LOAD_MS });
    await userEvent.setup({ delay: null }).click(pick);
    expect(commands).toHaveBeenCalledWith('booking.autoVenue', {
      eventInstanceId: ownShow.eventInstanceId,
    });
    // The panel follows the stored venue: no suggestion any more.
    await waitFor(
      () => {
        expect(screen.queryByText('Not chosen yet: suggested')).toBeNull();
      },
      { timeout: LOAD_MS },
    );
    expect(screen.getByText(/^Local /)).toBeInTheDocument();
  });
});
