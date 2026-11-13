import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { PromotionId } from '@ringside/engine';
import { tinyWorld } from '@ringside/engine/testing';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { registerPromotionTab } from './promotionTabs';

/** The lazily loaded profile chunk and the engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;

interface TinyPromotions {
  /** Run by the local seat. */
  readonly own: PromotionId;
  /** Run by the computer, with a revealed review and a plan not aired yet. */
  readonly rival: PromotionId;
}

function tinyPromotions(): TinyPromotions {
  const { ids } = tinyWorld();
  const own = ids.promotions.A;
  const rival = ids.promotions.B;
  if (own === undefined || rival === undefined) throw new Error('The tiny world lost a promotion.');
  return { own, rival };
}

function renderProfile(path: string) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(fakeEngineState());
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

async function findHeading(name: string | RegExp): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name }, { timeout: LOAD_MS });
}

function tabNames(): string[] {
  return screen.getAllByRole('tab').map((tab) => tab.textContent);
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

describe('PromotionProfileScreen', () => {
  it('shows a rival’s header and key numbers, with its cash kept private', async () => {
    const { rival } = tinyPromotions();
    renderProfile(routes.game.promotion(rival));

    const heading = await findHeading('Test Promotion B');
    const header = heading.closest('header');
    if (header === null) throw new Error('The heading is not inside the header.');
    expect(within(header).getByText('Run by: Computer')).toBeInTheDocument();
    expect(within(header).getByText('Technical')).toBeInTheDocument();

    const cash = screen.getByRole('group', { name: 'Cash' });
    expect(cash).toHaveTextContent('Private');
    // ECO1's company size is public, so a rival's shows (AIP1-07).
    expect(
      await screen.findByRole('group', { name: 'Company size' }, { timeout: LOAD_MS }),
    ).toHaveTextContent(/Local|Regional|National|Continental|Global/);
    expect(
      screen.getByRole('button', { name: /^Why is Worldwide popularity/ }),
    ).toBeInTheDocument();
    const sidebar = screen.getByRole('navigation', { name: 'Main' });
    expect(within(sidebar).getByRole('link', { name: 'Promotions' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows your own cash exactly and plays by the full rules', async () => {
    const { own } = tinyPromotions();
    renderProfile(routes.game.promotion(own));

    await findHeading('Test Promotion A');
    expect(screen.getByRole('group', { name: 'Cash' })).toHaveTextContent('$');
    expect(screen.getByText(/^Plays by the full rules/)).toBeInTheDocument();
    // Your own promotion has no computer-run brand, so no Decision log.
    expect(tabNames()).toEqual(['Overview', 'Roster']);
  });

  it('switches tabs through ?tab=, and an unknown tab falls back to Overview', async () => {
    const { rival } = tinyPromotions();
    const { router, user } = renderProfile(`${routes.game.promotion(rival)}?tab=nonsense`);

    await findHeading('Test Promotion B');
    expect(tabNames()).toEqual(['Overview', 'Roster', 'Shows', 'Decision log']);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: 'Roster' }));
    expect(router.state.location.search).toBe('?tab=roster');
    const [why] = await screen.findAllByRole(
      'button',
      { name: /^Why is Card value at Test Promotion B/ },
      { timeout: LOAD_MS },
    );
    if (why === undefined) throw new Error('No card value Why? on the roster.');
    await user.click(why);
    expect(
      await screen.findByRole('dialog', { name: 'Card value at Test Promotion B' }),
    ).toBeInTheDocument();
  });

  it('shows the revealed review and counts the plan not aired yet', async () => {
    const { rival } = tinyPromotions();
    renderProfile(routes.game.promotion(rival, { tab: 'decision-log' }));

    await findHeading('Test Promotion B');
    const list = await screen.findByRole(
      'list',
      { name: 'Decisions, newest first' },
      { timeout: LOAD_MS },
    );
    const entries = within(list).getAllByRole('listitem');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveTextContent('Roster review');
    expect(entries[0]).toHaveTextContent('Weekly roster review: no pressing needs');
    expect(screen.getByText('1 plan hidden until it airs')).toBeInTheDocument();
  });

  it('adds a tab registered by another feature in its order, and drops it again', async () => {
    const { rival } = tinyPromotions();
    renderProfile(routes.game.promotion(rival));
    await findHeading('Test Promotion B');

    let unregister = (): void => undefined;
    act(() => {
      unregister = registerPromotionTab({
        id: 'front-office',
        label: 'Front office',
        order: 30,
        render: () => <p>Front office panel</p>,
      });
    });
    cleanups.push(unregister);
    expect(await screen.findByRole('tab', { name: 'Front office' })).toBeInTheDocument();
    expect(tabNames()).toEqual(['Overview', 'Roster', 'Front office', 'Shows', 'Decision log']);

    act(() => {
      unregister();
    });
    expect(screen.queryByRole('tab', { name: 'Front office' })).toBeNull();
  });

  it('says "Promotion not found" for an unknown promotion and for an address that is not one', async () => {
    renderProfile(routes.game.promotion(parseId('promotion', 'pro_0000009999')));
    expect(await findHeading('Promotion not found')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Back to Promotions' }).length).toBeGreaterThan(0);
  });
});
