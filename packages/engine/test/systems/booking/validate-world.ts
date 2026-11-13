/**
 * The world the booking-check and lock tests share. It starts on Monday 5 January 2026, the day of
 * `show`, promotion A's six-slot show on Brand One (with one pre-show slot):
 *
 * - promotion A is run by `player-1` and has a roster of 12, all contracted to Brand One:
 *   0 "Rhea Cortez" holds the heavyweight title; 1 and 2 hold the tag title; 3 "Tia Cruz" is
 *   injured but may still talk; 4 "Max Dorn" is injured and may not; 5 "Kai Moreno"; 6 "Mia Torres"; 7 "Leo Hart";
 *   8 "Ana Vale"; 9 "Bo Stone"; 10 "Sam Reed" is a manager, not a wrestler; 11 "Lia Moon" is a
 *   woman (everyone else is a man);
 * - the women's title is vacant; Brand Two is run by `player-2`, with a show of its own on
 *   Tuesday (`rival`);
 * - `past` is promotion A's show from the Sunday before, still scheduled.
 *
 * {@link bookRunnable} books the smallest card that passes every check.
 */

import { parseContentKey } from '../../../src/core/content-key';
import { parseGameDate, type GameDate } from '../../../src/core/date';
import type { BrandId, EventInstanceId, PersonId, SegmentId, TitleId } from '../../../src/core/ids';
import type { Controller } from '../../../src/model/controller';
import type { MatchOutcome } from '../../../src/model/entities/segment';
import type { GameWorld } from '../../../src/model/tables';
import {
  AngleDraftSchema,
  MatchDraftSchema,
  validateCard,
  writeSegment,
  type AngleDraft,
  type BookingValidation,
  type MatchDraft,
  type ParticipantDraft,
  type SegmentDraft,
} from '../../../src/systems/booking';
import { createEngineTunables } from '../../../src/systems/tunables';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { anEventInstance, worldBuilder } from '../../support';

export const PLAYER_ONE: Controller = { kind: 'human', playerId: 'player-1' };
export const PLAYER_TWO: Controller = { kind: 'human', playerId: 'player-2' };
export const START: GameDate = parseGameDate('2026-01-05');
export const INJURY_RETURN: GameDate = parseGameDate('2026-02-12');
export const PINFALL = parseContentKey('method.pinfall');
export const WIN: MatchOutcome = { kind: 'win', winningSide: 0, methodKey: PINFALL };

const RING_NAMES: Readonly<Record<number, string>> = {
  0: 'Rhea Cortez',
  3: 'Tia Cruz',
  4: 'Max Dorn',
  5: 'Kai Moreno',
  6: 'Mia Torres',
  7: 'Leo Hart',
  8: 'Ana Vale',
  9: 'Bo Stone',
  10: 'Sam Reed',
  11: 'Lia Moon',
};

export interface ValidateWorld {
  readonly world: GameWorld;
  readonly roster: readonly PersonId[];
  readonly brandOne: BrandId;
  readonly brandTwo: BrandId;
  readonly heavyweight: TitleId;
  readonly tag: TitleId;
  readonly women: TitleId;
  readonly show: EventInstanceId;
  readonly rival: EventInstanceId;
  readonly past: EventInstanceId;
}

function only<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`The validate world has no ${what}`);
  }
  return value;
}

export interface ValidateWorldOptions {
  /** Turns on MTCH2's Random winners new-game setting. */
  readonly randomWinners?: boolean;
  /** Puts the test injury catalog on the world, so in-match injuries become real ones (WRK6-07). */
  readonly injuryCatalog?: boolean;
}

export function validateWorld(options: ValidateWorldOptions = {}): ValidateWorld {
  const builder = worldBuilder({
    ...(options.randomWinners === undefined
      ? {}
      : { settings: { extra: { randomWinners: options.randomWinners } } }),
    startDate: START,
    players: [
      { playerId: 'player-1', displayName: 'Test Player 1' },
      { playerId: 'player-2', displayName: 'Test Player 2' },
    ],
  })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion
        .withBrand({ name: 'Test Brand One' })
        .withBrand({ name: 'Test Brand Two', controller: PLAYER_TWO })
        .withRoster(12, {
          person: (index) => {
            if (index === 3 || index === 4) {
              return {
                injury: {
                  kindKey: parseContentKey('injury.test'),
                  bodyPart: 'legs',
                  since: START,
                  expectedReturn: INJURY_RETURN,
                  canWorkAngles: index === 3,
                },
              };
            }
            if (index === 10) {
              return { roles: ['manager'], style: 'nonWrestler' };
            }
            if (index === 11) {
              return { gender: 'female' };
            }
            return {};
          },
          employment: (index) => {
            const ringName = RING_NAMES[index];
            return ringName === undefined ? {} : { ringName };
          },
        })
        .withTitle({ name: 'Test Heavyweight Title', prestige: 80 }, { holder: 0 })
        .withTitle(
          { name: 'Test Tag Team Title', holderCount: 2, prestige: 60 },
          { holder: [1, 2] },
        )
        .withTitle({
          name: "Test Women's Title",
          prestige: 50,
          division: { gender: 'female', minWeightKg: null, maxWeightKg: null },
        }),
    )
    .with('shows', (context) => {
      const promotionA = only(context.ids.promotions.A, 'promotion A');
      const [brandOne, brandTwo] = context.ids.brands;
      const regionId = only(context.ids.regions[0], 'a region');
      const add = (name: string, date: string, brandId: BrandId): void => {
        context.insert(
          'eventInstances',
          anEventInstance(
            {
              promotionId: promotionA,
              brandId,
              regionId,
              name,
              date: parseGameDate(date),
              airDate: parseGameDate(date),
              format: { slots: 6, preShowSlots: 1 },
            },
            context.sequence,
          ),
        );
      };
      add('Test Monday Show', '2026-01-05', only(brandOne, 'brand one'));
      add('Test Rival Show', '2026-01-06', only(brandTwo, 'brand two'));
      add('Test Sunday Show', '2026-01-04', only(brandOne, 'brand one'));
    });
  if (options.injuryCatalog === true) {
    builder.withInjuryCatalog();
  }
  const { world, ids } = builder.build();
  const [show, rival, past] = ids.eventInstances;
  const [heavyweight, tag, women] = ids.titles;
  return {
    world,
    roster: ids.people.slice(0, 12),
    brandOne: only(ids.brands[0], 'brand one'),
    brandTwo: only(ids.brands[1], 'brand two'),
    heavyweight: only(heavyweight, 'heavyweight title'),
    tag: only(tag, 'tag title'),
    women: only(women, "women's title"),
    show: only(show, 'show'),
    rival: only(rival, 'rival show'),
    past: only(past, 'past show'),
  };
}

/** Roster member `index`. */
export function who(built: ValidateWorld, index: number): PersonId {
  return only(built.roster[index], `roster ${String(index)}`);
}

export function competitor(personId: PersonId, side: number): ParticipantDraft {
  return { personId, side, role: 'competitor', teamId: null };
}

export function speaker(personId: PersonId, side = 0): ParticipantDraft {
  return { personId, side, role: 'speaker', teamId: null };
}

export interface MatchOptions {
  readonly type?: string;
  readonly titleIds?: readonly TitleId[];
  readonly outcome?: MatchOutcome | null;
  /** A planned finish (MTCH2), such as `finish.disqualification`; Auto when left out. */
  readonly finishKey?: string;
}

/** A match with one side per list of people. Side 0 wins by pinfall unless told otherwise. */
export function match(
  sides: readonly (readonly PersonId[])[],
  options: MatchOptions = {},
): MatchDraft {
  return MatchDraftSchema.parse({
    kind: 'match',
    label: null,
    match: {
      matchTypeKey: parseContentKey(options.type ?? 'match.singles'),
      titleIds: [...(options.titleIds ?? [])],
      ...(options.finishKey === undefined ? {} : { finishKey: parseContentKey(options.finishKey) }),
    },
    participants: sides.flatMap((people, side) =>
      people.map((personId) => competitor(personId, side)),
    ),
    outcome: options.outcome === undefined ? WIN : options.outcome,
  });
}

/** An angle of `type` with these speakers. */
export function angle(speakers: readonly PersonId[], type = 'angle.promo'): AngleDraft {
  return AngleDraftSchema.parse({
    kind: 'angle',
    label: null,
    angle: { angleTypeKey: parseContentKey(type) },
    participants: speakers.map((personId) => speaker(personId)),
  });
}

/** Writes `draft` into a slot of `show`, failing the test on a refusal. */
export function book(
  built: ValidateWorld,
  slot: number,
  draft: SegmentDraft,
  options: { preShow?: boolean; show?: EventInstanceId } = {},
): SegmentId {
  const result = built.world.transact('test booking', (tx) =>
    writeSegment(tx, {
      eventInstanceId: options.show ?? built.show,
      preShow: options.preShow ?? false,
      slot,
      draft,
    }),
  );
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

export interface RunnableCard {
  readonly opener: SegmentId;
  readonly promo: SegmentId;
  readonly mainEvent: SegmentId;
}

/**
 * Books the smallest card that passes every check: the opener (Mia Torres v Leo Hart), a promo by
 * Kai Moreno in slot 3 and the main event (Ana Vale v Bo Stone); three of six slots filled.
 */
export function bookRunnable(
  built: ValidateWorld,
  show: EventInstanceId = built.show,
): RunnableCard {
  return {
    opener: book(built, 0, match([[who(built, 6)], [who(built, 7)]]), { show }),
    promo: book(built, 2, angle([who(built, 5)]), { show }),
    mainEvent: book(built, 5, match([[who(built, 8)], [who(built, 9)]]), { show }),
  };
}

export function change(built: ValidateWorld, body: Parameters<GameWorld['transact']>[1]): void {
  const result = built.world.transact('test change', body);
  if (!result.ok) {
    throw result.error;
  }
}

/** Validates `show` (the Monday show by default) at default tunables or with `overrides`. */
export function validate(
  built: ValidateWorld,
  overrides: TunableOverrides = {},
  show: EventInstanceId = built.show,
): BookingValidation {
  return validateCard(built.world, show, { tunables: createEngineTunables(overrides) });
}
