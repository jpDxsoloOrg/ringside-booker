import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialEngineState } from '@ringside/engine';
import type { EngineState, LabWorkerRow } from '@ringside/engine';
import { TEST_PLAYER_ID, worldBuilder } from '@ringside/engine/testing';
import { devSeat } from '@/app/dev/EnterShellRoute';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';
import { registerLabPanel } from './labPanelRegistry';
import { useLabStore } from './labStore';
import { NO_CATALOG_BODY, NO_GAME_TITLE } from './MatchLabView';

/** The lazily loaded lab and the engine's first answers can take a moment under load. */
const LOAD_MS = 10_000;

/**
 * A backstop above LOAD_MS for a heavily loaded machine only: at vitest's default 5 s a test timed
 * out before its own LOAD_MS wait could. These tests go through the app shell and the lazy route on
 * purpose (LabSimulate.test renders the view on its own); each takes well under a second alone.
 */
const TEST_TIMEOUT_MS = 15_000;

interface RenderOptions {
  /** The world to load; the tiny world (with catalogs) by default. Null fakes a seat, no world. */
  readonly state?: EngineState | null;
}

function renderLab({ state = fakeEngineState() }: RenderOptions = {}) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  if (state === null) {
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: devSeat('promotion') });
  } else {
    const install = transport.host.installEngine(state);
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  }
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [routes.game.matchLab()],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  // No pause between simulated keys and clicks: nothing here depends on typing speed.
  return { transport, router, user: userEvent.setup({ delay: null }) };
}

/** The lab's slot role select, once the lab has loaded. */
async function findSlotRole(): Promise<HTMLElement> {
  return screen.findByRole('combobox', { name: 'Slot role' }, { timeout: LOAD_MS });
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

/** The promotion's roster as the picker lists it, straight from the engine. */
async function rosterRows(transport: InProcessTransport): Promise<LabWorkerRow[]> {
  const { regionId } = useLabStore.getState().setup;
  if (regionId === null) throw new Error('The lab has no region.');
  const { result } = await transport.host.query('match.labWorkers', { scope: 'mine', regionId });
  if (!result.ok) throw new Error('The engine refused match.labWorkers.');
  return result.data.rows;
}

/** Puts one roster member on each of the first `count` sides, adding sides as needed. */
async function fillSides(transport: InProcessTransport, count: number): Promise<LabWorkerRow[]> {
  const rows = await rosterRows(transport);
  act(() => {
    const store = useLabStore.getState();
    while (useLabStore.getState().sides.length < count) store.addSide();
    rows.slice(0, count).forEach((row, side) => {
      useLabStore.getState().addPerson(side, row);
    });
  });
  return rows;
}

function scoreBug(): HTMLElement {
  return screen.getByRole('group', { name: 'Lab result' });
}

/** The numbers on the score bug, label → value text. */
function scoreBugValues(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const term of within(scoreBug()).getAllByRole('term')) {
    values[term.textContent] = term.nextElementSibling?.textContent ?? '';
  }
  return values;
}

async function runOnce(user: UserEvent, button = 'Run'): Promise<void> {
  await user.click(screen.getByRole('button', { name: button }));
  await screen.findByRole('group', { name: 'Lab result' }, { timeout: LOAD_MS });
  await waitFor(() => {
    expect(useLabStore.getState().pending).toBe(false);
  });
}

/** Sets the Runs slider the way a drag or the arrow keys end up setting it. */
function setRuns(runs: number): void {
  fireEvent.change(screen.getByRole('slider', { name: 'Runs' }), {
    target: { value: String(runs) },
  });
}

/** The count on each of a list's items: "28 wins · 56%" → 28, a finish's "12 runs" → 12. */
function countsIn(list: HTMLElement): number[] {
  return within(list)
    .getAllByRole('listitem')
    .map((item) => {
      const count = within(item).getByText(/^\d+(?: (?:wins?|runs?) · \d+%)?$/);
      return Number.parseInt(count.textContent, 10);
    });
}

const cleanups: (() => void)[] = [];

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

afterEach(() => {
  act(() => {
    for (const unregister of cleanups.splice(0)) unregister();
  });
});

describe('MatchLabScreen', { timeout: TEST_TIMEOUT_MS }, () => {
  it('opens on a midcard singles with a Standard duration chip, live in the sidebar', async () => {
    const { user } = renderLab();
    expect(screen.getByRole('heading', { level: 1, name: 'Match lab' })).toBeInTheDocument();
    expect(await findSlotRole()).toHaveTextContent('Midcard');
    expect(screen.getByRole('combobox', { name: 'Match type' })).toHaveTextContent('Singles');
    expect(await screen.findByText('Standard', {}, { timeout: LOAD_MS })).toBeInTheDocument();
    expect(screen.getByText('Weight ×1.00')).toBeInTheDocument();
    expect(screen.getByText('2 sides, 1 each', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.title).toBe('Match lab · Ringside Booker');
    const sidebar = screen.getByRole('navigation', { name: 'Main' });
    expect(within(sidebar).getByRole('link', { name: 'Match lab' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await choose(user, 'Slot role', 'Main event');
    expect(await screen.findByText('Long', {}, { timeout: LOAD_MS })).toBeInTheDocument();
    expect(screen.getByText('Weight ×1.75')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Why is Duration class Long?' })).toBeInTheDocument();
  });

  it('holds Run back with a reason until every side has someone', async () => {
    const { transport } = renderLab();
    await findSlotRole();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    expect(screen.getByText('Add someone to every side')).toBeInTheDocument();

    await fillSides(transport, 2);
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();
    expect(screen.queryByText('Add someone to every side')).toBeNull();
  });

  it('runs a night with four numbers and a Why? on each, then a fresh roll on the next Run', async () => {
    const { transport, user } = renderLab();
    await findSlotRole();
    await fillSides(transport, 2);

    await runOnce(user);
    const first = scoreBugValues();
    expect(Object.keys(first)).toEqual(['Score', 'Stars', 'Work rate', 'Crowd']);
    for (const label of ['Score', 'Stars', 'Work rate', 'Crowd']) {
      expect(
        within(scoreBug()).getByRole('button', { name: new RegExp(`^Why is ${label} `) }),
      ).toBeInTheDocument();
    }
    expect(within(scoreBug()).getByRole('img', { name: /stars? out of 5|No stars/ })).toBeVisible();
    expect(screen.getByText(/^Expected \d+/)).toBeInTheDocument();
    expect(screen.getByText(/(below|above|right on) expectation/)).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Each worker' })).toBeInTheDocument();
    // A match always plays out who won and how.
    expect(screen.getByRole('button', { name: /^Why is Winner Side [12] wins: / })).toBeVisible();
    const firstRun = useLabStore.getState().lastRun;

    await runOnce(user);
    await waitFor(() => {
      expect(useLabStore.getState().lastRun).not.toBe(firstRun);
    });
    expect(useLabStore.getState().lastRun?.args.previewSeed).not.toBe(firstRun?.args.previewSeed);
    expect(document.body.textContent).not.toMatch(RUNNING_TIME_WORDS);
    expect(document.body.textContent).not.toMatch(/\bSeed\b/);
  });

  it('opens the Why? panel on the score', async () => {
    const { transport, user } = renderLab();
    await findSlotRole();
    await fillSides(transport, 2);
    await runOnce(user);

    await user.click(within(scoreBug()).getByRole('button', { name: /^Why is Score / }));
    expect(await screen.findByRole('dialog', { name: 'Score' })).toBeInTheDocument();
  });

  it("links each worker's name, on the chips and in the result, to their profile", async () => {
    const { transport, router, user } = renderLab();
    await findSlotRole();
    const [first] = await fillSides(transport, 2);
    if (first === undefined) throw new Error('The roster is empty.');
    const profile = routes.game.worker(first.personId);

    const side1 = screen.getByRole('list', { name: 'Side 1 line-up' });
    const chipLink = within(side1).getByRole('link', { name: first.name });
    expect(chipLink).toHaveAttribute('href', profile);
    // The remove button stays its own control beside the link.
    expect(
      within(side1).getByRole('button', { name: `Remove ${first.name} from Side 1` }),
    ).toBeInTheDocument();

    await runOnce(user);
    const grid = screen.getByRole('grid', { name: 'Each worker' });
    expect(within(grid).getByRole('link', { name: first.name })).toHaveAttribute('href', profile);

    // A person input inside a Why? panel links the same way, through the shell's link context.
    const popularity = `${first.name}'s popularity`;
    await user.click(
      within(grid).getByRole('button', { name: new RegExp(`^Why is ${popularity}`) }),
    );
    const panel = await screen.findByRole('dialog', { name: popularity });
    expect(
      within(panel).getByRole('link', { name: new RegExp(`^${popularity} in `) }),
    ).toHaveAttribute('href', profile);
    await user.keyboard('{Escape}');

    await user.click(within(grid).getByRole('link', { name: first.name }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(profile);
    });
  });

  it('has one action button, Run, and a Runs slider at 1, with no seed controls', async () => {
    renderLab();
    await findSlotRole();
    const run = screen.getByRole('button', { name: 'Run' });
    const bar = run.parentElement?.parentElement;
    if (bar == null) throw new Error('Run is in no bar.');
    expect(within(bar).getAllByRole('button')).toEqual([run]);
    const slider = within(bar).getByRole('slider', { name: 'Runs' });
    expect(slider).toHaveValue('1');
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '100');
    expect(slider).toHaveAttribute('aria-valuetext', '1 run');
    for (const gone of ['Simulate', 'Re-roll seed', 'Run x100']) {
      expect(screen.queryByRole('button', { name: gone })).toBeNull();
    }
    expect(document.body.textContent).not.toMatch(/\bSeed\b/);

    setRuns(50);
    expect(slider).toHaveValue('50');
    expect(slider).toHaveAttribute('aria-valuetext', '50 runs');
    expect(useLabStore.getState().runs).toBe(50);
  });

  it('rates a talking segment with no winner', async () => {
    const { transport, user } = renderLab();
    await findSlotRole();
    await user.click(screen.getByRole('radio', { name: 'Talking segment' }));
    await fillSides(transport, 1);
    await runOnce(user);
    expect(Object.keys(scoreBugValues())).toEqual(['Score', 'Stars', 'Talk', 'Crowd']);
    expect(screen.queryByRole('button', { name: /^Why is Winner / })).toBeNull();
    expect(useLabStore.getState().lastRun?.simulation).toBeNull();
  });

  it('marks the result out of date when the setup changes, until the next Run', async () => {
    const { transport, user } = renderLab();
    await findSlotRole();
    await fillSides(transport, 2);
    await runOnce(user);
    expect(screen.queryByText('Out of date: run again')).toBeNull();

    await choose(user, 'Slot role', 'Opener');
    expect(screen.getByText('Out of date: run again')).toBeInTheDocument();
    await runOnce(user);
    await waitFor(() => {
      expect(screen.queryByText('Out of date: run again')).toBeNull();
    });
  });

  it('runs 50 nights: the last in full, who won, the finishes and the score spread', async () => {
    const { transport, user } = renderLab();
    await findSlotRole();
    await fillSides(transport, 2);
    setRuns(50);

    await user.click(screen.getByRole('button', { name: 'Run' }));
    const table = await screen.findByRole(
      'table',
      { name: 'Score over 50 runs' },
      { timeout: LOAD_MS },
    );
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(1);
    expect(screen.getByRole('heading', { name: 'Over 50 runs' })).toBeInTheDocument();
    expect(screen.getByText(/^Last of 50 runs, in full/)).toBeInTheDocument();
    // The last night in full, with its winner and Why? panels.
    expect(scoreBug()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Why is Winner / })).toBeInTheDocument();

    const winners = screen.getByRole('list', { name: 'Who won' });
    const outcomes = countsIn(winners);
    expect(within(winners).getByText(/^Side 1: /)).toBeInTheDocument();
    expect(within(winners).getByText('Draws')).toBeInTheDocument();
    expect(outcomes.reduce((total, count) => total + count, 0)).toBe(50);
    const finishes = screen.getByRole('list', { name: 'Finishes, most common first' });
    const finishCounts = countsIn(finishes);
    expect(finishCounts.reduce((total, count) => total + count, 0)).toBe(50);
    expect(finishCounts).toEqual([...finishCounts].sort((left, right) => right - left));

    const summaries = screen.getAllByText(
      /^Mean [\d.]+ · spread ±[\d.]+ · range [\d.]+–[\d.]+ · middle 80% [\d.]+–[\d.]+$/,
    );
    // The score's summary, then one line each for stars, work rate and crowd.
    expect(summaries).toHaveLength(4);
    expect(screen.getAllByText(/runs? at [\d.]+ stars?/).length).toBeGreaterThan(0);

    // Back to one run: the counts go with the next Run.
    setRuns(1);
    await runOnce(user);
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Over 50 runs' })).toBeNull();
    });
  });

  it('warns about three sides in a singles match instead of refusing it', async () => {
    const { transport, user } = renderLab();
    await findSlotRole();
    await fillSides(transport, 3);

    await runOnce(user);
    const warnings = screen.getByRole('region', { name: 'Warnings' });
    expect(within(warnings).getByText(/Three sides in a Singles match: it takes 2/)).toBeVisible();
  });

  it('adds people from the picker to the side it was opened for, never twice', async () => {
    const { user } = renderLab();
    await findSlotRole();

    await user.click(screen.getByRole('button', { name: 'Add worker to Side 2' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add to Side 2' });
    const grid = await within(sheet).findByRole('grid', {}, { timeout: LOAD_MS });
    await waitFor(() => {
      expect(grid.querySelectorAll('tbody tr[data-row-id]').length).toBeGreaterThan(0);
    });
    const [firstRow] = [...grid.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')];
    if (firstRow === undefined) throw new Error('The picker listed nobody.');
    const personId = firstRow.dataset['rowId'];

    await user.click(firstRow);
    await waitFor(() => {
      expect(useLabStore.getState().sides[1]).toEqual([personId]);
    });
    expect(within(firstRow).getByText('On Side 2')).toBeInTheDocument();
    // The sheet stays open for the next pick, and the same person is not added again.
    await user.click(firstRow);
    expect(useLabStore.getState().sides).toEqual([[], [personId]]);
    expect(screen.getByRole('dialog', { name: 'Add to Side 2' })).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add to Side 2' })).toBeNull();
    });
    const side2 = screen.getByRole('list', { name: 'Side 2 line-up' });
    expect(within(side2).getAllByRole('listitem')).toHaveLength(1);
  });

  it('draws a registered panel under the result and refuses a second with its id', async () => {
    cleanups.push(
      registerLabPanel({
        id: 'test.panel',
        order: 20,
        title: 'Test aftermath',
        render: ({ result }) => (result === null ? 'No run yet' : `Rated ${result.kind}`),
      }),
    );
    expect(() =>
      registerLabPanel({ id: 'test.panel', order: 30, title: 'Again', render: () => null }),
    ).toThrow(/already registered/);

    renderLab();
    const panel = await screen.findByRole(
      'region',
      { name: 'Test aftermath' },
      { timeout: LOAD_MS },
    );
    expect(within(panel).getByText('No run yet')).toBeInTheDocument();
  });

  it('asks for a game when none is loaded', async () => {
    renderLab({ state: null });
    expect(screen.getByRole('heading', { level: 1, name: 'Match lab' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: NO_GAME_TITLE }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('explains that a save from before match types cannot use the lab', async () => {
    const { world } = worldBuilder()
      .withGeography('mini')
      .withPromotion(
        { name: 'Test Promotion A', controller: { kind: 'human', playerId: TEST_PLAYER_ID } },
        (promotion) => promotion.withRoster(2),
      )
      .build();
    renderLab({ state: initialEngineState(world) });
    expect(await screen.findByText(NO_CATALOG_BODY, {}, { timeout: LOAD_MS })).toBeInTheDocument();
  });
});
