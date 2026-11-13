// Helpers for the roster.setPush tests (WRK2-03), over the roster test world.
import { expect } from 'vitest';
import type { Engine } from '../../../src/core/api';
import type { Controller } from '../../../src/core/api/controller';
import type { AnyDomainEvent } from '../../../src/core/events/types';
import type { EmploymentId, PromotionId } from '../../../src/core/ids';
import type { Employment, Push } from '../../../src/model/entities/employment';
import { compareIds } from '../../../src/model/table';
import { OMNISCIENT, PLAYER_CONTROLLER, rosterOf, type RosterWorld } from './roster-world';

export const COMPUTER_CONTROLLER: Controller = { kind: 'computer' };

/** The employment as the engine holds it now. */
export function employmentOf(engine: Engine, employmentId: EmploymentId): Employment {
  const employment = engine
    .exportState()
    .world.tables.employments.find((row) => row.id === employmentId);
  if (employment === undefined) {
    throw new Error(`No employment ${employmentId}`);
  }
  return employment;
}

/** Every employment's push, by ID. */
export function pushesOf(engine: Engine): Record<string, Push> {
  return Object.fromEntries(
    engine
      .exportState()
      .world.tables.employments.map((employment) => [employment.id, employment.push]),
  );
}

/** The player's wrestler rows at `push`, in ascending ID order. */
export function ownWrestlersAt(world: RosterWorld, push: Push): EmploymentId[] {
  return rosterOf(world.engine)
    .rows.filter((row) => row.group === 'wrestlers' && row.push === push)
    .map((row) => row.employmentId)
    .sort(compareIds);
}

/** The first of `ownWrestlersAt`, failing the test when there is none. */
export function ownWrestlerAt(world: RosterWorld, push: Push): EmploymentId {
  const [first] = ownWrestlersAt(world, push);
  if (first === undefined) {
    throw new Error(`The roster world has no wrestler at ${push}`);
  }
  return first;
}

/** The active contracts with `promotionId`, in ascending ID order. */
export function contractsWith(engine: Engine, promotionId: PromotionId): Employment[] {
  return engine
    .exportState()
    .world.tables.employments.filter(
      (employment) => employment.promotionId === promotionId && employment.status === 'active',
    )
    .sort((left, right) => compareIds(left.id, right.id));
}

/** The push-change events published so far, oldest first. */
export function pushEvents(engine: Engine): AnyDomainEvent[] {
  const result = engine.query(
    'sim.recentEvents',
    { limit: 500, types: ['employment.pushChanged'] },
    OMNISCIENT,
  );
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.data;
}

/** Runs `roster.setPush` and fails the test when it is refused. */
export function setPushOk(
  engine: Engine,
  employmentIds: EmploymentId[],
  push: Push,
  issuedBy: Controller = PLAYER_CONTROLLER,
): { changed: EmploymentId[]; unchanged: EmploymentId[] } {
  const result = engine.command('roster.setPush', { employmentIds, push }, issuedBy);
  if (!result.ok) {
    expect.fail(JSON.stringify(result.reasons));
  }
  return result.data;
}
