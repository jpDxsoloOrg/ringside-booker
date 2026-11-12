// Soft compression. Design: docs/design/match-rating.md#soft-compression
import { describe, expect, it } from 'vitest';
import {
  findTraceNodes,
  isTruncationNote,
  startCalc,
  traceDepth,
  untraced,
} from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  COMPRESSION_DOC_REF,
  softCompression,
  workRate,
  workerPerformance,
  type WorkRateWorker,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectTraceContains, expectTraceReplays } from '../../../support/trace';

function compress(value: number, overrides: TunableOverrides = {}) {
  const result = softCompression(
    { value: untraced(value, 'Work rate before compression'), label: 'Work rate' },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  return result;
}

describe('softCompression', () => {
  it('leaves 85 and below alone', () => {
    for (const value of [0, 40, 84.9, 85]) {
      const result = compress(value);
      expect(result.value).toBe(value);
      expect(expectTraceContains(result, { kind: 'branch' }).taken).toBe(false);
    }
  });

  it('maps 95 to 89 and 120 to 99 at the defaults', () => {
    expect(compress(95).value).toBeCloseTo(89, 9);
    expect(compress(120).value).toBeCloseTo(99, 9);
    const branch = expectTraceContains(compress(95), { kind: 'branch' });
    expect(branch.label).toBe('Above the knee at 85');
    expect(branch.taken).toBe(true);
  });

  it('keeps the order of values above the knee', () => {
    const values = [86, 90, 100, 110, 120].map((value) => compress(value).value);
    expect([...values].sort((left, right) => left - right)).toEqual(values);
    expect(new Set(values).size).toBe(values.length);
  });

  it('flattens everything above the knee at factor 0', () => {
    for (const value of [86, 95, 150]) {
      expect(compress(value, { 'match.compression.factor': 0 }).value).toBe(85);
    }
  });

  it('is off inside the scale at knee 100', () => {
    for (const value of [50, 85, 95, 100]) {
      expect(compress(value, { 'match.compression.knee': 100 }).value).toBe(value);
    }
    expect(compress(130, { 'match.compression.knee': 100 }).value).toBe(100);
  });

  it('keeps the result between 0 and 100 and never rolls', () => {
    expect(compress(-5).value).toBe(0);
    expect(compress(400).value).toBe(100);
    expect(findTraceNodes(compress(120).trace, 'roll')).toHaveLength(0);
  });

  it('starts from the value it compresses', () => {
    const result = compress(95);
    expect(result.trace.label).toBe('Work rate');
    expect(result.trace.children?.[0]?.label).toBe('Work rate before compression');
  });

  it('continues a formula trace instead of wrapping it', () => {
    const tunables = createEngineTunables();
    const source = startCalc('Work rate', 90, { startLabel: 'Before' }).add('Bonus', 5).done();
    const result = softCompression({ value: source, label: 'Work rate' }, { tunables });
    expectTraceReplays(result);
    expect(result.value).toBeCloseTo(89, 9);
    expect((result.trace.children ?? []).map((node) => node.label)).toEqual([
      'Before',
      'Bonus',
      'Above the knee at 85',
      'Down to the knee',
      'Share of each point above the knee kept',
      'Back up from the knee',
      'At most 100',
      'At least 0',
    ]);
    expect(expectTraceContains(result, { kind: 'branch' }).docRef).toBe(COMPRESSION_DOC_REF);
  });

  it('keeps every level of a real work rate trace', () => {
    const tunables = createEngineTunables();
    const worker = (id: string): WorkRateWorker => ({
      id,
      name: id,
      stamina: 50,
      performance: workerPerformance(
        {
          personId: id,
          name: id,
          axis: 'inRing',
          attributes: {
            ringwork: 99,
            psychology: 99,
            athleticism: 99,
            safety: 99,
            mic: 50,
            charisma: 50,
            presence: 50,
          },
          style: 'technician',
          fatigue: 0,
          injured: false,
          styleAffinity: [],
        },
        { tunables },
      ),
    });
    const rate = workRate(
      {
        durationClass: 'long',
        durationLabel: 'Main event (long)',
        sides: [
          { side: 0, members: [worker('a')] },
          { side: 1, members: [worker('b')] },
        ],
        workerCount: 2,
        leader: { id: 'a', name: 'a', psychology: 99 },
        matchType: { name: 'Singles', workRateFactor: 1 },
      },
      { tunables },
    );
    const result = softCompression({ value: rate, label: 'Work rate' }, { tunables });
    expectTraceReplays(result);
    expect(traceDepth(result.trace)).toBe(traceDepth(rate.trace));
    expect(findTraceNodes(result.trace, 'note').some(isTruncationNote)).toBe(false);
    const knee = expectTraceContains(result, { kind: 'branch', label: 'Above the knee at 85' });
    expect(knee.taken).toBe(rate.value > 85);
  });
});
