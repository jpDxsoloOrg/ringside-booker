import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';
import type { SelectOption } from './Select';

const MATCH_TYPES: readonly SelectOption[] = [
  { value: 'singles', label: 'Singles' },
  { value: 'tag', label: 'Tag team' },
  { value: 'cage', label: 'Steel cage', disabled: true },
  { value: 'ladder', label: 'Ladder' },
];

function ControlledSelect({ onChange }: { readonly onChange: (value: string) => void }) {
  const [matchType, setMatchType] = useState('singles');
  return (
    <Select
      label="Match type"
      options={MATCH_TYPES}
      value={matchType}
      onValueChange={(nextValue) => {
        onChange(nextValue);
        setMatchType(nextValue);
      }}
    />
  );
}

function getField(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Match type' });
}

describe('Select', () => {
  it('is a combobox named by its label, showing the chosen option', () => {
    render(<ControlledSelect onChange={vi.fn()} />);

    expect(getField()).toHaveTextContent('Singles');
    expect(getField()).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the placeholder while nothing is chosen', () => {
    render(<Select label="Show size" options={MATCH_TYPES} placeholder="Pick a size" />);

    expect(screen.getByRole('combobox', { name: 'Show size' })).toHaveTextContent('Pick a size');
  });

  it('opens from the keyboard, moves past disabled options, and picks with Enter', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<ControlledSelect onChange={handleChange} />);

    await user.tab();
    expect(getField()).toHaveFocus();
    await user.keyboard('{Enter}');

    const listbox = await screen.findByRole('listbox');
    expect(listbox).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Singles' })).toHaveFocus();
    });

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Tag team' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Ladder' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(handleChange).toHaveBeenCalledWith('ladder');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(getField()).toHaveTextContent('Ladder');
    await waitFor(() => {
      expect(getField()).toHaveFocus();
    });
  });

  it('closes on Escape without changing the value', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<ControlledSelect onChange={handleChange} />);

    await user.tab();
    await user.keyboard('{ArrowDown}');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Escape}');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(handleChange).not.toHaveBeenCalled();
    expect(getField()).toHaveTextContent('Singles');
  });

  it('does nothing while disabled', async () => {
    const user = userEvent.setup();
    render(<Select label="Locked" options={MATCH_TYPES} defaultValue="tag" disabled />);
    const field = screen.getByRole('combobox', { name: 'Locked' });

    expect(field).toBeDisabled();
    await user.click(field);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps a hidden label for screen readers', () => {
    render(<Select label="Sort roster by" hideLabel options={MATCH_TYPES} defaultValue="tag" />);

    expect(screen.getByRole('combobox', { name: 'Sort roster by' })).toHaveTextContent('Tag team');
  });
});
