/**
 * MTCH4's "Injured" banner on the results page (MTCH4-06), in the real route tree against the test
 * engine in process. The tiny world's completed show `evi_0000000001` gets one injury from its
 * opener, so that card has the banner and every other card has none.
 */
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { initialEngineState, parseContentKey, parseId } from '@ringside/engine';
import type { PersonId } from '@ringside/engine';
import { tinyWorld } from '@ringside/engine/testing';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { resetSettingsForTest } from '@/test/settings';
import { fakeEngineFactory } from '@/test/fakeEngine';

const SHOW = parseId('eventInstance', 'evi_0000000001');
const LOAD_MS = 10_000;

afterEach(() => {
  resetSettingsForTest();
  useSessionStore.getState().clear();
});

/** The tiny world with one healed injury from the show's first match on the main card. */
function worldWithInjury(): { state: ReturnType<typeof initialEngineState>; hurt: PersonId } {
  const { world } = tinyWorld();
  const opener = world.tables.segments
    .values()
    .filter((segment) => segment.eventInstanceId === SHOW && segment.kind === 'match')
    .sort((left, right) => Number(right.preShow) - Number(left.preShow) || left.slot - right.slot)
    .find((segment) => !segment.preShow);
  if (opener === undefined) throw new Error('no opener');
  const hurt = world.tables.participants
    .values()
    .find(
      (participant) => participant.segmentId === opener.id && participant.role === 'competitor',
    );
  if (hurt === undefined) throw new Error('no competitor');
  const show = world.tables.eventInstances.require(SHOW);
  const outcome = world.transact('test injury', (tx) => {
    tx.create('injuries', {
      personId: hurt.personId,
      kindKey: parseContentKey('injury.test-leg'),
      bodyPart: 'legs',
      severity: 'moderate',
      since: show.date,
      expectedReturn: show.date,
      returnedOn: show.date,
      source: 'segment',
      segmentId: opener.id,
      canWorkAngles: false,
      conditionLoss: 4,
      noticedOn: show.date,
    });
  });
  if (!outcome.ok) throw outcome.error;
  return { state: initialEngineState(world), hurt: hurt.personId };
}

function renderResults(state: ReturnType<typeof initialEngineState>) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [routes.game.showResults(SHOW)],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
}

describe('the injury banner on the results page', () => {
  it("shows on the hurt worker's match card only, with weeks out", async () => {
    const { state } = worldWithInjury();
    renderResults(state);
    const banner = await screen.findByRole('region', { name: /^Injured: / }, { timeout: LOAD_MS });
    expect(within(banner).getByText('Out about 1 week')).toBeInTheDocument();
    const cards = screen.getAllByRole('article');
    const withBanner = cards.filter(
      (card) => within(card).queryByRole('region', { name: /^Injured: / }) !== null,
    );
    expect(withBanner).toHaveLength(1);
    expect(withBanner[0]?.getAttribute('data-role')).not.toBeNull();
  });

  it('shows no banner on a show nobody was hurt on', async () => {
    renderResults(initialEngineState(tinyWorld().world));
    await screen.findByRole('heading', { level: 1, name: 'Test Weekly' }, { timeout: LOAD_MS });
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: /^Injured: / })).not.toBeInTheDocument();
  });
});
