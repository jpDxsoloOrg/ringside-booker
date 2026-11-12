import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../Button';
import { ConfirmDialog } from '../ConfirmDialog';
import { Sheet } from '../Sheet';
import { DropdownMenu } from './DropdownMenu';
import type { DropdownMenuEntry } from './DropdownMenu';

interface Handlers {
  readonly profile: () => void;
  readonly book: () => void;
  readonly titleShot: () => void;
  readonly release: () => void;
}

function menuItems(handlers: Handlers): readonly DropdownMenuEntry[] {
  return [
    {
      kind: 'item',
      id: 'profile',
      label: 'View profile',
      icon: 'users',
      onSelect: handlers.profile,
    },
    { kind: 'item', id: 'book', label: 'Book on next show', onSelect: handlers.book },
    {
      kind: 'item',
      id: 'title-shot',
      label: 'Give a title shot',
      disabled: true,
      onSelect: handlers.titleShot,
    },
    { kind: 'separator', id: 'danger-zone' },
    {
      kind: 'item',
      id: 'release',
      label: 'Release',
      tone: 'danger',
      onSelect: handlers.release,
    },
  ];
}

function renderMenu(): Handlers {
  const handlers: Handlers = {
    profile: vi.fn(),
    book: vi.fn(),
    titleShot: vi.fn(),
    release: vi.fn(),
  };
  render(
    <DropdownMenu
      label="Worker actions"
      trigger={<Button>Actions</Button>}
      items={menuItems(handlers)}
    />,
  );
  return handlers;
}

/** The trigger. While the menu is open the rest of the page is hidden from screen readers. */
function getTrigger(): HTMLElement {
  return screen.getByRole('button', { name: 'Actions', hidden: true });
}

function item(name: string): HTMLElement {
  return screen.getByRole('menuitem', { name });
}

async function openWithKeyboard(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.tab();
  expect(getTrigger()).toHaveFocus();
  await user.keyboard('{Enter}');
}

/** A row menu whose items open a Sheet and a ConfirmDialog, as roster rows will. */
function MenuWithOverlays() {
  const [openOverlay, setOpenOverlay] = useState<'sheet' | 'confirm' | null>(null);
  const closeOverlay = () => {
    setOpenOverlay(null);
  };
  return (
    <>
      <DropdownMenu
        trigger={<Button>Actions</Button>}
        items={[
          {
            kind: 'item',
            id: 'details',
            label: 'Details',
            onSelect: () => {
              setOpenOverlay('sheet');
            },
          },
          {
            kind: 'item',
            id: 'release',
            label: 'Release',
            tone: 'danger',
            onSelect: () => {
              setOpenOverlay('confirm');
            },
          },
        ]}
      />
      <Sheet open={openOverlay === 'sheet'} onClose={closeOverlay} title="Worker details">
        <button type="button">Inner action</button>
      </Sheet>
      <ConfirmDialog
        open={openOverlay === 'confirm'}
        onClose={closeOverlay}
        onConfirm={() => undefined}
        title="Release this worker?"
        body="Their contract ends today."
        confirmLabel="Release"
        tone="danger"
      />
    </>
  );
}

describe('DropdownMenu', () => {
  it('marks the trigger as opening a menu', () => {
    renderMenu();
    expect(getTrigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens from the keyboard with the first item focused', async () => {
    const user = userEvent.setup();
    renderMenu();

    await openWithKeyboard(user);

    expect(screen.getByRole('menu', { name: 'Worker actions' })).toBeInTheDocument();
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => {
      expect(item('View profile')).toHaveFocus();
    });
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('moves with the arrow keys, skipping disabled items and wrapping at the ends', async () => {
    const user = userEvent.setup();
    renderMenu();
    await openWithKeyboard(user);
    await waitFor(() => {
      expect(item('View profile')).toHaveFocus();
    });

    await user.keyboard('{ArrowDown}');
    expect(item('Book on next show')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Release')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('View profile')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(item('Release')).toHaveFocus();

    await user.keyboard('{Home}');
    expect(item('View profile')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('Release')).toHaveFocus();
  });

  it('jumps to an item by its first letter', async () => {
    const user = userEvent.setup();
    renderMenu();
    await openWithKeyboard(user);
    await waitFor(() => {
      expect(item('View profile')).toHaveFocus();
    });

    await user.keyboard('r');
    expect(item('Release')).toHaveFocus();
  });

  it('runs the item on Enter, closes, and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const handlers = renderMenu();
    await openWithKeyboard(user);
    await waitFor(() => {
      expect(item('View profile')).toHaveFocus();
    });

    await user.keyboard('{ArrowDown}{Enter}');

    expect(handlers.book).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => {
      expect(getTrigger()).toHaveFocus();
    });
  });

  it('closes on Escape without running anything', async () => {
    const user = userEvent.setup();
    const handlers = renderMenu();
    await openWithKeyboard(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).toBeNull();
    for (const handler of Object.values(handlers)) {
      expect(handler).not.toHaveBeenCalled();
    }
    await waitFor(() => {
      expect(getTrigger()).toHaveFocus();
    });
  });

  it('opens on click and runs an item on click', async () => {
    const user = userEvent.setup();
    const handlers = renderMenu();

    await user.click(getTrigger());
    await user.click(item('Release'));

    expect(handlers.release).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not run a disabled item', async () => {
    const user = userEvent.setup();
    const handlers = renderMenu();

    await user.click(getTrigger());
    const disabledItem = item('Give a title shot');
    expect(disabledItem).toHaveAttribute('aria-disabled', 'true');
    await user.click(disabledItem);

    expect(handlers.titleShot).not.toHaveBeenCalled();
  });

  it('opens a submenu with the right arrow and runs its item', async () => {
    const user = userEvent.setup();
    const onDraw = vi.fn();
    render(
      <DropdownMenu
        label="Segment actions"
        trigger={<Button>Actions</Button>}
        items={[
          { kind: 'item', id: 'edit', label: 'Edit', onSelect: vi.fn() },
          {
            kind: 'submenu',
            id: 'winner',
            label: 'Winner',
            items: [
              { kind: 'item', id: 'side-1', label: 'Side 1', onSelect: vi.fn() },
              { kind: 'item', id: 'draw', label: 'Draw', onSelect: onDraw },
            ],
          },
        ]}
      />,
    );

    getTrigger().focus();
    await user.keyboard('{Enter}');
    const winner = await screen.findByRole('menuitem', { name: 'Winner' });
    expect(winner).toHaveAttribute('aria-haspopup', 'menu');
    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(winner).toHaveFocus();
    });
    await user.keyboard('{ArrowRight}');
    await user.click(await screen.findByRole('menuitem', { name: 'Draw' }));

    expect(onDraw).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it('names the menu after its trigger when no label is given', async () => {
    const user = userEvent.setup();
    render(<MenuWithOverlays />);

    await user.click(getTrigger());

    expect(screen.getByRole('menu', { name: 'Actions' })).toBeInTheDocument();
  });

  it('returns focus to the trigger after a Sheet opened from an item closes', async () => {
    const user = userEvent.setup();
    render(<MenuWithOverlays />);

    await openWithKeyboard(user);
    await waitFor(() => {
      expect(item('Details')).toHaveFocus();
    });
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Worker details' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Inner action' })).toHaveFocus();
    });

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getTrigger()).toHaveFocus();
  });

  it('returns focus to the trigger after a ConfirmDialog opened from an item closes', async () => {
    const user = userEvent.setup();
    render(<MenuWithOverlays />);

    await user.click(getTrigger());
    await user.click(item('Release'));
    expect(screen.getByRole('alertdialog', { name: 'Release this worker?' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(getTrigger()).toHaveFocus();
  });
});
