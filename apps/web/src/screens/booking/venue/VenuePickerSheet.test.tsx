import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VenueScope } from '@ringside/engine';
import { useSessionStore } from '@/app/session/sessionStore';
import { countryVenueOptions } from '@/screens/dev-gallery/fixtures/venues';
import { renderWithEngine, venueTestWorld } from '@/test/venueWorld';
import { ABROAD_SWITCH_LABEL, VenuePickerSheet, VenuePickerSheetView } from './VenuePickerSheet';

const LOAD_MS = 10_000;

afterEach(() => {
  useSessionStore.getState().clear();
});

function FixedPicker({ onUse }: { readonly onUse: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [scope, setScope] = useState<VenueScope>('country');
  return (
    <VenuePickerSheetView
      open
      onClose={() => undefined}
      options={countryVenueOptions}
      scope={scope}
      onScopeChange={setScope}
      selected={selected}
      onSelect={setSelected}
      onUse={onUse}
      onPickForMe={() => undefined}
    />
  );
}

describe('the venue picker, from fixed data', () => {
  it('lists the venues in groups with their crowd, fit and badges', () => {
    render(<FixedPicker onUse={() => undefined} />);
    const sheet = screen.getByRole('dialog', { name: 'Choose a venue' });
    for (const heading of ['In Northeast', 'Elsewhere in United States', 'Local venues (generic)'])
      expect(within(sheet).getByRole('group', { name: heading })).toBeInTheDocument();
    // No venue abroad in a country-wide list, so no Abroad group, but the switch is there.
    expect(within(sheet).queryByRole('group', { name: 'Abroad' })).toBeNull();
    expect(within(sheet).getByRole('switch', { name: ABROAD_SWITCH_LABEL })).not.toBeChecked();

    const harbor = within(sheet).getByRole('radio', { name: /^Harbor Arena/ });
    expect(harbor).toHaveAccessibleName('Harbor Arena Preferred Current');
    expect(harbor).toHaveAccessibleDescription(
      'Northeast, United States · Arena · Capacity 17,500 Expected 11,800 – 15,600 Good fit',
    );
  });

  it('shows unavailable venues with the reason, reachable but never chosen', async () => {
    const user = userEvent.setup({ delay: null });
    const onUse = vi.fn();
    render(<FixedPicker onUse={onUse} />);
    const barn = screen.getByRole('radio', { name: 'Longleaf Barn' });
    expect(barn).toHaveAttribute('aria-disabled', 'true');
    expect(barn).toBeEnabled();
    expect(barn).toHaveAccessibleDescription(
      /Unavailable: Exclusive to Longleaf Championship Wrestling/,
    );
    expect(screen.getByRole('radio', { name: 'Old Mill Hall' })).toHaveAccessibleDescription(
      /Unavailable: Tessen Pro Wrestling runs Iron Hour there that night/,
    );
    expect(screen.getByRole('radio', { name: 'Steel City Dome' })).toHaveAccessibleDescription(
      /Unavailable: Closed on that date/,
    );

    await user.click(screen.getByText('Longleaf Barn'));
    expect(barn).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Use this venue' })).toBeDisabled();

    await user.click(screen.getByText('Bayside Theatre'));
    expect(screen.getByRole('radio', { name: 'Bayside Theatre' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Use this venue' }));
    expect(onUse).toHaveBeenCalledOnce();
  });
});

describe('the venue picker, against the engine', () => {
  async function openPicker() {
    const world = await venueTestWorld();
    const { ownShow, transport } = world;
    const commands = vi.spyOn(transport.host, 'command');
    const queries = vi.spyOn(transport.host, 'query');
    const onClose = vi.fn();
    renderWithEngine(
      transport,
      <VenuePickerSheet open onClose={onClose} eventInstanceId={ownShow.eventInstanceId} />,
    );
    await screen.findByRole('group', { name: /^Local venues/ }, { timeout: LOAD_MS });
    return { ...world, commands, queries, onClose, user: userEvent.setup({ delay: null }) };
  }

  it('sets the chosen venue and closes', async () => {
    const { ownShow, commands, onClose, user } = await openPicker();
    await user.click(screen.getByRole('radio', { name: /^Local hall,/ }));
    await user.click(screen.getByRole('button', { name: 'Use this venue' }));
    expect(commands).toHaveBeenCalledWith('booking.setVenue', {
      eventInstanceId: ownShow.eventInstanceId,
      choice: { kind: 'generic', tier: 'hall' },
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it('shows a refusal in the sheet and stays open', async () => {
    const { commands, onClose, user } = await openPicker();
    commands.mockResolvedValueOnce({
      revision: 0,
      result: {
        ok: false,
        reasons: [
          { code: 'boxOffice.showNotEditable', message: 'This show can’t change venue any more' },
        ],
      },
    });
    await user.click(screen.getByRole('radio', { name: /^Local arena,/ }));
    await user.click(screen.getByRole('button', { name: 'Use this venue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This show can’t change venue any more',
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Choose a venue' })).toBeInTheDocument();
  });

  it('asks the game to pick with Pick for me', async () => {
    const { ownShow, commands, onClose, user } = await openPicker();
    await user.click(screen.getByRole('button', { name: 'Pick for me' }));
    expect(commands).toHaveBeenCalledWith('booking.autoVenue', {
      eventInstanceId: ownShow.eventInstanceId,
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it('looks abroad when the switch is on', async () => {
    const { ownShow, queries, user } = await openPicker();
    expect(queries).toHaveBeenCalledWith('boxOffice.venues', {
      eventInstanceId: ownShow.eventInstanceId,
      scope: 'country',
    });
    await user.click(screen.getByRole('switch', { name: ABROAD_SWITCH_LABEL }));
    await waitFor(() => {
      expect(queries).toHaveBeenCalledWith('boxOffice.venues', {
        eventInstanceId: ownShow.eventInstanceId,
        scope: 'world',
      });
    });
  });
});
