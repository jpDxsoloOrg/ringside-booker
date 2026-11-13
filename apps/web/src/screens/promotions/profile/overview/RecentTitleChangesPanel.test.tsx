import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';
import { routes } from '@/app/routes';
import {
  galleryResultTraceOf,
  galleryTitleChanges,
} from '@/screens/dev-gallery/fixtures/rivalResults';
import { LOAD_MS, loadShowCardsWorld, renderWithShowCards } from '@/test/showCardsWorld';
import type { LoadedShowCards } from '@/test/showCardsWorld';
import { NO_TITLE_CHANGES_TEXT, RecentTitleChangesList } from './RecentTitleChangesList';
import { RecentTitleChangesPanel } from './RecentTitleChangesPanel';

let loaded: LoadedShowCards;

beforeAll(async () => {
  loaded = await loadShowCardsWorld();
}, 30_000);

describe('RecentTitleChangesList', () => {
  it('lists the changes in the order given, newest first, with who, whom and how long', () => {
    render(
      <MemoryRouter>
        <RecentTitleChangesList changes={galleryTitleChanges} traceOf={galleryResultTraceOf} />
      </MemoryRouter>,
    );
    const items = within(screen.getByRole('list', { name: 'Recent title changes' })).getAllByRole(
      'listitem',
    );
    expect(items.map((item) => item.querySelector('time')?.getAttribute('datetime'))).toEqual([
      '2026-03-07',
      '2026-02-21',
      '2026-01-31',
    ]);
    expect(items[0]).toHaveTextContent('Dante Rivers won the Coastal Heavyweight Title');
    expect(items[0]).toHaveTextContent('Beat Big Joe Sato · ended a 212-day reign');
    expect(items[1]).toHaveTextContent(
      'Vance Troy and Ollie Banks won the Coastal Tag Team Titles',
    );
    expect(items[2]).toHaveTextContent('Won the vacant title');
    // A reason without a kept breakdown is plain text; no reason (your own show) shows none.
    expect(within(items[1] as HTMLElement).getByText('Time for a change')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).queryByRole('button')).toBeNull();
    expect(within(items[2] as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('says when there are none', () => {
    render(
      <MemoryRouter>
        <RecentTitleChangesList changes={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: NO_TITLE_CHANGES_TEXT })).toBeInTheDocument();
  });
});

describe('RecentTitleChangesPanel', () => {
  it("lists a rival's title change with the booker's reason, a Why? and a link to the show", async () => {
    renderWithShowCards(loaded, <RecentTitleChangesPanel promotionId={loaded.promotions.rival} />);
    const list = await screen.findByRole(
      'list',
      { name: 'Recent title changes' },
      { timeout: LOAD_MS },
    );
    const [item] = within(list).getAllByRole('listitem');
    if (item === undefined) throw new Error('No title change listed.');
    expect(item).toHaveTextContent(/won the Test Rival Second Title/);
    expect(item).toHaveTextContent(/ended a 40-day reign/);
    expect(within(item).getByText('Contract ending')).toBeInTheDocument();
    expect(within(item).getByRole('button', { name: /^Why the change\? / })).toBeInTheDocument();
    expect(within(item).getByRole('link', { name: 'Rival Weekly' })).toHaveAttribute(
      'href',
      routes.game.showResults(loaded.rivalShow),
    );
  });

  it('says there are none for a promotion with no changes', async () => {
    renderWithShowCards(loaded, <RecentTitleChangesPanel promotionId={loaded.promotions.own} />);
    expect(
      await screen.findByRole('heading', { name: NO_TITLE_CHANGES_TEXT }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
  });
});
