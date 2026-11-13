import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CARD_HIDDEN_TEXT, parseId } from '@ringside/engine';
import type { PromotionId } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { routes } from '@/app/routes';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { aipShowCardsFakeState, fakeEngineFactory } from '@/test/fakeEngine';
import type { ShowCardsFakeWorld } from '@/test/fakeEngine';
import { ShowsTab } from './ShowsTab';

/** The engine's first answer can take a moment while other test files load the machine. */
const LOAD_MS = 10_000;

interface Loaded {
  readonly transport: InProcessTransport;
  readonly promotions: ShowCardsFakeWorld['promotions'];
}

/** The show-cards world one day in: B's show booked, run and revealed; C's cancelled. */
async function loadWorld(): Promise<Loaded> {
  const world = aipShowCardsFakeState();
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(world.state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const advanced = await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
  if (!advanced.ok || advanced.failures.length > 0)
    throw new Error('The show-cards world failed to advance.');
  return { transport, promotions: world.promotions };
}

let loaded: Loaded;

beforeAll(async () => {
  loaded = await loadWorld();
}, 30_000);

afterEach(() => {
  act(() => {
    useTracePanelStore.setState({ openPanelId: null });
  });
});

function renderTab(promotionId: PromotionId) {
  render(
    <MemoryRouter>
      <EngineProvider createTransport={() => loaded.transport}>
        <ShowsTab promotionId={promotionId} />
      </EngineProvider>
    </MemoryRouter>,
  );
  return userEvent.setup({ delay: null });
}

/** A show's disclosure button: its name holds the show's, and it is not a Why? button. */
function toggleName(name: string): RegExp {
  return new RegExp(`^(?!Why).*${name}`);
}

async function findShow(name: string): Promise<HTMLElement> {
  const toggle = await screen.findByRole(
    'button',
    { name: toggleName(name) },
    { timeout: LOAD_MS },
  );
  const show = toggle.closest('article');
  if (show === null) throw new Error(`${name} is not inside a show card.`);
  return show;
}

describe('the Shows tab', () => {
  it('lists the recent shows and the ones coming up', async () => {
    renderTab(loaded.promotions.rival);
    const recent = await screen.findByRole(
      'region',
      { name: 'Recent shows' },
      { timeout: LOAD_MS },
    );
    const upcoming = screen.getByRole('region', { name: 'Coming up' });
    expect(within(recent).getByText('Rival Weekly')).toBeInTheDocument();
    expect(within(upcoming).getByText('Rival Next')).toBeInTheDocument();
    expect(within(recent).getByText(/^Completed · Score \d+$/)).toBeInTheDocument();
  });

  it(
    'opens a revealed show onto six slots, Opener to Main event, each with a Why?',
    { timeout: 20_000 },
    async () => {
      const user = renderTab(loaded.promotions.rival);
      const show = await findShow('Rival Weekly');
      const toggle = within(show).getByRole('button', { name: toggleName('Rival Weekly') });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');

      const card = within(show).getByRole('list', { name: 'Rival Weekly card' });
      const slots = within(card).getAllByRole('article');
      expect(slots).toHaveLength(6);
      expect(slots[0]).toHaveAccessibleName('Slot 1: Opener');
      expect(slots[5]).toHaveAccessibleName('Slot 6: Main event');
      expect(
        within(card).getAllByRole('button', { name: /^Why this segment\? Slot / }),
      ).toHaveLength(6);
      expect(show).not.toHaveTextContent(/minute/i);

      await user.click(
        within(card).getByRole('button', { name: 'Why this segment? Slot 6, Main event' }),
      );
      expect(
        await screen.findByRole('dialog', { name: /^Why this segment\? / }, { timeout: LOAD_MS }),
      ).toBeInTheDocument();
    },
  );

  it("opens a show that has run on its score, the score's Why? and a link to the results", async () => {
    const user = renderTab(loaded.promotions.rival);
    const show = await findShow('Rival Weekly');
    await user.click(within(show).getByRole('button', { name: toggleName('Rival Weekly') }));
    expect(within(show).getByText(/^Show score/)).toHaveTextContent(/^Show score \d+$/);
    const link = within(show).getByRole('link', { name: 'See results' });
    const showId = (link.getAttribute('href') ?? '').split('/').pop() ?? '';
    expect(showId).toMatch(/^evi_/);
    expect(link).toHaveAttribute('href', routes.game.showResults(parseId('eventInstance', showId)));
    await user.click(within(show).getByRole('button', { name: /^Why this score\? Rival Weekly/ }));
    expect(
      await screen.findByRole('dialog', { name: /^Why this score\? / }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
  });

  it('keeps a card that has not aired hidden', async () => {
    const user = renderTab(loaded.promotions.rival);
    const show = await findShow('Rival Next');
    await user.click(within(show).getByRole('button', { name: toggleName('Rival Next') }));
    expect(within(show).getByText(CARD_HIDDEN_TEXT)).toBeInTheDocument();
    expect(within(show).queryByRole('article')).toBeNull();
    expect(within(show).queryByRole('button', { name: /^Why this card/ })).toBeNull();
    expect(within(show).queryByRole('link', { name: 'See results' })).toBeNull();
  });

  it('says why a cancelled show did not happen', async () => {
    const user = renderTab(loaded.promotions.thin);
    const show = await findShow('Thin Weekly');
    expect(within(show).getAllByText('Show cancelled').length).toBeGreaterThan(0);
    await user.click(within(show).getByRole('button', { name: toggleName('Thin Weekly') }));
    expect(within(show).getByText(/wrestlers available/)).toBeInTheDocument();
  });
});
