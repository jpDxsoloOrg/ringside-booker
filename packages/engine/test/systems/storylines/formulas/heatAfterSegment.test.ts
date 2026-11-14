// Heat after a linked segment (CRTV4-02). Design: docs/design/storylines.md#heat-after-segment
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace/helpers';
import type { Traced } from '../../../../src/core/trace/types';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { heatAfterSegment } from '../../../../src/systems/storylines';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

interface Case {
  heatBefore: number;
  segmentScore: number;
  nthOnShow?: number;
  preShow?: boolean;
}

function step(input: Case, overrides: TunableOverrides = {}): Traced<number> {
  const result = heatAfterSegment(
    {
      heatBefore: input.heatBefore,
      segmentScore: input.segmentScore,
      storylineName: 'Test Feud',
      segmentLabel: 'Main event',
      nthOnShow: input.nthOnShow ?? 1,
      preShow: input.preShow ?? false,
    },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('heatAfterSegment', () => {
  it('moves heat 50 toward a score of 80 by 40% of the gap: 62', () => {
    const result = step({ heatBefore: 50, segmentScore: 80 });
    expect(result.value).toBeCloseTo(62, 10);
    expect(result.trace).toMatchObject({
      kind: 'formula',
      label: "Heat after 'Main event'",
      unit: 'points',
      docRef: 'docs/design/storylines.md#heat-after-segment',
    });
    expect(
      expectTraceContains(result, { kind: 'input', label: "Heat before 'Main event'" }).value,
    ).toBe(50);
    expect(
      expectTraceContains(result, { kind: 'formula', label: "Gap to the segment's score" }).value,
    ).toBe(30);
    expectTraceContains(result, { kind: 'tunable', label: 'Share of the gap one segment closes' });
    expect(
      expectTraceContains(result, {
        kind: 'branch',
        label: 'First linked segment for this story tonight',
      }),
    ).toMatchObject({ taken: false });
    expect(
      expectTraceContains(result, { kind: 'clamp', label: 'Most heat one segment can move' }),
    ).toMatchObject({ applied: false, min: -15, max: 15 });
  });

  it("counts the same storyline's second segment that night at half: 62 → 65.6", () => {
    const result = step({ heatBefore: 62, segmentScore: 80, nthOnShow: 2 });
    expect(result.value).toBeCloseTo(65.6, 10);
    expect(
      expectTraceContains(result, {
        kind: 'branch',
        label: 'Second linked segment for this story tonight',
      }),
    ).toMatchObject({ taken: true });
    expect(
      expectTraceContains(result, { kind: 'multiply', label: 'Second segment tonight' }),
    ).toMatchObject({ value: expect.closeTo(3.6, 10) as unknown });
  });

  it('applies the repeat factor once per extra segment: a third counts at a quarter', () => {
    const result = step({ heatBefore: 50, segmentScore: 80, nthOnShow: 3 });
    expect(result.value).toBeCloseTo(53, 10);
    expectTraceContains(result, {
      kind: 'branch',
      label: 'Third linked segment for this story tonight',
    });
  });

  it('cools a story when the segment scores below its heat: 50 → 42', () => {
    expect(step({ heatBefore: 50, segmentScore: 30 }).value).toBeCloseTo(42, 10);
  });

  it('caps one step at maxStep: 20 toward 90 → 35', () => {
    const result = step({ heatBefore: 20, segmentScore: 90 });
    expect(result.value).toBe(35);
    expect(
      expectTraceContains(result, { kind: 'clamp', label: 'Most heat one segment can move' }),
    ).toMatchObject({ applied: true, before: 28, after: 15 });
  });

  it('caps a fall at maxStep too', () => {
    expect(step({ heatBefore: 90, segmentScore: 10 }).value).toBe(75);
  });

  it('halves a pre-show segment: 50 toward 80 → 56', () => {
    const result = step({ heatBefore: 50, segmentScore: 80, preShow: true });
    expect(result.value).toBeCloseTo(56, 10);
    expect(
      expectTraceContains(result, { kind: 'branch', label: 'Pre-show segment' }),
    ).toMatchObject({ taken: true });
  });

  it('leaves 0 at 0 for a score of 0', () => {
    expect(step({ heatBefore: 0, segmentScore: 0 }).value).toBe(0);
  });

  it('closes a small gap near the top: 99 toward 100 → 99.4', () => {
    expect(step({ heatBefore: 99, segmentScore: 100 }).value).toBeCloseTo(99.4, 10);
  });

  it('never leaves 0..100', () => {
    expect(step({ heatBefore: 100, segmentScore: 100 }).value).toBe(100);
    expect(step({ heatBefore: 5, segmentScore: 0 }, { 'storylines.heat.pull': 1 }).value).toBe(0);
  });

  it('pull 0: heat never moves from shows', () => {
    expect(step({ heatBefore: 50, segmentScore: 80 }, { 'storylines.heat.pull': 0 }).value).toBe(
      50,
    );
  });

  it('maxStep 0: heat never moves from shows', () => {
    expect(
      step({ heatBefore: 50, segmentScore: 80 }, { 'storylines.heat.maxStep': 0 }).value,
    ).toBe(50);
  });

  it('repeatFactor 0: a second segment that night changes nothing', () => {
    expect(
      step(
        { heatBefore: 62, segmentScore: 80, nthOnShow: 2 },
        { 'storylines.heat.repeatFactor': 0 },
      ).value,
    ).toBe(62);
  });

  it('repeatFactor 1: a second segment counts in full', () => {
    expect(
      step(
        { heatBefore: 62, segmentScore: 80, nthOnShow: 2 },
        { 'storylines.heat.repeatFactor': 1 },
      ).value,
    ).toBeCloseTo(69.2, 10);
  });

  it('preShowFactor 0: a pre-show segment changes nothing', () => {
    expect(
      step(
        { heatBefore: 50, segmentScore: 80, preShow: true },
        { 'storylines.heat.preShowFactor': 0 },
      ).value,
    ).toBe(50);
  });

  it('records no reduction steps for a first main-card segment', () => {
    const result = step({ heatBefore: 50, segmentScore: 80 });
    expect(findTraceNodes(result.trace, 'multiply').map((node) => node.label)).toEqual([
      'Pull per segment',
    ]);
  });
});
