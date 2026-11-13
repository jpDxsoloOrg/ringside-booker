/**
 * Test support (DAY2-06) for the Office's partner panels: draws one registered panel inside its
 * `OfficePanelFrame`, against the test engine in process, without the Office screen or the app
 * shell. The panel gets the real `office.dashboard` answer as its context.
 */
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { EngineState } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { useSessionStore } from '@/app/session/sessionStore';
import { OfficePanelFrame } from '@/screens/office/panels/OfficePanelFrame';
import { registeredOfficePanels } from '@/screens/office/panels/officePanelRegistry';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import type { FakeEngineOptions } from '@/test/fakeEngine';

export interface OfficePanelRenderOptions {
  readonly state?: EngineState;
  readonly engine?: FakeEngineOptions;
  /** Days to simulate before the panel is drawn. */
  readonly daysPlayed?: number;
  readonly isPhone?: boolean;
}

export interface RenderedOfficePanel {
  readonly transport: InProcessTransport;
  readonly view: RenderResult;
}

/** Draws the registered panel `panelId` (its module must be imported by the test). */
export async function renderOfficePanel(
  panelId: string,
  options: OfficePanelRenderOptions = {},
): Promise<RenderedOfficePanel> {
  const panel = registeredOfficePanels().find((definition) => definition.id === panelId);
  if (panel === undefined) throw new Error(`No office panel "${panelId}" is registered.`);

  const transport = createInProcessTransport(fakeEngineFactory(options.engine), {
    progressIntervalMs: 0,
  });
  const install = transport.host.installEngine(options.state ?? fakeEngineState());
  if (options.daysPlayed !== undefined) {
    await transport.host.advanceDays({ maxDays: options.daysPlayed }, () => undefined);
  }
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const dashboard = await transport.host.query('office.dashboard', {});
  if (!dashboard.result.ok) throw new Error('office.dashboard was refused.');
  const context = {
    promotionId: dashboard.result.data.promotion?.promotionId ?? null,
    dashboard: dashboard.result.data,
    isPhone: options.isPhone ?? false,
  };

  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: <OfficePanelFrame panelId={panel.id} render={() => panel.render(context)} />,
      },
    ],
    { initialEntries: ['/game/office'], future: routerFutureFlags },
  );
  const view = render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { transport, view };
}
