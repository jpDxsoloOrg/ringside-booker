/**
 * The results page's "Popularity & momentum" section (MTCH3-05): the body drawn from fixtures,
 * and the registered section against the test engine.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { EventInstanceId } from '@ringside/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { listResultsSections } from '@/screens/show-results/resultsSectionRegistry';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { AFTERMATH_OPEN_ON_PHONE, AftermathResults, BREAKDOWN_GONE_TEXT } from './AftermathResults';
import { AFTERMATH_EMPTY_TEXT, AftermathSection } from './AftermathSection';
import { aftermathResult, aftermathShow } from './aftermathResultsFixtures';
import { AFTERMATH_SECTION_ID, AFTERMATH_SECTION_LABEL, AFTERMATH_SECTION_ORDER } from './register';

const LOAD_MS = 10_000;

afterEach(() => {
  useSessionStore.getState().clear();
});

/** A Why? by reference reads the engine when it opens, so the body needs a provider. */
function renderResults(options: Parameters<typeof aftermathResult>[0] = {}) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  return render(
    <EngineProvider createTransport={() => transport}>
      <MemoryRouter future={routerFutureFlags}>
        <AftermathResults data={aftermathResult(options)} view={aftermathShow()} />
      </MemoryRouter>
    </EngineProvider>,
  );
}

describe('AftermathResults', () => {
  it('shows one card per match in card order, none for the no contest', () => {
    renderResults();
    expect(screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual([
      'Slot 1: Opener',
      'Slot 2: Midcard',
      'Slot 3: Midcard',
      'Slot 5: Main event',
    ]);
  });

  it("shows each competitor's show-region popularity and momentum, before and after, with a Why?", () => {
    renderResults();
    const opener = screen.getByRole('region', { name: 'Slot 1: Opener' });
    const rows = within(opener).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const winner = rows.find((row) => within(row).queryByText('Win') !== null);
    const loser = rows.find((row) => within(row).queryByText('Loss') !== null);
    if (winner === undefined || loser === undefined)
      throw new Error('expected a winner and a loser');
    expect(within(winner).getByText('Popularity in Bayshore')).toBeInTheDocument();
    expect(within(winner).getByText('42.4')).toBeInTheDocument();
    expect(within(winner).getByText('18')).toBeInTheDocument();
    expect(within(winner).getAllByRole('button', { name: /Why/ })).toHaveLength(2);
    expect(within(loser).getByText('39.6')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/morale|minutes/i);
  });

  it('links every competitor to their profile', () => {
    renderResults();
    const opener = screen.getByRole('region', { name: 'Slot 1: Opener' });
    const links = within(opener).getAllByRole('link', { name: /^Open in profile/ });
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toMatch(new RegExp(`^${routes.game.workers()}/per_`));
  });

  it('says when the full breakdown is gone, and keeps the numbers', () => {
    renderResults({ withTraces: false });
    expect(screen.queryAllByRole('button', { name: /Why/ })).toEqual([]);
    expect(screen.getAllByText(BREAKDOWN_GONE_TEXT).length).toBeGreaterThan(0);
    expect(screen.getAllByText('42.4').length).toBeGreaterThan(0);
  });

  it("says momentum isn't tracked without a contract", () => {
    renderResults({ freeAgent: true });
    expect(
      screen.getAllByText("No contract with Coastline Wrestling: momentum isn't tracked").length,
    ).toBeGreaterThan(0);
  });

  it('folds every match after the third behind its own toggle (phones only show it)', async () => {
    const user = userEvent.setup({ delay: null });
    renderResults();
    const toggles = screen.getAllByRole('button', { name: /^(Show|Hide) / });
    expect(toggles).toHaveLength(aftermathResult().segments.length - AFTERMATH_OPEN_ON_PHONE);
    const [mainEvent] = toggles;
    if (mainEvent === undefined) throw new Error('expected a toggle');
    expect(mainEvent).toHaveAttribute('aria-expanded', 'false');
    const card = screen.getByRole('region', { name: 'Slot 5: Main event' });
    expect(card).toHaveAttribute('data-folded', 'true');
    await user.click(mainEvent);
    expect(mainEvent).toHaveAttribute('aria-expanded', 'true');
    expect(card).not.toHaveAttribute('data-folded');
  });
});

describe('AftermathSection', () => {
  it('is registered as the results page’s "Popularity & momentum" section, after Popularity', () => {
    const ids = listResultsSections().map((entry) => entry.id);
    const section = listResultsSections().find((entry) => entry.id === AFTERMATH_SECTION_ID);
    expect(section?.label).toBe(AFTERMATH_SECTION_LABEL);
    expect(AFTERMATH_SECTION_ORDER).toBe(30);
    expect(ids.indexOf(AFTERMATH_SECTION_ID)).toBeGreaterThan(ids.indexOf('evt5.popularity'));
  });

  function renderSection(pick: (state: ReturnType<typeof fakeEngineState>) => EventInstanceId) {
    const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    const state = fakeEngineState();
    const eventInstanceId = pick(state);
    const install = transport.host.installEngine(state);
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
    return render(
      <EngineProvider createTransport={() => transport}>
        <MemoryRouter future={routerFutureFlags}>
          <AftermathSection
            eventInstanceId={eventInstanceId}
            view={{ ...aftermathShow(), eventInstanceId, offscreen: true, segments: [] }}
          />
        </MemoryRouter>
      </EngineProvider>,
    );
  }

  it("draws a show's stored aftermath once the engine answers", async () => {
    renderSection((state) => {
      const row = state.world.tables.aftermaths[0];
      if (row === undefined) throw new Error('the fake world has no stored aftermath');
      return row.eventInstanceId;
    });
    expect(
      (await screen.findAllByRole('link', { name: /^Open in profile/ }, { timeout: LOAD_MS }))
        .length,
    ).toBeGreaterThan(0);
  });

  it('says why there is nothing to list for a show with no stored aftermath', async () => {
    renderSection((state) => {
      const row = state.world.tables.aftermaths[0];
      if (row === undefined) throw new Error('the fake world has no stored aftermath');
      // Forget that show's rows, as for a show scored without a card.
      state.world.tables.aftermaths = state.world.tables.aftermaths.filter(
        (entry) => entry.eventInstanceId !== row.eventInstanceId,
      );
      return row.eventInstanceId;
    });
    expect(
      await screen.findByText(AFTERMATH_EMPTY_TEXT.offscreen, {}, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
  });
});
