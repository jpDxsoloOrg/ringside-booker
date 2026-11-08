import { describe, expect, it } from 'vitest';
import { InvalidCadenceError, PipelineError } from '../../../src/core/errors';
import {
  definePhase,
  PHASE_GROUP_BASES,
  PHASE_GROUPS,
  PhaseRegistry,
  type PhaseGroup,
  type PhaseSpec,
} from '../../../src/core/pipeline';
import type { ToyRegistry } from '../../support/toy-registry';

function spec(id: string, group: PhaseGroup, order: number): PhaseSpec<ToyRegistry> {
  return {
    id,
    group,
    order,
    cadence: { kind: 'daily' },
    run: () => undefined,
  };
}

describe('phase groups', () => {
  it('lists the groups in day order with rising bases 100 apart', () => {
    expect(PHASE_GROUPS).toEqual([
      'open',
      'housekeeping',
      'worldEvents',
      'aiTurns',
      'contracts',
      'shows',
      'settlement',
      'growth',
      'money',
      'periodic',
      'close',
    ]);
    expect(PHASE_GROUPS.map((group) => PHASE_GROUP_BASES[group])).toEqual([
      0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
    ]);
  });
});

describe('definePhase', () => {
  it('returns a frozen definition with a checked cadence', () => {
    const phase = definePhase<ToyRegistry>({
      ...spec('money.payroll', 'money', 10),
      cadence: { kind: 'weekly', weekday: 'fri' },
    });
    expect(Object.isFrozen(phase)).toBe(true);
    expect(phase.cadence).toEqual({ kind: 'weekly', weekday: 'fri' });
    expect(phase.when).toBeUndefined();
  });

  it.each(['payroll', 'Money.payroll', 'money.payroll.weekly', 'money.pay_roll', 'money.'])(
    'rejects the id %j',
    (id) => {
      expect(() => definePhase(spec(id, 'money', 0))).toThrow(PipelineError);
    },
  );

  it.each([-1, 100, 1.5, Number.NaN])('rejects order %d', (order) => {
    expect(() => definePhase(spec('money.payroll', 'money', order))).toThrow(/order must be/);
  });

  it('rejects a cadence that would skip days', () => {
    expect(() =>
      definePhase({ ...spec('money.rent', 'money', 0), cadence: { kind: 'monthly', day: 31 } }),
    ).toThrow(InvalidCadenceError);
  });
});

describe('PhaseRegistry', () => {
  it('throws on a duplicate id', () => {
    const registry = new PhaseRegistry<ToyRegistry>();
    registry.register(spec('money.payroll', 'money', 0));
    expect(() => registry.register(spec('money.payroll', 'money', 1))).toThrow(
      /already registered/,
    );
    expect(registry.size).toBe(1);
  });

  it('throws when two phases share a group and order', () => {
    const registry = new PhaseRegistry<ToyRegistry>();
    registry.register(spec('money.payroll', 'money', 5));
    let thrown: unknown;
    try {
      registry.register(spec('money.sponsors', 'money', 5));
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PipelineError);
    expect(thrown).toMatchObject({
      code: 'PIPELINE',
      details: { phaseId: 'money.sponsors', otherPhaseId: 'money.payroll' },
    });
    // The same order in another group is a different slot.
    expect(() => registry.register(spec('growth.training', 'growth', 5))).not.toThrow();
  });

  it.each(['open', 'close'] as const)('refuses the engine-only group %s', (group) => {
    const registry = new PhaseRegistry<ToyRegistry>();
    expect(() => registry.register(spec('custom.step', group, 1))).toThrow(
      /reserved for the engine/,
    );
    expect(registry.size).toBe(0);
  });

  it('refuses ids in the engine prefix', () => {
    const registry = new PhaseRegistry<ToyRegistry>();
    expect(() => registry.register(spec('pipeline.open', 'housekeeping', 0))).toThrow(
      /reserved for the engine/,
    );
  });

  it('orders by group then order, whatever the registration order', () => {
    const phases = [
      spec('money.payroll', 'money', 50),
      spec('house.cleanup', 'housekeeping', 90),
      spec('periodic.monthly', 'periodic', 0),
      spec('money.sponsors', 'money', 10),
      spec('shows.run', 'shows', 0),
      spec('house.injuries', 'housekeeping', 0),
      spec('world.events', 'worldEvents', 99),
      spec('growth.training', 'growth', 3),
    ];
    const expected = [
      'house.injuries',
      'house.cleanup',
      'world.events',
      'shows.run',
      'growth.training',
      'money.sponsors',
      'money.payroll',
      'periodic.monthly',
    ];
    const forwards = new PhaseRegistry<ToyRegistry>();
    const backwards = new PhaseRegistry<ToyRegistry>();
    for (const phase of phases) {
      forwards.register(phase);
    }
    for (const phase of [...phases].reverse()) {
      backwards.register(phase);
    }
    expect(forwards.ordered().map((phase) => phase.id)).toEqual(expected);
    expect(backwards.ordered().map((phase) => phase.id)).toEqual(expected);
  });

  it('includes phases registered after an earlier ordered() call', () => {
    const registry = new PhaseRegistry<ToyRegistry>();
    registry.register(spec('money.payroll', 'money', 0));
    expect(registry.ordered()).toHaveLength(1);
    registry.register(spec('house.cleanup', 'housekeeping', 0));
    expect(registry.ordered().map((phase) => phase.id)).toEqual(['house.cleanup', 'money.payroll']);
    expect(registry.get('house.cleanup')?.group).toBe('housekeeping');
  });
});

describe('public API', () => {
  it('exports the phase definitions, reports and failure log from the package entry', async () => {
    const engine = await import('@ringside/engine');
    expect(engine.definePhase).toBe(definePhase);
    expect(engine.PhaseRegistry).toBe(PhaseRegistry);
    expect(typeof engine.deterministicDayReport).toBe('function');
    expect(typeof engine.pipelineFailureLogStateSchema.safeParse).toBe('function');
    expect(typeof engine.serializeError).toBe('function');
    expect(engine.PipelineError).toBe(PipelineError);
    expect(engine).not.toHaveProperty('runDay');
    expect(engine).not.toHaveProperty('createRuntime');
  });
});
