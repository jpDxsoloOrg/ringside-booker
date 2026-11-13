// The Match lab's Physical panel in the real lab, over the fake engine's tiny world (MTCH4-05).
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabWorkerRow } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { LiveAnnouncer } from '@/app/a11y/LiveAnnouncer';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import {
  fatigueWhatIfLabel,
  INJURIES_PER_100_LABEL,
  RUN_MANY_EMPTY_TITLE,
} from '@/components/PhysicalTollTable';
import { useTracePanelStore } from '@/components/Trace';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { useLabStore } from '../labStore';
import { MatchLabView } from '../MatchLabView';
import { PHYSICAL_EMPTY_BODY } from './PhysicalPanel';
import { PHYSICAL_PANEL_TITLE } from './register';

/** The engine's first answers can take a moment under load. */
const LOAD_MS = 10_000;

/** A backstop for a heavily loaded machine only. */
const TEST_TIMEOUT_MS = 20_000;

/** The lab view on its own, without the app shell or the lazily loaded route. */
function renderLab() {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(fakeEngineState());
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const querySpy = vi.spyOn(transport.host, 'query');
  const router = createMemoryRouter([{ path: '*', element: <MatchLabView /> }], {
    initialEntries: [routes.game.matchLab()],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <LiveAnnouncer>
        <RouterProvider router={router} future={routerProviderFutureFlags} />
      </LiveAnnouncer>
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
  const rows = result.data.rows.filter((row) => row.style !== 'nonWrestler').slice(0, 2);
  act(() => {
    rows.forEach((row, side) => {
      useLabStore.getState().addPerson(side, row);
    });
  });
  return rows;
}

async function findPanel(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: PHYSICAL_PANEL_TITLE }, { timeout: LOAD_MS });
}

/** Runs, then waits for a fatigue gain Why? per competitor (a table row or a card each). */
async function runAndWait(user: UserEvent, panel: HTMLElement, workers: number): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Run' }));
  await waitFor(
    () => {
      expect(
        within(panel).getAllByRole('button', { name: /^Why is .*'s fatigue gain / }),
      ).toHaveLength(workers);
    },
    { timeout: LOAD_MS },
  );
}

/** Opens the select named `label` from the keyboard and picks `option`. */
async function choose(user: UserEvent, label: string, option: string): Promise<void> {
  const field = screen.getByRole('combobox', { name: label });
  field.focus();
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('option', { name: option }));
  await waitFor(() => {
    expect(screen.queryByRole('listbox')).toBeNull();
  });
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

describe('the Match lab Physical panel', { timeout: TEST_TIMEOUT_MS }, () => {
  it('shows a row per competitor after a Run, in the same round-trip as Simulate', async () => {
    const { transport, querySpy, user } = renderLab();
    const panel = await findPanel();
    expect(within(panel).getByText(PHYSICAL_EMPTY_BODY)).toBeInTheDocument();
    const rows = await fillSides(transport);
    await runAndWait(user, panel, 2);

    for (const row of rows) {
      expect(within(panel).getByRole('link', { name: row.name })).toBeInTheDocument();
    }
    expect(within(panel).getAllByText('Fatigue gain').length).toBeGreaterThan(0);
    expect(within(panel).getByText(/match$/)).toBeInTheDocument();
    const asked = querySpy.mock.calls.map(([name]) => name);
    expect(asked.filter((name) => name === 'match.simulate')).toHaveLength(1);
    expect(panel.textContent).not.toMatch(/minute/i);
    expect(panel.textContent).not.toMatch(/potential|ceiling/i);
  });

  it('opens the fatigue gain Why? on the duration class', async () => {
    const { transport, user } = renderLab();
    const panel = await findPanel();
    const [first] = await fillSides(transport);
    if (first === undefined) throw new Error('Nobody to put on a side.');
    await runAndWait(user, panel, 2);

    await user.click(
      within(panel).getByRole('button', {
        name: new RegExp(`^Why is ${first.name}'s fatigue gain `),
      }),
    );
    const why = await screen.findByRole('dialog', { name: `${first.name}'s fatigue gain` });
    const [firstLine] = within(why).getAllByRole('treeitem');
    expect(firstLine?.textContent).toMatch(/duration class/i);
    expect(why.textContent).not.toMatch(/minute/i);
  });

  it('plays the same night again with the fatigue what-if', async () => {
    const { transport, querySpy, user } = renderLab();
    const panel = await findPanel();
    const [first] = await fillSides(transport);
    if (first === undefined) throw new Error('Nobody to put on a side.');
    await runAndWait(user, panel, 2);
    const seed = useLabStore.getState().lastRun?.args.previewSeed;

    await choose(user, fatigueWhatIfLabel(first.name), '100');
    await waitFor(
      () => {
        const worker = useLabStore
          .getState()
          .lastRun?.simulation?.extensions?.physical?.workers.find(
            (entry) => entry.personId === first.personId,
          );
        expect(worker).toMatchObject({ fatigueWhatIf: true, fatigueBefore: 100 });
      },
      { timeout: LOAD_MS },
    );
    expect(useLabStore.getState().lastRun?.args.previewSeed).toBe(seed);
    const simulated = querySpy.mock.calls.filter(([name]) => name === 'match.simulate');
    expect(simulated).toHaveLength(2);
    expect(JSON.stringify(simulated[1]?.[1])).toContain('"fatigueOverrides"');
    expect(
      screen.getByRole('combobox', { name: fatigueWhatIfLabel(first.name) }),
    ).toHaveTextContent('100');
  });

  it('shows injuries per 100 runs after a 100-run batch', async () => {
    const { transport, user } = renderLab();
    const panel = await findPanel();
    expect(within(panel).getByText(RUN_MANY_EMPTY_TITLE)).toBeInTheDocument();
    await fillSides(transport);
    act(() => {
      useLabStore.getState().setRuns(100);
    });
    await user.click(screen.getByRole('button', { name: 'Run' }));
    const kpi = await within(panel).findByRole(
      'group',
      { name: INJURIES_PER_100_LABEL },
      { timeout: LOAD_MS },
    );
    expect(kpi).toHaveTextContent(/Injuries: \d+ in 100 runs/);
    expect(within(panel).queryByText(RUN_MANY_EMPTY_TITLE)).toBeNull();
    expect(panel.textContent).not.toMatch(/minute/i);
  });

  it('is not shown for a talking segment', async () => {
    renderLab();
    await findPanel();
    act(() => {
      useLabStore.getState().setKind('angle', null, 2);
    });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: PHYSICAL_PANEL_TITLE })).toBeNull();
    });
  });
});
