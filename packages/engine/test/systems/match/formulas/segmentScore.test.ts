// Segment score. Design: docs/design/match-rating.md#segment-score
import { describe, expect, it } from 'vitest';
import { untraced, type Traced } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  PROMOTION_STYLES,
  type PromotionStyle,
} from '../../../../src/model/entities/promotion-style';
import type { SegmentKind } from '../../../../src/model/entities/segment';
import {
  DEFAULT_POLICY_LABEL,
  SEGMENT_SCORE_LABEL,
  segmentScore,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectTraceContains, expectTraceReplays } from '../../../support/trace';

const WORK_RATE_SHARES: Readonly<Record<PromotionStyle, number>> = {
  mainstream: 0.45,
  traditional: 0.5,
  technical: 0.65,
  hardHitting: 0.6,
  hardcore: 0.5,
  highFlying: 0.6,
  entertainment: 0.3,
};

interface ScoreOptions {
  kind?: SegmentKind;
  performance?: number;
  crowd?: number;
  style?: PromotionStyle;
  policyBonus?: number;
  policyLabel?: string;
}

function score(options: ScoreOptions = {}, overrides: TunableOverrides = {}): Traced<number> {
  const result = segmentScore(
    {
      kind: options.kind ?? 'match',
      performance: untraced(options.performance ?? 66.1, 'Work rate'),
      crowd: untraced(options.crowd ?? 64.1725, 'Crowd'),
      promotionStyle: options.style ?? 'mainstream',
      policyBonus: untraced(options.policyBonus ?? 0, 'Policy bonus'),
      policyLabel: options.policyLabel ?? DEFAULT_POLICY_LABEL,
    },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  return result;
}

describe('segmentScore', () => {
  it('blends work rate and crowd at a mainstream promotion and rounds', () => {
    // 66.1 × 0.45 + 64.1725 × 0.55 = 65.04, rounded to 65.
    const result = score();
    expect(result.value).toBe(65);
    expect(result.trace.label).toBe(SEGMENT_SCORE_LABEL);
    expectTraceContains(result, { kind: 'add', label: 'Work rate × 0.45' });
    expectTraceContains(result, { kind: 'add', label: 'Crowd × 0.55' });
    expectTraceContains(result, { kind: 'add', label: 'Same rules for every promotion +0' });
    expectTraceContains(result, { kind: 'round' });
  });

  it.each(PROMOTION_STYLES.map((style) => [style]))('uses the %s work rate share', (style) => {
    const share = WORK_RATE_SHARES[style];
    const result = score({ style, performance: 100, crowd: 0 });
    expect(result.value).toBe(Math.round(100 * share));
    expectTraceContains(result, { kind: 'tunable', label: /work rate share$/ });
  });

  it('uses the talk share for a talking segment, whatever the style', () => {
    for (const style of PROMOTION_STYLES) {
      const result = score({ kind: 'angle', style, performance: 100, crowd: 0 });
      expect(result.value).toBe(35);
      expectTraceContains(result, { kind: 'add', label: 'Talk × 0.35' });
    }
  });

  it("adds the policy bonus with the provider's label", () => {
    const result = score({ policyBonus: 3, policyLabel: 'Strong style rules' });
    expect(result.value).toBe(68);
    expectTraceContains(result, { kind: 'add', label: 'Strong style rules +3' });
  });

  it('keeps the score between 0 and 100', () => {
    expect(score({ performance: 100, crowd: 100, policyBonus: 10 }).value).toBe(100);
    expect(score({ performance: 0, crowd: 0, policyBonus: -10 }).value).toBe(0);
  });

  it('is all work rate at share 1 and all crowd at share 0', () => {
    expect(score({}, { 'match.blend.workRateShare.mainstream': 1 }).value).toBe(66);
    expect(score({}, { 'match.blend.workRateShare.mainstream': 0 }).value).toBe(64);
  });
});
