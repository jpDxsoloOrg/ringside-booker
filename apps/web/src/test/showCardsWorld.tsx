/**
 * The show-cards world (`aipShowCardsFakeState`) one day in, for the rival results tests
 * (AIP5-05): Test Promotion B's "Rival Weekly" has been booked by the rival desk, run and
 * revealed, with a title retained in the main event and a second title moved because its
 * champion's contract ends in ten days. Renders a screen with the engine and a memory router,
 * without the app shell.
 */
import { render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { EventInstanceId } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { useSessionStore } from '@/app/session/sessionStore';
import { aipShowCardsFakeState, fakeEngineFactory } from './fakeEngine';
import type { ShowCardsFakeWorld } from './fakeEngine';

/** The engine's first answer can take a moment while other test files load the machine. */
export const LOAD_MS = 10_000;

export interface LoadedShowCards {
  readonly transport: InProcessTransport;
  readonly promotions: ShowCardsFakeWorld['promotions'];
  /** B's "Rival Weekly", run and revealed. */
  readonly rivalShow: EventInstanceId;
}

export async function loadShowCardsWorld(): Promise<LoadedShowCards> {
  const world = aipShowCardsFakeState();
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(world.state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const advanced = await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
  if (!advanced.ok || advanced.failures.length > 0) {
    throw new Error('The show-cards world failed to advance.');
  }
  const cards = await transport.host.query('aip.showCards', {
    promotionId: world.promotions.rival,
  });
  const rivalShow = cards.result.ok
    ? cards.result.data.rows.find((row) => row.name === 'Rival Weekly')?.eventInstanceId
    : undefined;
  if (rivalShow === undefined) throw new Error('The show-cards world lost Rival Weekly.');
  return { transport, promotions: world.promotions, rivalShow };
}

/** Renders `ui` against the loaded world's engine. */
export function renderWithShowCards(loaded: LoadedShowCards, ui: ReactElement) {
  render(
    <MemoryRouter>
      <EngineProvider createTransport={() => loaded.transport}>{ui}</EngineProvider>
    </MemoryRouter>,
  );
  return userEvent.setup({ delay: null });
}
