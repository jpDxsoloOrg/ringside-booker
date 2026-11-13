// AIP5-05: the results page's Booker's calls section, on a rival's show and never on your own.
import { screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { ShowResultsView } from '@ringside/engine';
import { listResultsSections } from '@/screens/show-results/resultsSectionRegistry';
import { LOAD_MS, loadShowCardsWorld, renderWithShowCards } from '@/test/showCardsWorld';
import type { LoadedShowCards } from '@/test/showCardsWorld';
import { BOOKERS_CALLS_ERROR_TEXT, BookersCalls, showsBookersCalls } from './BookersCalls';
import { BOOKERS_CALLS_SECTION_ID } from './registerBookersCalls';

let loaded: LoadedShowCards;
let rivalView: ShowResultsView;

beforeAll(async () => {
  loaded = await loadShowCardsWorld();
  const results = await loaded.transport.host.query('shows.results', {
    eventInstanceId: loaded.rivalShow,
  });
  if (!results.result.ok || results.result.data === null) {
    throw new Error('shows.results failed for Rival Weekly.');
  }
  rivalView = results.result.data;
}, 30_000);

function section() {
  const found = listResultsSections().find((each) => each.id === BOOKERS_CALLS_SECTION_ID);
  if (found === undefined) throw new Error("Booker's calls is not registered.");
  return found;
}

describe("Booker's calls", () => {
  it('is registered as a results section', () => {
    expect(section()).toMatchObject({ label: "Booker's calls", order: 60 });
  });

  it("lists each match of a rival's show with its slot and result line", async () => {
    const content = section().render({ eventInstanceId: loaded.rivalShow, view: rivalView });
    expect(content).not.toBeNull();
    if (content === null || typeof content !== 'object') throw new Error('No section drawn.');
    renderWithShowCards(loaded, <>{content}</>);
    const list = await screen.findByRole('list', { name: "Booker's calls" }, { timeout: LOAD_MS });
    const rows = within(list)
      .getAllByRole('listitem')
      .filter((row) => row.parentElement === list);
    const matches = rivalView.segments.filter((segment) => segment.kind === 'match');
    expect(rows).toHaveLength(matches.length);
    expect(rows[0]).toHaveTextContent(/^Slot \d+ · /);
    for (const row of rows) {
      expect(within(row).getByRole('button', { name: /^Why this result\? / })).toBeVisible();
    }
    expect(within(list).getByText('Retained')).toBeInTheDocument();
  });

  it('is left out on your own shows, off-screen shows and shows that have not run', () => {
    expect(showsBookersCalls(rivalView)).toBe(true);
    expect(showsBookersCalls({ ...rivalView, mine: true })).toBe(false);
    expect(showsBookersCalls({ ...rivalView, offscreen: true })).toBe(false);
    expect(showsBookersCalls({ ...rivalView, status: 'booked' })).toBe(false);
    expect(
      section().render({ eventInstanceId: loaded.rivalShow, view: { ...rivalView, mine: true } }),
    ).toBeNull();
  });

  it('says the lookup failed, not that the calls are gone, when the query fails', async () => {
    const missing = parseId('eventInstance', 'evi_zzzzzzzzzz');
    renderWithShowCards(loaded, <BookersCalls view={{ ...rivalView, eventInstanceId: missing }} />);
    expect(
      await screen.findByText(BOOKERS_CALLS_ERROR_TEXT, undefined, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
  });
});
