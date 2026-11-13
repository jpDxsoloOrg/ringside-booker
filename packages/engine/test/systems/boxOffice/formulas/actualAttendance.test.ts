// The crowd on the night. Design: docs/design/box-office.md#crowd-roll
import { describe, expect, it } from 'vitest';
import { findTraceNodes, inputOf, type Traced } from '../../../../src/core/trace';
import { computeActualAttendance } from '../../../../src/systems/boxOffice';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { expectRollRecorded, expectSerialisable, expectTraceReplays } from '../../../support/trace';
import { crowdStream, type CountingStream } from './rngSupport';

const DEFAULTS = createEngineTunables();
const NO_SPREAD = createEngineTunables({ 'boxOffice.crowd.spread': 0 });

function crowd(
  expected: number,
  capacity: number,
  options: { tunables?: EngineTunables; rng?: CountingStream } = {},
): { result: Traced<number>; rng: CountingStream } {
  const rng = options.rng ?? crowdStream('crowd-test');
  const result = computeActualAttendance(
    {
      expected: inputOf('Expected crowd', expected, undefined, 'count'),
      capacity,
      venueName: 'Hall',
    },
    { tunables: options.tunables ?? DEFAULTS, rng },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return { result, rng };
}

describe('computeActualAttendance', () => {
  it('lands on the forecast when the spread is 0, and still draws once', () => {
    const { result, rng } = crowd(1234, 5000, { tunables: NO_SPREAD });
    expect(result.value).toBe(1234);
    expect(rng.draws).toBe(1);
  });

  it('is 0 for an empty forecast and for a capacity of 0', () => {
    expect(crowd(0, 5000).result.value).toBe(0);
    expect(crowd(800, 0).result.value).toBe(0);
  });

  it('stays within the forecast spread, in whole people', () => {
    for (let index = 0; index < 50; index += 1) {
      const { result } = crowd(10_000, 100_000, { rng: crowdStream(`spread-${String(index)}`) });
      expect(Number.isInteger(result.value)).toBe(true);
      expect(result.value).toBeGreaterThanOrEqual(9_000);
      expect(result.value).toBeLessThanOrEqual(11_000);
    }
  });

  it('never goes above capacity, and the roll is drawn once even when the cap bites', () => {
    const { result, rng } = crowd(50_000, 17_500);
    expect(result.value).toBe(17_500);
    expect(rng.draws).toBe(1);
    const cap = findTraceNodes(result.trace, 'min').find(
      (node) => node.label === 'Capacity of Hall',
    );
    expect(cap?.applied).toBe(true);
  });

  it('handles the largest spread and a stadium-sized crowd', () => {
    const tunables = createEngineTunables({ 'boxOffice.crowd.spread': 0.5 });
    const { result } = crowd(200_000, 200_000, { tunables });
    expect(result.value).toBeGreaterThanOrEqual(100_000);
    expect(result.value).toBeLessThanOrEqual(200_000);
  });

  it('records the roll on the boxoffice.crowd stream and keeps the forecast as its first line', () => {
    const { result } = crowd(1000, 5000);
    const roll = expectRollRecorded(result, 'boxoffice.crowd');
    expect(roll.label).toBe('Crowd on the night');
    expect(roll.min).toBeCloseTo(0.9, 12);
    expect(roll.max).toBeCloseTo(1.1, 12);
    expect(result.trace.children?.[0]?.label).toBe('Expected crowd');
  });

  it('pins the crowd for a fixed seed, so a stream change is noticed', () => {
    expect(crowd(10_000, 100_000, { rng: crowdStream('pinned') }).result.value).toBe(9127);
  });
});
