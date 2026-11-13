import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { SUMMARISED_NOTICE, useTracePanelStore } from '@/components/Trace';
import {
  bigTelevisedShowChange,
  showChangeTraceEntries,
  smallUntelevisedShowChange,
  SUMMARISED_REGION_NAME,
  weakShowChange,
  worldwideShowChange,
} from '@/screens/dev-gallery/fixtures/popularityShowChange';
import { createTraceFixtureTransport } from '@/screens/dev-gallery/fixtures/traceEngine';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { setMatchMedia } from '@/test/matchMedia';
import type { PopularityShowChangeView } from './PopularityChangeList';
import {
  changeInWords,
  formatPopularityChange,
  isFlatChange,
  PopularityChangeList,
} from './PopularityChangeList';

afterEach(() => {
  act(() => {
    useTracePanelStore.setState({ openPanelId: null });
  });
});

function renderList(data: PopularityShowChangeView, phoneLimit?: number) {
  render(
    <EngineProvider
      createTransport={() => createTraceFixtureTransport(showChangeTraceEntries(), 0)}
    >
      <PopularityChangeList data={data} {...(phoneLimit === undefined ? {} : { phoneLimit })} />
    </EngineProvider>,
  );
  return userEvent.setup({ delay: null });
}

function regionTable(country: string): HTMLElement {
  return screen.getByRole('grid', { name: `Regions in ${country}` });
}

function rowOf(table: HTMLElement, region: string): HTMLElement {
  const row = within(table)
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryByText(region, { exact: true }) !== null);
  if (row === undefined) throw new Error(`No row for ${region}`);
  return row;
}

describe('formatting', () => {
  it('writes changes with one decimal, a true minus sign and flat zero', () => {
    expect(formatPopularityChange(0.19)).toBe('+0.2');
    expect(formatPopularityChange(-1.48)).toBe('−1.5');
    expect(formatPopularityChange(0.04)).toBe('0');
    expect(isFlatChange(-0.04)).toBe(true);
    expect(changeInWords(0.19)).toBe('up 0.2');
    expect(changeInWords(-1.48)).toBe('down 1.5');
    expect(changeInWords(0)).toBe('no change');
  });
});

describe('PopularityChangeList on desktop', () => {
  it('sums up the regions and explains the worldwide change', async () => {
    const user = renderList(bigTelevisedShowChange);
    expect(
      screen.getByText('Fans gained in 11 regions, lost in 1, 5 about the same'),
    ).toBeInTheDocument();
    expect(screen.getByText('21.4 → 21.4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Why is Worldwide popularity change / }));
    expect(
      await screen.findByRole('dialog', { name: 'Worldwide popularity change' }),
    ).toBeInTheDocument();
  });

  it('lists countries in the order given, as h3s with their own Why?', () => {
    renderList(bigTelevisedShowChange);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(headings).toEqual(bigTelevisedShowChange.countries.map((country) => country.name));
    expect(
      screen.getByRole('button', { name: /^Why is Popularity change in United States / }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Why is Popularity change in Canada / }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('shows how each region saw the show, what fans expected and before → after', () => {
    renderList(bigTelevisedShowChange);
    const states = regionTable('United States');
    const rows = within(states).getAllByRole('row');
    // The header, then the show region first.
    expect(rows[1]).toHaveTextContent('Northeast');
    const northeast = rowOf(states, 'Northeast');
    expect(northeast).toHaveTextContent('Show region');
    expect(northeast).toHaveTextContent('61 · scored 68');
    expect(northeast).toHaveTextContent('58.2 → 58.5');
    expect(northeast).toHaveTextContent('+0.3');
    expect(rowOf(states, 'Mid-Atlantic')).toHaveTextContent('Neighbour of Northeast');
    expect(rowOf(states, 'Texas')).toHaveTextContent('TV: National Signal Network');
  });

  it('says the change in words beside the chip', () => {
    renderList(bigTelevisedShowChange);
    const states = regionTable('United States');
    expect(within(rowOf(states, 'Mid-Atlantic')).getByText('up 0.2')).toBeInTheDocument();
    expect(within(rowOf(states, 'Texas')).getByText('down 0.1')).toBeInTheDocument();
  });

  it('labels a change inside the dead zone in words', () => {
    renderList(bigTelevisedShowChange);
    const plains = rowOf(regionTable('United States'), 'Plains');
    expect(plains).toHaveTextContent('About what fans expected');
    expect(within(plains).getByText('no change')).toBeInTheDocument();
  });

  it('marks a capped region and notes the cap in the summary', () => {
    renderList(smallUntelevisedShowChange);
    expect(screen.getByText('Monthly gain cap reached in 1 region')).toBeInTheDocument();
    const ontario = rowOf(regionTable('Canada'), 'Ontario');
    expect(ontario).toHaveTextContent('Cap reached');
    expect(ontario).not.toHaveTextContent('About what fans expected');
  });

  it("opens a region's Why? from its trace reference", async () => {
    const user = renderList(bigTelevisedShowChange);
    await user.click(
      within(rowOf(regionTable('United States'), 'Texas')).getByRole('button', {
        name: 'Why is Popularity change in Texas −0.1?',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Popularity change in Texas' });
    expect(
      await within(dialog).findByText('What fans here expected', { exact: false }),
    ).toBeInTheDocument();
  });

  it('keeps the stored numbers when the full breakdown has been summarised', async () => {
    const user = renderList(smallUntelevisedShowChange);
    const row = rowOf(regionTable('Canada'), SUMMARISED_REGION_NAME);
    expect(row).toHaveTextContent('9.6 → 11.1');
    expect(row).toHaveTextContent('+1.5');
    await user.click(
      within(row).getByRole('button', { name: /^Why is Popularity change in Quebec / }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Popularity change in Quebec' });
    expect(await within(dialog).findByText(SUMMARISED_NOTICE)).toBeInTheDocument();
    expect(row).toHaveTextContent('9.6 → 11.1');
  });

  it('folds countries past the third on a long worldwide list', async () => {
    const user = renderList(worldwideShowChange);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(8);
    expect(screen.getAllByRole('grid')).toHaveLength(3);
    const fourth = worldwideShowChange.countries[3]?.name ?? '';
    const toggle = screen.getByRole('button', { name: `Show the regions in ${fourth}` });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(regionTable(fourth)).toBeInTheDocument();
  });

  it('never talks about minutes or morale', () => {
    for (const data of [bigTelevisedShowChange, smallUntelevisedShowChange, weakShowChange]) {
      const { unmount } = render(
        <EngineProvider createTransport={() => createTraceFixtureTransport([], 0)}>
          <PopularityChangeList data={data} />
        </EngineProvider>,
      );
      expect(document.body.textContent).not.toMatch(/minutes|morale/i);
      unmount();
    }
  });
});

describe('PopularityChangeList on a phone', () => {
  it('shows the five biggest changes as cards, then Show all reveals the grouped list', async () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    const user = renderList(bigTelevisedShowChange);
    const cards = screen.getByRole('list', { name: 'Biggest changes' });
    const items = within(cards).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    // Largest change first, across countries, with the country beside how it was seen.
    expect(items[0]).toHaveTextContent('Northeast');
    expect(items[0]).toHaveTextContent('Show region · United States');
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();

    const showAll = screen.getByRole('button', { name: 'Show all (17)' });
    expect(showAll).toHaveAttribute('aria-expanded', 'false');
    await user.click(showAll);
    expect(showAll).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('list', { name: 'Biggest changes' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
    expect(
      within(screen.getByRole('list', { name: 'Regions in United States' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(12);
  });

  it('skips Show all when every region fits', () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    renderList(smallUntelevisedShowChange, 6);
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
  });
});
