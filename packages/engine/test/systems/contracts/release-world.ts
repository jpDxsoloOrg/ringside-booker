/**
 * The world and engine the ECO4-02 command, query and expiry tests share.
 *
 * "My Wrestling" (the player, $100,000 cash) has five workers:
 * - 0 `plain`: a $8,000-a-month lower-card deal with 300 days left, booked against `expiring` on
 *   "My Mainstage" in five days;
 * - 1 `champion`: main event, iron-clad, morale −62, holds the "Test Heavyweight Title", 500 days left;
 * - 2 `expiring`: mid card, 40 days left;
 * - 3 `low`: enhancement, 35 days left (below the default notice push);
 * - 4 `owner`: owns the promotion, open-ended.
 * Plus `signed`: a new person's signed deal starting in ten days.
 *
 * "Rival Wrestling" (the computer) has one worker, `rivalWorker`, morale −70, 200 days left.
 */

import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { Controller } from '../../../src/core/api/controller';
import { addDays, type GameDate } from '../../../src/core/date';
import type { EmploymentId, EventInstanceId, PersonId, PromotionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import type { Employment } from '../../../src/model/entities/employment';
import type { GameWorld } from '../../../src/model/tables';
import { contractsSystem } from '../../../src/systems/contracts';
import { financeSystem } from '../../../src/systems/finance';
import {
  aMatch,
  anEmployment,
  aParticipant,
  aPerson,
  resetTestIds,
  TEST_PLAYER_ID,
  TEST_START_DATE,
  worldBuilder,
  type DeepPartial,
} from '../../support';

export const PLAYER: Controller = { kind: 'human', playerId: TEST_PLAYER_ID };
export const OTHER_PLAYER: Controller = { kind: 'human', playerId: 'player-2' };
export const COMPUTER: Controller = { kind: 'computer' };
export const OMNISCIENT = { kind: 'omniscient' } as const;
export const PLAYER_VIEW = { kind: 'controller', controller: PLAYER } as const;

export const TITLE_NAME = 'Test Heavyweight Title';
export const SHOW_NAME = 'My Mainstage';
export const START_CASH = 10_000_000;

const TODAY = TEST_START_DATE;

const ROSTER: readonly DeepPartial<Employment>[] = [
  {
    push: 'lowerCard',
    endsOn: addDays(TODAY, 300),
    terms: { monthlyWage: cents(800_000) },
  },
  {
    push: 'mainEvent',
    endsOn: addDays(TODAY, 500),
    morale: -62,
    terms: { perks: { ironClad: true } },
  },
  { push: 'midCard', endsOn: addDays(TODAY, 40) },
  { push: 'enhancement', endsOn: addDays(TODAY, 35) },
  { push: 'none', endsOn: null },
];

export interface ReleaseWorld {
  readonly world: GameWorld;
  readonly human: PromotionId;
  readonly rival: PromotionId;
  readonly plain: EmploymentId;
  readonly champion: EmploymentId;
  readonly expiring: EmploymentId;
  readonly low: EmploymentId;
  readonly owner: EmploymentId;
  readonly signed: EmploymentId;
  readonly rivalWorker: EmploymentId;
  readonly show: EventInstanceId;
  readonly today: GameDate;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`release world: missing ${what}`);
  }
  return value;
}

export function edit(world: GameWorld, body: Parameters<GameWorld['transact']>[1]): void {
  const result = world.transact('test edit', body);
  if (!result.ok) {
    throw result.error;
  }
}

export function releaseWorld(options: { readonly cash?: number } = {}): ReleaseWorld {
  resetTestIds();
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion(
      { name: 'My Wrestling', controller: PLAYER, cash: cents(options.cash ?? START_CASH) },
      (promotion) =>
        promotion
          .withRoster(ROSTER.length, { employment: (index) => ROSTER[index] ?? {} })
          .withTitle({ name: TITLE_NAME }, { holder: 1 }),
    )
    .withPromotion({ name: 'Rival Wrestling' }, (promotion) =>
      promotion.withRoster(1, {
        employment: () => ({ endsOn: addDays(TODAY, 200), morale: -70 }),
      }),
    )
    .withEventInstance({ name: SHOW_NAME, date: addDays(TODAY, 5) })
    .with('booking', (context) => {
      const eventInstanceId = required(context.ids.eventInstances[0], 'show');
      const segment = context.insert('segments', aMatch({ eventInstanceId }, context.sequence));
      const booked = [
        required(context.ids.people[0], 'plain person'),
        required(context.ids.people[2], 'opponent'),
      ];
      booked.forEach((personId, side) => {
        context.insert(
          'participants',
          aParticipant(
            { segmentId: segment.id, personId, side, role: 'competitor' },
            context.sequence,
          ),
        );
      });
    })
    .build();
  const [plain, champion, expiring, low, owner, rivalWorker] = ids.employments;
  const human = required(ids.promotions.A, 'A');
  const ownerPerson: PersonId = required(ids.people[4], 'owner person');
  let signed: EmploymentId | undefined;
  edit(world, (tx) => {
    tx.update('promotions', human, { ownerPersonId: ownerPerson });
    const person = tx.insert('people', aPerson({ id: tx.mintId('people') })).id;
    signed = tx.insert(
      'employments',
      anEmployment({
        id: tx.mintId('employments'),
        personId: person,
        promotionId: human,
        status: 'signed',
        offeredOn: TODAY,
        startsOn: addDays(TODAY, 10),
        endsOn: addDays(TODAY, 375),
        terms: { monthlyWage: cents(400_000) },
      }),
    ).id;
  });
  return {
    world,
    human,
    rival: required(ids.promotions.B, 'B'),
    plain: required(plain, 'plain'),
    champion: required(champion, 'champion'),
    expiring: required(expiring, 'expiring'),
    low: required(low, 'low'),
    owner: required(owner, 'owner'),
    signed: required(signed, 'signed'),
    rivalWorker: required(rivalWorker, 'rival worker'),
    show: required(ids.eventInstances[0], 'show'),
    today: world.meta.currentDate,
  };
}

/** An engine over `world` with the contracts and finance systems. */
export function contractsEngine(
  world: GameWorld,
  overrides: Record<string, number | boolean | string> = {},
): Engine {
  const engine = createEngine({
    state: initialEngineState(world),
    systems: [simSystem, financeSystem, contractsSystem],
  });
  // The expiring-soon stop is off by default until the Contracts screen can clear it (ECO4-04);
  // these tests turn it on unless they say otherwise.
  for (const [key, value] of Object.entries({
    'contracts.expiringSoon.stopSkip': true,
    ...overrides,
  })) {
    const set = engine.command('tunables.setOverride', { key, value }, PLAYER);
    if (!set.ok) {
      throw new Error(`could not set ${key}: ${JSON.stringify(set.reasons)}`);
    }
  }
  return engine;
}

/** Runs a query and fails on a refusal. */
export function ask<T>(result: { ok: true; data: T } | { ok: false; reasons: unknown }): T {
  if (!result.ok) {
    throw new Error(`query refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

export function employmentOf(engine: Engine, id: EmploymentId): Employment {
  return required(
    engine.exportState().world.tables.employments.find((row) => row.id === id),
    `employment ${id}`,
  );
}

export function cashOf(engine: Engine, promotionId: PromotionId): number {
  return required(
    engine.exportState().world.tables.promotions.find((row) => row.id === promotionId),
    'promotion',
  ).cash;
}
