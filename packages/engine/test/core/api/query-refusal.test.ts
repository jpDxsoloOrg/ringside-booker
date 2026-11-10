// A query that says no on purpose. Design: docs/design/engine-api.md#refusing-a-query
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createEngine,
  defineQuery,
  defineSystem,
  initialEngineState,
  QueryRefusal,
  refuseQuery,
  simSystem,
  type Engine,
  type Reason,
} from '../../../src/core/api';
import { testId } from '../../support/ids';
import { expectSerialisable } from '../../support/trace';
import { tinyWorld } from '../../support/worlds';

declare module '@ringside/engine' {
  interface QueryMap {
    'refusalTest.one': { args: Record<string, never>; result: { found: true } };
    'refusalTest.several': { args: Record<string, never>; result: { found: true } };
    'refusalTest.bug': { args: Record<string, never>; result: { found: true } };
  }
}

const OMNISCIENT = { kind: 'omniscient' } as const;
const noArgs = z.strictObject({});

const NOT_FOUND: Reason = {
  code: 'notFound',
  message: 'No such worker',
  subject: { kind: 'person', id: testId('person', 999) },
};
const HIDDEN: Reason = { code: 'hidden', message: 'Your promotion does not know this yet' };

function engine(): Engine {
  const refusalSystem = defineSystem({
    id: 'refusalTest',
    queries: [
      defineQuery('refusalTest.one', { args: noArgs, run: () => refuseQuery(NOT_FOUND) }),
      defineQuery('refusalTest.several', {
        args: noArgs,
        run: () => refuseQuery([NOT_FOUND, HIDDEN]),
      }),
      defineQuery('refusalTest.bug', {
        args: noArgs,
        run: () => {
          throw new Error('The query blew up');
        },
      }),
    ],
  });
  return createEngine({
    state: initialEngineState(tinyWorld().world),
    systems: [simSystem, refusalSystem],
    debugChecks: true,
  });
}

describe('refuseQuery', () => {
  it('throws a QueryRefusal carrying the reasons', () => {
    let thrown: unknown = null;
    try {
      refuseQuery(NOT_FOUND);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(QueryRefusal);
    expect(thrown instanceof QueryRefusal ? thrown.reasons : null).toEqual([NOT_FOUND]);
    expect(thrown instanceof QueryRefusal ? thrown.message : null).toBe('No such worker');
  });

  it('comes back from the engine as the query’s own reason, not an internal one', () => {
    expect(engine().query('refusalTest.one', {}, OMNISCIENT)).toEqual({
      ok: false,
      reasons: [NOT_FOUND],
    });
  });

  it('keeps several reasons in the order given', () => {
    expect(engine().query('refusalTest.several', {}, OMNISCIENT)).toEqual({
      ok: false,
      reasons: [NOT_FOUND, HIDDEN],
    });
  });

  it('hands back copies, so a caller cannot change the reasons a query keeps', () => {
    const result = engine().query('refusalTest.one', {}, OMNISCIENT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons[0]).not.toBe(NOT_FOUND);
      expectSerialisable(result);
    }
  });

  it('stays out of the failure log', () => {
    const running = engine();
    running.query('refusalTest.one', {}, OMNISCIENT);
    running.query('refusalTest.several', {}, OMNISCIENT);
    expect(running.query('sim.failures', { limit: 10 }, OMNISCIENT)).toEqual({
      ok: true,
      data: [],
    });
  });

  it('leaves any other throw as an internal reason', () => {
    expect(engine().query('refusalTest.bug', {}, OMNISCIENT)).toEqual({
      ok: false,
      reasons: [
        { code: 'internal', message: expect.stringContaining('The query blew up') as unknown },
      ],
    });
  });
});
