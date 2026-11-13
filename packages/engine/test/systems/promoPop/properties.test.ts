// Property checks on seeded random cases for the show popularity change.
// Design: docs/design/promotion-popularity.md#show-popularity-change
import { describe, expect, it } from 'vitest';
import { floatBetween, pick, RngRegistry } from '../../../src/core/rng';
import { inputOf } from '../../../src/core/trace';
import { EVENT_IMPORTANCES } from '../../../src/model/entities/event-definition';
import {
  showPopularityChange,
  type ShowPopularityChangeInputs,
} from '../../../src/systems/promoPop';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';

const CASES = 500;
const tunables = createEngineTunables();
const deadZone = tunables.get('promoPop.deadZone');
const largestSwing = Math.max(
  tunables.get('promoPop.maxGainPerShow'),
  tunables.get('promoPop.maxLossPerShow'),
);
const IMPACT_KEYS = {
  house: 'promoPop.impact.house',
  minor: 'promoPop.impact.minor',
  regular: 'promoPop.impact.regular',
  major: 'promoPop.impact.major',
  flagship: 'promoPop.impact.flagship',
} as const;

/** A seeded stream per property. Any registered stream name does; the seed is what sets the cases. */
function casesFor(seed: string) {
  return new RngRegistry(seed).stream('worldgen.people.popularity');
}

function randomInputs(stream: ReturnType<typeof casesFor>): ShowPopularityChangeInputs {
  return {
    regionName: 'Test Region',
    score: floatBetween(stream, 0, 100),
    expectation: inputOf('What fans expected', floatBetween(stream, 0, 100), undefined, 'points'),
    before: floatBetween(stream, 0, 100),
    weight: inputOf('Reach', pick(stream, [1, 0.6, 0.5, 0.2, floatBetween(stream, 0, 1)])),
    reachLabel: 'Show region',
    importance: pick(stream, EVENT_IMPORTANCES),
    gainedThisMonth: floatBetween(stream, 0, 4),
  };
}

function scoreOf(inputs: ShowPopularityChangeInputs): number {
  return typeof inputs.score === 'number' ? inputs.score : inputs.score.value;
}

describe('showPopularityChange properties', () => {
  it('moves with the margin, within its bounds, and replays every time', () => {
    const stream = casesFor('promo-pop-properties-bounds');
    for (let caseIndex = 0; caseIndex < CASES; caseIndex += 1) {
      const inputs = randomInputs(stream);
      const result = showPopularityChange(inputs, { tunables });
      expectTraceReplays(result);
      expectSerialisable(result);

      const margin = scoreOf(inputs) - inputs.expectation.value;
      if (Math.abs(margin) <= deadZone || result.value === 0) {
        expect(result.value).toBe(0);
      } else {
        expect(Math.sign(result.value)).toBe(Math.sign(margin));
      }

      const impact = tunables.get(IMPACT_KEYS[inputs.importance]);
      const bound = largestSwing * impact * inputs.weight.value;
      expect(Math.abs(result.value)).toBeLessThanOrEqual(bound + 1e-9);

      if (result.value > 0) {
        const remaining = Math.max(
          0,
          tunables.get('promoPop.monthlyGainCap') - inputs.gainedThisMonth,
        );
        expect(result.value).toBeLessThanOrEqual(remaining + 1e-9);
      }
      expect(inputs.before + result.value).toBeGreaterThanOrEqual(-1e-9);
      expect(inputs.before + result.value).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it('never gives a larger gain to a promotion that is already more popular', () => {
    const stream = casesFor('promo-pop-properties-diminishing');
    for (let caseIndex = 0; caseIndex < CASES; caseIndex += 1) {
      const inputs = randomInputs(stream);
      const higher = { ...inputs, before: floatBetween(stream, inputs.before, 100) };
      const lowerGain = showPopularityChange(inputs, { tunables });
      const higherGain = showPopularityChange(higher, { tunables });
      expectTraceReplays(higherGain);
      expectSerialisable(higherGain);
      if (lowerGain.value >= 0) {
        expect(higherGain.value).toBeLessThanOrEqual(lowerGain.value + 1e-12);
      }
    }
  });
});
