import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialEngineState, NO_BEAT_CATALOG_MESSAGE } from '@ringside/engine';
import type { EngineState, LabWorkerRow, PersonId } from '@ringside/engine';
import { tinyWorld } from '@ringside/engine/testing';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import type { BeatDraft } from '@/components/BeatEditor';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { useLabStore } from '../labStore';
import { NO_BEATS_TITLE } from './AngleMode';

/** The lazily loaded lab and the engine's first answers can take a moment under load. */
const LOAD_MS = 10_000;

/** A backstop above LOAD_MS for a heavily loaded machine; each test takes about a second alone. */
const TEST_TIMEOUT_MS = 20_000;

interface RenderOptions {
  readonly state?: EngineState;
  /** The lab's URL; Angle mode by default. */
  readonly url?: string;
}

function renderLab({
  state = fakeEngineState(),
  url = `${routes.game.matchLab()}?mode=angle`,
}: RenderOptions = {}) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [url],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { transport, router, user: userEvent.setup({ delay: null }) };
}

/** Angle mode's type select, once the lab has loaded in Angle mode. */
async function findAngleType(): Promise<HTMLElement> {
  return screen.findByRole('combobox', { name: 'Angle type' }, { timeout: LOAD_MS });
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

function rowAt(rows: readonly LabWorkerRow[], index: number): LabWorkerRow {
  const row = rows[index];
  if (row === undefined) throw new Error(`No roster row ${String(index)}.`);
  return row;
}

function chip(row: LabWorkerRow) {
  return { id: row.personId, name: row.name };
}

/** Promo (A), War of Words (A against B), Promo (B): three beats with people in every group. */
async function buildThreeBeats(transport: InProcessTransport): Promise<LabWorkerRow[]> {
  const rows = await rosterRows(transport);
  const [first, second] = [rowAt(rows, 0), rowAt(rows, 1)];
  const beats: BeatDraft[] = [
    { id: 'beat-1', beatKey: 'beat.promo', groupOne: [chip(first)], groupTwo: [] },
    {
      id: 'beat-2',
      beatKey: 'beat.war-of-words',
      groupOne: [chip(first)],
      groupTwo: [chip(second)],
    },
    { id: 'beat-3', beatKey: 'beat.promo', groupOne: [chip(second)], groupTwo: [] },
  ];
  act(() => {
    useLabStore.getState().setAngle({
      beats,
      people: { [first.personId]: first, [second.personId]: second },
    });
  });
  return rows;
}

async function run(user: UserEvent): Promise<HTMLElement> {
  const button = screen.getByRole('button', { name: 'Run' });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  await user.click(button);
  return screen.findByRole('group', { name: 'Angle result' }, { timeout: LOAD_MS });
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useLabStore.getState().reset();
});

afterEach(() => {
  useTracePanelStore.setState({ openPanelId: null });
  useLabStore.getState().reset();
});

describe('the Match lab in Angle mode', { timeout: TEST_TIMEOUT_MS }, () => {
  it('switches to Angle with ?mode=angle and back to Match without it', async () => {
    const { router, user } = renderLab({ url: routes.game.matchLab() });
    await screen.findByRole('combobox', { name: 'Slot role' }, { timeout: LOAD_MS });
    expect(router.state.location.search).toBe('');

    await user.click(screen.getByRole('radio', { name: 'Angle' }));
    await findAngleType();
    expect(router.state.location.search).toBe('?mode=angle');
    expect(useLabStore.getState().setup.kind).toBe('angle');
    // The shared setup stays; the match's sides and Runs slider make way for the beats.
    expect(screen.getByRole('combobox', { name: 'Slot role' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Runs' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Beats' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Run' })).toHaveLength(1);

    await user.click(screen.getByRole('radio', { name: 'Match' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    expect(screen.getByRole('slider', { name: 'Runs' })).toBeInTheDocument();
  });

  it('starts with one beat of the type’s default and says who to add before Run', async () => {
    renderLab();
    await findAngleType();
    expect(useLabStore.getState().angle.beats.map((beat) => beat.beatKey)).toEqual(['beat.promo']);
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    expect(screen.getByText('Add someone to beat 1 to run')).toBeInTheDocument();
  });

  it('holds a pre-show to 2 beats and lets the main event take more', async () => {
    const { user } = renderLab();
    await findAngleType();
    await choose(user, 'Slot role', 'Pre-show');

    const addBeat = screen.getByRole('button', { name: 'Add beat' });
    await waitFor(() => {
      expect(screen.getAllByText('Short slot: up to 2 beats').length).toBeGreaterThan(0);
    });
    await user.click(addBeat);
    expect(addBeat).toHaveAttribute('aria-disabled', 'true');

    await choose(user, 'Slot role', 'Main event');
    await waitFor(() => {
      expect(addBeat).not.toHaveAttribute('aria-disabled');
    });
    expect(screen.getAllByText('Long slot: up to 6 beats').length).toBeGreaterThan(0);
  });

  it('runs three beats: the angle score, Why? and a row for each beat', async () => {
    const { transport, user } = renderLab();
    await findAngleType();
    await choose(user, 'Slot role', 'Main event');
    const rows = await buildThreeBeats(transport);

    const bug = await run(user);
    const score = useLabStore.getState().angleRun;
    expect(score?.args.beats).toHaveLength(3);
    expect(within(bug).getByRole('button', { name: /^Why is Angle score \d+\?$/ })).toBeVisible();
    for (const label of ['Stars', 'Delivered', 'Crowd']) {
      expect(
        within(bug).getByRole('button', { name: new RegExp(`^Why is ${label} `) }),
      ).toBeVisible();
    }
    expect(screen.getByText(/^Expected$/)).toBeInTheDocument();

    const table = screen.getByRole('grid', { name: 'Each beat of the angle' });
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(3);
    expect(within(bodyRows[1] ?? table).getByText('War of Words')).toBeInTheDocument();
    expect(
      within(bodyRows[0] ?? table).getByText(new RegExp(`^${rowAt(rows, 0).name} — Mic \\d+`)),
    ).toBeInTheDocument();
    // War of Words is the angle's second talk beat; the last beat closes it.
    expect(within(bodyRows[1] ?? table).getByText('repeat ×0.85')).toBeInTheDocument();
    expect(within(bodyRows[2] ?? table).getByText('closing')).toBeInTheDocument();
    // The editor's score chips show the same per-beat values.
    expect(screen.getAllByRole('button', { name: /^Why is Promo score \d+\?$/ })).toHaveLength(4);
  });

  it('shows the Aftermath of the angle: everyone in it, with a Why? and no morale (MTCH5-06)', async () => {
    const { transport, user } = renderLab();
    await findAngleType();
    expect(
      await screen.findByRole('heading', { name: 'Nothing run yet' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    await choose(user, 'Slot role', 'Main event');
    const rows = await buildThreeBeats(transport);
    await run(user);
    expect(useLabStore.getState().angleRun?.args.aftermath).toBe(true);

    const table = await screen.findByRole(
      'grid',
      { name: 'What the angle would do to everyone in it' },
      { timeout: LOAD_MS },
    );
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    const first = bodyRows[0] ?? table;
    expect(within(first).getByText(rowAt(rows, 0).name)).toBeInTheDocument();
    expect(within(first).getByText('In 2 of 3 beats')).toBeInTheDocument();
    expect(
      within(first).getByRole('button', {
        name: new RegExp(`^Why is ${rowAt(rows, 0).name}'s popularity change`),
      }),
    ).toBeVisible();
    expect(screen.queryByText(/morale/i)).toBeNull();
  });

  it('sends a manager chosen in the menu with the Run', async () => {
    const { world } = tinyWorld();
    const managerId = world.tables.people
      .values()
      .find((person) => person.defaultRingName === 'Test Person 008')?.id;
    if (managerId === undefined) throw new Error('No Test Person 008.');
    const edited = world.transact('make a manager', (tx) => {
      tx.update('people', managerId, { roles: ['wrestler', 'manager'] });
    });
    if (!edited.ok) throw edited.error;
    const { transport, user } = renderLab({ state: initialEngineState(world) });
    await findAngleType();
    const rows = await rosterRows(transport);
    const talker = rowAt(rows, 0);
    act(() => {
      useLabStore.getState().setAngle({
        beats: [{ id: 'beat-1', beatKey: 'beat.promo', groupOne: [chip(talker)], groupTwo: [] }],
        people: { [talker.personId]: talker },
      });
    });

    await user.click(screen.getByRole('button', { name: `Manager for ${talker.name}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Choose a manager…' }));
    const sheet = await screen.findByRole('dialog', { name: `Manager for ${talker.name}` });
    const grid = await within(sheet).findByRole('grid', {}, { timeout: LOAD_MS });
    await waitFor(() => {
      expect(grid.querySelectorAll('tbody tr[data-row-id]')).toHaveLength(1);
    });
    const [managerRow] = [...grid.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')];
    if (managerRow === undefined) throw new Error('No manager listed.');
    await user.click(managerRow);
    expect(await screen.findByText('Mgr: Test Person 008')).toBeInTheDocument();

    await run(user);
    expect(useLabStore.getState().angleRun?.args.managerOverrides).toEqual({
      [talker.personId]: managerId satisfies PersonId,
    });
  });

  it('shows the engine’s refusal under the beats', async () => {
    const { transport, user } = renderLab();
    await findAngleType();
    const rows = await rosterRows(transport);
    const [talker, notAManager] = [rowAt(rows, 0), rowAt(rows, 1)];
    act(() => {
      useLabStore.getState().setAngle({
        beats: [{ id: 'beat-1', beatKey: 'beat.promo', groupOne: [chip(talker)], groupTwo: [] }],
        managerOverrides: { [talker.personId]: notAManager.personId },
      });
    });
    await user.click(screen.getByRole('button', { name: 'Run' }));
    const panel = screen.getByRole('region', { name: 'Angle' });
    const alert = await within(panel).findByRole('alert', {}, { timeout: LOAD_MS });
    expect(alert.textContent).toMatch(/manager/i);
    expect(screen.queryByRole('group', { name: 'Angle result' })).toBeNull();
  });

  it('explains a save from before beats instead of building', async () => {
    const state = fakeEngineState();
    const { beats, angleTemplates, ...catalogs } = state.world.meta.catalogs;
    expect(beats).toBeDefined();
    expect(angleTemplates).toBeDefined();
    renderLab({
      state: { ...state, world: { ...state.world, meta: { ...state.world.meta, catalogs } } },
    });
    expect(await screen.findByText(NO_BEATS_TITLE, {}, { timeout: LOAD_MS })).toBeInTheDocument();
    expect(screen.getByText(NO_BEAT_CATALOG_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });
});
