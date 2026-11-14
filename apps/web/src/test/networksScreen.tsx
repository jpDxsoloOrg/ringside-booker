/**
 * Test helpers for the Networks screen: the screen on its own route (no app shell) against the
 * test engine, with every query it asks recorded. The world is built with the engine's world
 * builder (`networksFakeState`); deal states (a cancelled show, a missed airing, an ended deal)
 * are made through the engine's own commands and days, never by editing the world by hand.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { initialEngineState, parseGameDate, parseId } from '@ringside/engine';
import type {
  EngineState,
  EventInstanceId,
  GameDate,
  PromotionId,
  QueryName,
} from '@ringside/engine';
import { TEST_PLAYER_ID, worldBuilder } from '@ringside/engine/testing';
import { LiveAnnouncer } from '@/app/a11y/LiveAnnouncer';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { fakeEngineFactory } from '@/test/fakeEngine';
import { NetworksScreen } from '@/screens/networks/NetworksScreen';

/** The engine's first answer can take a moment under load. */
export const LOAD_MS = 10_000;

export interface Asked {
  readonly name: QueryName;
  readonly args: unknown;
}

/** The networks world's first day: a Friday. Test Weekly is on Thursdays. */
export const NETWORKS_WORLD_START: GameDate = parseGameDate('2026-04-10');

const THURSDAY = 3;
const SATURDAY = 5;

/**
 * A world for the Networks screen, on the mini geography:
 *
 * - Test Network North (TV, tier 0) and Test Pay-per-view (tier 0) cover Test Country North,
 *   where Test Promotion A is known; Test Network South covers only the south, so it is never
 *   listed.
 * - Test Promotion A, run by the local player: "Test Weekly" (Thursdays, on Test Network North in
 *   the evening, taped) and "Test Big Night" (Saturdays, a major show nobody carries yet; North
 *   would sign it).
 * - Test Promotion B, the computer's: "Test Rival Weekly" on Test Network North in the daytime.
 */
export function networksFakeState(): EngineState {
  const north = parseId('country', 'cty_0000000001');
  const south = parseId('country', 'cty_0000000002');
  const { world } = worldBuilder({
    worldName: 'Test Networks World',
    startDate: parseGameDate('2026-01-05'),
    currentDate: NETWORKS_WORLD_START,
  })
    .withCatalogs()
    .withGeography('mini')
    .withNetwork({
      name: 'Test Network North',
      kind: 'tv',
      reachTier: 0,
      coverage: { countryIds: [north], regionIds: [] },
    })
    .withNetwork({
      name: 'Test Pay-per-view',
      kind: 'ppv',
      reachTier: 0,
      coverage: { countryIds: [north], regionIds: [] },
    })
    .withNetwork({
      name: 'Test Network South',
      kind: 'tv',
      reachTier: 0,
      coverage: { countryIds: [south], regionIds: [] },
    })
    .withPromotion(
      {
        name: 'Test Promotion A',
        shortName: 'TPA',
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
        regionalPop: {
          [parseId('region', 'reg_0000000001')]: 70,
          [parseId('region', 'reg_0000000002')]: 60,
        },
      },
      (promotion) =>
        promotion
          .withBrand({ name: 'Test Brand A' })
          .withRoster(10)
          .withWeeklyShow({ name: 'Test Weekly', weekdays: [THURSDAY] })
          .withWeeklyShow({ name: 'Test Big Night', weekdays: [SATURDAY] }, { importance: 'major' })
          .withDeal({
            network: 'Test Network North',
            show: 'Test Weekly',
            timeslot: 'evening',
            weekday: THURSDAY,
            live: false,
          }),
    )
    .withPromotion({ name: 'Test Promotion B', shortName: 'TPB' }, (promotion) =>
      promotion
        .withRoster(4)
        .withWeeklyShow({ name: 'Test Rival Weekly', weekdays: [SATURDAY] })
        .withDeal({
          network: 'Test Network North',
          show: 'Test Rival Weekly',
          timeslot: 'daytime',
          weekday: SATURDAY,
        }),
    )
    .build();
  return initialEngineState(world);
}

/** Moves the world `days` days on (no show-day stop in the test engine). */
export async function advance(transport: InProcessTransport, days: number): Promise<void> {
  await transport.host.advanceDays({ maxDays: days }, () => undefined);
}

/** The id of the player's stored show called `name` on `date`. */
async function storedShowId(
  transport: InProcessTransport,
  name: string,
  date: GameDate,
): Promise<EventInstanceId> {
  const range = await transport.host.query('calendar.range', {
    from: date,
    to: date,
    scope: 'mine',
  });
  if (!range.result.ok) throw new Error('The calendar did not answer');
  const show = range.result.data.shows.find((entry) => entry.name === name);
  const id: EventInstanceId | null = show?.eventInstanceId ?? null;
  if (id === null) throw new Error(`No stored ${name} on ${date}`);
  return id;
}

/** Cancels the player's stored show called `name` on `date` through `calendar.cancelShow`. */
export async function cancelShowOn(
  transport: InProcessTransport,
  name: string,
  date: GameDate,
): Promise<void> {
  const eventInstanceId = await storedShowId(transport, name, date);
  const cancelled = await transport.host.command('calendar.cancelShow', { eventInstanceId });
  if (!cancelled.result.ok) throw new Error(cancelled.result.reasons[0]?.message ?? 'Refused');
}

/**
 * Fills the card of the player's show called `name` (Auto-fill, every result Auto) and runs it tonight
 * (`shows.runTonight`), as Run the show does; the world must be on its day. A show left unrun is a missed airing (ECO8-07).
 */
export async function runShowTonight(transport: InProcessTransport, name: string): Promise<void> {
  const today = await transport.host.query('sim.status', {});
  if (!today.result.ok) throw new Error('The engine did not answer');
  const eventInstanceId = await storedShowId(transport, name, today.result.data.date);
  const filled = await transport.host.command('aip.autoFillCard', { eventInstanceId });
  if (!filled.result.ok) throw new Error(filled.result.reasons[0]?.message ?? 'Refused');
  // Every match decided on the night (Auto), as the winner menu's Auto does.
  const card = await transport.host.query('booking.card', { eventInstanceId });
  if (!card.result.ok) throw new Error('The card did not answer');
  for (const section of card.result.data.sections) {
    for (const slot of section.slots) {
      if (slot.segment?.kind !== 'match') continue;
      const planned = await transport.host.command('booking.setResult', {
        segmentId: slot.segment.segmentId,
        result: 'auto',
      });
      if (!planned.result.ok) throw new Error(planned.result.reasons[0]?.message ?? 'Refused');
    }
  }
  const ran = await transport.host.command('shows.runTonight', { eventInstanceId });
  if (!ran.result.ok) throw new Error(ran.result.reasons[0]?.message ?? 'Refused');
}

export interface RenderNetworksOptions {
  /** The seat's promotion, in place of the one the engine host worked out. Null: none. */
  readonly seatPromotionId?: PromotionId | null;
  /** The engine state to load; `networksFakeState()` by default. */
  readonly state?: EngineState;
  /** Runs against the engine before the screen opens (commands, days). */
  readonly prepare?: (transport: InProcessTransport, promotionId: PromotionId) => Promise<void>;
}

export interface RenderedNetworks {
  readonly router: ReturnType<typeof createMemoryRouter>;
  readonly user: UserEvent;
  readonly transport: InProcessTransport;
  readonly asked: Asked[];
  /** The arguments of every `name` query asked so far. */
  readonly argsOf: (name: QueryName) => unknown[];
  readonly promotionId: PromotionId;
}

export async function renderNetworks(
  path: string = routes.game.networks(),
  options: RenderNetworksOptions = {},
): Promise<RenderedNetworks> {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(options.state ?? networksFakeState());
  const ownPromotionId = install.seat.promotionId;
  if (ownPromotionId === null) throw new Error('The tiny world seats the player at a promotion');
  if (options.prepare !== undefined) await options.prepare(transport, ownPromotionId);
  const seat =
    options.seatPromotionId === undefined
      ? install.seat
      : { ...install.seat, promotionId: options.seatPromotionId };
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat });

  const asked: Asked[] = [];
  const { host } = transport;
  const runQuery = host.query.bind(host);
  host.query = async (name, args) => {
    asked.push({ name, args });
    return runQuery(name, args);
  };

  const router = createMemoryRouter(
    [
      {
        path: routes.game.networks(),
        element: (
          <LiveAnnouncer>
            <NetworksScreen />
          </LiveAnnouncer>
        ),
      },
      { path: '*', element: <p>Somewhere else</p> },
    ],
    { initialEntries: [path], future: routerFutureFlags },
  );
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return {
    router,
    user: userEvent.setup({ delay: null }),
    transport,
    asked,
    argsOf: (name) => asked.filter((query) => query.name === name).map((query) => query.args),
    promotionId: ownPromotionId,
  };
}

/** The tab list, once the screen has drawn. */
export async function findNetworksTabs(): Promise<HTMLElement> {
  return screen.findByRole('tablist', { name: 'Networks sections' }, { timeout: LOAD_MS });
}
