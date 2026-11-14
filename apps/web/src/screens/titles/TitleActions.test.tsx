import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineState, PersonId } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';

/** The engine's first answers can take a moment under load. */
const LOAD_MS = 10_000;

const HEAVYWEIGHT = 'Test Heavyweight Title';
const TAG = 'Test Tag Team Title';

function renderAt(path: string, state: EngineState = fakeEngineState()) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [path],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { router, user: userEvent.setup({ delay: null }) };
}

function titleIdOf(state: EngineState, name: string) {
  const title = state.world.tables.titles.find((row) => row.name === name);
  if (title === undefined) throw new Error(`No title called ${name}.`);
  return title.id;
}

/** The ring name a promotion-A person works under. */
function ringNameOf(state: EngineState, personId: PersonId): string {
  const employment = state.world.tables.employments.find(
    (row) => row.personId === personId && row.status === 'active',
  );
  if (employment === undefined) throw new Error(`No employment for ${personId}.`);
  return employment.ringName;
}

/**
 * The tiny world with the heavyweight title made a women's title and two of promotion A's
 * wrestlers women. Its champion (a man) keeps the belt until it is awarded away.
 */
function womensTitleState(): { state: EngineState; women: readonly string[] } {
  const base = fakeEngineState();
  const promotionA = base.world.tables.promotions[0]?.id;
  const roster = base.world.tables.employments
    .filter((row) => row.promotionId === promotionA && row.status === 'active')
    .map((row) => row.personId);
  const womenIds = new Set(roster.slice(5, 7));
  const state: EngineState = {
    ...base,
    world: {
      ...base.world,
      tables: {
        ...base.world.tables,
        people: base.world.tables.people.map((person) =>
          womenIds.has(person.id) ? { ...person, gender: 'female' as const } : person,
        ),
        titles: base.world.tables.titles.map((title) =>
          title.name === HEAVYWEIGHT
            ? { ...title, division: { ...title.division, gender: 'female' as const } }
            : title,
        ),
      },
    },
  };
  return { state, women: [...womenIds].map((personId) => ringNameOf(state, personId)) };
}

/** The tiny world with the tag title handed to promotion B, run by the computer. */
function rivalTagState(): EngineState {
  const base = fakeEngineState();
  const promotionB = base.world.tables.promotions[1]?.id;
  if (promotionB === undefined) throw new Error('The tiny world has no promotion B.');
  return {
    ...base,
    world: {
      ...base.world,
      tables: {
        ...base.world.tables,
        titles: base.world.tables.titles.map((title) =>
          title.name === TAG ? { ...title, promotionId: promotionB, brandId: null } : title,
        ),
      },
    },
  };
}

async function findHeading(name: string): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name }, { timeout: LOAD_MS });
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

describe('Title actions: create and edit', () => {
  it('shows a duplicate name under the name field and changes nothing', async () => {
    const { user, router } = renderAt(routes.game.titles());
    await screen.findByRole('article', { name: HEAVYWEIGHT }, { timeout: LOAD_MS });
    await user.click(screen.getByRole('button', { name: 'New title' }));
    const sheet = await screen.findByRole('dialog', { name: 'New title' });
    await user.type(within(sheet).getByRole('textbox', { name: 'Name' }), HEAVYWEIGHT);
    await user.click(within(sheet).getByRole('button', { name: 'Create title' }));

    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    await waitFor(() => {
      expect(name).toHaveAccessibleDescription(
        expect.stringContaining(`already has a title called ${HEAVYWEIGHT}.`),
      );
    });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(router.state.location.pathname).toBe(routes.game.titles());
  });

  it('creates a title and opens its page', async () => {
    const { user, router } = renderAt(routes.game.titles());
    await screen.findByRole('article', { name: HEAVYWEIGHT }, { timeout: LOAD_MS });
    await user.click(screen.getByRole('button', { name: 'New title' }));
    const sheet = await screen.findByRole('dialog', { name: 'New title' });
    await user.type(within(sheet).getByRole('textbox', { name: 'Name' }), 'Test Crown');
    await user.click(within(sheet).getByRole('radio', { name: "Women's" }));
    await user.click(within(sheet).getByRole('radio', { name: /^Specialty/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Create title' }));

    expect(await findHeading('Test Crown')).toBeInTheDocument();
    expect(router.state.location.pathname).toMatch(/^\/game\/titles\/tit_/);
    expect(screen.getByText(/^Vacant since/)).toBeInTheDocument();
    expect(screen.getByText("Women's")).toBeInTheDocument();
  });

  it('locks the holders while the title is held, and announces Saved', async () => {
    const { user } = renderAt(routes.game.titles());
    const card = await screen.findByRole('article', { name: TAG }, { timeout: LOAD_MS });
    await user.click(within(card).getByRole('button', { name: `Actions for the ${TAG}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: `Edit ${TAG}` });
    const holders = within(sheet).getByRole('group', { name: 'Holders' });
    expect(within(holders).getByRole('radio', { name: 'Tag team' })).toBeChecked();
    expect(within(holders).getByRole('radio', { name: 'Singles' })).toBeDisabled();
    expect(within(sheet).getByText('Vacate the title to change this')).toBeInTheDocument();

    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Test Doubles Title');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByRole('article', { name: 'Test Doubles Title' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: `Edit ${TAG}` })).toBeNull();
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});

describe('Title actions: award', () => {
  it('lists only eligible people, shows the rest with reasons, and confirms a strip', async () => {
    const { state, women } = womensTitleState();
    const [first, second] = women;
    if (first === undefined || second === undefined) throw new Error('Two women expected.');
    const { user } = renderAt(routes.game.title(titleIdOf(state, HEAVYWEIGHT)), state);
    await findHeading(HEAVYWEIGHT);
    const bar = screen.getByRole('group', { name: `Change the ${HEAVYWEIGHT}` });
    await user.click(within(bar).getByRole('button', { name: 'Award' }));

    const sheet = await screen.findByRole('dialog', { name: `Award the ${HEAVYWEIGHT}` });
    const firstPick = await within(sheet).findByRole(
      'radio',
      { name: new RegExp(first) },
      { timeout: LOAD_MS },
    );
    const wrestlers = within(sheet).getByRole('group', { name: 'Wrestlers' });
    expect(within(wrestlers).getAllByRole('radio')).toHaveLength(2);
    expect(within(wrestlers).getByRole('radio', { name: new RegExp(second) })).toBeEnabled();

    await user.click(within(sheet).getByRole('switch', { name: "Show who can't hold it" }));
    const cannot = await within(sheet).findByRole(
      'group',
      { name: "Can't hold it" },
      { timeout: LOAD_MS },
    );
    const rest = within(cannot).getAllByRole('checkbox');
    expect(rest).toHaveLength(6);
    for (const box of rest) expect(box).toBeDisabled();
    expect(within(cannot).getAllByText(/women's title/i).length).toBe(6);

    await user.click(firstPick);
    await user.click(within(sheet).getByRole('button', { name: 'Award' }));
    const confirm = await screen.findByRole('alertdialog', {
      name: `Award the ${HEAVYWEIGHT} to ${first}?`,
    });
    expect(within(confirm).getByText(/reign ends as Stripped\.$/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Award' }));

    const champion = await screen.findByRole('region', { name: 'Champion' });
    await waitFor(() => {
      expect(within(champion).getByRole('link', { name: first })).toBeInTheDocument();
    });
    expect(screen.getAllByText('Stripped').length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: `Award the ${HEAVYWEIGHT}` })).toBeNull();
  });

  it('offers a whole team first for a tag title', async () => {
    const state = fakeEngineState();
    const { user } = renderAt(routes.game.title(titleIdOf(state, TAG)), state);
    await findHeading(TAG);
    await user.click(screen.getByRole('button', { name: 'Award' }));
    const sheet = await screen.findByRole('dialog', { name: `Award the ${TAG}` });
    const teams = await within(sheet).findByRole('group', { name: 'Teams' }, { timeout: LOAD_MS });
    // The tiny world's only team holds the title already, so it is marked and can't be picked.
    const team = within(teams).getByRole('radio', { name: /Test Tag Team A/ });
    expect(team).toBeDisabled();
    expect(within(teams).getByText('Champions')).toBeInTheDocument();
    const people = within(sheet).getByRole('group', { name: 'Or pick wrestlers' });
    expect(within(people).getAllByText('Champion')).toHaveLength(2);
  });
});

describe('Title actions: vacate, retire and reactivate', () => {
  it('confirms each one and shows the change', async () => {
    const state = fakeEngineState();
    const { user } = renderAt(routes.game.title(titleIdOf(state, HEAVYWEIGHT)), state);
    await findHeading(HEAVYWEIGHT);
    const bar = (): HTMLElement => screen.getByRole('group', { name: `Change the ${HEAVYWEIGHT}` });

    await user.click(within(bar()).getByRole('button', { name: 'Vacate' }));
    const vacate = await screen.findByRole('alertdialog', { name: `Vacate the ${HEAVYWEIGHT}?` });
    expect(within(vacate).getByText(/reign ends today as Vacated\.$/)).toBeInTheDocument();
    await user.click(within(vacate).getByRole('button', { name: 'Vacate' }));
    const champion = screen.getByRole('region', { name: 'Champion' });
    expect(
      await within(champion).findByText(/^Vacant since/, undefined, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(within(bar()).queryByRole('button', { name: 'Vacate' })).toBeNull();

    await user.click(within(bar()).getByRole('button', { name: 'Retire' }));
    const retire = await screen.findByRole('alertdialog', { name: `Retire the ${HEAVYWEIGHT}?` });
    expect(within(retire).getByText(/^It moves to Retired\./)).toBeInTheDocument();
    await user.click(within(retire).getByRole('button', { name: 'Retire' }));
    expect(
      await within(bar()).findByRole('button', { name: 'Reactivate' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Retired').length).toBeGreaterThan(0);

    await user.click(within(bar()).getByRole('button', { name: 'Reactivate' }));
    const back = await screen.findByRole('alertdialog', {
      name: `Bring the ${HEAVYWEIGHT} back?`,
    });
    expect(within(back).getByText(/^It returns vacant\./)).toBeInTheDocument();
    await user.click(within(back).getByRole('button', { name: 'Bring it back' }));
    expect(
      await within(bar()).findByRole('button', { name: 'Award' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});

describe('Title actions: rival titles', () => {
  it('shows no buttons on a rival title page or card', async () => {
    const state = rivalTagState();
    renderAt(routes.game.title(titleIdOf(state, TAG)), state);
    await findHeading(TAG);
    const main = screen.getByRole('main');
    for (const button of within(main).queryAllByRole('button')) {
      expect(button).toHaveAccessibleName(/^Why/);
    }
    expect(screen.queryByRole('group', { name: `Change the ${TAG}` })).toBeNull();
  });

  it('puts no menu on the cards around the world', async () => {
    const state = rivalTagState();
    renderAt(`${routes.game.titles()}?tab=world`, state);
    const card = await screen.findByRole('article', { name: TAG }, { timeout: LOAD_MS });
    expect(within(card).queryByRole('button', { name: /^Actions for/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New title' })).toBeNull();
  });
});
