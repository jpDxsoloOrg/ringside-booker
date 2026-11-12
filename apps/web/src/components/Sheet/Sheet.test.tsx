import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
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

/** The dimmed backdrop behind the sheet. Radix portals it, with the sheet, to the end of <body>. */
function getBackdrop(): HTMLElement {
  const backdrop = document.querySelector('[data-sheet-overlay]');
  if (!(backdrop instanceof HTMLElement)) throw new Error('The sheet backdrop is not rendered.');
  return backdrop;
}

function isScrollLocked(): boolean {
  return document.documentElement.classList.contains(SCROLL_LOCK_CLASS);
}

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    render(<SheetHarness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a modal dialog named by its title, portalled out of the page', async () => {
    const user = userEvent.setup();
    const { container } = render(<SheetHarness />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    const dialog = getDialog();
    expect(dialog).toHaveAttribute('data-state', 'open');
    expect(container.contains(dialog)).toBe(false);
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

  it('traps focus: Tab and Shift+Tab cycle inside the sheet', async () => {
    const user = userEvent.setup();
    render(<SheetHarness footer={<button type="button">Save</button>} />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));
    const closeButton = screen.getByRole('button', { name: 'Close' });
    const firstAction = screen.getByRole('button', { name: 'First action' });
    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(firstAction).toHaveFocus();

    await user.tab();
    expect(saveButton).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(saveButton).toHaveFocus();
  });

  it('opens from the keyboard and closes on Escape with focus back on the trigger', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);
    const trigger = screen.getByRole('button', { name: 'Open sheet' });

    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(getDialog()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'First action' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('opens and returns focus the same way under StrictMode', async () => {
    // StrictMode mounts, unmounts and remounts effects in development, which moves focus into the
    // sheet before the second run; the opener must still be the trigger, not the sheet's content.
    const user = userEvent.setup();
    render(
      <StrictMode>
        <SheetHarness />
      </StrictMode>,
    );
    const trigger = screen.getByRole('button', { name: 'Open sheet' });

    await user.click(trigger);
    expect(getDialog()).toHaveAttribute('data-state', 'open');
    expect(screen.getByRole('button', { name: 'First action' })).toHaveFocus();
    expect(isScrollLocked()).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(isScrollLocked()).toBe(false);
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

    await user.click(getBackdrop());
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
    fireEvent.click(getBackdrop());

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
    render(<SheetHarness side="left" size="lg" />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    expect(getDialog()).toHaveAttribute('data-side', 'left');
    expect(getDialog()).toHaveAttribute('data-size', 'lg');
    expect(getDialog().querySelector('.handle')).toBeNull();
  });

  it('opens from the bottom with a drag handle on a phone', async () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    const user = userEvent.setup();
    render(<SheetHarness side="right" />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    expect(getDialog()).toHaveAttribute('data-side', 'bottom');
    const handleBar = getDialog().querySelector('.handleBar');
    expect(handleBar).toHaveAttribute('aria-hidden', 'true');
    expect(handleBar?.querySelector('.handle')).toBeInstanceOf(HTMLElement);
  });

  it('fills a phone screen with no drag handle when phoneHeight is full', async () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    const user = userEvent.setup();
    render(
      <SheetHarness side="right" phoneHeight="full" footer={<button type="button">Save</button>} />,
    );

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    expect(getDialog()).toHaveAttribute('data-side', 'bottom');
    expect(getDialog()).toHaveAttribute('data-phone-height', 'full');
    expect(getDialog().querySelector('.handleBar')).toBeNull();
    expect(getDialog().querySelector('[data-sheet-footer]')).toHaveTextContent('Save');
  });

  it('ignores phoneHeight on desktop', async () => {
    const user = userEvent.setup();
    render(<SheetHarness side="right" phoneHeight="full" />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    expect(getDialog()).toHaveAttribute('data-side', 'right');
    expect(getDialog()).not.toHaveAttribute('data-phone-height');
  });

  it('stays open when the drag handle is tapped', async () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    const handleClose = vi.fn();
    const user = userEvent.setup();
    render(<SheetHarness onClose={handleClose} />);
    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    const handleBar = getDialog().querySelector('.handleBar');
    expect(handleBar).toBeInstanceOf(HTMLElement);
    if (!(handleBar instanceof HTMLElement)) return;
    await user.click(handleBar);

    expect(handleClose).not.toHaveBeenCalled();
    expect(getDialog()).toHaveAttribute('data-state', 'open');
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

  it('sets no inline styles beyond the pointer-events Radix uses to make it modal', async () => {
    const user = userEvent.setup();
    render(<SheetHarness footer={<button type="button">Save</button>} />);

    await user.click(screen.getByRole('button', { name: 'Open sheet' }));

    const sheetElements = [getBackdrop(), getDialog(), ...getDialog().querySelectorAll('*')];
    const styledElements = sheetElements.filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element.hasAttribute('style'),
    );
    const otherDeclarations = styledElements.flatMap((element) =>
      Array.from(element.style).filter((property) => property !== 'pointer-events'),
    );
    expect(otherDeclarations).toEqual([]);
  });
});
