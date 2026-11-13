// Step units read off their calculation. Design: docs/design/calculation-traces.md#units
import { describe, expect, it } from 'vitest';
import {
  constantOf,
  inputOf,
  mapTraced,
  startCalc,
  startDecision,
  traceNodeSchema,
  withStepUnits,
  type TraceNode,
} from '@ringside/engine';

function unitsByLabel(node: TraceNode): Record<string, string | undefined> {
  const found: Record<string, string | undefined> = { [node.label]: node.unit };
  for (const child of node.children ?? []) Object.assign(found, unitsByLabel(child));
  return found;
}

describe('withStepUnits', () => {
  it('gives every step of a money calculation the money unit', () => {
    const trace = startCalc('Cash', 3_870_320_840, { unit: 'money', startLabel: 'Last week' })
      .subtract('Wages', 33_393_019)
      .add('Ticket sales', 1_200_00)
      .multiply('Tax kept', 0.9)
      .round('round')
      .max('Never below zero', 0)
      .clamp(0, 10_000_000_000)
      .note('Booked by the office')
      .done().trace;

    const units = unitsByLabel(withStepUnits(trace));

    expect(units).toMatchObject({
      Cash: 'money',
      'Last week': 'money',
      Wages: 'money',
      'Ticket sales': 'money',
      'Tax kept': 'money',
      Rounded: 'money',
      'Never below zero': 'money',
      'Booked by the office': 'money',
    });
  });

  it('passes the unit into an amount that is added, but not into a factor', () => {
    const fee = startCalc('Fee', inputOf('Per show', 50_000), {}).done();
    const trace = startCalc('Costs', 0, { unit: 'money' })
      .add('Appearance fee', fee)
      .multiply('Shows', inputOf('Shows this month', 4))
      .done().trace;

    const units = unitsByLabel(withStepUnits(trace));

    expect(units['Fee']).toBe('money');
    expect(units['Per show']).toBe('money');
    expect(units['Shows']).toBe('money');
    expect(units['Shows this month']).toBeUndefined();
  });

  it('keeps a unit a step names itself, and passes that one on', () => {
    const crowd = inputOf('Crowd', 1_200, undefined, 'count');
    const trace = startCalc('Merch sales', crowd, { unit: 'money' })
      .add('Bonus fans', startCalc('Bonus fans', 0, { unit: 'count' }).add('Walk-ups', 30).done())
      .done().trace;

    const units = unitsByLabel(withStepUnits(trace));

    expect(units['Crowd']).toBe('count');
    expect(units['Bonus fans']).toBe('count');
    expect(units['Walk-ups']).toBe('count');
  });

  it('leaves the inside of inputs, decisions and constants used as factors alone', () => {
    const rating = mapTraced(inputOf('Score', 72), 'Stars', (score) => score / 20);
    const decision = startDecision<'a' | 'b'>('Pick')
      .consider('a', 2)
      .consider('b', 1)
      .choose('a', 'Higher');
    const trace = startCalc('Total', 0, { unit: 'points' })
      .add('From stars', rating)
      .multiply('Fixed', constantOf('Half', 0.5, 'a scale'))
      .done().trace;

    const units = unitsByLabel(withStepUnits(trace));

    expect(units['Stars']).toBe('points');
    expect(units['Score']).toBeUndefined();
    expect(units['Half']).toBeUndefined();
    expect(withStepUnits(decision.trace, 'money')).toBe(decision.trace);
  });

  it('keeps steps in the starting unit until a multiply turns them into the formula unit', () => {
    const trace = startCalc('Venue rent', inputOf('Capacity', 1_200, undefined, 'count'), {
      unit: 'money',
    })
      .add('Standing room', 30)
      .multiply('Rent per seat', inputOf('Per seat', 150, undefined, 'money'))
      .multiply('Arena', inputOf('Arena factor', 1.2, undefined, 'multiplier'))
      .round('round')
      .done().trace;

    const [start, standing, perSeat, arena, rounded] = withStepUnits(trace).children ?? [];

    expect(start?.unit).toBe('count');
    expect(standing?.unit).toBe('count');
    expect(perSeat).toMatchObject({ unit: 'money', beforeUnit: 'count', operandUnit: 'money' });
    expect(arena?.unit).toBe('money');
    expect(arena).not.toHaveProperty('beforeUnit');
    expect(arena).not.toHaveProperty('operandUnit');
    expect(rounded?.unit).toBe('money');
  });

  it('fills in read-time fields that a save would refuse to store', () => {
    const trace = startCalc('Rent', inputOf('Seats', 10, undefined, 'count'), { unit: 'money' })
      .multiply('Per seat', 150)
      .done().trace;

    expect(traceNodeSchema.safeParse(trace).success).toBe(true);
    expect(traceNodeSchema.safeParse(withStepUnits(trace)).success).toBe(false);
  });

  it('names no unit for a plain factor on the step that changes the unit', () => {
    const trace = startCalc('Marketing', inputOf('Level', 3, undefined, 'count'), {
      unit: 'multiplier',
    })
      .multiply('Per level', 0.05)
      .done().trace;

    const [, perLevel] = withStepUnits(trace).children ?? [];

    expect(perLevel).toMatchObject({ unit: 'multiplier', beforeUnit: 'count' });
    expect(perLevel).not.toHaveProperty('operandUnit');
  });

  it('returns the same object when there is nothing to fill in', () => {
    const trace = startCalc('Plain', 3).add('More', 2).done().trace;

    expect(withStepUnits(trace)).toBe(trace);
  });

  it('does not change the trace it was given', () => {
    const trace = startCalc('Cash', 100, { unit: 'money' }).add('More', 2).done().trace;
    const copy = structuredClone(trace);

    withStepUnits(trace);

    expect(trace).toEqual(copy);
  });
});
