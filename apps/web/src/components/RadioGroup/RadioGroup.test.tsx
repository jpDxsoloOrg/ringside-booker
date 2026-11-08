import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RadioGroup } from './RadioGroup';
import type { RadioOption } from './RadioGroup';

type Pace = 'slow' | 'normal' | 'fast';

const PACE_OPTIONS: readonly RadioOption<Pace>[] = [
  { value: 'slow', label: 'Slow', description: 'One day at a time.' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast', preview: <span data-testid="fast-preview">»</span> },
];

function ControlledPace({ onChange }: { readonly onChange?: (pace: Pace) => void }) {
  const [pace, setPace] = useState<Pace>('normal');
  return (
    <RadioGroup
      legend="Pace"
      description="How quickly days pass."
      options={PACE_OPTIONS}
      value={pace}
      onValueChange={(next) => {
        setPace(next);
        onChange?.(next);
      }}
    />
  );
}

describe('RadioGroup', () => {
  it('is a group named by its legend, with one radio per option', () => {
    render(<ControlledPace />);

    const group = screen.getByRole('group', { name: 'Pace' });
    expect(group).toHaveAccessibleDescription('How quickly days pass.');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Normal' })).toBeChecked();
  });

  it('names each radio by its label and describes it by its description', () => {
    render(<ControlledPace />);

    expect(screen.getByRole('radio', { name: 'Slow' })).toHaveAccessibleDescription(
      'One day at a time.',
    );
  });

  it('hides previews from screen readers', () => {
    render(<ControlledPace />);

    expect(screen.getByTestId('fast-preview').parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('picks an option on click, including a click on its text', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<ControlledPace onChange={handleChange} />);

    await user.click(screen.getByText('One day at a time.'));
    expect(screen.getByRole('radio', { name: 'Slow' })).toBeChecked();
    expect(handleChange).toHaveBeenLastCalledWith('slow');
  });

  it('moves and picks with the arrow keys', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<ControlledPace onChange={handleChange} />);

    await user.tab();
    expect(screen.getByRole('radio', { name: 'Normal' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Fast' })).toBeChecked();
    expect(handleChange).toHaveBeenLastCalledWith('fast');
  });

  it('can be disabled as a whole', () => {
    render(
      <RadioGroup
        legend="Pace"
        options={PACE_OPTIONS}
        value="slow"
        onValueChange={() => undefined}
        disabled
      />,
    );

    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
  });
});
