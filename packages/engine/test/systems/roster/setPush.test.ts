// roster.setPush: one or many card positions, all or nothing, through WRK1's push door.
// Design: docs/design/roster.md#set-push
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEngine, defineCommand, defineSystem, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { EmploymentId } from '../../../src/core/ids';
import { zId } from '../../../src/model/primitives';
import { compareIds } from '../../../src/model/table';
import {
  applySetPush,
  DUPLICATE_EMPLOYMENT_MESSAGE,
  rosterSystem,
  SET_PUSH_REASON_KEY,
  type SetPushDoor,
} from '../../../src/systems/roster';
import { setPush, workersSystem } from '../../../src/systems/workers';
import { testId } from '../../support/ids';
import { PLAYER_CONTROLLER, rosterTestWorld, type RosterWorld } from './roster-world';
import {
  contractsWith,
  employmentOf,
  ownWrestlerAt,
  ownWrestlersAt,
  pushEvents,
  pushesOf,
  setPushOk,
} from './set-push-support';

declare module '@ringside/engine' {
  interface CommandMap {
    'test.setPushFailsSecond': { args: { employmentIds: EmploymentId[] }; result: null };
  }
}

function ringNameOf(engine: Engine, employmentId: EmploymentId): string {
  return employmentOf(engine, employmentId).ringName;
}

/** Runs `roster.setPush` and returns its reasons, failing when it was applied. */
function refusedWith(
  world: RosterWorld,
  employmentIds: EmploymentId[],
  push: Parameters<typeof setPushOk>[2],
) {
  const before = pushesOf(world.engine);
  const eventsBefore = pushEvents(world.engine).length;
  const result = world.engine.command('roster.setPush', { employmentIds, push }, PLAYER_CONTROLLER);
  if (result.ok) {
    expect.fail('roster.setPush was applied');
  }
  // All or nothing: no row moved and no event went out.
  expect(pushesOf(world.engine)).toStrictEqual(before);
  expect(pushEvents(world.engine)).toHaveLength(eventsBefore);
  return result.reasons;
}

/** Two of the player's wrestlers at lower card or above, plus `odd`, in that order. */
function twoGoodRowsAnd(world: RosterWorld, odd: EmploymentId): EmploymentId[] {
  return [ownWrestlerAt(world, 'midCard'), ownWrestlerAt(world, 'upperCard'), odd];
}

describe('roster.setPush: changing pushes', () => {
  it('moves one wrestler up and publishes one event from the player', () => {
    const world = rosterTestWorld();
    const id = ownWrestlerAt(world, 'midCard');
    expect(setPushOk(world.engine, [id], 'mainEvent')).toEqual({ changed: [id], unchanged: [] });
    expect(employmentOf(world.engine, id).push).toBe('mainEvent');
    const events = pushEvents(world.engine);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      employmentId: id,
      promotionId: world.own,
      source: 'player',
      reasonKey: SET_PUSH_REASON_KEY,
      from: 'midCard',
      to: 'mainEvent',
    });
    // The door recorded its trace.
    const trace = world.engine.query(
      'trace.get',
      { ref: { kind: 'workers.push', id } },
      { kind: 'omniscient' },
    );
    expect(trace.ok && trace.data).not.toBeNull();
  });

  it('moves three wrestlers in one call, one event each in ID order', () => {
    const world = rosterTestWorld();
    const ids = [
      ownWrestlerAt(world, 'mainEvent'),
      ownWrestlerAt(world, 'enhancement'),
      ownWrestlerAt(world, 'midCard'),
    ];
    const sorted = [...ids].sort(compareIds);
    expect(setPushOk(world.engine, ids, 'lowerCard')).toEqual({ changed: sorted, unchanged: [] });
    expect(pushEvents(world.engine).map((event) => event.payload)).toEqual(
      sorted.map((id) => expect.objectContaining({ employmentId: id, to: 'lowerCard' }) as unknown),
    );
    for (const id of ids) {
      expect(employmentOf(world.engine, id).push).toBe('lowerCard');
    }
  });

  it('counts a row already at the push as unchanged, with no event', () => {
    const world = rosterTestWorld();
    const already = ownWrestlerAt(world, 'lowerCard');
    const moving = ownWrestlerAt(world, 'midCard');
    expect(setPushOk(world.engine, [already, moving], 'lowerCard')).toEqual({
      changed: [moving],
      unchanged: [already],
    });
    expect(pushEvents(world.engine).map((event) => event.payload)).toEqual([
      expect.objectContaining({ employmentId: moving }) as unknown,
    ]);
  });
});

describe('roster.setPush: refusals are all or nothing', () => {
  it("refuses a rival's wrestler and names that row only", () => {
    const world = rosterTestWorld();
    const [rivalRow] = contractsWith(world.engine, world.rival);
    if (rivalRow === undefined) {
      expect.fail('The rival has no contracts');
    }
    expect(refusedWith(world, twoGoodRowsAnd(world, rivalRow.id), 'mainEvent')).toEqual([
      {
        code: 'notAllowed',
        message: `${rivalRow.ringName} works for Test Promotion B. You can only change pushes on your own roster.`,
        field: 'employmentIds[2]',
        subject: { kind: 'employment', id: rivalRow.id },
      },
    ]);
  });

  it('refuses an expired contract', () => {
    const world = rosterTestWorld();
    expect(refusedWith(world, twoGoodRowsAnd(world, world.expired), 'mainEvent')).toEqual([
      {
        code: 'contractNotActive',
        message: `${ringNameOf(world.engine, world.expired)}'s contract isn't active (it is expired), so their push can't change.`,
        field: 'employmentIds[2]',
        subject: { kind: 'employment', id: world.expired },
      },
    ]);
  });

  it('refuses a card position for a referee', () => {
    const world = rosterTestWorld();
    expect(refusedWith(world, twoGoodRowsAnd(world, world.referee), 'midCard')).toEqual([
      {
        code: 'pushNotForRole',
        message: `${ringNameOf(world.engine, world.referee)} is a referee. Only wrestlers have a place on the card.`,
        field: 'employmentIds[2]',
        subject: { kind: 'employment', id: world.referee },
      },
    ]);
  });

  it('refuses taking a wrestler off the card, one reason per wrestler in ID order', () => {
    const world = rosterTestWorld();
    const ids = twoGoodRowsAnd(world, world.referee);
    const reasons = refusedWith(world, ids, 'none');
    const wrestlers = ids
      .map((id, index) => ({ id, index }))
      .filter(({ id }) => id !== world.referee)
      .sort((left, right) => compareIds(left.id, right.id));
    expect(reasons).toEqual(
      wrestlers.map(({ id, index }) => ({
        code: 'pushNotForRole',
        message: `Pick a card position for ${ringNameOf(world.engine, id)}, from Main event to Enhancement.`,
        field: `employmentIds[${String(index)}]`,
        subject: { kind: 'employment', id },
      })),
    );
  });

  it('refuses a contract that does not exist', () => {
    const world = rosterTestWorld();
    const missing = testId('employment', 999);
    expect(refusedWith(world, twoGoodRowsAnd(world, missing), 'mainEvent')).toEqual([
      {
        code: 'employmentNotFound',
        message: 'That contract no longer exists. Refresh the roster and try again.',
        field: 'employmentIds[2]',
        subject: { kind: 'employment', id: missing },
      },
    ]);
  });

  it('refuses an empty list and a contract picked twice', () => {
    const world = rosterTestWorld();
    expect(refusedWith(world, [], 'mainEvent')).toEqual([
      expect.objectContaining({ code: 'invalidArgs', field: 'employmentIds' }) as unknown,
    ]);
    const id = ownWrestlerAt(world, 'midCard');
    expect(refusedWith(world, [id, ownWrestlerAt(world, 'upperCard'), id], 'mainEvent')).toEqual([
      {
        code: 'invalidArgs',
        message: `employmentIds: ${DUPLICATE_EMPLOYMENT_MESSAGE}`,
        field: 'employmentIds',
      },
    ]);
  });
});

/** A door that does the real thing once and then fails. */
function doorFailingSecondCall(): SetPushDoor {
  let calls = 0;
  return (ctx, args) => {
    calls += 1;
    if (calls === 2) {
      throw new Error('The push door broke');
    }
    return setPush(ctx, args);
  };
}

const failingDoorSystem = defineSystem({
  id: 'testSetPush',
  commands: [
    defineCommand('test.setPushFailsSecond', {
      args: z.strictObject({ employmentIds: z.array(zId('employment')) }),
      apply: (ctx, args, issuedBy) => {
        applySetPush(
          ctx,
          { employmentIds: args.employmentIds, push: 'enhancement' },
          issuedBy,
          doorFailingSecondCall(),
        );
        return null;
      },
    }),
  ],
});

describe('roster.setPush: a failure part way rolls every row back', () => {
  it('leaves all three rows as they were and logs the failure', () => {
    const world = rosterTestWorld();
    const engine = createEngine({
      state: world.engine.exportState(),
      systems: [simSystem, workersSystem, rosterSystem, failingDoorSystem],
    });
    const ids = ownWrestlersAt(world, 'mainEvent').concat(ownWrestlerAt(world, 'midCard'));
    expect(ids).toHaveLength(3);
    const before = pushesOf(engine);
    const result = engine.command(
      'test.setPushFailsSecond',
      { employmentIds: ids },
      PLAYER_CONTROLLER,
    );
    expect(result).toEqual({
      ok: false,
      reasons: [
        {
          code: 'internal',
          message: expect.stringContaining('The push door broke') as unknown,
        },
      ],
    });
    expect(pushesOf(engine)).toStrictEqual(before);
    expect(pushEvents(engine)).toEqual([]);
    expect(engine.query('sim.failures', { limit: 5 }, { kind: 'omniscient' })).toMatchObject({
      ok: true,
      data: [{ stepId: 'command:test.setPushFailsSecond' }],
    });
  });
});

describe('roster.setPush: nothing else moves', () => {
  it('leaves morale, momentum, popularity and cash exactly as they were', () => {
    const world = rosterTestWorld();
    const id = ownWrestlerAt(world, 'mainEvent');
    const before = world.engine.exportState().world;
    const employmentBefore = employmentOf(world.engine, id);
    setPushOk(world.engine, [id], 'enhancement');
    const after = world.engine.exportState().world;
    const employmentAfter = employmentOf(world.engine, id);
    expect(employmentAfter.push).toBe('enhancement');
    expect(employmentAfter.morale).toBe(employmentBefore.morale);
    expect(employmentAfter.momentum).toBe(employmentBefore.momentum);
    expect(
      JSON.stringify(
        after.tables.people.find((row) => row.id === employmentAfter.personId)?.regionalPop,
      ),
    ).toBe(
      JSON.stringify(
        before.tables.people.find((row) => row.id === employmentBefore.personId)?.regionalPop,
      ),
    );
    expect(after.tables.promotions.find((row) => row.id === world.own)?.cash).toBe(
      before.tables.promotions.find((row) => row.id === world.own)?.cash,
    );
    // Only the push event: no morale, momentum or popularity event.
    const events = world.engine.query('sim.recentEvents', { limit: 50 }, { kind: 'omniscient' });
    expect(events.ok && events.data.map((event) => event.type)).toEqual(['employment.pushChanged']);
  });
});
