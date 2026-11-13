// The worker profile's Health tab (WRK6-05).
import { render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonId } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { EngineTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { fakeEngineFactory, healthFakeState } from '@/test/fakeEngine';
import { HealthPanel, medicalLine } from './HealthTab';
import { HEALTH_TAB } from './registerHealthTab';

/** The lazily loaded profile and tab chunks can take a moment under load. */
const LOAD_MS = 10_000;

const ACKNOWLEDGE = 'health.acknowledgeInjuries';

interface Setup {
  readonly transport: EngineTransport;
  readonly people: ReturnType<typeof healthFakeState>['people'];
  /** Every command name the tab sent, in order. */
  readonly commands: () => string[];
}

function setup(): Setup {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const { state, people } = healthFakeState();
  const install = transport.host.installEngine(state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const spy = vi.spyOn(transport.host, 'command');
  return {
    transport,
    people,
    commands: () => spy.mock.calls.map(([name]) => name),
  };
}

function renderPanel({ transport }: Setup, personId: PersonId) {
  return render(
    <EngineProvider createTransport={() => transport}>
      <HealthPanel personId={personId} />
    </EngineProvider>,
  );
}

beforeEach(() => {
  useSessionStore.getState().clear();
});

describe('the Health tab', () => {
  it('is on every profile, after Career and before Form', () => {
    expect(HEALTH_TAB).toMatchObject({ id: 'health', label: 'Health', order: 50 });
  });

  it('names the medical care, or says there is no employer', () => {
    expect(medicalLine({ level: 3, promotionId: null, promotionName: 'Altura Wrestling' })).toBe(
      'Medical care: Altura Wrestling, level 3',
    );
    expect(medicalLine({ level: 1, promotionId: null, promotionName: null })).toBe(
      'Medical care: no employer, level 1',
    );
  });

  it('draws six condition bars with the age cap, the fatigue meter, and Fit to work', async () => {
    const context = setup();
    renderPanel(context, context.people.fit);

    const condition = await screen.findByRole(
      'region',
      { name: 'Condition' },
      { timeout: LOAD_MS },
    );
    const bars = within(condition).getAllByRole('meter');
    expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual([
      'Head',
      'Neck',
      'Back',
      'Arms',
      'Torso',
      'Legs',
    ]);
    for (const bar of bars) {
      expect(bar.getAttribute('aria-valuetext')).toMatch(/age cap \d+/);
    }
    expect(
      within(condition).getByRole('button', { name: /^Why is Legs: age cap \d+\?$/ }),
    ).toBeVisible();
    expect(
      within(condition).getByRole('button', { name: /^Why is Legs: next weekly recovery \d+\?$/ }),
    ).toBeVisible();
    expect(screen.getByRole('meter', { name: 'Fatigue' })).toBeInTheDocument();
    expect(screen.getByText(/^Medical care: Test Promotion A, level \d$/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fit to work' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No injuries on record' })).toBeInTheDocument();
    expect(within(condition).queryByText('Injured')).not.toBeInTheDocument();
    expect(context.commands()).not.toContain(ACKNOWLEDGE);
  });

  it('shows the player’s new injury, its history, and marks it seen exactly once', async () => {
    const context = setup();
    renderPanel(context, context.people.injured);

    const card = await screen.findByRole(
      'region',
      { name: /Test arm injury/ },
      { timeout: LOAD_MS },
    );
    expect(within(card).getByText('Severe')).toBeInTheDocument();
    const condition = screen.getByRole('region', { name: 'Condition' });
    expect(within(condition).getAllByText('Injured')).toHaveLength(1);
    const history = screen.getByRole('region', { name: 'Injury history' });
    expect(within(history).getAllByText('Test arm injury')).toHaveLength(1);

    await waitFor(() => {
      expect(context.commands().filter((name) => name === ACKNOWLEDGE)).toHaveLength(1);
    });
    // Once seen, the profile refetches without the "New" badge, and nothing is sent again.
    await waitFor(() => {
      expect(within(card).queryByText('New')).not.toBeInTheDocument();
    });
    expect(context.commands().filter((name) => name === ACKNOWLEDGE)).toHaveLength(1);
  });

  it('shows a rival’s injury the same way and sends nothing', async () => {
    const context = setup();
    renderPanel(context, context.people.rivalInjured);

    const card = await screen.findByRole(
      'region',
      { name: /Test arm injury/ },
      { timeout: LOAD_MS },
    );
    expect(within(card).queryByText('New')).not.toBeInTheDocument();
    expect(screen.getByText(/^Medical care: Test Promotion B, level \d$/)).toBeInTheDocument();
    // Give a stray effect the chance to fire before checking nothing went out.
    await screen.findByRole('meter', { name: 'Fatigue' });
    expect(context.commands()).toEqual([]);
  });

  it('opens from the profile with ?tab=health', async () => {
    const context = setup();
    const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
      initialEntries: [`${routes.game.worker(context.people.fit)}?tab=health`],
      future: routerFutureFlags,
    });
    render(
      <EngineProvider createTransport={() => context.transport}>
        <RouterProvider router={router} future={routerProviderFutureFlags} />
      </EngineProvider>,
    );
    expect(
      await screen.findByRole('tab', { name: 'Health', selected: true }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Fit to work' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
  }, 20_000);
});
