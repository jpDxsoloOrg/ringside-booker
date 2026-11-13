// Small worlds for the roster query tests (WRK2-01).
import { createEngine, initialEngineState, type Engine, type Viewer } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { Controller } from '../../../src/core/api/controller';
import { addDays } from '../../../src/core/date';
import type { BrandId, EmploymentId, PromotionId } from '../../../src/core/ids';
import type { Push } from '../../../src/model/entities/employment';
import type { GameWorldView } from '../../../src/model/tables';
import { rosterSystem, type RosterRowsArgs, type RosterView } from '../../../src/systems/roster';
import { workersSystem } from '../../../src/systems/workers';
import { TEST_PLAYER_ID, TEST_START_DATE } from '../../support/builders/build-row';
import { aPerson } from '../../support/builders/people';
import { anEmployment } from '../../support/builders/promotions';
import { testId } from '../../support/ids';
import { worldBuilder, type BuildContext } from '../../support/world-builder';

export const TODAY = addDays(TEST_START_DATE, 100);

export const PLAYER_CONTROLLER: Controller = { kind: 'human', playerId: TEST_PLAYER_ID };
export const PLAYER: Viewer = { kind: 'controller', controller: PLAYER_CONTROLLER };
export const OMNISCIENT: Viewer = { kind: 'omniscient' };
/** A human seat that runs no promotion. */
export const SPECTATOR: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: 'player-spectator' },
};
export const COMPUTER: Viewer = { kind: 'controller', controller: { kind: 'computer' } };

const PUSHES: readonly Push[] = ['mainEvent', 'upperCard', 'midCard', 'lowerCard', 'enhancement'];

export interface RosterWorld {
  readonly engine: Engine;
  /** The world the engine started from (no day has run). */
  readonly read: GameWorldView;
  readonly own: PromotionId;
  readonly rival: PromotionId;
  readonly flagship: BrandId;
  readonly second: BrandId;
  /** The active crew and second-brand contracts added after the roster. */
  readonly referee: EmploymentId;
  readonly announcer: EmploymentId;
  readonly presenter: EmploymentId;
  readonly secondBrandWrestler: EmploymentId;
  readonly expired: EmploymentId;
  readonly offered: EmploymentId;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`The roster world is missing ${what}`);
  }
  return value;
}

/** Adds a person and an employment with promotion A, returning the employment's ID. */
function addContract(
  context: BuildContext,
  role: 'referee' | 'announcer' | 'presenter' | 'wrestler',
  employment: Parameters<typeof anEmployment>[0],
): EmploymentId {
  const promotionId = required(context.ids.promotions.A, 'promotion A');
  const crew = role !== 'wrestler';
  const person = context.insert(
    'people',
    aPerson(
      crew ? { roles: [role], style: 'nonWrestler', debutDate: null } : { roles: ['wrestler'] },
      context.sequence,
    ),
  );
  return context.insert(
    'employments',
    anEmployment(
      {
        personId: person.id,
        promotionId,
        offeredOn: TEST_START_DATE,
        startsOn: TEST_START_DATE,
        role,
        push: crew ? 'none' : 'midCard',
        ...employment,
      },
      context.sequence,
    ),
  ).id;
}

/**
 * Promotion A (the human's) with two brands: ten wrestlers, the first eight on the flagship and
 * the last two on no brand, every card position used twice; then a referee and an announcer on no
 * brand, a presenter and a wrestler on the second brand, one expired contract and one offer.
 * Promotion B (computer) has three wrestlers. 100 days in.
 */
export function rosterTestWorld(): RosterWorld {
  let referee: EmploymentId | undefined;
  let announcer: EmploymentId | undefined;
  let presenter: EmploymentId | undefined;
  let secondBrandWrestler: EmploymentId | undefined;
  let expired: EmploymentId | undefined;
  let offered: EmploymentId | undefined;
  const { world, ids } = worldBuilder({ startDate: TEST_START_DATE, currentDate: TODAY })
    .withGeography('mini')
    .withPromotion(
      {
        name: 'Test Promotion A',
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
        regionalPop: { [testId('region', 1)]: 40, [testId('region', 2)]: 20 },
      },
      (promotion) =>
        promotion
          .withBrand({ name: 'Test Brand One' })
          .withBrand({ name: 'Test Brand Two' })
          .withRoster(10, {
            person: (index) => ({
              regionalPop: { [testId('region', 1)]: 5 + index * 9, [testId('region', 2)]: 10 },
            }),
            employment: (index) => ({
              push: PUSHES[index % PUSHES.length] ?? 'midCard',
              ringName: `Test Name ${String(10 - index)}`,
              ...(index >= 8 ? { brandId: null } : {}),
              ...(index === 0 ? { endsOn: addDays(TODAY, 45) } : {}),
            }),
          }),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) => promotion.withRoster(3))
    .with('crew and other contracts', (context) => {
      const secondBrand = required(context.ids.brands[1], 'the second brand');
      referee = addContract(context, 'referee', {});
      announcer = addContract(context, 'announcer', {});
      presenter = addContract(context, 'presenter', { brandId: secondBrand });
      secondBrandWrestler = addContract(context, 'wrestler', {
        brandId: secondBrand,
        ringName: 'Test Second Brand Name',
      });
      expired = addContract(context, 'wrestler', {
        status: 'expired',
        endsOn: addDays(TEST_START_DATE, 30),
        endedOn: addDays(TEST_START_DATE, 30),
      });
      offered = addContract(context, 'wrestler', {
        status: 'offered',
        offeredOn: addDays(TODAY, -1),
        startsOn: addDays(TODAY, 30),
      });
    })
    .build();

  const engine = createEngine({
    state: initialEngineState(world),
    systems: [simSystem, workersSystem, rosterSystem],
    debugChecks: true,
  });
  return {
    engine,
    read: world,
    own: required(ids.promotions.A, 'promotion A'),
    rival: required(ids.promotions.B, 'promotion B'),
    flagship: required(ids.brands[0], 'the flagship brand'),
    second: required(ids.brands[1], 'the second brand'),
    referee: required(referee, 'the referee'),
    announcer: required(announcer, 'the announcer'),
    presenter: required(presenter, 'the presenter'),
    secondBrandWrestler: required(secondBrandWrestler, 'the second-brand wrestler'),
    expired: required(expired, 'the expired contract'),
    offered: required(offered, 'the offer'),
  };
}

/** Runs `roster.rows` and fails when the query is refused. */
export function rosterOf(engine: Engine, args: RosterRowsArgs = {}, viewer = PLAYER): RosterView {
  const result = engine.query('roster.rows', args, viewer);
  if (!result.ok) {
    throw new Error(`roster.rows was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

/** Every object key anywhere in `value`. */
export function keysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      keysIn(item, found);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      keysIn(nested, found);
    }
  }
  return found;
}
