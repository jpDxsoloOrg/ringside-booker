// Title urgency. Design: docs/design/rival-booking.md#title-picture
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace';
import { EVENT_IMPORTANCES } from '../../../../src/model/entities/event-definition';
import { titleUrgency, type TitleUrgencyInputs } from '../../../../src/systems/aip';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const tunables = createEngineTunables();

function urgencyOf(overrides: Partial<TitleUrgencyInputs> = {}, tuned = tunables): number {
  const result = titleUrgency(
    {
      titleName: 'Test Title',
      prestige: 0,
      daysSinceDefence: 28,
      importance: 'regular',
      titleFocus: 50,
      ...overrides,
    },
    { tunables: tuned },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result.value;
}

describe('titleUrgency', () => {
  it('is 1 when the usual gap has passed at neutral taste, prestige 0, on a regular show', () => {
    expect(urgencyOf()).toBeCloseTo(1);
    expect(urgencyOf({ daysSinceDefence: 14 })).toBeCloseTo(0.5);
  });

  it('halves the usual gap at title taste 100 with a swing of 0.5', () => {
    expect(urgencyOf({ titleFocus: 100, daysSinceDefence: 14 })).toBeCloseTo(1);
    expect(urgencyOf({ titleFocus: 0, daysSinceDefence: 42 })).toBeCloseTo(1);
  });

  it('never lets the usual gap fall below a day', () => {
    const tuned = createEngineTunables({
      'aip.titles.defenceIntervalDays': 1,
      'aip.titles.tempoSwing': 1,
    });
    expect(urgencyOf({ titleFocus: 100, daysSinceDefence: 3 }, tuned)).toBeCloseTo(3);
  });

  it('adds prestige ÷ 100 × the prestige weight, and nothing at weight 0', () => {
    expect(urgencyOf({ prestige: 80 })).toBeCloseTo(1.4);
    const flat = createEngineTunables({ 'aip.titles.prestigeWeight': 0 });
    expect(urgencyOf({ prestige: 80 }, flat)).toBeCloseTo(1);
  });

  it('adds the importance bonus for each level of show', () => {
    const expected = { house: 0, minor: 0, regular: 0, major: 1, flagship: 2 } as const;
    for (const importance of EVENT_IMPORTANCES) {
      expect(urgencyOf({ importance, daysSinceDefence: 0 })).toBeCloseTo(expected[importance]);
    }
  });

  it('names the days since the last defence and the booker taste in its trace', () => {
    const result = titleUrgency(
      {
        titleName: 'Test Title',
        prestige: 50,
        daysSinceDefence: 40,
        importance: 'major',
        titleFocus: 70,
      },
      { tunables },
    );
    const labels = findTraceNodes(result.trace, 'input').map((node) => node.label);
    expect(labels).toContain('40 days since the last defence');
    const arithmetic = findTraceNodes(result.trace, 'multiply').map((node) => node.label);
    expect(arithmetic).toContain("Booker's title taste (70)");
    expect(result.trace.docRef).toBe('rival-booking.md#title-picture');
  });
});
