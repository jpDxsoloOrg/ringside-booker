import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseGameDate } from '@ringside/engine';
import type { GameDate } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { useSessionStore } from '@/app/session/sessionStore';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { registerSkipTarget } from './skipTargets';
import {
  nextMonthStart,
  NEWS_ALERTS_STOP_LABEL,
  parseRememberedChoice,
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
  return { onStart, onClose, unmount, user: userEvent.setup({ delay: null }) };
}

function chip(name: string): HTMLElement {
  return screen.getByRole('button', { name });
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
    expect(chip('7 days')).toHaveAttribute('aria-pressed', 'true');

    await user.click(chip('30 days'));

    expect(lengthInput()).toHaveValue(30);
    expect(chip('30 days')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('7 days')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Until Sunday, March 2, 2031')).toBeInTheDocument();

    await user.click(startButton());
    expect(onStart).toHaveBeenCalledWith({ maxDays: 30 });
    expect(onClose).toHaveBeenCalled();
  });

  it('remembers the chip used last in this browser', async () => {
    const first = renderSheet();
    await first.user.click(chip('90 days'));
    await first.user.click(startButton());
    expect(window.localStorage.getItem(SKIP_LENGTH_STORAGE_KEY)).toBe('days.90');
    first.unmount();

    renderSheet();
    expect(chip('90 days')).toHaveAttribute('aria-pressed', 'true');
    expect(lengthInput()).toHaveValue(90);
  });

  it('remembers a typed length as a number', async () => {
    const first = renderSheet();
    await typeLength(first.user, '45');
    await first.user.click(startButton());
    expect(first.onStart).toHaveBeenCalledWith({ maxDays: 45 });
    expect(window.localStorage.getItem(SKIP_LENGTH_STORAGE_KEY)).toBe('45');
    first.unmount();

    renderSheet();
    expect(lengthInput()).toHaveValue(45);
  });

  it('loads a number an older build remembered as a typed length', () => {
    window.localStorage.setItem(SKIP_LENGTH_STORAGE_KEY, '180');
    renderSheet();
    expect(lengthInput()).toHaveValue(180);
    for (const name of ['7 days', '30 days', '90 days', 'Until the 1st of next month']) {
      expect(chip(name)).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('starts on 7 days, and falls back to it for a chip that is no longer there', () => {
    window.localStorage.setItem(SKIP_LENGTH_STORAGE_KEY, 'season.end');
    renderSheet();
    expect(lengthInput()).toHaveValue(7);
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
    for (const name of [
      'Stop at my shows',
      'Stop when a decision arrives',
      NEWS_ALERTS_STOP_LABEL,
    ]) {
      const box = screen.getByRole('checkbox', { name });
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
  });
});

describe('SkipDaysSheet chips', () => {
  it('offers the registered targets in order, each with its detail as its description', () => {
    renderSheet();
    const chips = within(screen.getByRole('group', { name: 'How long' })).getAllByRole('button');
    expect(chips.map((button) => button.getAttribute('data-target-id'))).toEqual([
      'days.7',
      'days.30',
      'days.90',
      'month.next',
    ]);
    expect(chip('7 days')).toHaveAccessibleDescription('to Fri 7 Feb 2031');
    expect(chip('Until the 1st of next month')).toHaveAccessibleDescription(
      'Sat 1 Feb 2031 · 1 day',
    );
  });

  it('shows a target another feature registers, and hides one that resolves to null', () => {
    const removeShow = registerSkipTarget({
      id: 'test.nextShow',
      label: 'Until next show',
      order: 5,
      useResolve: () => ({
        request: { maxDays: 4, stopAtDate: '2031-02-04' },
        detail: 'Tue 4 Feb',
      }),
    });
    const removeHidden = registerSkipTarget({
      id: 'test.hidden',
      label: 'Never shown',
      order: 6,
      useResolve: () => null,
    });
    try {
      renderSheet();
      const chips = within(screen.getByRole('group', { name: 'How long' })).getAllByRole('button');
      expect(chips[0]).toHaveAccessibleName('Until next show');
      expect(screen.queryByRole('button', { name: 'Never shown' })).toBeNull();
    } finally {
      removeShow();
      removeHidden();
    }
  });

  it('starts the chosen target with its own request', async () => {
    const removeShow = registerSkipTarget({
      id: 'test.nextShow',
      label: 'Until next show',
      order: 5,
      useResolve: () => ({
        request: { maxDays: 4, stopAtDate: '2031-02-03' },
        detail: 'Mon 3 Feb',
      }),
    });
    try {
      const { user, onStart } = renderSheet();
      await user.click(chip('Until next show'));
      expect(screen.getByText('Until Monday, February 3, 2031')).toBeInTheDocument();
      await user.click(startButton());
      expect(onStart).toHaveBeenCalledWith({ maxDays: 4, stopAtDate: '2031-02-03' });
      expect(window.localStorage.getItem(SKIP_LENGTH_STORAGE_KEY)).toBe('test.nextShow');
    } finally {
      removeShow();
    }
  });

  it('lets a typed length override the chosen chip', async () => {
    const { user, onStart } = renderSheet();
    await user.click(chip('Until the 1st of next month'));
    expect(chip('Until the 1st of next month')).toHaveAttribute('aria-pressed', 'true');

    await typeLength(user, '12');

    expect(chip('Until the 1st of next month')).toHaveAttribute('aria-pressed', 'false');
    await user.click(startButton());
    expect(onStart).toHaveBeenCalledWith({ maxDays: 12 });
  });
});

describe('SkipDaysSheet stops', () => {
  it('stops at the 1st of next month: 31 January gives 1 February, one day on', async () => {
    const { user, onStart } = renderSheet();

    await user.click(chip('Until the 1st of next month'));

    expect(screen.getByText('Until Saturday, February 1, 2031')).toBeInTheDocument();
    await user.click(startButton());
    expect(onStart).toHaveBeenCalledWith({ maxDays: 1, stopAtDate: '2031-02-01' });
  });

  it('keeps the earlier of the month stop and a stop date', async () => {
    const { user, onStart } = renderSheet(parseGameDate('2031-03-01'));

    await user.click(chip('Until the 1st of next month'));
    await user.click(screen.getByRole('radio', { name: 'Stop on a date' }));
    fireEvent.change(screen.getByLabelText('Stop on'), { target: { value: '2031-03-20' } });

    expect(screen.getByText('Until Thursday, March 20, 2031')).toBeInTheDocument();
    await user.click(startButton());
    expect(onStart).toHaveBeenCalledWith({ maxDays: 31, stopAtDate: '2031-03-20' });
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
    await user.click(chip('90 days'));

    expect(screen.getByText('Until Monday, February 3, 2031')).toBeInTheDocument();
    await user.click(startButton());
    expect(onStart).toHaveBeenCalledWith({ maxDays: 90, stopAtDate: '2031-02-03' });
  });
});

describe('SkipDaysSheet alert settings', () => {
  it('opens the News alerts sheet on top, and gives focus back to the link', async () => {
    const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    const install = transport.host.installEngine(fakeEngineState());
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
    const user = userEvent.setup({ delay: null });
    render(
      <EngineProvider createTransport={() => transport}>
        <SkipDaysSheet open today={LAST_OF_JANUARY} onStart={vi.fn()} onClose={vi.fn()} />
      </EngineProvider>,
    );
    const link = screen.getByRole('button', { name: 'Alert settings' });
    await user.click(link);

    const alerts = await screen.findByRole('dialog', { name: 'News alerts' });
    expect(
      await within(alerts).findByRole('switch', { name: 'Front-page stories' }, { timeout: 5000 }),
    ).toBeChecked();
    expect(screen.getByRole('dialog', { name: 'Skip days' })).toBeInTheDocument();

    await user.click(within(alerts).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'News alerts' })).toBeNull();
    });
    await waitFor(() => {
      expect(link).toHaveFocus();
    });
    useSessionStore.getState().clear();
  });
});

describe('skip helpers', () => {
  it('reads a remembered choice: an id, a number, or nothing', () => {
    expect(parseRememberedChoice(null)).toEqual({ kind: 'target', id: 'days.7' });
    expect(parseRememberedChoice('days.30')).toEqual({ kind: 'target', id: 'days.30' });
    expect(parseRememberedChoice('365')).toEqual({ kind: 'typed', text: '365' });
    expect(parseRememberedChoice('99999')).toEqual({ kind: 'target', id: 'days.7' });
  });

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
