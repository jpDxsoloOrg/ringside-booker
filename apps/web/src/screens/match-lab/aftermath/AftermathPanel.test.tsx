// The Aftermath panel in the real lab, over the fake engine's tiny world (MTCH3-04).
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabWorkerRow } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { useLabStore } from '../labStore';
import { AFTERMATH_EMPTY_BODY, AFTERMATH_STALE_TEXT } from './aftermathText';
import { useAftermathViewStore } from './aftermathViewStore';
import { AFTERMATH_PANEL_TITLE } from './register';

/** The lazily loaded lab and the engine's first answers can take a moment under load. */
const LOAD_MS = 10_000;

function renderLab() {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(fakeEngineState());
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const querySpy = vi.spyOn(transport.host, 'query');
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [routes.game.matchLab()],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { transport, querySpy, user: userEvent.setup({ delay: null }) };
}

/** Puts one roster member on each side; returns who went where. */
async function fillSides(transport: InProcessTransport): Promise<LabWorkerRow[]> {
  const { regionId } = useLabStore.getState().setup;
  if (regionId === null) throw new Error('The lab has no region.');
  const { result } = await transport.host.query('match.labWorkers', { scope: 'mine', regionId });
  if (!result.ok) throw new Error('The engine refused match.labWorkers.');
  const rows = result.data.rows.slice(0, 2);
  act(() => {
    rows.forEach((row, side) => {
      useLabStore.getState().addPerson(side, row);
    });
  });
  return rows;
}

async function findPanel(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: AFTERMATH_PANEL_TITLE }, { timeout: LOAD_MS });
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
  useAftermathViewStore.setState({ level: 'region' });
});

describe('the Match lab Aftermath panel', () => {
  it('waits for a Run, then shows every competitor, without asking about morale', async () => {
    const { transport, querySpy, user } = renderLab();
    const panel = await findPanel();
    expect(within(panel).getByText(AFTERMATH_EMPTY_BODY)).toBeInTheDocument();

    const rows = await fillSides(transport);
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(
      () => {
        expect(within(panel).getAllByRole('article')).toHaveLength(2);
      },
      { timeout: LOAD_MS },
    );

    for (const row of rows) {
      const block = within(panel).getByRole('article', { name: row.name });
      expect(within(block).getByRole('link', { name: row.name })).toBeInTheDocument();
      expect(within(block).getByText('Popularity')).toBeInTheDocument();
      expect(within(block).getByText('Momentum')).toBeInTheDocument();
    }
    expect(within(panel).getByText('Win')).toBeInTheDocument();
    expect(within(panel).getByText('Loss')).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/morale/i);
    const asked = querySpy.mock.calls.map(([name]) => name);
    expect(asked.filter((name) => /morale/i.test(name))).toEqual([]);
  });

  it('marks the numbers stale when the setup changes, and keeps the level choice', async () => {
    const { transport, user } = renderLab();
    const panel = await findPanel();
    await fillSides(transport);
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await within(panel).findByRole('radio', { name: 'Country' }, { timeout: LOAD_MS });

    await user.click(within(panel).getByRole('radio', { name: 'Country' }));
    expect(useAftermathViewStore.getState().level).toBe('country');

    act(() => {
      useLabStore.getState().setImportance('flagship');
    });
    expect(within(panel).getByRole('status')).toHaveTextContent(AFTERMATH_STALE_TEXT);
    expect(within(panel).getByRole('radio', { name: 'Country' })).toBeChecked();
  });

  it('is not shown for a talking segment', async () => {
    renderLab();
    await findPanel();
    act(() => {
      useLabStore.getState().setKind('angle', null, 2);
    });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: AFTERMATH_PANEL_TITLE })).toBeNull();
    });
  });
});
