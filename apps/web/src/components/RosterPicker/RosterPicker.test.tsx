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

  it('shows type and stats as visible text, with full names for screen readers', () => {
    const stats = (popularity: number, stamina: number) => [
      { key: 'popularity', short: 'Pop', label: 'Popularity in Greater Lakes', value: popularity },
      { key: 'stamina', short: 'Stamina', label: 'Stamina', value: stamina },
    ];
    renderPicker({
      people: [
        { ...KAI, typeLabel: 'High flyer', stats: stats(54, 72) },
        { ...REX, typeLabel: 'Powerhouse', stats: stats(61, 58) },
      ],
      statsNote: 'Pop: popularity in Greater Lakes, where this show is.',
    });
    const list = screen.getByRole('listbox', { name: 'People' });
    const kai = within(list).getByRole('option', { name: /Kai Moreno/ });
    expect(within(kai).getByText('High flyer')).toBeVisible();
    expect(within(kai).getByText('Pop')).toHaveAttribute('aria-hidden', 'true');
    expect(kai).toHaveAccessibleName(
      expect.stringContaining('High flyer , Popularity in Greater Lakes 54 , Stamina 72'),
    );
    expect(
      screen.getByText('Pop: popularity in Greater Lakes, where this show is.'),
    ).toBeInTheDocument();
  });

  it('sorts people by a stat, highest first, while the chip is on', async () => {
    const user = userEvent.setup({ delay: null });
    const pop = (value: number) => [{ key: 'popularity', short: 'Pop', label: 'Pop', value }];
    renderPicker({
      people: [{ ...KAI, stats: pop(40) }, { ...REX, stats: pop(70) }, person(4, 'Jo Park')],
      sortStat: { key: 'popularity', label: 'Most popular' },
    });
    const list = screen.getByRole('listbox', { name: 'People' });
    const names = () =>
      within(list)
        .getAllByRole('option')
        .map((option) => option.querySelector('[class*="rowName"]')?.textContent);
    expect(names()).toEqual(['Kai Moreno', 'Rex Hale', 'Jo Park']);
    const chip = screen.getByRole('button', { name: 'Most popular' });
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    // Someone without the stat goes last.
    expect(names()).toEqual(['Rex Hale', 'Kai Moreno', 'Jo Park']);
    await user.click(chip);
    expect(names()).toEqual(['Kai Moreno', 'Rex Hale', 'Jo Park']);
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

  describe('gender and push', () => {
    const ANA = person(5, 'Ana Ruiz', { gender: 'female', push: 'mainEvent' });
    const BEN = person(6, 'Ben Cole', { gender: 'male', push: 'midCard' });
    const CAL = person(7, 'Cal Dune', { gender: 'nonBinary', push: 'lowerCard' });
    const DEE = person(8, 'Dee Marsh', { gender: 'female', push: 'lowerCard' });
    const MIXED: RosterPickerTeam = {
      ...TEAM,
      teamId: parseId('team', 'tem_0000000002'),
      name: 'Odd Couple',
      memberNames: ['Ana Ruiz', 'Ben Cole'],
      memberGenders: ['female', 'male'],
      memberPushes: ['mainEvent', 'midCard'],
      otherBrand: false,
    };
    const SISTERS: RosterPickerTeam = {
      ...MIXED,
      teamId: parseId('team', 'tem_0000000003'),
      name: 'The Sisters',
      memberNames: ['Ana Ruiz', 'Dee Marsh'],
      memberGenders: ['female', 'female'],
      memberPushes: ['mainEvent', 'lowerCard'],
    };
    const names = () =>
      screen
        .getAllByRole('option')
        .map((option) => option.querySelector('[class*="rowName"]')?.textContent);

    function renderFiltered(overrides: Partial<RosterPickerProps> = {}) {
      return renderPicker({
        people: [ANA, BEN, CAL, DEE],
        teams: [MIXED, SISTERS],
        genderAndPushFilters: true,
        ...overrides,
      });
    }

    it('shows each person’s gender in words first on the stats line', () => {
      renderFiltered({ people: [{ ...ANA, typeLabel: 'Technician' }, BEN, CAL] });
      const ana = screen.getByRole('option', { name: /Ana Ruiz/ });
      expect(within(ana).getByText('Woman')).toBeVisible();
      expect(ana).toHaveAccessibleName(expect.stringContaining('Woman , Technician'));
      expect(screen.getByRole('option', { name: /Ben Cole/ })).toHaveTextContent('Man');
      expect(screen.getByRole('option', { name: /Cal Dune/ })).toHaveTextContent('Non-binary');
    });

    it('says a team is Mixed when its members differ, and names the gender when they match', async () => {
      const user = userEvent.setup({ delay: null });
      renderFiltered();
      await user.click(screen.getByRole('button', { name: 'Teams' }));
      expect(screen.getByRole('option', { name: /Odd Couple/ })).toHaveTextContent('Mixed');
      expect(screen.getByRole('option', { name: /The Sisters/ })).toHaveTextContent('Women');
    });

    it('narrows by gender, counts who it hides, and keeps teams whose members all match', async () => {
      const user = userEvent.setup({ delay: null });
      renderFiltered();
      const chip = screen.getByRole('button', { name: 'Gender' });
      await user.click(chip);
      const menu = await screen.findByRole('dialog', { name: 'Show by gender' });
      expect(
        within(menu)
          .getAllByRole('radio')
          .map((radio) => radio.closest('label')?.textContent),
      ).toEqual(['All', 'Men', 'Women', 'Non-binary']);
      await user.click(within(menu).getByRole('radio', { name: 'Women' }));
      expect(screen.getByRole('button', { name: 'Gender: Women' })).toBeInTheDocument();
      expect(names()).toEqual(['Ana Ruiz', 'Dee Marsh']);
      expect(
        screen.getByText('2 more are hidden by the Gender or Push filter.'),
      ).toBeInTheDocument();

      await user.keyboard('{Escape}');
      await user.click(screen.getByRole('button', { name: 'Teams' }));
      expect(names()).toEqual(['The Sisters']);
      expect(
        screen.getByText('1 more is hidden by the Gender or Push filter.'),
      ).toBeInTheDocument();
    });

    it('narrows by one or more pushes, and a team matches when any member does', async () => {
      const user = userEvent.setup({ delay: null });
      renderFiltered();
      await user.click(screen.getByRole('button', { name: 'Push' }));
      const menu = await screen.findByRole('dialog', { name: 'Show by push' });
      for (const push of ['Main event', 'Upper card', 'Mid card', 'Enhancement', 'None']) {
        await user.click(within(menu).getByRole('checkbox', { name: push }));
      }
      expect(screen.getByRole('button', { name: 'Push: Lower card' })).toBeInTheDocument();
      expect(names()).toEqual(['Cal Dune', 'Dee Marsh']);
      await user.click(within(menu).getByRole('checkbox', { name: 'Mid card' }));
      expect(screen.getByRole('button', { name: 'Push: 2 chosen' })).toBeInTheDocument();
      expect(names()).toEqual(['Ben Cole', 'Cal Dune', 'Dee Marsh']);

      await user.keyboard('{Escape}');
      await user.click(screen.getByRole('button', { name: 'Teams' }));
      // Both teams have a member at Mid card or Lower card.
      expect(names()).toEqual(['Odd Couple', 'The Sisters']);

      await user.click(screen.getByRole('button', { name: 'Push: 2 chosen' }));
      await user.click(
        within(await screen.findByRole('dialog', { name: 'Show by push' })).getByRole('button', {
          name: 'Show every push',
        }),
      );
      expect(screen.getByRole('button', { name: 'Push' })).toBeInTheDocument();
    });

    it('combines with the other filters and says how to see more when nobody is left', async () => {
      const user = userEvent.setup({ delay: null });
      renderFiltered({
        people: [ANA, { ...DEE, selectable: false, reason: 'Injured' }, BEN],
      });
      await user.click(screen.getByRole('button', { name: 'Gender' }));
      await user.click(
        within(await screen.findByRole('dialog', { name: 'Show by gender' })).getByRole('radio', {
          name: 'Women',
        }),
      );
      // Dee is hidden by Bookable only and Ben by Gender: each counted once, under its own filter.
      expect(names()).toEqual(['Ana Ruiz']);
      expect(screen.getByText(/1 more is hidden because they can’t be booked/)).toBeInTheDocument();
      expect(
        screen.getByText('1 more is hidden by the Gender or Push filter.'),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('radio', { name: 'Men' }));
      // A click outside closes the menu; the choice stays.
      await user.click(screen.getByRole('button', { name: 'Bookable only' }));
      expect(names()).toEqual(['Ben Cole']);
      await user.click(screen.getByRole('button', { name: 'Gender: Men' }));
      await user.click(
        within(await screen.findByRole('dialog', { name: 'Show by gender' })).getByRole('radio', {
          name: 'Non-binary',
        }),
      );
      expect(screen.getByText('Change the Gender or Push filter to see more.')).toBeInTheDocument();
    });

    it('never stops anyone being picked: a filter only narrows the list', async () => {
      const user = userEvent.setup({ delay: null });
      const props = renderFiltered();
      await user.click(screen.getByRole('option', { name: /Ben Cole/ }));
      await user.click(screen.getByRole('option', { name: /Ana Ruiz/ }));
      expect(props.onPickPerson).toHaveBeenCalledTimes(2);
    });

    it('has no Gender or Push filter unless the screen asks for it', () => {
      renderPicker({ people: [ANA, BEN] });
      expect(screen.queryByRole('button', { name: /^Gender/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Push/ })).not.toBeInTheDocument();
      expect(names()).toEqual(['Ana Ruiz', 'Ben Cole']);
    });
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
