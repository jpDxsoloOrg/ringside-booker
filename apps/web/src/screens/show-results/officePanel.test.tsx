import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGameDate, parseId } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { renderOfficePanel } from '@/test/officePanel';
import {
  LAST_SHOW_PANEL_ID,
  LastShowPanel,
  mainEventText,
  NO_SHOWS_YET_TEXT,
  titleChangeText,
  winnerText,
} from './officePanel';

/** The engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;

/** The tiny world's completed show: last Thursday's Test Weekly, score 62. */
const SHOW = parseId('eventInstance', 'evi_0000000001');

afterEach(() => {
  useSessionStore.getState().clear();
});

describe('the Last show panel (DAY2-06)', () => {
  it("shows the player's last show: score with its Why?, stars, crowd and a results link", async () => {
    await renderOfficePanel(LAST_SHOW_PANEL_ID);

    const panel = await screen.findByRole('region', { name: 'Last show' }, { timeout: LOAD_MS });
    expect(
      await within(panel).findByRole('heading', { level: 3, name: 'Test Weekly' }),
    ).toBeInTheDocument();
    expect(within(panel).getByText('62')).toBeInTheDocument();
    // The fixture keeps no score breakdown, so there is no Why? that would open nothing.
    expect(within(panel).queryByRole('button', { name: /^Why is show score/iu })).toBeNull();
    expect(within(panel).getByRole('img', { name: /out of 5|No stars/u })).toBeInTheDocument();
    // ECO1 and EVT6: the player's own show has its box office net, with a Why? once kept.
    expect(
      await within(panel).findByText(/^Box office net/u, undefined, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    // EVT6: the tiny world's show has its crowd stored.
    expect(
      await within(panel).findByText(/^Crowd [\d,]+/u, undefined, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Full results' })).toHaveAttribute(
      'href',
      routes.game.showResults(SHOW),
    );
  });

  it("gives the score its Why? when the breakdown is kept, and the main event's winner", () => {
    const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    const install = transport.host.installEngine(fakeEngineState());
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
    render(
      <EngineProvider createTransport={() => transport}>
        <MemoryRouter>
          <LastShowPanel
            show={{
              eventInstanceId: SHOW,
              name: 'Test Weekly',
              date: parseGameDate('2026-04-09'),
              promotionName: 'Test Promotion A',
              mine: false,
              score: 71,
              stars: 3.5,
              scoreTraceRef: { kind: 'shows.score', id: SHOW },
              mainEvent: { typeName: 'Singles match', sides: ['Ace', 'Bolt'], winnerSide: 'Bolt' },
              titleChanges: [{ titleName: 'World Title', newHolderNames: ['Bolt'] }],
            }}
          />
        </MemoryRouter>
      </EngineProvider>,
    );
    const panel = screen.getByRole('region', { name: 'Last show' });
    expect(within(panel).getByRole('button', { name: /^Why is show score/iu })).toBeVisible();
    expect(panel).toHaveTextContent('Main event: Ace vs Bolt (Singles match). Winner: Bolt');
    expect(panel).toHaveTextContent('New champion: Bolt (World Title)');
  });

  it('says "No shows yet" before the first show', () => {
    render(
      <MemoryRouter>
        <LastShowPanel show={null} />
      </MemoryRouter>,
    );
    const panel = screen.getByRole('region', { name: 'Last show' });
    expect(within(panel).getByText(NO_SHOWS_YET_TEXT)).toBeInTheDocument();
    expect(within(panel).queryByRole('link')).toBeNull();
  });

  it('words the main event and title changes', () => {
    const mainEvent = { typeName: 'Singles match', sides: ['Ace', 'Bolt'], winnerSide: 'Ace' };
    expect(mainEventText(mainEvent)).toBe('Main event: Ace vs Bolt (Singles match)');
    expect(winnerText(mainEvent)).toBe('Winner: Ace');
    expect(winnerText({ ...mainEvent, winnerSide: null })).toBe('No winner');
    expect(titleChangeText({ titleName: 'World Title', newHolderNames: ['Bolt'] })).toBe(
      'New champion: Bolt (World Title)',
    );
    expect(titleChangeText({ titleName: 'Tag Titles', newHolderNames: ['A', 'B'] })).toBe(
      'New champions: A & B (Tag Titles)',
    );
    expect(titleChangeText({ titleName: 'World Title', newHolderNames: [] })).toBe(
      'Vacated: World Title',
    );
  });
});
