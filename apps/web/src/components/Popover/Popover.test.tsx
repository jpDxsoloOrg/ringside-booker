import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../Button';
import { Popover } from './Popover';

function getTrigger(): HTMLElement {
  return screen.getByRole('button', { name: 'Attendance breakdown' });
}

function DetailPopover() {
  return (
    <>
      <Popover trigger={<Button>Attendance breakdown</Button>} title="Attendance">
        <p>Capped by the venue at 3,400.</p>
      </Popover>
      <button type="button">Elsewhere</button>
    </>
  );
}

describe('Popover', () => {
  it('opens from its trigger as a dialog named by its title', async () => {
    const user = userEvent.setup();
    render(<DetailPopover />);
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(getTrigger());

    const popover = screen.getByRole('dialog', { name: 'Attendance' });
    expect(popover).toHaveTextContent('Capped by the venue at 3,400.');
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'true');
    expect(getTrigger()).toHaveAttribute('aria-controls', popover.id);
  });

  it('opens from the keyboard, focusing the popover, and Escape returns focus', async () => {
    const user = userEvent.setup();
    render(<DetailPopover />);

    await user.tab();
    expect(getTrigger()).toHaveFocus();
    await user.keyboard('{Enter}');

    const popover = screen.getByRole('dialog', { name: 'Attendance' });
    expect(popover).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(getTrigger()).toHaveFocus();
    });
  });

  it('focuses the first control in the body, not the Close button', async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<Button>Filters</Button>} title="Filters">
        <label>
          <input type="checkbox" /> Injured workers
        </label>
      </Popover>,
    );

    await user.click(screen.getByRole('button', { name: 'Filters' }));

    expect(screen.getByRole('checkbox', { name: 'Injured workers' })).toHaveFocus();
  });

  it('closes from its Close button and on a click outside', async () => {
    const user = userEvent.setup();
    render(<DetailPopover />);

    await user.click(getTrigger());
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(getTrigger());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('follows open and reports changes when controlled', async () => {
    const user = userEvent.setup();
    const handleOpenChange = vi.fn();

    function ControlledPopover() {
      const [isOpen, setIsOpen] = useState(true);
      return (
        <Popover
          open={isOpen}
          onOpenChange={(nextOpen) => {
            handleOpenChange(nextOpen);
            setIsOpen(nextOpen);
          }}
          trigger={<Button>Filters</Button>}
          title="Filters"
        >
          <p>Body</p>
        </Popover>
      );
    }

    render(<ControlledPopover />);
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(handleOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
