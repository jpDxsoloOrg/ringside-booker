import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AT_MAX_REASON, LevelStepper } from './LevelStepper';
import type { LevelStepperProps } from './LevelStepper';

function renderStepper(props: Partial<LevelStepperProps> = {}) {
  const onRequestChange = vi.fn();
  const view = render(
    <LevelStepper label="Camera" level={4} onRequestChange={onRequestChange} {...props} />,
  );
  return { ...view, onRequestChange, user: userEvent.setup({ delay: null }) };
}

function group(): HTMLElement {
  return screen.getByRole('group', { name: 'Camera level' });
}

describe('LevelStepper', () => {
  it('shows the level on a meter, in words, inside a named group', () => {
    renderStepper();
    const meter = within(group()).getByRole('meter', { name: 'Camera level' });
    expect(meter).toHaveAttribute('aria-valuenow', '4');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '10');
    expect(meter).toHaveAttribute('aria-valuetext', 'Level 4 of 10');
    expect(group()).toHaveAccessibleDescription('Level 4 of 10');
    expect(meter.querySelectorAll('[data-filled="true"]')).toHaveLength(4);
  });

  it('asks for the level one below and one above', async () => {
    const { user, onRequestChange } = renderStepper();
    await user.click(screen.getByRole('button', { name: 'Lower Camera' }));
    await user.click(screen.getByRole('button', { name: 'Raise Camera' }));
    expect(onRequestChange.mock.calls).toEqual([[3], [5]]);
  });

  it('moves focus from − to + with the Tab key', async () => {
    const { user } = renderStepper();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Lower Camera' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Raise Camera' })).toHaveFocus();
  });

  it('holds + back at the top and says why on focus', async () => {
    const { user, onRequestChange } = renderStepper({ level: 10 });
    const raise = screen.getByRole('button', { name: 'Raise Camera' });
    expect(raise).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Lower Camera' })).not.toHaveAttribute(
      'aria-disabled',
    );
    await user.tab();
    await user.tab();
    expect(raise).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(AT_MAX_REASON);
    await user.click(raise);
    expect(onRequestChange).not.toHaveBeenCalled();
  });

  it('holds − back at the floor with the floor reason', async () => {
    const reason = 'Your TV deal needs camera at 3 or higher';
    const { user, onRequestChange } = renderStepper({ level: 3, min: 3, minReason: reason });
    const lower = screen.getByRole('button', { name: 'Lower Camera' });
    expect(lower).toHaveAttribute('aria-disabled', 'true');
    await user.tab();
    expect(lower).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(reason);
    await user.click(lower);
    expect(onRequestChange).not.toHaveBeenCalled();
  });

  it('holds both buttons back while disabled', async () => {
    const { user, onRequestChange } = renderStepper({
      disabled: true,
      disabledReason: 'Saving the change',
    });
    for (const name of ['Lower Camera', 'Raise Camera']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      await user.click(button);
    }
    expect(onRequestChange).not.toHaveBeenCalled();
  });

  it('updates aria-valuenow when the level changes', () => {
    const { rerender, onRequestChange } = renderStepper({ level: 2 });
    rerender(<LevelStepper label="Camera" level={7} onRequestChange={onRequestChange} />);
    expect(within(group()).getByRole('meter')).toHaveAttribute('aria-valuenow', '7');
  });
});
