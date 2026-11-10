import { parseId } from '@ringside/engine';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { workersListUrlFrom } from '@/app/entityLinks';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useTracePanelStore } from '../Trace';
import { WorkerLink } from './WorkerLink';

const PERSON_ID = parseId('person', 'per_0000000001');

function renderLinkAt(path: string) {
  const link = <WorkerLink personId={PERSON_ID} name="Test Worker 001" />;
  const router = createMemoryRouter(
    [
      { path: routes.game.workers(), element: link },
      { path: routes.game.roster(), element: link },
      { path: routes.game.worker(PERSON_ID), element: <p>Profile</p> },
    ],
    { initialEntries: [path], future: routerFutureFlags },
  );
  render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
  return router;
}

describe('WorkerLink', () => {
  it('links the name to the profile', () => {
    renderLinkAt(routes.game.roster());

    expect(screen.getByRole('link', { name: 'Test Worker 001' })).toHaveAttribute(
      'href',
      routes.game.worker(PERSON_ID),
    );
  });

  it('carries the workers list URL, filters included, when followed from the list', async () => {
    const listUrl = `${routes.game.workers()}?role=wrestler&q=test`;
    const router = renderLinkAt(listUrl);

    await userEvent.setup().click(screen.getByRole('link', { name: 'Test Worker 001' }));

    expect(router.state.location.pathname).toBe(routes.game.worker(PERSON_ID));
    expect(workersListUrlFrom(router.state.location.state)).toBe(listUrl);
  });

  it('carries nothing when followed from another screen', async () => {
    const router = renderLinkAt(routes.game.roster());

    await userEvent.setup().click(screen.getByRole('link', { name: 'Test Worker 001' }));

    expect(workersListUrlFrom(router.state.location.state)).toBeNull();
  });

  it('closes an open Why? panel on the way', async () => {
    renderLinkAt(routes.game.roster());
    useTracePanelStore.getState().openPanel('some-panel');

    await userEvent.setup().click(screen.getByRole('link', { name: 'Test Worker 001' }));

    expect(useTracePanelStore.getState().openPanelId).toBeNull();
  });
});

describe('workersListUrlFrom', () => {
  it('only trusts a workers list URL', () => {
    expect(workersListUrlFrom({ workersListUrl: '/game/workers?role=referee' })).toBe(
      '/game/workers?role=referee',
    );
    expect(workersListUrlFrom({ workersListUrl: '/game/workers' })).toBe('/game/workers');
    expect(workersListUrlFrom({ workersListUrl: '/game/workersX' })).toBeNull();
    expect(workersListUrlFrom({ workersListUrl: 'https://example.test/' })).toBeNull();
    expect(workersListUrlFrom({ workersListUrl: 7 })).toBeNull();
    expect(workersListUrlFrom(null)).toBeNull();
    expect(workersListUrlFrom('text')).toBeNull();
  });
});
