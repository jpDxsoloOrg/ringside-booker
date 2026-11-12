/**
 * The world the booking command tests share.
 *
 * - promotion A is run by `player-1` and has a roster of 8. Its first brand has no controller of
 *   its own (so `player-1` runs it); its second brand is run by `player-2`;
 * - promotion B is run by the computer and has a roster of 2;
 * - `player-3` is in the game and runs nothing;
 * - today is a Tuesday, 2026-01-06, so Monday's shows are yesterday's.
 *
 * Every show has 4 main-card slots and 1 pre-show slot.
 */

import type { Engine } from '../../../src/core/api';
import { parseContentKey } from '../../../src/core/content-key';
import { parseGameDate } from '../../../src/core/date';
import type { DomainEventMap } from '../../../src/core/events/types';
import type { EventInstanceId, PersonId, SegmentId } from '../../../src/core/ids';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import type { MatchOutcome } from '../../../src/model/entities/segment';
import type { GameWorld } from '../../../src/model/tables';
import {
  AngleDraftSchema,
  MatchDraftSchema,
  writeSegment,
  type AngleDraft,
  type MatchDraft,
  type ParticipantDraft,
  type SegmentDraft,
} from '../../../src/systems/booking';
import { anEventInstance, worldBuilder } from '../../support';
import type { DeepPartial } from '../../support/builders/build-row';
import { OMNISCIENT, PLAYER_ONE, PLAYER_TWO } from '../calendar/lifecycle-world';

export const START = '2026-01-05';
export const TODAY = '2026-01-06';
const NEXT_WEEK = parseGameDate('2026-01-13');
export const PINFALL = parseContentKey('method.pinfall');
export const SUBMISSION = parseContentKey('method.submission');

/** The shows every command world has. */
export const SHOW_NAMES = [
  'open',
  'today',
  'yesterday',
  'shared',
  'rival',
  'computer',
  'locked',
  'completed',
  'cancelled',
] as const;
export type ShowName = (typeof SHOW_NAMES)[number];

export interface CommandWorld {
  readonly world: GameWorld;
  readonly shows: Readonly<Record<ShowName, EventInstanceId>>;
  /** Promotion A's roster of 8. */
  readonly roster: readonly PersonId[];
  /** Promotion B's roster of 2. */
  readonly rivals: readonly PersonId[];
}

function only<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`The command world has no ${what}`);
  }
  return value;
}

/** Builds the command world. Shows are inserted directly, so no show is on the calendar twice. */
export function commandWorld(options: { readonly randomWinners?: boolean } = {}): CommandWorld {
  let shows: Record<ShowName, EventInstanceId> | undefined;
  const { world, ids } = worldBuilder({
    ...(options.randomWinners === undefined
      ? {}
      : { settings: { extra: { randomWinners: options.randomWinners } } }),
    startDate: START,
    currentDate: TODAY,
    players: [
      { playerId: 'player-1', displayName: 'Test Player 1' },
      { playerId: 'player-2', displayName: 'Test Player 2' },
      { playerId: 'player-3', displayName: 'Test Player 3' },
    ],
  })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion
        .withRoster(8)
        .withBrand({ name: 'Test Brand One' })
        .withBrand({ name: 'Test Brand Two', controller: PLAYER_TWO }),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) => promotion.withRoster(2))
    .with('shows', (context) => {
      const promotionA = only(context.ids.promotions.A, 'promotion A');
      const promotionB = only(context.ids.promotions.B, 'promotion B');
      const [sharedBrand, rivalBrand] = context.ids.brands;
      const regionId = only(context.ids.regions[0], 'region');
      const add = (overrides: DeepPartial<EventInstance>): EventInstanceId =>
        context.insert(
          'eventInstances',
          anEventInstance(
            {
              promotionId: promotionA,
              regionId,
              date: NEXT_WEEK,
              format: { slots: 4, preShowSlots: 1 },
              ...overrides,
            },
            context.sequence,
          ),
        ).id;
      shows = {
        open: add({ name: 'Test Open Show' }),
        today: add({ date: parseGameDate(TODAY) }),
        yesterday: add({ date: parseGameDate(START) }),
        shared: add({ brandId: only(sharedBrand, 'shared brand') }),
        rival: add({ brandId: only(rivalBrand, 'rival brand') }),
        computer: add({ promotionId: promotionB }),
        locked: add({ status: 'booked' }),
        completed: add({ date: parseGameDate(START), status: 'completed' }),
        cancelled: add({ status: 'cancelled' }),
      };
    })
    .build();
  return {
    world,
    shows: only(shows, 'shows'),
    roster: ids.people.slice(0, 8),
    rivals: ids.people.slice(8, 10),
  };
}

/** Roster member `index` of promotion A. */
export function wrestler(booked: CommandWorld, index: number): PersonId {
  return only(booked.roster[index], `roster index ${String(index)}`);
}

export function competitor(personId: PersonId, side: number): ParticipantDraft {
  return { personId, side, role: 'competitor', teamId: null };
}

/** A singles match between the two people; everything later sections own is left to default. */
export function singles(
  left: PersonId,
  right: PersonId,
  outcome: MatchOutcome | null = null,
): MatchDraft {
  return MatchDraftSchema.parse({
    kind: 'match',
    label: null,
    match: { matchTypeKey: parseContentKey('match.singles') },
    participants: [competitor(left, 0), competitor(right, 1)],
    outcome,
  });
}

/** A promo by one person. */
export function promo(personId: PersonId): AngleDraft {
  return AngleDraftSchema.parse({
    kind: 'angle',
    label: null,
    angle: { angleTypeKey: parseContentKey('angle.promo') },
    participants: [{ personId, side: 0, role: 'speaker', teamId: null }],
  });
}

/** Writes `draft` straight onto a card (status is not checked), before the engine exists. */
export function seed(
  world: GameWorld,
  eventInstanceId: EventInstanceId,
  slot: number,
  draft: SegmentDraft,
  preShow = false,
): SegmentId {
  const result = world.transact('seed card', (tx) =>
    writeSegment(tx, { eventInstanceId, preShow, slot, draft }),
  );
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/** The payload of every `card.changed` in the recent-event log, oldest first. */
export function cardChanges(engine: Engine): DomainEventMap['card.changed'][] {
  const result = engine.query(
    'sim.recentEvents',
    { limit: 10_000, types: ['card.changed'] },
    OMNISCIENT,
  );
  if (!result.ok) {
    throw new Error(`sim.recentEvents failed: ${JSON.stringify(result.reasons)}`);
  }
  return result.data.flatMap((event) => (event.type === 'card.changed' ? [event.payload] : []));
}
