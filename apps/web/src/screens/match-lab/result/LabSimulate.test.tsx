import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineState, LabWorkerRow } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { OUT_OF_DATE_TEXT } from '../LabResult';
import { useLabStore } from '../labStore';
import { MatchResultBlock } from './MatchResultBlock';
import { AUTO_FINISH_LABEL, FINISH_RESET_MESSAGE } from './resultText';
import {
  disqualificationSimulation,
  drawSimulation,
  noContestSimulation,
  randomWinnersSimulation,
  winSimulation,
} from './simulationFixtures';

/** The lazily loaded lab and the engine's first answers can take a moment under load. */
const LOAD_MS = 10_000;

function renderLab(state: EngineState = fakeEngineState()) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [routes.game.matchLab()],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { transport, user: userEvent.setup() };
}

/** Puts one roster member on each of the first `count` sides, adding sides as needed. */
async function fillSides(transport: InProcessTransport, count: number): Promise<void> {
  const { regionId } = useLabStore.getState().setup;
  if (regionId === null) throw new Error('The lab has no region.');
  const { result } = await transport.host.query('match.labWorkers', { scope: 'mine', regionId });
  if (!result.ok) throw new Error('The engine refused match.labWorkers.');
  const rows: LabWorkerRow[] = result.data.rows;
  act(() => {
    const store = useLabStore.getState();
    while (useLabStore.getState().sides.length < count) store.addSide();
    rows.slice(0, count).forEach((row, side) => {
      useLabStore.getState().addPerson(side, row);
    });
  });
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

/** The names of the Finish select's options, read by opening it and closing it again. */
async function finishOptions(user: UserEvent): Promise<string[]> {
  const field = screen.getByRole('combobox', { name: 'Finish' });
  field.focus();
  await user.keyboard('{Enter}');
  const listbox = await screen.findByRole('listbox');
  const names = within(listbox)
    .getAllByRole('option')
    .map((option) => option.textContent);
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  return names;
}

async function findFinish(): Promise<HTMLElement> {
  return screen.findByRole('combobox', { name: 'Finish' }, { timeout: LOAD_MS });
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

describe('the Match lab Winner and finish group and Run', () => {
  it('narrows the finishes to the two draw finishes when Draw is chosen', async () => {
    const { user } = renderLab();
    await findFinish();
    expect(await finishOptions(user)).toContain('Clean finish');
    await user.click(screen.getByRole('radio', { name: 'Draw' }));
    await waitFor(async () => {
      expect(await finishOptions(user)).toEqual([
        AUTO_FINISH_LABEL,
        'Double count-out (no title change)',
        'Stalemate (no title change)',
      ]);
    });
  });

  it('resets a disqualification to Auto when the match turns three-sided, and says so', async () => {
    const { user } = renderLab();
    await findFinish();
    await choose(user, 'Finish', 'Disqualification (no title change)');
    expect(screen.getByRole('combobox', { name: 'Finish' })).toHaveTextContent('Disqualification');
    await choose(user, 'Match type', 'Three-Way');
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Finish' })).toHaveTextContent(AUTO_FINISH_LABEL);
    });
    expect(screen.getByText(FINISH_RESET_MESSAGE)).toBeInTheDocument();
    expect(useLabStore.getState().result.finishKey).toBeNull();
  });

  it('plays out a booked winner with a Why? on it, on a fresh roll every Run', async () => {
    const { transport, user } = renderLab();
    await findFinish();
    await fillSides(transport, 2);
    await user.click(screen.getByRole('radio', { name: /^Side 2:/ }));
    await user.click(screen.getByRole('button', { name: 'Run' }));
    const why = await screen.findByRole(
      'button',
      { name: /^Why is Winner Side 2 wins: .+\?$/ },
      { timeout: LOAD_MS },
    );
    expect(why).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Lab result' })).toBeInTheDocument();
    const first = useLabStore.getState().lastRun;
    expect(first?.simulation?.winningSide).toBe(1);
    await waitFor(() => {
      expect(useLabStore.getState().pending).toBe(false);
    });
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => {
      expect(useLabStore.getState().lastRun).not.toBe(first);
    });
    const second = useLabStore.getState().lastRun;
    expect(second?.simulation?.winningSide).toBe(1);
    expect(second?.args.previewSeed).not.toBe(first?.args.previewSeed);
  });

  it('marks the result out of date when the winner changes, until the next Run', async () => {
    const { transport, user } = renderLab();
    await findFinish();
    await fillSides(transport, 2);
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await screen.findByRole('group', { name: 'Lab result' }, { timeout: LOAD_MS });
    expect(screen.queryByText(OUT_OF_DATE_TEXT)).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Draw' }));
    expect(screen.getByText(OUT_OF_DATE_TEXT)).toBeInTheDocument();
  });

  it('shows a refused Run inline', async () => {
    // A save whose catalog lost its draw finishes: a Draw has nothing to end with.
    const state = fakeEngineState();
    const { catalogs } = state.world.meta;
    if (catalogs.finishes === undefined) throw new Error('The tiny world has no finishes.');
    catalogs.finishes = Object.fromEntries(
      Object.entries(catalogs.finishes).filter(([, entry]) => entry.outcomeKind !== 'draw'),
    );
    const { transport, user } = renderLab(state);
    await findFinish();
    await fillSides(transport, 2);
    await user.click(screen.getByRole('radio', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Run' }));
    const message = await screen.findByText(
      "This match can't end in a draw: it has no draw finish.",
      {},
      { timeout: LOAD_MS },
    );
    expect(message.closest('[role="alert"]')).not.toBeNull();
    expect(useLabStore.getState().lastRun).toBeNull();
  });
});

describe('MatchResultBlock', () => {
  const block = (simulation: ReturnType<typeof winSimulation>, titlesOnLine = false) =>
    render(
      <MatchResultBlock
        simulation={simulation}
        ratedOn={null}
        today={null}
        outOfDate={false}
        titlesOnLine={titlesOnLine}
      />,
    );

  it('heads a win with the side and names, the method and the finish', () => {
    block(winSimulation(['Rex Harlan', 'Ivo Brandt']));
    expect(screen.getByText('Side 1 wins: Rex Harlan & Ivo Brandt')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Why is Winner Side 1 wins: Rex Harlan & Ivo Brandt?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Pinfall · Clean finish')).toBeInTheDocument();
    expect(screen.queryByText(/Titles can't change hands/)).toBeNull();
  });

  it('says Draw and No contest with no method', () => {
    const { unmount } = block(drawSimulation());
    expect(screen.getByRole('button', { name: 'Why is Winner Draw?' })).toBeInTheDocument();
    expect(screen.getByText('Stalemate finish')).toBeInTheDocument();
    unmount();
    block(noContestSimulation());
    expect(screen.getByRole('button', { name: 'Why is Winner No contest?' })).toBeInTheDocument();
  });

  it('marks a Random winners night and a finish that keeps titles where they are', () => {
    const { unmount } = block(randomWinnersSimulation());
    expect(screen.getByText('Random winners')).toBeInTheDocument();
    unmount();
    block(disqualificationSimulation(), true);
    expect(
      screen.getByText("Titles can't change hands on a Disqualification finish"),
    ).toBeInTheDocument();
  });
});
