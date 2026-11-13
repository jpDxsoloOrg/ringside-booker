/**
 * The results page's Popularity section against the test engine, whose `popularity.showChange`
 * answers the gallery's fixtures by show id.
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { EventInstanceId, ShowPopularityChangeView } from '@ringside/engine';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import {
  bigTelevisedShowChange,
  showChangeFixtures,
  showChangeWithStatus,
  weakShowChange,
} from '@/screens/dev-gallery/fixtures/popularityShowChange';
import { listResultsSections } from '@/screens/show-results/resultsSectionRegistry';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { POPULARITY_EMPTY_TEXT, PopularitySection } from './PopularitySection';
import { POPULARITY_SECTION_ID, POPULARITY_SECTION_ORDER } from './register';

const LOAD_MS = 10_000;

afterEach(() => {
  useSessionStore.getState().clear();
});

function renderSection(eventInstanceId: EventInstanceId) {
  const transport = createInProcessTransport(
    fakeEngineFactory({ showChanges: showChangeFixtures() }),
    { progressIntervalMs: 0 },
  );
  const install = transport.host.installEngine(fakeEngineState());
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  return render(
    <EngineProvider createTransport={() => transport}>
      <PopularitySection eventInstanceId={eventInstanceId} />
    </EngineProvider>,
  );
}

function idOf(view: ShowPopularityChangeView): EventInstanceId {
  return view.eventInstanceId;
}

describe('PopularitySection', () => {
  it('is registered as the results page’s "Popularity" section, between card flow and workers', () => {
    const section = listResultsSections().find((entry) => entry.id === POPULARITY_SECTION_ID);
    expect(section?.label).toBe('Popularity');
    expect(POPULARITY_SECTION_ORDER).toBeGreaterThan(20);
    expect(POPULARITY_SECTION_ORDER).toBeLessThan(30);
  });

  it("lists a show's regions by country once the engine answers", async () => {
    renderSection(idOf(bigTelevisedShowChange));
    expect(
      await screen.findByText(
        'Fans gained in 11 regions, lost in 1, 5 about the same',
        {},
        { timeout: LOAD_MS },
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual([
      'United States',
      'Canada',
    ]);
  });

  it("shows a rival's weak show the same way, losses included", async () => {
    renderSection(idOf(weakShowChange));
    const heading = await screen.findByRole(
      'heading',
      { level: 3, name: 'United States' },
      { timeout: LOAD_MS },
    );
    expect(heading).toBeInTheDocument();
    const states = screen.getByRole('grid', { name: 'Regions in United States' });
    expect(within(states).getByText('down 1.48')).toBeInTheDocument();
  });

  it.each([
    ['notCompleted', POPULARITY_EMPTY_TEXT.notCompleted],
    ['pruned', POPULARITY_EMPTY_TEXT.pruned],
    ['notApplied', POPULARITY_EMPTY_TEXT.notApplied],
  ] as const)('says why there is nothing to list when the show is %s', async (status, text) => {
    renderSection(idOf(showChangeWithStatus(status)));
    expect(await screen.findByText(text, {}, { timeout: LOAD_MS })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(document.body.textContent).not.toMatch(/minutes|morale/i);
  });

  it('shows the engine refusal for an unknown show', async () => {
    renderSection(parseId('eventInstance', 'evi_0000009999'));
    expect(
      await screen.findByText("Popularity changes can't be shown", {}, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.getByText("That show doesn't exist.")).toBeInTheDocument();
  });

  it("sits under the card of a real results page, headed by the page's own panel heading", async () => {
    const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    const install = transport.host.installEngine(fakeEngineState());
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
    const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
      initialEntries: [routes.game.showResults(parseId('eventInstance', 'evi_0000000001'))],
      future: routerFutureFlags,
    });
    render(
      <EngineProvider createTransport={() => transport}>
        <RouterProvider router={router} future={routerProviderFutureFlags} />
      </EngineProvider>,
    );
    const section = await screen.findByRole('region', { name: 'Popularity' }, { timeout: LOAD_MS });
    expect(within(section).getAllByRole('heading', { level: 2 })).toHaveLength(1);
  });
});
