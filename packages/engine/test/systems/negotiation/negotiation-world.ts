/**
 * The world the ECO5-02 asking-terms and free-agent tests share (mini geography, today =
 * TEST_START_DATE). Both promotions are known in every region, so both may offer written and
 * exclusive deals.
 *
 * "My Wrestling" (the player, home North 1):
 * - `mine`: a written exclusive deal at $8,000 a month, 300 days left;
 * - `mineFee`: a per-appearance deal at $450 an appearance.
 *
 * "Rival Wrestling" (the computer unless told otherwise):
 * - `rivalLocked`: exclusive, $12,345.67 a month, 200 days left (talks blocked);
 * - `rivalEnding`: exclusive, 20 days left (inside the approach window);
 * - `rivalFee`: a per-appearance deal at $987.65 an appearance;
 * - `rivalSigned`: a signed exclusive deal that starts in 10 days (talks blocked).
 *
 * Nobody's employer:
 * - `free`: a popular free agent based in Test Country South (asks for travel), with an open
 *   rival negotiation and an earlier walk-away from the player (cooldown in 12 days);
 * - `veteran`: aged 50, popularity 85, loyal;
 * - `retired` and `rookie` (debuts next year): unavailable.
 */

import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { Controller } from '../../../src/core/api/controller';
import { addDays, addYears, type GameDate } from '../../../src/core/date';
import type { EmploymentId, PersonId, PromotionId, RegionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import type { Employment } from '../../../src/model/entities/employment';
import type { GameWorld } from '../../../src/model/tables';
import { contractsSystem } from '../../../src/systems/contracts';
import { financeSystem } from '../../../src/systems/finance';
import { negotiationSystem } from '../../../src/systems/negotiation';
import { createEngineTunables, type EngineTunables } from '../../../src/systems/tunables';
import {
  aNegotiation,
  anEmployment,
  anOffer,
  aPerson,
  resetTestIds,
  TEST_PLAYER_ID,
  TEST_START_DATE,
  worldBuilder,
  type BuildContext,
  type DeepPartial,
} from '../../support';

export const PLAYER: Controller = { kind: 'human', playerId: TEST_PLAYER_ID };
export const OTHER_PLAYER: Controller = { kind: 'human', playerId: 'player-2' };
export const PLAYER_VIEW = { kind: 'controller', controller: PLAYER } as const;
export const OTHER_VIEW = { kind: 'controller', controller: OTHER_PLAYER } as const;
export const OMNISCIENT = { kind: 'omniscient' } as const;

export const RIVAL_NAME = 'Rival Wrestling';
/** The rival's private money terms: they must never leave the engine. */
export const RIVAL_WAGE = 1_234_567;
export const RIVAL_FEE = 98_765;
export const MY_WAGE = 800_000;
export const MY_FEE = 45_000;

const TODAY = TEST_START_DATE;

export interface NegotiationWorld {
  readonly world: GameWorld;
  readonly today: GameDate;
  readonly human: PromotionId;
  readonly rival: PromotionId;
  readonly mine: EmploymentId;
  readonly mineFee: EmploymentId;
  readonly rivalLocked: EmploymentId;
  readonly rivalEnding: EmploymentId;
  readonly rivalFee: EmploymentId;
  readonly rivalSigned: EmploymentId;
  readonly person: (employmentId: EmploymentId) => PersonId;
  readonly free: PersonId;
  readonly veteran: PersonId;
  readonly retired: PersonId;
  readonly rookie: PersonId;
  readonly signedPerson: PersonId;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`negotiation world: missing ${what}`);
  }
  return value;
}

/** Popularity `value` in every region of the map. */
function everywhere(context: BuildContext, value: number): Record<RegionId, number> {
  const pop: Record<RegionId, number> = {};
  for (const regionId of context.ids.regions) {
    pop[regionId] = value;
  }
  return pop;
}

const MY_ROSTER: readonly DeepPartial<Employment>[] = [
  { endsOn: addDays(TODAY, 300), terms: { monthlyWage: cents(MY_WAGE) } },
  {
    endsOn: addDays(TODAY, 300),
    terms: {
      kind: 'perAppearance',
      exclusive: false,
      monthlyWage: cents(0),
      perAppearanceFee: cents(MY_FEE),
    },
  },
];

const RIVAL_ROSTER: readonly DeepPartial<Employment>[] = [
  { endsOn: addDays(TODAY, 200), terms: { monthlyWage: cents(RIVAL_WAGE) } },
  { endsOn: addDays(TODAY, 20), terms: { monthlyWage: cents(RIVAL_WAGE) } },
  {
    endsOn: addDays(TODAY, 100),
    terms: {
      kind: 'perAppearance',
      exclusive: false,
      monthlyWage: cents(0),
      perAppearanceFee: cents(RIVAL_FEE),
    },
  },
];

export function negotiationWorld(options: { rivalController?: Controller } = {}): NegotiationWorld {
  resetTestIds();
  const extra: Record<string, PersonId> = {};
  let signed: EmploymentId | undefined;
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({ name: 'My Wrestling', controller: PLAYER, prestige: 60 }, (promotion) =>
      promotion.withRoster(MY_ROSTER.length, { employment: (index) => MY_ROSTER[index] ?? {} }),
    )
    .withPromotion(
      { name: RIVAL_NAME, controller: options.rivalController ?? { kind: 'computer' } },
      (promotion) =>
        promotion.withRoster(RIVAL_ROSTER.length, {
          employment: (index) => RIVAL_ROSTER[index] ?? {},
        }),
    )
    .with('popular promotions', (context) => {
      for (const promotionId of context.ids.promotions.A === undefined
        ? []
        : [context.ids.promotions.A, required(context.ids.promotions.B, 'B')]) {
        context.tx.update('promotions', promotionId, { regionalPop: everywhere(context, 80) });
      }
    })
    .with('free agents', (context) => {
      const south = required(context.ids.regions[2], 'South 1');
      const add = (key: string, overrides: DeepPartial<Parameters<typeof aPerson>[0]>): void => {
        extra[key] = context.insert('people', aPerson(overrides, context.sequence)).id;
      };
      add('free', { basedInRegionId: south, regionalPop: everywhere(context, 60) });
      add('veteran', {
        birthDate: addYears(TODAY, -50),
        regionalPop: everywhere(context, 85),
        traits: ['loyal'],
      });
      add('retired', { status: 'retired' });
      add('rookie', { birthDate: addYears(TODAY, -17), debutDate: addYears(TODAY, 1) });
      add('signedPerson', {});
      const rival = required(context.ids.promotions.B, 'B');
      const freeId = required(extra['free'], 'free');
      const signedId = required(extra['signedPerson'], 'signed person');
      const human = required(context.ids.promotions.A, 'A');
      signed = context.insert(
        'employments',
        anEmployment(
          {
            personId: signedId,
            promotionId: rival,
            status: 'signed',
            startsOn: addDays(TODAY, 10),
            endsOn: addDays(TODAY, 375),
            terms: { monthlyWage: cents(RIVAL_WAGE) },
          },
          context.sequence,
        ),
      ).id;
      // The rival is talking to the free agent: an open signing with its offered employment.
      const offered = context.insert(
        'employments',
        anEmployment(
          {
            personId: freeId,
            promotionId: rival,
            status: 'offered',
            startsOn: addDays(TODAY, 7),
            endsOn: addDays(TODAY, 372),
            terms: { monthlyWage: cents(RIVAL_WAGE) },
          },
          context.sequence,
        ),
      ).id;
      context.insert(
        'negotiations',
        aNegotiation(
          {
            personId: freeId,
            promotionId: rival,
            employmentId: offered,
            offer: anOffer({ terms: { monthlyWage: cents(RIVAL_WAGE) } }),
          },
          context.sequence,
        ),
      );
      // The free agent walked away from the player earlier.
      const withdrawn = context.insert(
        'employments',
        anEmployment(
          {
            personId: freeId,
            promotionId: human,
            status: 'withdrawn',
            offeredOn: addDays(TODAY, -18),
            startsOn: addDays(TODAY, -11),
            endsOn: addDays(TODAY, 300),
            endedOn: addDays(TODAY, -18),
          },
          context.sequence,
        ),
      ).id;
      context.insert(
        'negotiations',
        aNegotiation(
          {
            personId: freeId,
            promotionId: human,
            employmentId: withdrawn,
            status: 'walkedAway',
            openedOn: addDays(TODAY, -20),
            submittedOn: addDays(TODAY, -20),
            closedOn: addDays(TODAY, -18),
            outcome: { code: 'walkedAway', otherPromotionId: null },
            cooldownUntil: addDays(TODAY, 12),
          },
          context.sequence,
        ),
      );
    })
    .build();
  const [mine, mineFee, rivalLocked, rivalEnding, rivalFee] = ids.employments;
  return {
    world,
    today: world.meta.currentDate,
    human: required(ids.promotions.A, 'A'),
    rival: required(ids.promotions.B, 'B'),
    mine: required(mine, 'mine'),
    mineFee: required(mineFee, 'mine fee'),
    rivalLocked: required(rivalLocked, 'rival locked'),
    rivalEnding: required(rivalEnding, 'rival ending'),
    rivalFee: required(rivalFee, 'rival fee'),
    rivalSigned: required(signed, 'rival signed'),
    person: (employmentId) => world.tables.employments.require(employmentId).personId,
    free: required(extra['free'], 'free'),
    veteran: required(extra['veteran'], 'veteran'),
    retired: required(extra['retired'], 'retired'),
    rookie: required(extra['rookie'], 'rookie'),
    signedPerson: required(extra['signedPerson'], 'signed person'),
  };
}

/** An engine over `world` with the systems the queries need. */
export function negotiationEngine(world: GameWorld): Engine {
  return createEngine({
    state: initialEngineState(world),
    systems: [simSystem, financeSystem, contractsSystem, negotiationSystem],
  });
}

export function defaultTunables(): EngineTunables {
  return createEngineTunables({});
}

/** Runs a query and fails on a refusal. */
export function ask<T>(result: { ok: true; data: T } | { ok: false; reasons: unknown }): T {
  if (!result.ok) {
    throw new Error(`query refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

/** Sets an employment's morale (a test edit, not the morale door). */
export function setMorale(world: GameWorld, employmentId: EmploymentId, morale: number): void {
  const result = world.transact('test morale', (tx) => {
    tx.update('employments', employmentId, { morale });
  });
  if (!result.ok) {
    throw result.error;
  }
}
