import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseGameDate } from '@ringside/engine';
import type { GameDate } from '@ringside/engine';
import {
  nextMonthStart,
  parseSkipLength,
  SKIP_LENGTH_MESSAGE,
  SKIP_LENGTH_STORAGE_KEY,
  SkipDaysSheet,
} from './SkipDaysSheet';

const LAST_OF_JANUARY = parseGameDate('2031-01-31');

function renderSheet(today: GameDate = LAST_OF_JANUARY) {
  const onStart = vi.fn();
  const onClose = vi.fn();
  const { unmount } = render(
    <SkipDaysSheet open today={today} onStart={onStart} onClose={onClose} />,
  );
  return { onStart, onClose, unmount, user: userEvent.setup() };
}

function lengthInput(): HTMLElement {
  return screen.getByLabelText('Days to skip');
}

function startButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Start' });
}

async function typeLength(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.clear(lengthInput());
  await user.type(lengthInput(), text);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('SkipDaysSheet length', () => {
  it.each(['0', '3651'])('rejects %s days with the validation message', async (text) => {
    const { user, onStart } = renderSheet();

    await typeLength(user, text);

    expect(screen.getByText(SKIP_LENGTH_MESSAGE)).toBeInTheDocument();
    expect(lengthInput()).toHaveAttribute('aria-invalid', 'true');
    expect(startButton()).toBeDisabled();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('accepts the ends of the range', async () => {
    const { user } = renderSheet();
    for (const text of ['1', '3650']) {
      await typeLength(user, text);
      expect(screen.queryByText(SKIP_LENGTH_MESSAGE)).toBeNull();
      expect(startButton()).toBeEnabled();
    }
  });

  it('fills the length from a quick choice and previews the end date', async () => {
    const { user, onStart, onClose } = renderSheet();

    await user.click(screen.getByRole('button', { name: '30 days' }));

    expect(lengthInput()).toHaveValue(30);
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Until Sunday, March 2, 2031')).toBeInTheDocument();

    await user.click(startButton());
    expect(onStart).toHaveBeenCalledWith({ maxDays: 30 });
    expect(onClose).toHaveBeenCalled();
  });

  it('remembers the last length used in this browser', async () => {
    const first = renderSheet();
    await first.user.click(screen.getByRole('button', { name: '90 days' }));
    await first.user.click(startButton());
    expect(window.localStorage.getItem(SKIP_LENGTH_STORAGE_KEY)).toBe('90');
    first.unmount();

    renderSheet();
    expect(lengthInput()).toHaveValue(90);
  });

  it('still opens when storage is blocked', () => {
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    renderSheet();
    expect(lengthInput()).toHaveValue(7);
    blocked.mockRestore();
  });

  it('shows the always-on stops ticked and locked', () => {
    renderSheet();
    for (const name of ['Stop at my shows', 'Stop when a decision arrives']) {
      const box = screen.getByRole('checkbox', { name });
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
  });
});

describe('SkipDaysSheet stops', () => {
  it('stops at the start of next month: 31 January gives 1 February', async () => {
    const { user, onStart } = renderSheet();

    await user.click(screen.getByRole('radio', { name: 'Stop at the start of next month' }));

    expect(screen.getByText('Saturday, February 1, 2031')).toBeInTheDocument();
    expect(screen.getByText('Until Saturday, February 1, 2031')).toBeInTheDocument();
    await user.click(startButton());
    expect(onStart).toHaveBeenCalledWith({ maxDays: 7, stopAtDate: '2031-02-01' });
  });

  it('rejects a stop date before today', async () => {
    const { user, onStart } = renderSheet();

    await user.click(screen.getByRole('radio', { name: 'Stop on a date' }));
    fireEvent.change(screen.getByLabelText('Stop on'), { target: { value: '2031-01-15' } });

    expect(screen.getByText('Pick a date after Friday, January 31, 2031.')).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
    await user.click(startButton());
    expect(onStart).not.toHaveBeenCalled();
  });

  it('rejects today itself as a stop date', async () => {
    const { user } = renderSheet();
    await user.click(screen.getByRole('radio', { name: 'Stop on a date' }));
    fireEvent.change(screen.getByLabelText('Stop on'), { target: { value: '2031-01-31' } });
    expect(startButton()).toBeDisabled();
  });

  it('passes a later stop date to the advance', async () => {
    const { user, onStart } = renderSheet();

    await user.click(screen.getByRole('radio', { name: 'Stop on a date' }));
    fireEvent.change(screen.getByLabelText('Stop on'), { target: { value: '2031-02-03' } });
    await user.click(screen.getByRole('button', { name: '365 days' }));

    expect(screen.getByText('Until Monday, February 3, 2031')).toBeInTheDocument();
    await user.click(startButton());
    expect(onStart).toHaveBeenCalledWith({ maxDays: 365, stopAtDate: '2031-02-03' });
  });
});

describe('skip helpers', () => {
  it('parses whole numbers in range only', () => {
    expect(parseSkipLength('7')).toBe(7);
    expect(parseSkipLength(' 30 ')).toBe(30);
    expect(parseSkipLength('')).toBeNull();
    expect(parseSkipLength('2.5')).toBeNull();
    expect(parseSkipLength('-3')).toBeNull();
    expect(parseSkipLength('0')).toBeNull();
    expect(parseSkipLength('3651')).toBeNull();
  });

  it('finds the first of next month across month lengths and years', () => {
    expect(nextMonthStart(parseGameDate('2031-01-31'))).toBe('2031-02-01');
    expect(nextMonthStart(parseGameDate('2031-12-15'))).toBe('2032-01-01');
    expect(nextMonthStart(parseGameDate('2032-02-29'))).toBe('2032-03-01');
  });
});
