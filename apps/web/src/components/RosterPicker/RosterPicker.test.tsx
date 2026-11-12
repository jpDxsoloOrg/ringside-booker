import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseId } from '@ringside/engine';
import { RosterPicker, ROSTER_SEARCH_DEBOUNCE_MS } from './RosterPicker';
import type { RosterPickerPerson, RosterPickerProps, RosterPickerTeam } from './RosterPicker';

function person(
  index: number,
  name: string,
  overrides: Partial<RosterPickerPerson> = {},
): RosterPickerPerson {
  return {
    personId: parseId('person', `per_${String(index).padStart(10, '0')}`),
    name,
    imageRef: null,
    pushLabel: 'Mid card',
    alignment: 'face',
    availability: { status: 'available', label: 'Available' },
    selectable: true,
    reason: null,
    otherBrand: false,
    notes: [],
    ...overrides,
  };
}

const KAI = person(1, 'Kai Moreno');
const TIA = person(2, 'Tia Cruz', {
  availability: { status: 'injured', label: 'Injured until 12 Feb' },
  selectable: false,
  reason: "Can't wrestle on this date: Injured (leg injury)",
});
const REX = person(3, 'Rex Hale', {
  otherBrand: true,
  notes: ['Other brand: Altura Overclock', 'On this card: Opener'],
});

const TEAM: RosterPickerTeam = {
  teamId: parseId('team', 'tem_0000000001'),
  name: 'The Hale Storm',
  memberNames: ['Kai Moreno', 'Rex Hale'],
  selectable: true,
  reason: null,
  otherBrand: true,
};

function renderPicker(overrides: Partial<RosterPickerProps> = {}) {
  const props: RosterPickerProps = {
    open: true,
    onClose: vi.fn(),
    title: 'Add to Side 1',
    people: [KAI, TIA, REX],
    teams: [TEAM],
    onSearchChange: vi.fn(),
    onPickPerson: vi.fn(),
    onPickTeam: vi.fn(),
    ...overrides,
  };
  render(<RosterPicker {...props} />);
  return props;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RosterPicker', () => {
  it('lists bookable people by default with their push, alignment and availability', () => {
    renderPicker();
    const list = screen.getByRole('listbox', { name: 'People' });
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Kai Moreno');
    expect(options[0]).toHaveTextContent('Mid card');
    expect(options[0]).toHaveTextContent('Face');
    expect(options[0]).toHaveTextContent('Available');
    expect(options[1]).toHaveTextContent('Other brand: Altura Overclock');
    expect(options[1]).toHaveTextContent('On this card: Opener');
    expect(screen.getByText(/1 more is hidden because they can’t be booked/)).toBeInTheDocument();
  });

  it('shows unbookable people dimmed with the reason, and never picks them', async () => {
    const user = userEvent.setup();
    const props = renderPicker();
    await user.click(screen.getByRole('button', { name: 'Bookable only' }));
    const tia = screen.getByRole('option', { name: /Tia Cruz/ });
    expect(tia).toHaveAttribute('aria-disabled', 'true');
    expect(tia).toHaveAccessibleDescription("Can't wrestle on this date: Injured (leg injury)");
    expect(tia).toHaveTextContent('Injured until 12 Feb');
    await user.click(tia);
    expect(props.onPickPerson).not.toHaveBeenCalled();
  });

  it('moves with the arrow keys and picks with Enter', async () => {
    const user = userEvent.setup();
    const props = renderPicker();
    const search = screen.getByRole('combobox', { name: 'Search by name' });
    await user.click(search);
    await user.keyboard('{ArrowDown}');
    expect(search).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: /Rex Hale/ }).id,
    );
    await user.keyboard('{Enter}');
    expect(props.onPickPerson).toHaveBeenCalledWith(REX);
  });

  it('narrows to this brand', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('button', { name: 'This brand' }));
    expect(screen.getByRole('button', { name: 'This brand' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('option', { name: /Rex Hale/ })).toBeNull();
  });

  it('lists teams and picks one', async () => {
    const user = userEvent.setup();
    const props = renderPicker();
    await user.click(screen.getByRole('button', { name: 'Teams' }));
    const team = screen.getByRole('option', { name: /The Hale Storm/ });
    expect(team).toHaveTextContent('Kai Moreno & Rex Hale');
    await user.click(team);
    expect(props.onPickTeam).toHaveBeenCalledWith(TEAM);
  });

  it('opens on the teams list when asked', () => {
    renderPicker({ initialMode: 'teams' });
    expect(screen.getByRole('listbox', { name: 'Teams' })).toBeInTheDocument();
  });

  it('searches once typing pauses', () => {
    vi.useFakeTimers();
    const props = renderPicker();
    const search = screen.getByRole('combobox', { name: 'Search by name' });
    act(() => {
      vi.advanceTimersByTime(ROSTER_SEARCH_DEBOUNCE_MS);
    });
    vi.mocked(props.onSearchChange).mockClear();
    act(() => {
      search.focus();
    });
    // Typed key by key, faster than the debounce.
    for (const text of ['K', 'Ka', 'Kai ']) {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          search,
          text,
        );
        search.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(ROSTER_SEARCH_DEBOUNCE_MS / 2);
      });
    }
    expect(props.onSearchChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(ROSTER_SEARCH_DEBOUNCE_MS);
    });
    expect(props.onSearchChange).toHaveBeenCalledTimes(1);
    expect(props.onSearchChange).toHaveBeenCalledWith('Kai');
  });

  it('hides people already booked elsewhere on the card until Hide booked is turned off', async () => {
    const user = userEvent.setup({ delay: null });
    const BOOKED = person(4, 'Mia Stone', {
      bookedElsewhere: true,
      notes: ['On this card: Opener'],
    });
    renderPicker({ people: [KAI, BOOKED], bookedFilter: true });
    const hideBooked = screen.getByRole('button', { name: 'Hide booked' });
    expect(hideBooked).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('option', { name: /Mia Stone/ })).not.toBeInTheDocument();
    expect(
      screen.getByText('1 already on this card is hidden. Turn off Hide booked to see them.'),
    ).toBeInTheDocument();

    await user.click(hideBooked);
    expect(screen.getByRole('option', { name: /Mia Stone/ })).toBeInTheDocument();
    expect(screen.getByText('On this card: Opener')).toBeInTheDocument();
  });

  it('hides a team with a member booked elsewhere, and says why the list is empty', async () => {
    const user = userEvent.setup({ delay: null });
    renderPicker({
      people: [person(4, 'Mia Stone', { bookedElsewhere: true })],
      teams: [{ ...TEAM, bookedElsewhere: true }],
      bookedFilter: true,
    });
    expect(screen.getByText(/Everyone left is already on this card/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Teams' }));
    expect(screen.queryByRole('option', { name: /The Hale Storm/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide booked' }));
    expect(screen.getByRole('option', { name: /The Hale Storm/ })).toBeInTheDocument();
  });

  it('has no Hide booked filter unless the screen asks for it', () => {
    renderPicker({ people: [person(4, 'Mia Stone', { bookedElsewhere: true })] });
    expect(screen.queryByRole('button', { name: 'Hide booked' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Mia Stone/ })).toBeInTheDocument();
  });

  it('says so when nobody matches', async () => {
    const user = userEvent.setup();
    renderPicker({ people: [TIA] });
    expect(screen.getByText('No people to list')).toBeInTheDocument();
    expect(screen.getByText(/Turn off Bookable only to see everyone/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bookable only' }));
    expect(screen.getByRole('option', { name: /Tia Cruz/ })).toBeInTheDocument();
  });
});
