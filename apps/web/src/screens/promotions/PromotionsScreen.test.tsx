import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineState } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { resetMatchMedia, setMatchMedia } from '@/test/matchMedia';
import { RIVAL_RULES_FOOTER } from './RivalRulesChip';

/** The engine's first answers can take a moment under load. */
const LOAD_MS = 10_000;

function renderPromotions(path: string = routes.game.promotions(), state = fakeEngineState()) {
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

async function findTable(): Promise<HTMLElement> {
  return screen.findByRole('grid', { name: 'Promotions' }, { timeout: LOAD_MS });
}

function levelPlayingFieldState(): EngineState {
  const state = fakeEngineState();
  state.world.meta.settings.levelPlayingField = true;
  return state;
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

afterEach(() => {
  resetMatchMedia();
});

describe('PromotionsScreen', () => {
  it('lists the tiny world’s promotions with who runs each, and no money', async () => {
    renderPromotions();
    const table = await findTable();
    expect(screen.getByRole('heading', { level: 1, name: 'Promotions' })).toBeInTheDocument();
    const rowA = (await within(table).findByRole('link', { name: 'Test Promotion A' })).closest(
      'tr',
    );
    const rowB = within(table).getByRole('link', { name: 'Test Promotion B' }).closest('tr');
    if (rowA === null || rowB === null) throw new Error('A promotion is not in a table row.');
    expect(within(rowA).getByText('You')).toBeInTheDocument();
    expect(within(rowB).getByText('Computer')).toBeInTheDocument();
    expect(within(table).queryByText(/\$/)).toBeNull();
    expect(screen.getByText(/2 promotions · 1 run by the computer/)).toBeInTheDocument();
  });

  it('opens the Why? of a home popularity', async () => {
    const { user } = renderPromotions();
    const table = await findTable();

    const [why] = await within(table).findAllByRole('button', { name: /^Why is Popularity in / });
    if (why === undefined) throw new Error('No popularity Why? in the table.');
    await user.click(why);

    expect(await screen.findByRole('dialog', { name: /^Popularity in / })).toBeInTheDocument();
  });

  it('lists all six shortcuts behind the Rival rules chip', async () => {
    const { user } = renderPromotions();

    const chip = await screen.findByRole(
      'button',
      { name: /^Rival rules: 6 on$/ },
      { timeout: LOAD_MS },
    );
    await user.click(chip);

    const dialog = await screen.findByRole('dialog', { name: 'Rival rules' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(6);
    expect(within(dialog).getByText('+3')).toBeInTheDocument();
    expect(within(dialog).getByText('ai.skipWorkerRequests')).toBeInTheDocument();
    expect(within(dialog).getByText(RIVAL_RULES_FOOTER)).toBeInTheDocument();
  });

  it('reads "Level playing field" when the game was started with it, in a sheet on a phone', async () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    const { user } = renderPromotions(routes.game.promotions(), levelPlayingFieldState());

    const chip = await screen.findByRole(
      'button',
      { name: 'Level playing field' },
      { timeout: LOAD_MS },
    );
    await user.click(chip);

    const sheet = await screen.findByRole('dialog', { name: 'Rival rules' });
    expect(within(sheet).getAllByText('Off')).toHaveLength(6);
  });

  it('keeps the sort in the URL and carries it to the profile’s back link', async () => {
    const { router, user } = renderPromotions(`${routes.game.promotions()}?sort=name&dir=asc`);
    const table = await findTable();

    await user.click(await within(table).findByRole('link', { name: 'Test Promotion B' }));

    const back = await screen.findByRole(
      'link',
      { name: 'Back to Promotions' },
      { timeout: LOAD_MS },
    );
    expect(back).toHaveAttribute('href', `${routes.game.promotions()}?sort=name&dir=asc`);
    expect(router.state.location.pathname).toMatch(/^\/game\/promotions\/pro_/);
  });
});
