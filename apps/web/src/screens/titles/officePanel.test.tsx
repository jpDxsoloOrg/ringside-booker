import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { renderOfficePanel } from '@/test/officePanel';
import {
  ALL_TITLES_TEXT,
  CHAMPIONS_PANEL_ID,
  CHAMPIONS_TITLE,
  ChampionsPanel,
  championRows,
  NO_TITLES_TEXT,
} from './officePanel';

/** The engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;

afterEach(() => {
  useSessionStore.getState().clear();
});

describe('the Office "Champions" panel (CRTV1-06, with DAY2)', () => {
  it("shows every active title of the player's promotion, each linking to its title page", async () => {
    const { transport } = await renderOfficePanel(CHAMPIONS_PANEL_ID);
    const answer = await transport.host.query('titles.list', { scope: 'own', status: 'active' });
    if (!answer.result.ok) throw new Error('titles.list was refused');
    const rows = championRows(answer.result.data);
    expect(rows.length).toBeGreaterThan(0);

    const panel = await screen.findByRole(
      'region',
      { name: CHAMPIONS_TITLE },
      { timeout: LOAD_MS },
    );
    const cards = within(panel).getByRole('region', { name: 'Your champions' });
    const items = within(cards).getAllByRole('listitem');
    expect(items).toHaveLength(rows.length);
    rows.forEach((row, index) => {
      const item = items[index];
      if (item === undefined) throw new Error(`no card for ${row.name}`);
      expect(within(item).getByRole('link', { name: row.name })).toHaveAttribute(
        'href',
        routes.game.title(row.titleId),
      );
    });
    expect(within(panel).getByRole('link', { name: ALL_TITLES_TEXT })).toHaveAttribute(
      'href',
      routes.game.titles(),
    );
  });

  it('says so when the promotion has no active titles', () => {
    const router = createMemoryRouter([{ path: '*', element: <ChampionsPanel rows={[]} /> }], {
      initialEntries: ['/game/office'],
      future: routerFutureFlags,
    });
    render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
    const panel = screen.getByRole('region', { name: CHAMPIONS_TITLE });
    expect(within(panel).getByText(NO_TITLES_TEXT)).toBeInTheDocument();
    expect(within(panel).queryByRole('region', { name: 'Your champions' })).toBeNull();
  });
});
