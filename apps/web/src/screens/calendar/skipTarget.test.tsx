import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, parseGameDate } from '@ringside/engine';
import { SkipDaysSheet } from '@/app/AppShell/day/SkipDaysSheet';
import { skipTarget } from '@/app/AppShell/day/skipTargets';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { useSessionStore } from '@/app/session/sessionStore';
import { BOOKING_WORLD_START, bookingFakeState, fakeEngineFactory } from '@/test/fakeEngine';
import { NEXT_SHOW_SKIP_LABEL, NEXT_SHOW_SKIP_TARGET_ID, nextShowChoice } from './skipTarget';

/** The engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;

function nextShow(date: string, daysUntil: number) {
  return { show: { date: parseGameDate(date) }, daysUntil };
}

afterEach(() => {
  useSessionStore.getState().clear();
});

describe('the "Until next show" skip target (EVT1, wired by DAY1-06)', () => {
  it('is registered fifth, before the 7-day choice', () => {
    expect(skipTarget(NEXT_SHOW_SKIP_TARGET_ID)).toMatchObject({
      label: NEXT_SHOW_SKIP_LABEL,
      order: 5,
    });
  });

  it('skips to the show and stops on its day, "Mon 11 Jan · 7 days"', () => {
    expect(nextShowChoice(nextShow('2027-01-11', 7))).toEqual({
      request: { maxDays: 7, stopAtDate: '2027-01-11' },
      detail: 'Mon 11 Jan · 7 days',
    });
    expect(nextShowChoice(nextShow('2027-01-05', 1))?.detail).toBe('Tue 5 Jan · 1 day');
  });

  it('is hidden with no show, and on the show day itself', () => {
    expect(nextShowChoice(null)).toBeNull();
    expect(nextShowChoice(nextShow('2027-01-04', 0))).toBeNull();
  });

  it("offers the player's next show in the Skip days sheet and starts it", async () => {
    const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    const install = transport.host.installEngine(bookingFakeState().state);
    // Stored shows appear after the first simulated day: the Thursday show is then 5 days away.
    await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
    const answer = await transport.host.query('calendar.nextShow', { scope: 'mine' });
    if (!answer.result.ok) throw new Error('calendar.nextShow was refused');
    const expected = nextShowChoice(answer.result.data);
    if (expected === null) throw new Error('the booking world has no show of mine to skip to');
    expect(answer.result.data?.daysUntil).toBe(5);

    const onStart = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <EngineProvider createTransport={() => transport}>
        <SkipDaysSheet
          open
          today={addDays(BOOKING_WORLD_START, 1)}
          onStart={onStart}
          onClose={vi.fn()}
        />
      </EngineProvider>,
    );
    const chip = await screen.findByRole(
      'button',
      { name: NEXT_SHOW_SKIP_LABEL },
      { timeout: LOAD_MS },
    );
    expect(chip).toHaveAccessibleDescription(expected.detail);
    await user.click(chip);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => {
      expect(onStart).toHaveBeenCalledWith(expected.request);
    });
  });
});
