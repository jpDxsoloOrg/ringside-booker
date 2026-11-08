import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { setMatchMedia } from '@/test/matchMedia';
import { Sheet } from './Sheet';
import type { SheetProps } from './Sheet';
import { SCROLL_LOCK_CLASS } from './useBodyScrollLock';

type HarnessProps = Partial<Omit<SheetProps, 'open' | 'onClose' | 'children'>> & {
  readonly children?: ReactNode;
  readonly onClose?: () => void;
};

/** A trigger button and a sheet it opens, the way a screen uses it. */
function SheetHarness({
  children,
  onClose,
  title = 'Worker details',
  ...sheetProps
}: HarnessProps) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
        }}
      >
        Open sheet
      </button>
      <Sheet
        {...sheetProps}
        title={title}
        open={isOpen}
        onClose={() => {
          onClose?.();
          setIsOpen(false);
        }}
      >
        {children ?? <button type="button">First action</button>}
      </Sheet>
    </>
  );
}

function getDialog(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Worker details' });
}

function isScrollLocked(): boolean {
  return document.documentElement.classList.contains(SCROLL_LOCK_CLASS);
}

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    render(<SheetHarness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a modal dialog named by its title', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    const dialog = getDialog();
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByRole('heading', { level: 2, name: 'Worker details' })).toBeInTheDocument();
  });

  it('focuses the first focusable element in the content when it opens', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    expect(screen.getByRole('button', { name: 'First action' })).toHaveFocus();
  });

  it('focuses the footer when the content has nothing focusable', async () => {
    const user = userEvent.setup();
    render(
      <SheetHarness footer={<button type="button">Save</button>}>
        <p>Read-only notes.</p>
      </SheetHarness>,
    );

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
  });

  it('focuses the title when nothing in the content or footer can take focus', async () => {
    const user = userEvent.setup();
    render(
      <SheetHarness>
        <p>Read-only notes.</p>
      </SheetHarness>,
    );

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    expect(screen.getByRole('heading', { name: 'Worker details' })).toHaveFocus();
  });

  it('calls onClose on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    render(<SheetHarness onClose={handleClose} />);
    const trigger = screen.getByRole('button', { name: 'Open sheet' });

    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes from the Close button and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);
    const trigger = screen.getByRole('button', { name: 'Open sheet' });

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes on a backdrop click but not on a click inside', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    render(
      <SheetHarness onClose={handleClose}>
        <p>Body text</p>
      </SheetHarness>,
    );

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));
    await user.click(screen.getByText('Body text'));
    expect(handleClose).not.toHaveBeenCalled();

    // A backdrop click reaches the <dialog> element itself.
    await user.click(getDialog());
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a press that starts inside and ends on the backdrop', async () => {
    const handleClose = vi.fn();
    const user = userEvent.setup();
    render(
      <SheetHarness onClose={handleClose}>
        <p>Body text</p>
      </SheetHarness>,
    );
    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    fireEvent.pointerDown(screen.getByText('Body text'));
    fireEvent.click(getDialog());

    expect(handleClose).not.toHaveBeenCalled();
  });

  it('renders the footer below the body', async () => {
    const user = userEvent.setup();
    render(<SheetHarness footer={<button type="button">Save</button>} />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    const footer = screen.getByRole('button', { name: 'Save' }).closest('[data-sheet-footer]');
    expect(footer).toBeInstanceOf(HTMLElement);
    expect(getDialog().contains(footer)).toBe(true);
  });

  it('locks page scroll while open', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));
    expect(isScrollLocked()).toBe(true);

    await user.keyboard('{Escape}');
    expect(isScrollLocked()).toBe(false);
  });

  it('sits on the requested side on desktop, with no drag handle', async () => {
    const user = userEvent.setup();
    const { container } = render(<SheetHarness side="left" size="lg" />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    expect(getDialog()).toHaveAttribute('data-side', 'left');
    expect(getDialog()).toHaveAttribute('data-size', 'lg');
    expect(container.querySelector('.handle')).toBeNull();
  });

  it('opens from the bottom with a drag handle on a phone', async () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    const user = userEvent.setup();
    const { container } = render(<SheetHarness side="right" />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    expect(getDialog()).toHaveAttribute('data-side', 'bottom');
    expect(container.querySelector('.handle')).toHaveAttribute('aria-hidden', 'true');
  });

  it('switches to a bottom sheet when the window narrows while open', async () => {
    const user = userEvent.setup();
    render(<SheetHarness side="right" />);
    await user.click(screen.getByRole('button', { name: 'Open sheet' }));
    expect(getDialog()).toHaveAttribute('data-side', 'right');

    act(() => {
      setMatchMedia((query) => query === BP_MOBILE_QUERY);
    });

    expect(getDialog()).toHaveAttribute('data-side', 'bottom');
  });

  it('keeps its side on a phone when responsiveSide is off', async () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    const user = userEvent.setup();
    render(<SheetHarness side="left" responsiveSide={false} />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    expect(getDialog()).toHaveAttribute('data-side', 'left');
  });

  it('sets no inline styles', async () => {
    const user = userEvent.setup();
    render(<SheetHarness footer={<button type="button">Save</button>} />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    expect(document.querySelectorAll('[style]')).toHaveLength(0);
  });
});
