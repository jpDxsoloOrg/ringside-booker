import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseId, PUSH_LABELS, WEIGHT_CLASS_LABELS } from '@ringside/engine';
import type { EngineState, PersonId } from '@ringside/engine';
import { tinyWorld } from '@ringside/engine/testing';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { registerProfileTab } from './profileTabs';
import type { ProfileTabDefinition } from './profileTabs';

/** The lazily loaded profile chunk and the engine's first answer can take a moment under load. */
const PROFILE_LOAD_MS = 10_000;

interface TinyPeople {
  /** A wrestler of the promotion the local seat runs, and its champion. */
  readonly own: PersonId;
  /** A wrestler of the computer-run promotion. */
  readonly rival: PersonId;
}

function tinyPeople(): TinyPeople {
  const { ids } = tinyWorld();
  const own = ids.people[0];
  const rival = ids.people[8];
  if (own === undefined || rival === undefined) throw new Error('The tiny world lost its people.');
  return { own, rival };
}

interface RenderOptions {
  readonly state?: EngineState;
  /** Navigation state the first entry carries, as a link from the workers list would. */
  readonly locationState?: unknown;
}

function renderProfile(
  path: string,
  { state = fakeEngineState(), locationState }: RenderOptions = {},
) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [locationState === undefined ? path : { pathname: path, state: locationState }],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { router, user: userEvent.setup() };
}

/** The page heading once the profile (or its not-found state) has loaded. */
async function findHeading(name: string | RegExp): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name }, { timeout: PROFILE_LOAD_MS });
}

function tabNames(): string[] {
  return screen.getAllByRole('tab').map((tab) => tab.textContent);
}

const cleanups: (() => void)[] = [];

function registerForTest(definition: ProfileTabDefinition): () => void {
  const unregister = registerProfileTab(definition);
  cleanups.push(unregister);
  return unregister;
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

afterEach(() => {
  // The profile is still mounted here and re-renders when a tab goes away.
  act(() => {
    for (const unregister of cleanups.splice(0)) unregister();
  });
});

describe('WorkerProfileScreen', () => {
  it('shows the header for one of the seat’s own wrestlers', async () => {
    const { own } = tinyPeople();
    renderProfile(routes.game.worker(own));

    const heading = await findHeading(/^Test /);
    const header = heading.closest('header');
    if (header === null) throw new Error('The heading is not inside the profile header.');

    const factList = header.querySelector('dl');
    if (factList === null) throw new Error('The header has no list of facts.');
    const facts = within(factList);
    expect(facts.getByText('Age').nextElementSibling).toHaveTextContent(/^\d+$/);
    expect(facts.getByText('183 cm · 100 kg')).toBeInTheDocument();
    expect(facts.getByText(WEIGHT_CLASS_LABELS.lightHeavyweight)).toBeInTheDocument();
    expect(facts.getByText('Test Promotion A')).toBeInTheDocument();
    expect(facts.getByText(PUSH_LABELS.midCard)).toBeInTheDocument();
    expect(within(header).getByText('Face')).toHaveAttribute('data-alignment', 'face');
    expect(within(header).getByRole('button', { name: /Available/ })).toHaveAttribute(
      'data-status',
      'available',
    );
    await waitFor(() => {
      expect(document.title).toBe(`${heading.textContent} · Ringside Booker`);
    });
  });

  it('keeps Workers highlighted in the sidebar', async () => {
    const { own } = tinyPeople();
    renderProfile(routes.game.worker(own));
    await findHeading(/^Test /);

    const sidebar = screen.getByRole('navigation', { name: 'Main' });
    expect(within(sidebar).getByRole('link', { name: 'Workers' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('has the four built-in tabs, opens on Overview and explains the main rating', async () => {
    const { own } = tinyPeople();
    const { user } = renderProfile(routes.game.worker(own));
    await findHeading(/^Test /);

    expect(tabNames()).toEqual([
      'Overview',
      'Attributes',
      'Popularity',
      'Career',
      'Health',
      'Form',
      'Contract',
    ]);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Would expect:')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Why is Wrestler overall \d+\?$/ }));
    const panel = await screen.findByRole('dialog', { name: 'Wrestler overall' });
    expect(within(panel).getByRole('tree')).toBeInTheDocument();
  });

  it('keeps the selected tab in the URL', async () => {
    const { own } = tinyPeople();
    const { router, user } = renderProfile(routes.game.worker(own));
    await findHeading(/^Test /);

    await user.click(screen.getByRole('tab', { name: 'Attributes' }));
    expect(router.state.location.search).toBe('?tab=attributes');
    expect(screen.getByRole('heading', { level: 2, name: 'In-ring' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Character' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Crew' })).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Ring work' })).toBeInTheDocument();
    const roleTable = screen.getByRole('table');
    const [, firstRow] = within(roleTable).getAllByRole('row');
    expect(firstRow).toHaveTextContent('Wrestler');
    expect(firstRow).toHaveTextContent('Main role');

    await user.click(screen.getByRole('tab', { name: 'Popularity' }));
    expect(router.state.location.search).toBe('?tab=popularity');
    expect(screen.getByRole('heading', { level: 2, name: 'Popularity' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Career' }));
    expect(router.state.location.search).toBe('?tab=career');
    expect(screen.getByRole('heading', { level: 2, name: 'Contracts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Title reigns' })).toBeInTheDocument();
    expect(screen.getByText('Test Heavyweight Title')).toBeInTheDocument();
    expect(screen.getByText('No teams yet')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(router.state.location.search).toBe('');
  });

  it('leaves focus on the tab strip, so the arrow keys walk along it', async () => {
    const { own } = tinyPeople();
    const { router, user } = renderProfile(routes.game.worker(own));
    await findHeading(/^Test /);

    await user.click(screen.getByRole('tab', { name: 'Attributes' }));
    expect(screen.getByRole('tab', { name: 'Attributes' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Popularity' })).toHaveFocus();
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tab=popularity');
    });
    expect(screen.getByRole('tab', { name: 'Popularity' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tab=career');
    });
    expect(screen.getByRole('tab', { name: 'Career' })).toHaveFocus();
  });

  it('opens on the tab the URL names', async () => {
    const { own } = tinyPeople();
    renderProfile(`${routes.game.worker(own)}?tab=career`);
    await findHeading(/^Test /);

    expect(screen.getByRole('tab', { name: 'Career' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Contracts' })).toBeInTheDocument();
  });

  it('falls back to Overview for a tab nobody registered', async () => {
    const { own } = tinyPeople();
    renderProfile(`${routes.game.worker(own)}?tab=nonsense`);
    await findHeading(/^Test /);

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Overall' })).toBeInTheDocument();
  });

  it('shows the seat’s own wage and morale, and no "Private"', async () => {
    const { own } = tinyPeople();
    renderProfile(`${routes.game.worker(own)}?tab=career`);
    await findHeading(/^Test /);

    const contracts = screen.getByRole('grid', { name: /^Contracts of / });
    expect(within(contracts).getByText(/per month$/)).toBeInTheDocument();
    expect(within(contracts).queryByText('Private')).toBeNull();
  });

  it('shows "Private" for a rival worker’s wage and morale', async () => {
    const { rival } = tinyPeople();
    renderProfile(`${routes.game.worker(rival)}?tab=career`);
    await findHeading(/^Test /);

    const contracts = screen.getByRole('grid', { name: /^Contracts of / });
    expect(within(contracts).getAllByText('Private')).toHaveLength(2);
    expect(within(contracts).queryByText(/per month$/)).toBeNull();
    expect(within(contracts).getByText('Test Promotion B')).toBeInTheDocument();
    expect(
      screen.getByText('Other promotions keep their wages and morale to themselves.'),
    ).toBeInTheDocument();
  });

  it('says "Worker not found" for an id the world does not have', async () => {
    renderProfile(routes.game.worker(parseId('person', 'per_zzzzzzzzzz')));

    expect(await findHeading('Worker not found')).toBeInTheDocument();
    expect(screen.getByText(/No such worker/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Workers' })).toHaveAttribute(
      'href',
      routes.game.workers(),
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await waitFor(() => {
      expect(document.title).toBe('Worker not found · Ringside Booker');
    });
  });

  it('says "Worker not found" for an address that is not a person id', async () => {
    renderProfile(`${routes.game.workers()}/not-an-id`);

    expect(await findHeading('Worker not found')).toBeInTheDocument();
    expect(screen.getByText(/That address is not a worker's/)).toBeInTheDocument();
  });
});

describe('WorkerProfileScreen: tabs from other features', () => {
  it('shows a registered tab in its place and drops it when it is unregistered', async () => {
    const { own } = tinyPeople();
    const unregister = registerForTest({
      id: 'scouting',
      label: 'Scouting',
      order: 25,
      render: ({ profile }) => <p>Scouting of {profile.header.ringName}</p>,
    });
    const { router, user } = renderProfile(routes.game.worker(own));
    const heading = await findHeading(/^Test /);

    expect(tabNames()).toEqual([
      'Overview',
      'Attributes',
      'Scouting',
      'Popularity',
      'Career',
      'Health',
      'Form',
      'Contract',
    ]);

    await user.click(screen.getByRole('tab', { name: 'Scouting' }));
    expect(router.state.location.search).toBe('?tab=scouting');
    expect(screen.getByText(`Scouting of ${heading.textContent}`)).toBeInTheDocument();

    act(() => {
      unregister();
    });
    expect(tabNames()).toEqual([
      'Overview',
      'Attributes',
      'Popularity',
      'Career',
      'Health',
      'Form',
      'Contract',
    ]);
    // The URL still names the tab that went away, so the profile shows Overview.
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('adds a tab registered while the profile is open, after the built-in ones', async () => {
    const { own } = tinyPeople();
    renderProfile(routes.game.worker(own));
    await findHeading(/^Test /);

    act(() => {
      registerForTest({ id: 'development', label: 'Development', order: 50, render: () => null });
    });

    expect(tabNames()).toEqual([
      'Overview',
      'Attributes',
      'Popularity',
      'Career',
      'Health',
      'Development',
      'Form',
      'Contract',
    ]);
  });

  it('leaves out a tab that says it is not visible, even when the URL asks for it', async () => {
    const { own } = tinyPeople();
    registerForTest({
      id: 'secret',
      label: 'Secret',
      order: 60,
      visible: () => false,
      render: () => <p>Secret content</p>,
    });
    renderProfile(`${routes.game.worker(own)}?tab=secret`);
    await findHeading(/^Test /);

    expect(tabNames()).toEqual([
      'Overview',
      'Attributes',
      'Popularity',
      'Career',
      'Health',
      'Form',
      'Contract',
    ]);
    expect(screen.queryByText('Secret content')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('hands a tab the person, the profile and the seat’s promotion', async () => {
    const { own } = tinyPeople();
    registerForTest({
      id: 'probe',
      label: 'Probe',
      order: 70,
      render: ({ personId, viewerPromotionId, profile }) => (
        <p data-testid="probe">
          {personId}|{viewerPromotionId ?? 'none'}|{profile.header.employer?.promotionId ?? 'none'}
        </p>
      ),
    });
    renderProfile(`${routes.game.worker(own)}?tab=probe`);
    await findHeading(/^Test /);

    const [personId, viewerPromotionId, employerId] = screen
      .getByTestId('probe')
      .textContent.split('|');
    expect(personId).toBe(own);
    expect(viewerPromotionId).toBe(employerId);
    expect(viewerPromotionId).not.toBe('none');
  });
});

describe('WorkerProfileScreen: the way back', () => {
  it('links back to the plain workers list by default', async () => {
    const { own } = tinyPeople();
    renderProfile(routes.game.worker(own));
    await findHeading(/^Test /);

    expect(screen.getByRole('link', { name: 'Back to Workers' })).toHaveAttribute(
      'href',
      routes.game.workers(),
    );
  });

  it('returns to the list with its filters, and still does after a tab change', async () => {
    const { own } = tinyPeople();
    const listUrl = `${routes.game.workers()}?role=wrestler&q=test`;
    const { user } = renderProfile(routes.game.worker(own), {
      locationState: { workersListUrl: listUrl },
    });
    await findHeading(/^Test /);

    expect(screen.getByRole('link', { name: 'Back to Workers' })).toHaveAttribute('href', listUrl);

    await user.click(screen.getByRole('tab', { name: 'Career' }));
    expect(screen.getByRole('link', { name: 'Back to Workers' })).toHaveAttribute('href', listUrl);
  });
});
