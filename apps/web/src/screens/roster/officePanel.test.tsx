import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { RosterRow } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { galleryTopOfRoster } from '@/screens/dev-gallery/fixtures/roster';
import { fakeEngineFactory } from '@/test/fakeEngine';
import { renderOfficePanel } from '@/test/officePanel';
import {
  NO_WRESTLERS_TEXT,
  TOP_OF_ROSTER_PANEL_ID,
  TOP_OF_ROSTER_TITLE,
  TopOfRosterPanel,
  VIEW_ROSTER_TEXT,
} from './officePanel';

/** The engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;

afterEach(() => {
  useSessionStore.getState().clear();
});

function renderPanel(rows: readonly RosterRow[]) {
  const router = createMemoryRouter([{ path: '*', element: <TopOfRosterPanel rows={rows} /> }], {
    initialEntries: ['/game/office'],
    future: routerFutureFlags,
  });
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  return render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
}

describe('the "Top of your roster" panel (WRK2-06)', () => {
  it("lists the player's most popular wrestlers from the engine, with the roster link", async () => {
    await renderOfficePanel(TOP_OF_ROSTER_PANEL_ID);

    const panel = await screen.findByRole(
      'region',
      { name: TOP_OF_ROSTER_TITLE },
      { timeout: LOAD_MS },
    );
    const items = within(panel).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(5);
    for (const item of items) {
      expect(within(item).getByRole('link')).toHaveAttribute(
        'href',
        expect.stringMatching(/^\/game\/workers\//u),
      );
      expect(within(item).getByRole('button', { name: /^Why is .* popularity/u })).toBeVisible();
    }
    expect(within(panel).getByRole('link', { name: VIEW_ROSTER_TEXT })).toHaveAttribute(
      'href',
      routes.game.roster(),
    );
  });

  it('shows push, popularity and momentum, with a dash before the first appearance', () => {
    renderPanel(galleryTopOfRoster);
    const panel = screen.getByRole('region', { name: TOP_OF_ROSTER_TITLE });
    const [first] = within(panel).getAllByRole('listitem');
    if (first === undefined) throw new Error('No rows.');
    const top = galleryTopOfRoster[0];
    if (top === undefined) throw new Error('No sample rows.');
    expect(within(first).getByRole('link', { name: top.ringName })).toBeVisible();
    expect(within(first).getByText('Main event')).toBeVisible();
    expect(within(first).getByText('Popularity')).toBeVisible();
    expect(within(first).getByText('Momentum')).toBeVisible();
    const noMomentum = galleryTopOfRoster.findIndex((row) => row.momentum.value === null);
    const row = within(panel).getAllByRole('listitem')[noMomentum];
    if (row === undefined) throw new Error('The sample has no wrestler without momentum.');
    expect(within(row).getByText('–')).toBeVisible();
  });

  it('says so when there are no wrestlers, and still links to the roster', () => {
    renderPanel([]);
    const panel = screen.getByRole('region', { name: TOP_OF_ROSTER_TITLE });
    expect(within(panel).getByText(NO_WRESTLERS_TEXT)).toBeVisible();
    expect(within(panel).getByRole('link', { name: VIEW_ROSTER_TEXT })).toBeVisible();
  });
});
