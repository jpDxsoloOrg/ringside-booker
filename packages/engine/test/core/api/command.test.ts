import { describe, expect, it } from 'vitest';
import { assertSerialisable, commandStepId, type Engine } from '../../../src/core/api';
import type { PromotionId } from '../../../src/core/ids';
import { testId } from '../../support/ids';
import { tinyWorld } from '../../support/worlds';
import { engineFor } from './apiTestSystem';

const COMPUTER = { kind: 'computer' } as const;

function setup(): { engine: Engine; promotionId: PromotionId } {
  const { world, ids } = tinyWorld();
  return { engine: engineFor(world), promotionId: ids.promotions.A! };
}

/** Everything a refused or failed command must leave exactly as it was. */
function untouched(engine: Engine) {
  const { world, rng, events, traces } = engine.exportState();
  return { world, rng, events, traces };
}

describe('command arguments', () => {
  it('returns invalidArgs naming the field for bad arguments', () => {
    const { engine, promotionId } = setup();
    const before = untouched(engine);
    const result = engine.commandRaw('test.moveCash', { promotionId, amount: 'lots' }, COMPUTER);
    expect(result).toEqual({
      ok: false,
      reasons: [
        {
          code: 'invalidArgs',
          field: 'amount',
          message: expect.stringContaining('amount') as unknown,
        },
      ],
    });
    expect(untouched(engine)).toStrictEqual(before);
  });

  it('reports a missing argument object and an unknown command without throwing', () => {
    const { engine } = setup();
    expect(engine.commandRaw('test.moveCash', undefined, COMPUTER)).toEqual({
      ok: false,
      reasons: [
        { code: 'invalidArgs', message: expect.stringContaining('Invalid arguments') as unknown },
      ],
    });
    expect(engine.commandRaw('test.nothing', {}, COMPUTER)).toEqual({
      ok: false,
      reasons: [{ code: 'unknownCommand', message: 'There is no command called "test.nothing".' }],
    });
  });

  it('refuses a malformed controller and does not log it', () => {
    const { engine, promotionId } = setup();
    const result = engine.commandRaw(
      'test.moveCash',
      { promotionId, amount: 1 },
      { kind: 'human' },
    );
    expect(result).toEqual({
      ok: false,
      reasons: [expect.objectContaining({ code: 'invalidArgs', field: 'issuedBy.playerId' })],
    });
    expect(engine.exportState().commandLog.entries).toEqual([]);
  });
});

describe('validate', () => {
  it('rejects with its reasons before a transaction is opened', () => {
    const { engine } = setup();
    const before = untouched(engine);
    const seenEvents: string[] = [];
    engine.onEvent((event) => seenEvents.push(event.type));
    expect(engine.command('test.refuse', {}, COMPUTER)).toEqual({
      ok: false,
      reasons: [{ code: 'notToday', message: 'Not today.' }],
    });
    expect(
      engine.command(
        'test.moveCash',
        { promotionId: testId('promotion', 999), amount: 1 },
        COMPUTER,
      ),
    ).toEqual({
      ok: false,
      reasons: [
        {
          code: 'unknownPromotion',
          message: 'That promotion does not exist.',
          field: 'promotionId',
        },
      ],
    });
    expect(untouched(engine)).toStrictEqual(before);
    expect(seenEvents).toEqual([]);
    expect(engine.exportState().failureLog.entries).toEqual([]);
  });
});

describe('apply', () => {
  it('rolls everything back when apply throws and returns internal', () => {
    const { engine, promotionId } = setup();
    const before = untouched(engine);
    const result = engine.command('test.explode', { promotionId }, COMPUTER);
    expect(result).toEqual({
      ok: false,
      reasons: [
        { code: 'internal', message: expect.stringContaining('The command blew up') as unknown },
      ],
    });
    // World, RNG, events and traces exactly as they were: no stepFailed notice either.
    expect(untouched(engine)).toStrictEqual(before);
    const failures = engine.exportState().failureLog.entries;
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      stepId: commandStepId('test.explode'),
      error: { message: 'The command blew up' },
    });
    expect(engine.query('sim.failures', { limit: 5 }, { kind: 'omniscient' })).toMatchObject({
      ok: true,
      data: [{ stepId: 'command:test.explode' }],
    });
  });

  it('commits a successful command and returns its events', () => {
    const { engine, promotionId } = setup();
    const seqBefore = engine.exportState().events.seq;
    const cashBefore = engine.query('test.cash', { promotionId }, { kind: 'omniscient' });
    const result = engine.command('test.moveCash', { promotionId, amount: 250 }, COMPUTER);
    if (!result.ok) {
      expect.fail(JSON.stringify(result.reasons));
    }
    expect(() => {
      assertSerialisable(result, 'result');
    }).not.toThrow();
    expect(result.events).toEqual([{ type: 'test.cashMoved', seq: seqBefore + 1 }]);
    expect(result.data.roll).toBeGreaterThanOrEqual(1);
    expect(result.data.roll).toBeLessThanOrEqual(100);
    if (!cashBefore.ok || cashBefore.data === null) {
      expect.fail('test.cash failed');
    }
    expect(result.data.cash).toBe(cashBefore.data.cash + 250 + result.data.roll);
    expect(engine.query('test.cash', { promotionId }, { kind: 'omniscient' })).toEqual({
      ok: true,
      data: { cash: result.data.cash },
    });

    const state = engine.exportState();
    expect(state.events.seq).toBe(seqBefore + 1);
    expect(state.events.recent.at(-1)).toMatchObject({
      type: 'test.cashMoved',
      source: { kind: 'command', id: 'test.moveCash' },
    });
    const trace = engine.query(
      'trace.get',
      { ref: { kind: 'test.moveCash', id: promotionId } },
      { kind: 'omniscient' },
    );
    expect(trace).toMatchObject({ ok: true, data: { value: result.data.cash } });
  });

  it('refuses a result that is not plain JSON and rolls the command back', () => {
    const { engine, promotionId } = setup();
    const before = untouched(engine);
    const result = engine.command('test.badResult', { promotionId }, COMPUTER);
    expect(result).toEqual({
      ok: false,
      reasons: [
        {
          code: 'internal',
          message: expect.stringContaining('commands["test.badResult"].result.lookup') as unknown,
        },
      ],
    });
    expect(untouched(engine)).toStrictEqual(before);
  });
});
