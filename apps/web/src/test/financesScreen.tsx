/**
 * Test helpers for the Finances screen: the screen on its own route (no app shell) against the
 * test engine's tiny world, with every query it asks recorded.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { PromotionId, QueryName } from '@ringside/engine';
import { LiveAnnouncer } from '@/app/a11y/LiveAnnouncer';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { FinancesScreen } from '@/screens/finances/FinancesScreen';

/** The engine's first answer and the lazily loaded tabs can take a moment under load. */
export const LOAD_MS = 10_000;

export interface Asked {
  readonly name: QueryName;
  readonly args: unknown;
}

export interface RenderFinancesOptions {
  /** The seat's promotion, in place of the one the engine host worked out. Null: none. */
  readonly seatPromotionId?: PromotionId | null;
  /** Days to simulate before the screen opens, so money has moved. None by default. */
  readonly daysPlayed?: number;
}

export interface RenderedFinances {
  readonly router: ReturnType<typeof createMemoryRouter>;
  readonly user: UserEvent;
  readonly transport: InProcessTransport;
  readonly asked: Asked[];
  /** The arguments of every `name` query asked so far. */
  readonly argsOf: (name: QueryName) => unknown[];
  /** The promotion the local player runs in the tiny world. */
  readonly promotionId: PromotionId;
}

export async function renderFinances(
  path: string = routes.game.finances(),
  options: RenderFinancesOptions = {},
): Promise<RenderedFinances> {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(fakeEngineState());
  if (options.daysPlayed !== undefined) {
    await transport.host.advanceDays({ maxDays: options.daysPlayed }, () => undefined);
  }
  const ownPromotionId = install.seat.promotionId;
  if (ownPromotionId === null) throw new Error('The tiny world seats the player at a promotion');
  const seat =
    options.seatPromotionId === undefined
      ? install.seat
      : { ...install.seat, promotionId: options.seatPromotionId };
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat });

  const asked: Asked[] = [];
  const { host } = transport;
  const runQuery = host.query.bind(host);
  host.query = async (name, args) => {
    asked.push({ name, args });
    return runQuery(name, args);
  };

  const router = createMemoryRouter(
    [
      {
        path: routes.game.finances(),
        element: (
          <LiveAnnouncer>
            <FinancesScreen />
          </LiveAnnouncer>
        ),
      },
      { path: '*', element: <p>Somewhere else</p> },
    ],
    { initialEntries: [path], future: routerFutureFlags },
  );
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return {
    router,
    user: userEvent.setup({ delay: null }),
    transport,
    asked,
    argsOf: (name) => asked.filter((query) => query.name === name).map((query) => query.args),
    promotionId: ownPromotionId,
  };
}

/** The tab list, once the screen's chunk has loaded. */
export async function findFinanceTabs(): Promise<HTMLElement> {
  return screen.findByRole('tablist', { name: 'Finances sections' }, { timeout: LOAD_MS });
}

/** Opens the select named `label` from the keyboard and picks `option`. */
export async function choose(user: UserEvent, label: string, option: string): Promise<void> {
  const field = screen.getByRole('combobox', { name: label });
  field.focus();
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('option', { name: option }));
  await waitFor(() => {
    expect(screen.queryByRole('listbox')).toBeNull();
  });
}
