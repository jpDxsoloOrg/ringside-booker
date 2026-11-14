/**
 * Test helpers for the Contracts screen (ECO4-04): the screen on its own route (no app shell)
 * against the test engine's tiny world, with every command recorded. `canned` answers chosen
 * queries in place of the engine (the tiny world has no release requests or unseen notices), and
 * `cannedCommands` answers chosen commands without running them.
 */
import { render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { CommandName, PromotionId, QueryName } from '@ringside/engine';
import { LiveAnnouncer } from '@/app/a11y/LiveAnnouncer';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { ContractsScreen } from '@/screens/contracts/ContractsScreen';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';

/** The engine's first answer can take a moment under load. */
export const LOAD_MS = 10_000;

export interface Issued {
  readonly name: CommandName;
  readonly args: unknown;
}

/** A canned answer: the result, or undefined to let the engine answer. */
export type CannedQuery = (args: unknown) => unknown;
export type CannedCommand = (
  args: unknown,
) =>
  | { ok: true; data: unknown }
  | { ok: false; reasons: { code: string; message: string }[] }
  | undefined;

export interface RenderContractsOptions {
  readonly canned?: Partial<Record<QueryName, CannedQuery>>;
  readonly cannedCommands?: Partial<Record<CommandName, CannedCommand>>;
}

export interface RenderedContracts {
  readonly router: ReturnType<typeof createMemoryRouter>;
  readonly user: UserEvent;
  readonly transport: InProcessTransport;
  readonly issued: Issued[];
  readonly promotionId: PromotionId;
}

export function renderContracts(
  path: string = routes.game.contracts(),
  options: RenderContractsOptions = {},
): RenderedContracts {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(fakeEngineState());
  const promotionId = install.seat.promotionId;
  if (promotionId === null) throw new Error('The tiny world seats the player at a promotion');
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });

  const { host } = transport;
  const runQuery = host.query.bind(host);
  host.query = async (name, args) => {
    const canned = options.canned?.[name]?.(args);
    if (canned !== undefined) {
      const real = await runQuery(name, args);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a canned answer stands in for the engine's
      return { ...real, result: { ok: true, data: canned } } as typeof real;
    }
    return runQuery(name, args);
  };
  const issued: Issued[] = [];
  const runCommand = host.command.bind(host);
  host.command = async (name, args) => {
    issued.push({ name, args });
    const canned = options.cannedCommands?.[name]?.(args);
    if (canned !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a canned answer stands in for the engine's
      return { revision: 0, result: canned } as Awaited<ReturnType<typeof runCommand>>;
    }
    return runCommand(name, args);
  };

  const router = createMemoryRouter(
    [
      {
        path: routes.game.contracts(),
        element: (
          <LiveAnnouncer>
            <ContractsScreen />
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
    issued,
    promotionId,
  };
}
