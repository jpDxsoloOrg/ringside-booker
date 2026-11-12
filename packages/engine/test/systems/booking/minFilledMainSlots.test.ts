// Minimum filled main-card slots. Design: docs/design/booking.md#validation
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { minFilledMainSlots } from '../../../src/systems/booking';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';

function needed(slots: number, overrides: TunableOverrides = {}) {
  const result = minFilledMainSlots({ slots }, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expectSerialisable(result.trace);
  return result;
}

describe('minFilledMainSlots', () => {
  it('labels the root and its steps in player words', () => {
    const result = needed(6);
    expect(result.trace).toMatchObject({
      kind: 'formula',
      label: 'Main card slots that must be filled',
      unit: 'count',
    });
    expectTraceContains(result, { kind: 'input', label: 'Main card slots' });
    expectTraceContains(result, { kind: 'multiply', label: 'Share that must be filled' });
    expectTraceContains(result, { kind: 'round', label: 'Rounded up' });
  });

  it('needs half the slots at the default share, rounded up', () => {
    expect(needed(6).value).toBe(3);
    expect(needed(5).value).toBe(3);
    expect(needed(4).value).toBe(2);
  });

  it('needs nothing of a card with no slots and one of a one-slot card', () => {
    expect(needed(0).value).toBe(0);
    expect(needed(1).value).toBe(1);
  });

  it('has no minimum at a share of 0 and needs every slot at 1', () => {
    expect(needed(6, { 'booking.minFilledMainShare': 0 }).value).toBe(0);
    expect(needed(1, { 'booking.minFilledMainShare': 0 }).value).toBe(0);
    expect(needed(6, { 'booking.minFilledMainShare': 1 }).value).toBe(6);
    expect(needed(0, { 'booking.minFilledMainShare': 1 }).value).toBe(0);
  });

  it('rounds a whole product to itself, not a step up', () => {
    // 10 × 0.3 is 3.0000000000000004 in floating point.
    expect(needed(10, { 'booking.minFilledMainShare': 0.3 }).value).toBe(3);
    expect(needed(10, { 'booking.minFilledMainShare': 0.7 }).value).toBe(7);
    expect(needed(6, { 'booking.minFilledMainShare': 0.55 }).value).toBe(4);
  });

  it('keeps the answer within the main card', () => {
    const clamp = expectTraceContains(needed(6, { 'booking.minFilledMainShare': 1 }), {
      kind: 'clamp',
    });
    expect(clamp.applied).toBe(false);
    expect(clamp.max).toBe(6);
  });
});
