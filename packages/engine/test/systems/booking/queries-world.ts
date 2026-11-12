/**
 * The world the booking query and gate tests share. It starts on Monday 5 January 2026:
 *
 * - promotion A is run by `player-1`. Brand One has no controller of its own; Brand Two is run by
 *   the computer. A's roster of 6: roster 0 wrestles as "Kid Vega" here; roster 2 is injured but
 *   may still talk; roster 3 is injured and may not; roster 5 is contracted to Brand One's sister
 *   Brand Three. Roster 0 and 1 are a tag team, and roster 0 holds the heavyweight title;
 * - promotion B is run by the computer and has one wrestler;
 * - A's shows: `six` today on Brand One (6 slots and a pre-show), `three` on Wednesday (3 slots),
 *   `yesterday` (still scheduled, but past), `brandTwo` on Tuesday (Brand Two's), and B's `rival`
 *   on Tuesday.
 *
 * `six` is partly booked (see {@link bookSix}); the others are empty.
 */

import { parseContentKey } from '../../../src/core/content-key';
import { createEngine, initialEngineState, type Engine, type Viewer } from '../../../src/core/api';
import { parseGameDate, type GameDate } from '../../../src/core/date';
import type {
  BrandId,
  EventInstanceId,
  PersonId,
  SegmentId,
  TeamId,
  TitleId,
} from '../../../src/core/ids';
import type { Controller } from '../../../src/model/controller';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import {
  AngleDraftSchema,
  MatchDraftSchema,
  writeSegment,
  type ParticipantDraft,
  type SegmentDraft,
} from '../../../src/systems/booking';
import { aTeam, anEventInstance, worldBuilder } from '../../support';

export const PLAYER_ONE: Controller = { kind: 'human', playerId: 'player-1' };
export const AS_PLAYER_ONE: Viewer = { kind: 'controller', controller: PLAYER_ONE };
export const AS_PLAYER_TWO: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: 'player-2' },
};
export const AS_COMPUTER: Viewer = { kind: 'controller', controller: { kind: 'computer' } };
export const OMNISCIENT: Viewer = { kind: 'omniscient' };

/** A Monday. */
export const START: GameDate = parseGameDate('2026-01-05');
export const INJURY_RETURN: GameDate = parseGameDate('2026-02-12');

export interface BookingQueriesWorld {
  readonly world: GameWorld;
  readonly roster: readonly PersonId[];
  readonly outsider: PersonId;
  readonly brandOne: BrandId;
  readonly brandTwo: BrandId;
  readonly brandThree: BrandId;
  readonly team: TeamId;
  readonly title: TitleId;
  readonly shows: {
    readonly six: EventInstanceId;
    readonly three: EventInstanceId;
    readonly yesterday: EventInstanceId;
    readonly brandTwo: EventInstanceId;
    readonly rival: EventInstanceId;
  };
}

function only<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`The booking world has no ${what}`);
  }
  return value;
}

export interface BookingWorldOptions {
  /** Leave the catalogs out, as a save from before MTCH1 has it. */
  readonly withoutCatalogs?: boolean;
}

export function bookingQueriesWorld(options: BookingWorldOptions = {}): BookingQueriesWorld {
  const builder = worldBuilder({ startDate: START });
  if (options.withoutCatalogs !== true) {
    builder.withCatalogs();
  }
  const { world, ids } = builder
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion
        .withBrand({ name: 'Test Brand One' })
        .withBrand({ name: 'Test Brand Two', controller: { kind: 'computer' } })
        .withBrand({ name: 'Test Brand Three' })
        .withRoster(6, {
          person: (index) => {
            if (index === 2 || index === 3) {
              return {
                injury: {
                  kindKey: parseContentKey('injury.test'),
                  bodyPart: 'legs',
                  since: START,
                  expectedReturn: INJURY_RETURN,
                  canWorkAngles: index === 2,
                },
              };
            }
            return {};
          },
          employment: (index) => ({
            ...(index === 0 ? { ringName: 'Kid Vega' } : {}),
            push: index === 4 ? 'mainEvent' : 'midCard',
          }),
        })
        .withTitle({ name: 'Test Heavyweight Title', prestige: 80 }, { holder: 0 })
        .withTitle({ name: 'Test Midcard Title', prestige: 40 }),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) => promotion.withRoster(1))
    .with('team, brands and shows', (context) => {
      const [first, second, , , , sixth] = context.ids.people;
      const [brandOne, brandTwo, brandThree] = context.ids.brands;
      context.insert(
        'teams',
        aTeam(
          { name: 'Test Team', memberIds: [only(first, 'roster 0'), only(second, 'roster 1')] },
          context.sequence,
        ),
      );
      const sixthEmployment = context.tx.view.tables.employments
        .lookup('byPerson', only(sixth, 'roster 5'))
        .at(0);
      context.tx.update('employments', only(sixthEmployment, 'roster 5 contract').id, {
        brandId: only(brandThree, 'brand three'),
      });
      const promotionA = only(context.ids.promotions.A, 'promotion A');
      const promotionB = only(context.ids.promotions.B, 'promotion B');
      const [regionId] = context.ids.regions;
      const show = (
        name: string,
        date: string,
        promotionId: typeof promotionA,
        brandId: BrandId | null,
        format: { slots: number; preShowSlots: number },
      ): void => {
        context.insert(
          'eventInstances',
          anEventInstance(
            {
              promotionId,
              brandId,
              regionId: only(regionId, 'a region'),
              name,
              date: parseGameDate(date),
              airDate: parseGameDate(date),
              format,
            },
            context.sequence,
          ),
        );
      };
      const one = only(brandOne, 'brand one');
      show('Test Monday Show', '2026-01-05', promotionA, one, { slots: 6, preShowSlots: 1 });
      show('Test Wednesday Show', '2026-01-07', promotionA, one, { slots: 3, preShowSlots: 0 });
      show('Test Sunday Show', '2026-01-04', promotionA, one, { slots: 3, preShowSlots: 0 });
      show('Test Brand Two Show', '2026-01-06', promotionA, only(brandTwo, 'brand two'), {
        slots: 3,
        preShowSlots: 0,
      });
      show('Test Rival Show', '2026-01-06', promotionB, null, { slots: 3, preShowSlots: 0 });
    })
    .build();
  const shows = ids.eventInstances;
  return {
    world,
    roster: ids.people.slice(0, 6),
    outsider: only(ids.people[6], 'outsider'),
    brandOne: only(ids.brands[0], 'brand one'),
    brandTwo: only(ids.brands[1], 'brand two'),
    brandThree: only(ids.brands[2], 'brand three'),
    team: only(ids.teams[0], 'team'),
    title: only(ids.titles[0], 'title'),
    shows: {
      six: only(shows[0], 'show six'),
      three: only(shows[1], 'show three'),
      yesterday: only(shows[2], 'show yesterday'),
      brandTwo: only(shows[3], 'show brandTwo'),
      rival: only(shows[4], 'show rival'),
    },
  };
}

/** Roster member `index`. */
export function person(built: BookingQueriesWorld, index: number): PersonId {
  return only(built.roster[index], `roster ${String(index)}`);
}

function competitor(personId: PersonId, side: number, teamId: TeamId | null = null) {
  return { personId, side, role: 'competitor', teamId } satisfies ParticipantDraft;
}

/** Writes `draft` into a slot of `show`, failing the test on a refusal. */
export function book(
  world: GameWorld,
  show: EventInstanceId,
  preShow: boolean,
  slot: number,
  draft: SegmentDraft,
): SegmentId {
  const result = world.transact('test booking', (tx) =>
    writeSegment(tx, { eventInstanceId: show, preShow, slot, draft }),
  );
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

export interface SixCard {
  readonly opener: SegmentId;
  readonly battleRoyal: SegmentId;
  readonly promo: SegmentId;
  readonly mainEvent: SegmentId;
  readonly preShow: SegmentId;
}

/**
 * Books `six`: slot 1 Kid Vega v roster 1 for the title (Kid Vega to win by pinfall), slot 2 open,
 * slot 3 a battle royal, slot 4 a promo by roster 2, slot 5 open, slot 6 the tag team v roster 4
 * and 5, and a pre-show singles match between roster 4 and 5.
 */
export function bookSix(built: BookingQueriesWorld): SixCard {
  const { world } = built;
  const show = built.shows.six;
  const key = parseContentKey;
  const opener = book(
    world,
    show,
    false,
    0,
    MatchDraftSchema.parse({
      kind: 'match',
      label: 'Title match',
      match: { matchTypeKey: key('match.singles'), titleIds: [built.title] },
      participants: [competitor(person(built, 0), 0), competitor(person(built, 1), 1)],
      outcome: { kind: 'win', winningSide: 0, methodKey: key('method.pinfall') },
    }),
  );
  const battleRoyal = book(
    world,
    show,
    false,
    2,
    MatchDraftSchema.parse({
      kind: 'match',
      label: null,
      match: { matchTypeKey: key('match.battle-royal') },
      participants: [1, 4, 5].map((index, side) => competitor(person(built, index), side)),
      outcome: null,
    }),
  );
  const promo = book(
    world,
    show,
    false,
    3,
    AngleDraftSchema.parse({
      kind: 'angle',
      label: null,
      angle: { angleTypeKey: key('angle.promo') },
      participants: [{ personId: person(built, 2), side: 0, role: 'speaker', teamId: null }],
    }),
  );
  const mainEvent = book(
    world,
    show,
    false,
    5,
    MatchDraftSchema.parse({
      kind: 'match',
      label: null,
      match: { matchTypeKey: key('match.tag-team') },
      participants: [
        competitor(person(built, 0), 0, built.team),
        competitor(person(built, 1), 0, built.team),
        competitor(person(built, 4), 1),
        competitor(person(built, 5), 1),
      ],
      outcome: null,
    }),
  );
  const preShow = book(
    world,
    show,
    true,
    0,
    MatchDraftSchema.parse({
      kind: 'match',
      label: null,
      match: { matchTypeKey: key('match.singles') },
      participants: [competitor(person(built, 4), 0), competitor(person(built, 5), 1)],
      outcome: { kind: 'draw' },
    }),
  );
  return { opener, battleRoyal, promo, mainEvent, preShow };
}

export function engineOver(world: GameWorld): Engine {
  return createEngine({ state: initialEngineState(world), systems: defaultSystems });
}
