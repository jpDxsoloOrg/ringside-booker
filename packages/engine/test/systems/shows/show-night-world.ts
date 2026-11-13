/**
 * The world the show night tests share. Today is Tuesday 2026-01-06.
 *
 * - promotion A is run by `player-1` and has a roster of 12;
 * - promotion B is run by the computer and has a roster of 6;
 * - `human`: A's show today, with 1 pre-show slot and 5 main-card slots, all filled: five matches
 *   with planned results and one promo. {@link showNightEngine}'s stand-in player runs it;
 * - `unrun`: A's show today with a one-match card, which the player does not run;
 * - `cancelled`: A's show today, cancelled;
 * - `rivalBare`: B's show today with no card;
 * - `rivalCard`: B's show today with two matches and no planned results.
 *
 * Shows are inserted directly and their cards written with the card writer, the way EVT2's commands
 * and the rival booker write them.
 */

import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { parseGameDate } from '../../../src/core/date';
import { simSystem } from '../../../src/core/api/builtins';
import type { DomainEventMap } from '../../../src/core/events/types';
import type { EventInstanceId, PersonId, SegmentId } from '../../../src/core/ids';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import type { GameWorld } from '../../../src/model/tables';
import { matchSystem } from '../../../src/systems/match';
import { showsSystem } from '../../../src/systems/shows';
import { anEventInstance, withMyShowsRun, worldBuilder, type RunsShow } from '../../support';
import type { DeepPartial } from '../../support/builders/build-row';
import { PINFALL, promo, seed, singles, SUBMISSION } from '../booking/command-world';
import { OMNISCIENT, PLAYER_ONE } from '../calendar/lifecycle-world';

export const START = '2026-01-05';
export const TODAY = parseGameDate('2026-01-06');

export interface ShowNightOptions {
  /** Leave out promotion A's shows (the human ones). */
  readonly withoutHumanShows?: boolean;
  /** Number of B's shows with no card. Defaults to 1. */
  readonly bareRivalShows?: number;
}

export interface ShowNightWorld {
  readonly world: GameWorld;
  readonly human: EventInstanceId | null;
  readonly unrun: EventInstanceId | null;
  readonly cancelled: EventInstanceId | null;
  readonly rivalBare: readonly EventInstanceId[];
  readonly rivalCard: EventInstanceId;
  /** The human show's card in running order: the pre-show match first. */
  readonly humanCard: readonly SegmentId[];
  readonly rivalMatches: readonly SegmentId[];
  /** Promotion A's roster. */
  readonly roster: readonly PersonId[];
  /** Promotion B's roster. */
  readonly rivals: readonly PersonId[];
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`The show night world has no entry ${String(index)}`);
  }
  return value;
}

/** The name of the player's show that the stand-in player leaves alone. */
export const UNRUN_SHOW_NAME = 'Test Unrun Show';

/** The stand-in player runs every show of theirs but `unrun`. */
export const runsAllButUnrun: RunsShow = (show) => show.name !== UNRUN_SHOW_NAME;

/** Builds the show night world. */
export function showNightWorld(options: ShowNightOptions = {}): ShowNightWorld {
  const withHuman = options.withoutHumanShows !== true;
  const bareCount = options.bareRivalShows ?? 1;
  let shows:
    | {
        human: EventInstanceId | null;
        unrun: EventInstanceId | null;
        cancelled: EventInstanceId | null;
        rivalBare: EventInstanceId[];
        rivalCard: EventInstanceId;
      }
    | undefined;
  const { world, ids } = worldBuilder({
    startDate: START,
    currentDate: TODAY,
    players: [{ playerId: 'player-1', displayName: 'Test Player 1' }],
  })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion.withRoster(12),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) => promotion.withRoster(6))
    .with('shows', (context) => {
      const promotionA = context.ids.promotions.A;
      const promotionB = context.ids.promotions.B;
      const regionId = context.ids.regions[0];
      if (promotionA === undefined || promotionB === undefined || regionId === undefined) {
        throw new Error('The show night world is missing a promotion or a region');
      }
      const add = (overrides: DeepPartial<EventInstance>): EventInstanceId =>
        context.insert(
          'eventInstances',
          anEventInstance(
            { promotionId: promotionA, regionId, date: TODAY, ...overrides },
            context.sequence,
          ),
        ).id;
      shows = {
        human: withHuman
          ? add({ name: 'Test Human Show', format: { slots: 5, preShowSlots: 1 } })
          : null,
        unrun: withHuman ? add({ name: UNRUN_SHOW_NAME }) : null,
        cancelled: withHuman ? add({ name: 'Test Cancelled Show', status: 'cancelled' }) : null,
        rivalBare: Array.from({ length: bareCount }, (_, index) =>
          add({ name: `Test Rival Bare ${String(index + 1)}`, promotionId: promotionB }),
        ),
        rivalCard: add({ name: 'Test Rival Card', promotionId: promotionB }),
      };
    })
    .build();
  if (shows === undefined) {
    throw new Error('The show night world was built without its shows');
  }
  const roster = ids.people.slice(0, 12);
  const rivals = ids.people.slice(12, 18);
  const person = (index: number): PersonId => at(roster, index);

  const humanCard: SegmentId[] = [];
  if (shows.human !== null) {
    const human = shows.human;
    humanCard.push(
      seed(
        world,
        human,
        0,
        singles(person(0), person(1), { kind: 'win', winningSide: 0, methodKey: PINFALL }),
        true,
      ),
      seed(
        world,
        human,
        0,
        singles(person(2), person(3), { kind: 'win', winningSide: 1, methodKey: SUBMISSION }),
      ),
      seed(world, human, 1, singles(person(4), person(5), { kind: 'draw' })),
      seed(world, human, 2, promo(person(6))),
      seed(world, human, 3, singles(person(7), person(8), { kind: 'noContest' })),
      seed(
        world,
        human,
        4,
        singles(person(9), person(10), { kind: 'win', winningSide: 0, methodKey: PINFALL }),
      ),
    );
  }
  if (shows.unrun !== null) {
    seed(world, shows.unrun, 0, singles(person(0), person(11)));
  }
  const rivalMatches = [
    seed(world, shows.rivalCard, 0, singles(at(rivals, 0), at(rivals, 1))),
    seed(world, shows.rivalCard, 1, singles(at(rivals, 2), at(rivals, 3))),
  ];
  return { world, ...shows, humanCard, rivalMatches, roster, rivals };
}

/**
 * An engine that runs only show night (no calendar, so nothing closes the day's open shows). The
 * player's `human` show is run inside the day, as pressing Run the show would (`withMyShowsRun`);
 * `unrun` is not.
 */
export function showNightEngine(world: GameWorld): Engine {
  return createEngine({
    state: initialEngineState(world),
    systems: withMyShowsRun([simSystem, matchSystem, showsSystem], runsAllButUnrun),
  });
}

/** A show night event as the recent-event log holds it. */
export type ShowNightEvent =
  | { readonly type: 'segment.completed'; readonly payload: DomainEventMap['segment.completed'] }
  | { readonly type: 'show.completed'; readonly payload: DomainEventMap['show.completed'] };

/** Every show night event in the recent-event log, oldest first. */
export function showNightEvents(engine: Engine): ShowNightEvent[] {
  const result = engine.query(
    'sim.recentEvents',
    { limit: 10_000, types: ['segment.completed', 'show.completed'] },
    OMNISCIENT,
  );
  if (!result.ok) {
    throw new Error(`sim.recentEvents failed: ${JSON.stringify(result.reasons)}`);
  }
  return result.data.flatMap((event): ShowNightEvent[] => {
    if (event.type === 'segment.completed') {
      return [{ type: event.type, payload: event.payload }];
    }
    if (event.type === 'show.completed') {
      return [{ type: event.type, payload: event.payload }];
    }
    return [];
  });
}

/** The `segment.completed` payloads, oldest first. */
export function segmentEvents(engine: Engine): DomainEventMap['segment.completed'][] {
  return showNightEvents(engine).flatMap((event) =>
    event.type === 'segment.completed' ? [event.payload] : [],
  );
}

/** The `show.completed` payloads, oldest first. */
export function showEvents(engine: Engine): DomainEventMap['show.completed'][] {
  return showNightEvents(engine).flatMap((event) =>
    event.type === 'show.completed' ? [event.payload] : [],
  );
}

export { OMNISCIENT, PLAYER_ONE };
