// AIP5-05: a rival show that has run lists the booker's result per match; one still to air shows
// nothing about its planned results.
import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CARD_HIDDEN_TEXT } from '@ringside/engine';
import { useTracePanelStore } from '@/components/Trace';
import { LOAD_MS, loadShowCardsWorld, renderWithShowCards } from '@/test/showCardsWorld';
import type { LoadedShowCards } from '@/test/showCardsWorld';
import { ShowsTab } from './ShowsTab';

let loaded: LoadedShowCards;

beforeAll(async () => {
  loaded = await loadShowCardsWorld();
}, 30_000);

afterEach(() => {
  act(() => {
    useTracePanelStore.setState({ openPanelId: null });
  });
});

async function openShow(name: string) {
  const user = renderWithShowCards(loaded, <ShowsTab promotionId={loaded.promotions.rival} />);
  const toggle = await screen.findByRole(
    'button',
    { name: new RegExp(`^(?!Why).*${name}`) },
    { timeout: LOAD_MS },
  );
  const show = toggle.closest('article');
  if (show === null) throw new Error(`${name} is not in a show card.`);
  await user.click(toggle);
  return { show, user };
}

describe('rival results on the Shows tab', () => {
  it(
    'gives every match on a show that ran its winner, a reason and a Why?, and the titles their badges',
    { timeout: 20_000 },
    async () => {
      const { show, user } = await openShow('Rival Weekly');
      const card = within(show).getByRole('list', { name: 'Rival Weekly card' });
      const matches = [...card.querySelectorAll<HTMLElement>('li[data-segment-kind="match"]')];
      expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        const line = match.querySelector<HTMLElement>('[data-part="rival-result"]');
        if (line === null) throw new Error('A match has no result line.');
        expect(line.querySelector('[data-part="outcome"]')).toHaveTextContent(/ def\. |^Draw$/);
        expect(within(line).getByRole('button', { name: /^Why this result\? / })).toBeVisible();
      }
      // Angles have no result line.
      for (const angle of card.querySelectorAll('li[data-segment-kind="angle"]')) {
        expect(angle.querySelector('[data-part="rival-result"]')).toBeNull();
      }
      // The main event's title stayed; the second title moved (its champion was leaving).
      expect(within(card).getByText('Retained')).toBeInTheDocument();
      expect(within(card).getByText('New champion')).toBeInTheDocument();
      expect(within(card).getAllByText('Contract ending').length).toBeGreaterThan(0);

      await user.click(
        within(card).getByRole('button', { name: 'Why Retained? Test Rival Title' }),
      );
      const panel = await screen.findByRole(
        'dialog',
        { name: 'Why Retained? Test Rival Title' },
        { timeout: LOAD_MS },
      );
      expect(panel).toHaveTextContent(/Change chance/);
    },
  );

  it('shows nothing about a card that has not aired', async () => {
    const { show } = await openShow('Rival Next');
    expect(within(show).getByText(CARD_HIDDEN_TEXT)).toBeInTheDocument();
    expect(show.querySelector('[data-part="rival-result"]')).toBeNull();
    expect(within(show).queryByText(/Retained|New champion/)).toBeNull();
  });
});
