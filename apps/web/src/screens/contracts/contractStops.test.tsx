/**
 * The contract stops end to end in the real shell (ECO4-04), against the test engine's tiny world
 * with the real contracts gates: the day stops for an expiring contract or a worker who wants to
 * leave, the day bar's button reads Contracts, and one or two taps on the Contracts screen clear
 * the stop so the day moves again. The rules are pushed so the stops come on the first day: every
 * dated contract counts as expiring soon, and every worker is unhappy enough to ask at once.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '@ringside/engine';
import type { EngineState } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { FAKE_START_DATE, fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { fakeSlot } from '@/test/fakeStorage';

const LOAD_MS = 10_000;
/** Each answer runs a command and refetches the shell: a few seconds under load. */
const FLOW_TIMEOUT_MS = 60_000;

beforeEach(() => {
  useSessionStore.getState().clear();
  window.localStorage.clear();
});

/** The tiny world's contracts are open-ended; these end 200 days in. */
const DATED_END = addDays(FAKE_START_DATE, 200);

function datedState(): EngineState {
  const state = fakeEngineState();
  const { employments } = state.world.tables;
  return {
    ...state,
    world: {
      ...state.world,
      tables: {
        ...state.world.tables,
        employments: employments.map((row) => ({ ...row, endsOn: DATED_END })),
      },
    },
  };
}

function renderGame(overrides: Record<string, number | string | boolean>) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const state = datedState();
  const install = transport.host.installEngine({
    ...state,
    tunableOverrides: { ...state.tunableOverrides, ...overrides },
  });
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  vi.spyOn(transport.host, 'autosave').mockResolvedValue({
    ok: true,
    slot: fakeSlot({ slotId: 'slot-1' }),
  });
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [routes.game.calendar()],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { router, transport, user: userEvent.setup({ delay: null }) };
}

function dayControl(): HTMLElement {
  return screen.getByTestId('day-control');
}

async function findDayButton(name: string): Promise<HTMLElement> {
  return within(
    await screen.findByTestId('day-control', undefined, { timeout: LOAD_MS }),
  ).findByRole('button', { name }, { timeout: LOAD_MS });
}

describe('the contract stops', () => {
  it(
    'an expiring contract stops the day; Contracts then Mark all seen moves it again',
    async () => {
      const { user, router } = renderGame({
        'contracts.expiringSoon.days': 365,
        'contracts.expiringSoon.minPush': 'none',
      });
      await user.click(await findDayButton('Next day'));
      const contracts = await findDayButton('Contracts');

      await user.click(contracts);
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(routes.game.contracts());
      });
      expect(router.state.location.search).toBe('?tab=expiring');
      const banner = await screen.findByRole(
        'region',
        { name: 'New expiry notices' },
        { timeout: LOAD_MS },
      );
      await user.click(within(banner).getByRole('button', { name: 'Mark all seen' }));

      await findDayButton('Next day');
      expect(within(dayControl()).queryByRole('button', { name: 'Contracts' })).toBeNull();
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    'workers who want to leave stop the day; Contracts then Grant or Refuse answers each in turn',
    async () => {
      const { user, router, transport } = renderGame({
        'contracts.quit.threshold': 100,
        'contracts.quit.days': 0,
      });
      await user.click(await findDayButton('Next day'));
      await findDayButton('Contracts');
      const counts = await transport.host.query('contracts.counts', {});
      if (!counts.result.ok) throw new Error('contracts.counts refused');
      const asked = counts.result.data.wantsToLeave;
      expect(asked).toBeGreaterThan(0);

      for (let answered = 0; answered < asked; answered += 1) {
        await user.click(await findDayButton('Contracts'));
        await waitFor(() => {
          expect(router.state.location.search).toMatch(
            /^\?tab=active&wantsToLeave=1&employment=emp_/u,
          );
        });
        const request = await screen.findByRole(
          'region',
          { name: 'Release request' },
          { timeout: LOAD_MS },
        );
        if (answered === 0) {
          // The first is let go: Grant, then the confirm, and the sheet closes.
          await user.click(
            await within(request).findByRole('button', { name: 'Grant' }, { timeout: LOAD_MS }),
          );
          const confirm = await screen.findByRole('alertdialog', { name: /^Let .* go\?$/u });
          await user.click(within(confirm).getByRole('button', { name: 'Grant' }));
          await screen.findByText(/^Let .* go\. Severance/u, undefined, { timeout: LOAD_MS });
          await waitFor(() => {
            expect(router.state.location.search).not.toContain('employment=');
          });
        } else {
          await user.click(
            await within(request).findByRole('button', { name: 'Refuse' }, { timeout: LOAD_MS }),
          );
          await screen.findByText(/^You refused /u, undefined, { timeout: LOAD_MS });
          await user.keyboard('{Escape}');
        }
      }

      await findDayButton('Next day');
      expect(within(dayControl()).queryByRole('button', { name: 'Contracts' })).toBeNull();
    },
    FLOW_TIMEOUT_MS,
  );
});
