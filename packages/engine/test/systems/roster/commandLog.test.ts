// Every roster.setPush attempt lands in the command log, whoever issued it and however it ended.
// Design: docs/design/roster.md#set-push, docs/design/engine-api.md#the-command-log
import { describe, expect, it } from 'vitest';
import { PLAYER_CONTROLLER, rosterTestWorld, OMNISCIENT } from './roster-world';
import {
  COMPUTER_CONTROLLER,
  contractsWith,
  employmentOf,
  ownWrestlerAt,
  pushEvents,
  setPushOk,
} from './set-push-support';

describe('roster.setPush in the command log', () => {
  it('logs an applied, a rejected and an invalid call once each', () => {
    const world = rosterTestWorld();
    const own = ownWrestlerAt(world, 'midCard');
    const [rivalRow] = contractsWith(world.engine, world.rival);
    if (rivalRow === undefined) {
      expect.fail('The rival has no contracts');
    }
    setPushOk(world.engine, [own], 'upperCard');
    world.engine.command(
      'roster.setPush',
      { employmentIds: [rivalRow.id], push: 'mainEvent' },
      PLAYER_CONTROLLER,
    );
    world.engine.command(
      'roster.setPush',
      { employmentIds: [], push: 'mainEvent' },
      PLAYER_CONTROLLER,
    );

    const log = world.engine.query('sim.commandLog', { limit: 10 }, OMNISCIENT);
    if (!log.ok) {
      expect.fail(JSON.stringify(log.reasons));
    }
    expect(log.data).toHaveLength(3);
    expect(log.data).toMatchObject([
      {
        issuedBy: PLAYER_CONTROLLER,
        name: 'roster.setPush',
        args: { employmentIds: [own], push: 'upperCard' },
        outcome: 'applied',
        reasonCodes: [],
      },
      {
        issuedBy: PLAYER_CONTROLLER,
        name: 'roster.setPush',
        args: { employmentIds: [rivalRow.id], push: 'mainEvent' },
        outcome: 'rejected',
        reasonCodes: ['notAllowed'],
      },
      {
        issuedBy: PLAYER_CONTROLLER,
        name: 'roster.setPush',
        args: { employmentIds: [], push: 'mainEvent' },
        outcome: 'rejected',
        reasonCodes: ['invalidArgs'],
      },
    ]);
  });

  it("lets the computer set pushes on a computer-run roster, as the AI's change", () => {
    const world = rosterTestWorld();
    const [rivalRow] = contractsWith(world.engine, world.rival);
    if (rivalRow === undefined) {
      expect.fail('The rival has no contracts');
    }
    const push = rivalRow.push === 'mainEvent' ? 'lowerCard' : 'mainEvent';
    expect(setPushOk(world.engine, [rivalRow.id], push, COMPUTER_CONTROLLER)).toEqual({
      changed: [rivalRow.id],
      unchanged: [],
    });
    expect(employmentOf(world.engine, rivalRow.id).push).toBe(push);
    expect(pushEvents(world.engine).map((event) => event.payload)).toEqual([
      expect.objectContaining({ employmentId: rivalRow.id, source: 'ai' }) as unknown,
    ]);
    const log = world.engine.query('sim.commandLog', { limit: 1 }, OMNISCIENT);
    expect(log.ok && log.data).toMatchObject([
      { issuedBy: COMPUTER_CONTROLLER, name: 'roster.setPush', outcome: 'applied' },
    ]);
  });

  it("refuses the computer on the player's roster", () => {
    const world = rosterTestWorld();
    const own = ownWrestlerAt(world, 'midCard');
    const result = world.engine.command(
      'roster.setPush',
      { employmentIds: [own], push: 'mainEvent' },
      COMPUTER_CONTROLLER,
    );
    expect(result.ok || result.reasons.map((reason) => reason.code)).toEqual(['notAllowed']);
  });
});
