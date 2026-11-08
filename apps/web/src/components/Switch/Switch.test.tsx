import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

describe('Switch', () => {
  it('is a switch named by its label and described by its description', () => {
    render(<Switch label="Autosave" description="Saves after every day you advance." />);

    const toggle = screen.getByRole('switch', { name: 'Autosave' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription('Saves after every day you advance.');
  });

  it('toggles on click, on its label, and with Space', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<Switch label="Pause on injuries" onCheckedChange={handleChange} />);
    const toggle = screen.getByRole('switch', { name: 'Pause on injuries' });

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByText('Pause on injuries'));
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.tab();
    await user.tab({ shift: true });
    toggle.focus();
    await user.keyboard('[Space]');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(handleChange.mock.calls).toEqual([[true], [false], [true]]);
  });

  it('follows checked when controlled', async () => {
    const user = userEvent.setup();

    function ControlledSwitch() {
      const [isOn, setIsOn] = useState(true);
      return (
        <>
          <p>{isOn ? 'On' : 'Off'}</p>
          <Switch label="Autosave" checked={isOn} onCheckedChange={setIsOn} />
        </>
      );
    }

    render(<ControlledSwitch />);
    const toggle = screen.getByRole('switch', { name: 'Autosave' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('cannot be toggled while disabled', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<Switch label="Level playing field" disabled onCheckedChange={handleChange} />);
    const toggle = screen.getByRole('switch', { name: 'Level playing field' });

    expect(toggle).toBeDisabled();
    await user.click(toggle);
    expect(handleChange).not.toHaveBeenCalled();
  });
});
