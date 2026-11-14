import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { LOAD_MS, renderFinances } from '@/test/financesScreen';
import { lastAiringText, shortViewers } from './BroadcastIncomeKpi';

afterEach(() => {
  cleanup();
  useSessionStore.getState().clear();
});

describe('BroadcastIncomeKpi', () => {
  it('joins the Finances Overview with its Why?, the last airing and a link to Networks', async () => {
    await renderFinances(routes.game.finances());
    const card = await screen.findByRole(
      'group',
      { name: 'TV income (30 days)' },
      { timeout: LOAD_MS },
    );
    expect(
      within(card).getByRole('button', { name: /^Why is TV income \(30 days\)/ }),
    ).toBeInTheDocument();
    expect(within(card).getByText(/^Last airing: Test Weekly, /)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Networks' })).toHaveAttribute(
      'href',
      routes.game.networks(),
    );
    expect(card.textContent).not.toMatch(/\bmin(ute)?s?\b|hours?\b/i);
  });

  it('writes viewers short and says when nothing has aired', () => {
    expect(shortViewers(2_400_000)).toBe('2.4M');
    expect(lastAiringText(null)).toBe('Nothing has aired yet');
  });
});
