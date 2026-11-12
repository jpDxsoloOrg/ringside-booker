// Star ratings. Design: docs/design/match-rating.md#star-ratings
import { describe, expect, it } from 'vitest';
import { untraced, type Traced } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import type { SegmentKind } from '../../../../src/model/entities/segment';
import {
  NEAREST_QUARTER_LABEL,
  POINTS_PER_STAR_ZERO_NOTE,
  STARS_LABEL,
  starRating,
  type DurationClass,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectTraceContains, expectTraceReplays } from '../../../support/trace';

const DURATION_LABELS: Readonly<Record<DurationClass, string>> = {
  short: 'Opener (short)',
  standard: 'Midcard (standard)',
  long: 'Main event (long)',
};

function stars(
  base: number,
  durationClass: DurationClass = 'long',
  overrides: TunableOverrides = {},
  kind: SegmentKind = 'match',
): Traced<number> {
  // Performance and crowd both at `base`, so the blend is `base` whatever the share.
  const result = starRating(
    {
      kind,
      performance: untraced(base, 'Work rate'),
      crowd: untraced(base, 'Crowd'),
      durationClass,
      durationLabel: kind === 'angle' ? 'Talking segment' : DURATION_LABELS[durationClass],
    },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  return result;
}

describe('starRating', () => {
  it('gives 0 stars at base 15', () => {
    expect(stars(15).value).toBe(0);
    expect(stars(10).value).toBe(0);
  });

  it('gives base 95 five stars long, 4.75 standard and 3.5 short', () => {
    expect(stars(95, 'long').value).toBe(5);
    expect(stars(95, 'standard').value).toBe(4.75);
    expect(stars(95, 'short').value).toBe(3.5);
    expectTraceContains(stars(95, 'standard'), {
      kind: 'clamp',
      label: 'Midcard (standard): at most 4.75 stars',
    });
  });

  it('caps a talking segment at 4 stars', () => {
    const result = stars(95, 'long', {}, 'angle');
    expect(result.value).toBe(4);
    expectTraceContains(result, { kind: 'clamp', label: 'Talking segment: at most 4 stars' });
    expectTraceContains(result, { kind: 'add', label: 'Talk × 0.7' });
  });

  it('names the blend and rounds to the nearest quarter star', () => {
    // 66.1 × 0.7 + 64.1725 × 0.3 = 65.52; (65.52 − 15) ÷ 15 = 3.37, to 3.25.
    const result = starRating(
      {
        kind: 'match',
        performance: untraced(66.1, 'Work rate'),
        crowd: untraced(64.1725, 'Crowd'),
        durationClass: 'long',
        durationLabel: 'Main event (long)',
      },
      { tunables: createEngineTunables() },
    );
    expectTraceReplays(result);
    expect(result.value).toBe(3.25);
    expect(result.trace.label).toBe(STARS_LABEL);
    expect(result.trace.unit).toBe('stars');
    expectTraceContains(result, { kind: 'add', label: 'Work rate × 0.7' });
    expectTraceContains(result, { kind: 'add', label: 'Crowd × 0.3' });
    expectTraceContains(result, { kind: 'round', label: NEAREST_QUARTER_LABEL });
  });

  it('only ever gives multiples of 0.25 between 0 and 5', () => {
    for (let base = 0; base <= 100; base += 0.37) {
      for (const durationClass of ['short', 'standard', 'long'] as const) {
        const value = stars(base, durationClass).value;
        expect(Number.isInteger(value * 4)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
  });

  it('gives the cap or nothing when points per star is 0', () => {
    const above = stars(16, 'standard', { 'match.stars.pointsPerStar': 0 });
    expect(above.value).toBe(4.75);
    expectTraceContains(above, { kind: 'note', label: POINTS_PER_STAR_ZERO_NOTE });
    expect(expectTraceContains(above, { kind: 'branch' }).taken).toBe(true);
    const at = stars(15, 'standard', { 'match.stars.pointsPerStar': 0 });
    expect(at.value).toBe(0);
    expect(expectTraceContains(at, { kind: 'branch' }).taken).toBe(false);
  });

  it('gives 0 with every cap at 0', () => {
    expect(stars(95, 'long', { 'match.stars.cap.long': 0 }).value).toBe(0);
  });
});
