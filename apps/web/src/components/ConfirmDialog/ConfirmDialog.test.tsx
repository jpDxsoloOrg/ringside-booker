import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SCROLL_LOCK_CLASS, Sheet } from '../Sheet';
import { CONFIRM_FALLBACK_ERROR, ConfirmDialog } from './ConfirmDialog';
import type { ConfirmDialogProps } from './ConfirmDialog';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type HarnessProps = Partial<Omit<ConfirmDialogProps, 'open' | 'onClose'>> & {
  readonly onClose?: () => void;
};

function ConfirmHarness({ onClose, onConfirm = () => undefined, ...dialogProps }: HarnessProps) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
        }}
      >
        Release worker
      </button>
      <ConfirmDialog
        title="Release this worker?"
        body="Their contract ends today and they join the free agents."
        confirmLabel="Release"
        {...dialogProps}
        onConfirm={onConfirm}
        open={isOpen}
        onClose={() => {
          onClose?.();
          setIsOpen(false);
        }}
      />
    </>
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Release worker' }));
  return screen.getByRole('alertdialog', { name: 'Release this worker?' });
}

function isScrollLocked(): boolean {
  return document.documentElement.classList.contains(SCROLL_LOCK_CLASS);
}

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    render(<ConfirmHarness />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('is an alert dialog named by its title and described by its body', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness />);

    const dialog = await openDialog(user);

    expect(dialog).toHaveAttribute('data-state', 'open');
    expect(dialog).toHaveAccessibleDescription(
      'Their contract ends today and they join the free agents.',
    );
  });

  it('focuses the confirm button first for the default tone', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness />);

    await openDialog(user);

    expect(screen.getByRole('button', { name: 'Release' })).toHaveFocus();
  });

  it('focuses Cancel first for the danger tone', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness tone="danger" />);

    const dialog = await openDialog(user);

    expect(dialog).toHaveAttribute('data-tone', 'danger');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('traps focus between its two buttons', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness />);

    await openDialog(user);
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    const confirmButton = screen.getByRole('button', { name: 'Release' });
    expect(confirmButton).toHaveFocus();

    await user.tab();
    expect(cancelButton).toHaveFocus();
    await user.tab();
    expect(confirmButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancelButton).toHaveFocus();
  });

  it('opens from the keyboard and Escape returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness tone="danger" />);
    const opener = screen.getByRole('button', { name: 'Release worker' });

    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alertdialog', { name: 'Release this worker?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('closes after onConfirm resolves and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const handleConfirm = vi.fn(() => pending.promise);
    render(<ConfirmHarness onConfirm={handleConfirm} />);
    const opener = screen.getByRole('button', { name: 'Release worker' });

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Release' }));

    expect(handleConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Release' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    pending.resolve();
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(opener).toHaveFocus();
  });

  it('closes straight away when onConfirm is synchronous', async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={handleConfirm} />);

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Release' }));

    expect(handleConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });

  it('stays open and shows the error when onConfirm rejects', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    const handleConfirm = vi.fn(() =>
      Promise.reject(new Error('The save slot is locked by another tab.')),
    );
    render(<ConfirmHarness tone="danger" onConfirm={handleConfirm} onClose={handleClose} />);

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Release' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The save slot is locked by another tab.',
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(handleClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Release' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('shows a fallback message when the rejection has none', async () => {
    const user = userEvent.setup();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test
    render(<ConfirmHarness onConfirm={() => Promise.reject(undefined)} />);

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Release' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(CONFIRM_FALLBACK_ERROR);
  });

  it('clears the error when the next attempt starts and closes when it succeeds', async () => {
    const user = userEvent.setup();
    const handleConfirm = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Try later.'))
      .mockResolvedValueOnce(undefined);
    render(<ConfirmHarness onConfirm={handleConfirm} />);

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Release' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try later.');

    await user.click(screen.getByRole('button', { name: 'Release' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });

  it('closes on Cancel and on Escape without confirming', async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={handleConfirm} />);

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await openDialog(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(handleConfirm).not.toHaveBeenCalled();
  });

  it('cannot be dismissed with Escape while the confirm is running', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    render(<ConfirmHarness onConfirm={() => pending.promise} />);

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Release' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    pending.resolve();
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });

  it('does not close on a backdrop click', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    render(<ConfirmHarness onClose={handleClose} />);

    const dialog = await openDialog(user);
    const backdrop = dialog.previousElementSibling;
    expect(backdrop).toBeInstanceOf(HTMLElement);
    if (!(backdrop instanceof HTMLElement)) return;
    await user.click(backdrop);

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('keeps the page locked when it closes on top of an open Sheet', async () => {
    const user = userEvent.setup();

    function SheetWithConfirm() {
      const [isSheetOpen, setIsSheetOpen] = useState(true);
      const [isConfirmOpen, setIsConfirmOpen] = useState(false);
      return (
        <Sheet
          open={isSheetOpen}
          onClose={() => {
            setIsSheetOpen(false);
          }}
          title="Worker details"
        >
          <button
            type="button"
            onClick={() => {
              setIsConfirmOpen(true);
            }}
          >
            Release
          </button>
          <ConfirmDialog
            open={isConfirmOpen}
            onClose={() => {
              setIsConfirmOpen(false);
            }}
            onConfirm={() => undefined}
            title="Release this worker?"
            body="This cannot be undone."
            confirmLabel="Release now"
            tone="danger"
          />
        </Sheet>
      );
    }

    render(<SheetWithConfirm />);
    const releaseButton = screen.getByRole('button', { name: 'Release' });
    expect(releaseButton).toHaveFocus();

    await user.click(releaseButton);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(isScrollLocked()).toBe(true);

    // Escape goes to the topmost dialog only: the confirm closes, the sheet stays.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Worker details' })).toBeInTheDocument();
    expect(isScrollLocked()).toBe(true);
    expect(releaseButton).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(isScrollLocked()).toBe(false);
  });
});
