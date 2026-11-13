import { parseId } from '@ringside/engine';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { promotionsListUrlFrom } from '@/app/entityLinks';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useTracePanelStore } from '../Trace';
import { PromotionLink } from './PromotionLink';

const PROMOTION_ID = parseId('promotion', 'pro_0000000001');

function renderLinkAt(path: string, truncate = false) {
  const link = (
    <PromotionLink promotionId={PROMOTION_ID} name="Test Promotion A" truncate={truncate} />
  );
  const router = createMemoryRouter(
    [
      { path: routes.game.promotions(), element: link },
      { path: routes.game.roster(), element: link },
      { path: routes.game.promotion(PROMOTION_ID), element: <p>Profile</p> },
    ],
    { initialEntries: [path], future: routerFutureFlags },
  );
  render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
  return router;
}

describe('PromotionLink', () => {
  it('links the name to the profile, with the whole name as the tooltip when cut short', () => {
    renderLinkAt(routes.game.roster(), true);

    const link = screen.getByRole('link', { name: 'Test Promotion A' });
    expect(link).toHaveAttribute('href', routes.game.promotion(PROMOTION_ID));
    expect(link).toHaveAttribute('title', 'Test Promotion A');
  });

  it('carries the list URL with its sort when followed from the list, and closes a Why?', async () => {
    const listUrl = `${routes.game.promotions()}?sort=prestige&dir=asc`;
    const router = renderLinkAt(listUrl);
    useTracePanelStore.getState().openPanel('some-panel');

    await userEvent
      .setup({ delay: null })
      .click(screen.getByRole('link', { name: 'Test Promotion A' }));

    expect(router.state.location.pathname).toBe(routes.game.promotion(PROMOTION_ID));
    expect(promotionsListUrlFrom(router.state.location.state)).toBe(listUrl);
    expect(useTracePanelStore.getState().openPanelId).toBeNull();
  });
});
