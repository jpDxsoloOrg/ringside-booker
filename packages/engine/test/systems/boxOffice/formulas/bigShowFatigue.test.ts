// Big-show fatigue. Design: docs/design/box-office.md#big-show-fatigue
import { describe, expect, it } from 'vitest';
import { findTraceNodes, type Traced } from '../../../../src/core/trace';
import type { EventImportance } from '../../../../src/model/entities/event-definition';
import { computeBigShowFatigue } from '../../../../src/systems/boxOffice';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const DEFAULTS = createEngineTunables();

function fatigue(
  importance: EventImportance,
  bigShowsBefore: number,
  tunables: EngineTunables = DEFAULTS,
): Traced<number> {
  const result = computeBigShowFatigue({ importance, bigShowsBefore }, { tunables });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('computeBigShowFatigue', () => {
  it('leaves smaller shows alone however many big shows came before', () => {
    for (const importance of ['house', 'minor', 'regular'] as const) {
      const result = fatigue(importance, 6);
      expect(result.value).toBe(1);
      expect(findTraceNodes(result.trace, 'note').map((node) => node.label)).toEqual([
        'Not a big show',
      ]);
    }
  });

  it('costs nothing below and at the free shows', () => {
    expect(fatigue('major', 0).value).toBe(1);
    expect(fatigue('flagship', 1).value).toBe(1);
  });

  it('loses 20% for each big show beyond the free one', () => {
    expect(fatigue('major', 2).value).toBeCloseTo(0.8, 12);
    expect(fatigue('flagship', 3).value).toBeCloseTo(0.6, 12);
  });

  it('stops at the floor', () => {
    expect(fatigue('major', 4).value).toBeCloseTo(0.4, 12);
    const atFloor = fatigue('major', 5);
    expect(atFloor.value).toBeCloseTo(0.25, 12);
    const deep = fatigue('major', 10);
    expect(deep.value).toBe(0.25);
    expect(
      findTraceNodes(deep.trace, 'max').find((node) => node.label === 'Fatigue floor')?.applied,
    ).toBe(true);
  });

  it('labels the line with the window', () => {
    const result = fatigue('major', 2);
    const labels = (result.trace.children ?? []).map((node) => node.label);
    expect(labels).toContain('Other big shows in the last 28 days');
  });

  it('turns off at perExtraShow 0 and empties the crowd at 1 with floor 0', () => {
    const off = createEngineTunables({ 'boxOffice.fatigue.perExtraShow': 0 });
    expect(fatigue('major', 10, off).value).toBe(1);
    const harsh = createEngineTunables({
      'boxOffice.fatigue.perExtraShow': 1,
      'boxOffice.fatigue.floor': 0,
    });
    expect(fatigue('major', 2, harsh).value).toBe(0);
    expect(fatigue('major', 5, harsh).value).toBe(0);
  });

  it('charges every big show with no free ones', () => {
    const none = createEngineTunables({ 'boxOffice.fatigue.freeShows': 0 });
    expect(fatigue('major', 1, none).value).toBeCloseTo(0.8, 12);
  });

  it('never drops below a floor of 1', () => {
    const floor = createEngineTunables({ 'boxOffice.fatigue.floor': 1 });
    expect(fatigue('flagship', 10, floor).value).toBe(1);
  });
});
