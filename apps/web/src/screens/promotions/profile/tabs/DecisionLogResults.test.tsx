// AIP5-05: the decision log's Winners and Titles chips filter AIP5's entries, and a title entry's
// Why? opens the title call.
import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PromotionProfile } from '@ringside/engine';
import { useTracePanelStore } from '@/components/Trace';
import { LOAD_MS, loadShowCardsWorld, renderWithShowCards } from '@/test/showCardsWorld';
import type { LoadedShowCards } from '@/test/showCardsWorld';
import { DecisionLogTab } from './DecisionLogTab';

let loaded: LoadedShowCards;
let profile: PromotionProfile;

beforeAll(async () => {
  loaded = await loadShowCardsWorld();
  const answer = await loaded.transport.host.query('promotions.profile', {
    promotionId: loaded.promotions.rival,
  });
  if (!answer.result.ok) throw new Error('promotions.profile failed.');
  profile = answer.result.data;
}, 30_000);

afterEach(() => {
  act(() => {
    useTracePanelStore.setState({ openPanelId: null });
  });
});

function renderLog() {
  return renderWithShowCards(
    loaded,
    <DecisionLogTab
      profile={profile}
      promotionId={loaded.promotions.rival}
      isOwn={false}
      viewerPromotionId={loaded.promotions.own}
    />,
  );
}

async function pick(user: ReturnType<typeof renderLog>, chip: string) {
  const chips = await screen.findByRole(
    'group',
    { name: 'Show decisions of kind' },
    { timeout: LOAD_MS },
  );
  await user.click(within(chips).getByRole('button', { name: chip }));
  const entries = await screen.findByRole('list', { name: 'Decisions, newest first' });
  return entries;
}

describe('the decision log with rival results', () => {
  it('filters to the winners the booker picked', { timeout: 20_000 }, async () => {
    const user = renderLog();
    const entries = await pick(user, 'Winners');
    await screen.findByRole('button', { name: 'Winners', pressed: true });
    const rows = within(entries).getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.dataset['kind'] === 'winner')).toBe(true);
  });

  it('filters to the title calls, each opening its own Why?', { timeout: 20_000 }, async () => {
    const user = renderLog();
    await pick(user, 'Titles');
    await screen.findByRole('button', { name: 'Titles', pressed: true });
    const entries = screen.getByRole('list', { name: 'Decisions, newest first' });
    const rows = await within(entries).findAllByRole('listitem');
    expect(rows.map((row) => row.dataset['kind'])).toEqual(['title', 'title']);
    const changed = rows.find((row) => row.textContent.includes('Test Rival Second Title'));
    if (changed === undefined) throw new Error('No entry for the title that moved.');
    await user.click(within(changed).getByRole('button'));
    const panel = await screen.findByRole('dialog', {}, { timeout: LOAD_MS });
    expect(panel).toHaveTextContent('Title decision: Test Rival Second Title');
  });
});
