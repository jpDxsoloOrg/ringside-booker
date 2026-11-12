// Region expectation. Design: docs/design/promotion-popularity.md#region-expectation
import { describe, expect, it } from 'vitest';
import { findTraceNodes, inputOf, type Traced } from '../../../src/core/trace';
import {
  EVENT_IMPORTANCES,
  type EventImportance,
} from '../../../src/model/entities/event-definition';
import { regionExpectation, type RegionExpectationInputs } from '../../../src/systems/promoPop';
import { createEngineTunables, type EngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';

const DEFAULTS = createEngineTunables();

function expectation(
  overrides: Partial<RegionExpectationInputs> = {},
  tunables: EngineTunables = DEFAULTS,
): Traced<number> {
  const result = regionExpectation(
    {
      regionName: 'Altura Coast',
      popularity: 75,
      prestige: 80,
      importance: 'regular',
      hype: null,
      ...overrides,
    },
    { tunables },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

function noteLabels(result: Traced<number>): string[] {
  return findTraceNodes(result.trace, 'note').map((node) => node.label);
}

describe('regionExpectation', () => {
  it('expects nothing when both weights are 0', () => {
    const zero = createEngineTunables({
      'promoPop.expect.popularityWeight': 0,
      'promoPop.expect.prestigeWeight': 0,
    });
    expect(expectation({}, zero).value).toBe(0);
  });

  it('expects 61 from a big company at a regular show in its home region', () => {
    const result = expectation();
    expect(result.value).toBeCloseTo(61, 9);
    expect(result.trace.label).toBe('What fans in Altura Coast expected');
    expect(result.trace.docRef).toBe('promotion-popularity.md#region-expectation');
    const multiplies = findTraceNodes(result.trace, 'multiply').map((node) => node.label);
    expect(multiplies).toEqual([
      'Popularity here 75 × 0.6',
      'Event size: Regular × 1',
      'Prestige 80 × 0.2',
    ]);
  });

  it('expects 16.4 from a small company at a minor show', () => {
    expect(expectation({ popularity: 20, prestige: 28, importance: 'minor' }).value).toBeCloseTo(
      16.4,
      9,
    );
  });

  it('expects only the prestige part where nobody knows the promotion', () => {
    expect(expectation({ popularity: 0, prestige: 28, importance: 'minor' }).value).toBeCloseTo(
      5.6,
      9,
    );
  });

  it.each<[EventImportance, number]>([
    ['house', 0.8],
    ['minor', 0.9],
    ['regular', 1],
    ['major', 1.15],
    ['flagship', 1.3],
  ])('scales only the popularity part for a %s show (× %s)', (importance, factor) => {
    expect(EVENT_IMPORTANCES).toContain(importance);
    expect(expectation({ importance }).value).toBeCloseTo(75 * 0.6 * factor + 80 * 0.2, 9);
  });

  it('keeps expectations at 100 or below', () => {
    const tunables = createEngineTunables({ 'promoPop.expect.popularityWeight': 2 });
    const result = expectation({ popularity: 90, importance: 'flagship' }, tunables);
    expect(result.value).toBe(100);
    expect(findTraceNodes(result.trace, 'clamp')[0]).toMatchObject({
      label: 'Expectations stay within 0–100',
      applied: true,
    });
  });

  it('notes that hype is not tracked when there is none, and multiplies by it when there is', () => {
    expect(noteLabels(expectation())).toContain("Hype isn't tracked yet");
    const hyped = expectation({ hype: inputOf('Hype', 1.1, undefined, 'multiplier') });
    expect(hyped.value).toBeCloseTo(61 * 1.1, 9);
    expect(noteLabels(hyped)).not.toContain("Hype isn't tracked yet");
    expect(findTraceNodes(hyped.trace, 'multiply').map((node) => node.label)).toContain(
      'Hype: fans expect more × 1.1',
    );
  });
});
