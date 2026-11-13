/**
 * A world for the show-cost tests (ECO1-04), on the mini geography (North 1 and North 2 in one
 * country, South 1 and South 2 in another).
 *
 * - A: human-controlled, home North 1, travel and catering at Basic (overridable), medical None.
 *   Roster of four: 0 plain, 1 on a $400 per-appearance fee, 2 with the travel perk, 3 the
 *   referee.
 * - B: computer-controlled, roster of eight with pushes from the top of the card down, so the
 *   off-screen estimate has a clear order.
 * - `show`: A's completed regular show "Test Night" in `showRegion` (North 1 by default). Three
 *   matches: person 0 is in all three, person 1 in the first, A's person 2 in the second with B's
 *   person 4 (a guest), and person 3 referees the first.
 * - `offscreen`: B's completed show with no card, three main-card slots.
 */

import type { EventInstanceId, PersonId, PromotionId, RegionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import { createRuntime, type SimRuntime } from '../../../src/core/pipeline/runtime';
import type { Push } from '../../../src/model/entities/employment';
import type { Promotion } from '../../../src/model/entities/promotion';
import type { GameWorld } from '../../../src/model/tables';
import { createEngineTunables } from '../../../src/systems/tunables';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { aMatch, anEventInstance, aParticipant, TEST_PLAYER_ID, worldBuilder } from '../../support';

export interface ShowCostWorld {
  readonly world: GameWorld;
  readonly human: PromotionId;
  readonly rival: PromotionId;
  readonly show: EventInstanceId;
  readonly offscreen: EventInstanceId;
  readonly roster: readonly PersonId[];
  readonly rivals: readonly PersonId[];
  readonly regions: readonly RegionId[];
}

export interface ShowCostWorldOptions {
  /** Which mini region A's show is held in: 0 North 1 (home), 1 North 2, 2 South 1. */
  readonly showRegion?: number;
  readonly policies?: Partial<Promotion['policies']>;
}

const RIVAL_PUSHES: readonly Push[] = [
  'lowerCard',
  'mainEvent',
  'midCard',
  'enhancement',
  'upperCard',
  'midCard',
  'mainEvent',
  'none',
];

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`showCostWorld: missing ${what}`);
  }
  return value;
}

export function showCostWorld(options: ShowCostWorldOptions = {}): ShowCostWorld {
  const showRegion = options.showRegion ?? 0;
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion(
      {
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
        policies: { travel: 1, catering: 1, medical: 0, ...options.policies },
      },
      (promotion) =>
        promotion.withRoster(4, {
          employment: (index) => {
            if (index === 1) {
              return { terms: { perAppearanceFee: cents(40_000) } };
            }
            if (index === 2) {
              return { terms: { perks: { travelCovered: true } } };
            }
            if (index === 3) {
              return { role: 'referee', push: 'none' };
            }
            return {};
          },
        }),
    )
    .withPromotion({}, (promotion) =>
      promotion.withRoster(8, {
        employment: (index) => ({ push: RIVAL_PUSHES[index] ?? 'none' }),
      }),
    )
    .with('shows', (context) => {
      const regionId = required(context.ids.regions[showRegion], 'show region');
      const human = required(context.ids.promotions.A, 'A');
      const rival = required(context.ids.promotions.B, 'B');
      const person = (index: number) =>
        required(context.ids.people[index], `person ${String(index)}`);
      const date = context.meta.startDate;
      const show = context.insert(
        'eventInstances',
        anEventInstance(
          { promotionId: human, regionId, name: 'Test Night', status: 'completed', date },
          context.sequence,
        ),
      );
      context.insert(
        'eventInstances',
        anEventInstance(
          {
            promotionId: rival,
            regionId: required(context.ids.regions[0], 'region'),
            name: 'Test Rival Night',
            status: 'completed',
            date,
            format: { slots: 3, preShowSlots: 0 },
          },
          context.sequence,
        ),
      );
      const cards: { people: number[]; refereeId: PersonId | null }[] = [
        { people: [0, 1], refereeId: person(3) },
        { people: [0, 2, 4], refereeId: null },
        { people: [0], refereeId: null },
      ];
      cards.forEach((card, slot) => {
        const segment = context.insert(
          'segments',
          aMatch(
            {
              eventInstanceId: show.id,
              slot,
              crew: { refereeId: card.refereeId, producerId: null, announcerIds: [] },
            },
            context.sequence,
          ),
        );
        card.people.forEach((index, side) => {
          context.insert(
            'participants',
            aParticipant(
              { segmentId: segment.id, personId: person(index), side },
              context.sequence,
            ),
          );
        });
      });
    })
    .build();
  const [show, offscreen] = ids.eventInstances;
  return {
    world,
    human: required(ids.promotions.A, 'A'),
    rival: required(ids.promotions.B, 'B'),
    show: required(show, 'show'),
    offscreen: required(offscreen, 'offscreen show'),
    roster: ids.people.slice(0, 4),
    rivals: ids.people.slice(4, 12),
    regions: ids.regions,
  };
}

/** A runtime over `world` with no phases: tests run their own steps. */
export function bareRuntime(world: GameWorld, overrides: TunableOverrides = {}): SimRuntime {
  return createRuntime({ world, tunables: createEngineTunables(overrides) });
}
