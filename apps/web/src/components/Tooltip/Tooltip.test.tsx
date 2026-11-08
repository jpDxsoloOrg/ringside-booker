import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button, IconButton } from '../Button';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('renders only the trigger until it is wanted', () => {
    render(
      <Tooltip content="Advance one day">
        <IconButton icon="fast-forward" label="Next day" />
      </Tooltip>,
    );

    expect(screen.getByRole('button', { name: 'Next day' })).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows at once on keyboard focus, describes the trigger, and hides on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Advance one day">
        <IconButton icon="fast-forward" label="Next day" />
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Next day' });

    await user.tab();
    expect(trigger).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Advance one day');
    expect(trigger).toHaveAccessibleDescription('Advance one day');

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
    expect(trigger).toHaveFocus();
  });

  it('shows on hover after the delay and hides on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Shown on the right" side="right" delayMs={0}>
        <Button>Hint</Button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Hint' });

    await user.hover(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Shown on the right');

    // Moving away is checked in a real browser (gallery e2e): jsdom has no layout for Radix's
    // pointer grace area between the trigger and the tooltip.
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
  });
});
