// Crowd score (D-02). Design: docs/design/match-rating.md#crowd-and-expectation-d-02
import { describe, expect, it } from 'vitest';
import { RngRegistry, type RngStream } from '../../../../src/core/rng/registry';
import {
  findTraceNodes,
  isTruncationNote,
  traceDepth,
  TRACE_MAX_DEPTH,
  untraced,
  type Traced,
} from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  CROWD_WEIGHTS_ZERO_NOTE,
  MATCH_RATING_STREAM,
  NO_VARIANCE_NOTE,
  crowdExpectation,
  crowdScore,
  starPower,
  type CrowdScoreInputs,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectRollRecorded,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

function stream(seed: string): RngStream {
  return new RngRegistry(seed).stream(MATCH_RATING_STREAM);
}

interface Numbers {
  performance?: number;
  entertainment?: number;
  starPower?: number;
  expectation?: number;
  crowdFactor?: number;
}

function inputs(numbers: Numbers = {}): CrowdScoreInputs {
  return {
    performance: untraced(numbers.performance ?? 66.1, 'Work rate'),
    performanceLabel: 'Work rate',
    entertainment: untraced(numbers.entertainment ?? 60, 'Entertainment'),
    starPower: untraced(numbers.starPower ?? 92.8, 'Star power'),
    expectation: untraced(numbers.expectation ?? 81.4, 'Expected'),
    crowdFactor: numbers.crowdFactor ?? 1,
    typeName: 'Singles',
  };
}

function crowd(
  numbers: Numbers = {},
  overrides: TunableOverrides = {},
  rng?: RngStream,
): Traced<number> {
  const result = crowdScore(inputs(numbers), {
    tunables: createEngineTunables(overrides),
    ...(rng === undefined ? {} : { rng }),
  });
  expectTraceReplays(result);
  return result;
}

function rootLabels(result: Traced<number>): string[] {
  return (result.trace.children ?? []).map((node) => node.label);
}

describe('crowdScore', () => {
  it('reads delivered, expected and the surprise as separate lines', () => {
    // Delivered 66.1 × 0.55 + 60 × 0.25 + 92.8 × 0.2 = 69.915; (69.915 − 81.4) × 0.5 = −5.7425.
    const result = crowd();
    expect(result.value).toBeCloseTo(64.1725, 9);
    expect(rootLabels(result)).toEqual([
      'Nothing yet',
      'Delivered 69.91',
      'Below expectation −5.74',
      'Singles crowd factor',
      NO_VARIANCE_NOTE,
      'Never below 0',
    ]);
    expectTraceContains(result, { kind: 'subtract', label: 'Expected 81.4' });
  });

  it('reacts better to the same match as an opener, where less was expected', () => {
    // (69.915 − 70.4) × 0.5 = −0.2425.
    expect(crowd({ expectation: 70.4 }).value).toBeCloseTo(69.6725, 9);
  });

  it('notices an act that beats expectation', () => {
    const result = crowd({ expectation: 59.915 });
    expect(result.value).toBeCloseTo(69.915 + 5, 9);
    expectTraceContains(result, { kind: 'add', label: 'Above expectation +5' });
  });

  it('adds nothing when delivered equals expected', () => {
    const result = crowd({ performance: 70, entertainment: 70, starPower: 70, expectation: 70 });
    expect(result.value).toBeCloseTo(70, 9);
    const surprise = expectTraceContains(result, { kind: 'add', label: 'Met expectation +0' });
    expect(surprise.operand).toBeCloseTo(0, 9);
  });

  it('gives 0 with a note when all three weights are 0', () => {
    const result = crowd(
      {},
      {
        'match.crowd.performanceWeight': 0,
        'match.crowd.entertainmentWeight': 0,
        'match.crowd.starWeight': 0,
        'match.crowd.surpriseWeight': 0,
      },
    );
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: CROWD_WEIGHTS_ZERO_NOTE });
  });

  it('ignores expectation at surprise weight 0', () => {
    expect(crowd({}, { 'match.crowd.surpriseWeight': 0 }).value).toBeCloseTo(69.915, 9);
  });

  it('scales by the crowd factor and floors at 0', () => {
    expect(crowd({ crowdFactor: 1.2 }).value).toBeCloseTo(64.1725 * 1.2, 9);
    expect(crowd({ crowdFactor: 0 }).value).toBe(0);
    expect(crowd({ performance: 0, entertainment: 0, starPower: 0, expectation: 100 }).value).toBe(
      0,
    );
  });

  it('counts popularity only through star power, in delivered and in the expectation', () => {
    const lowStar = crowd({ starPower: 40 });
    const highStar = crowd({ starPower: 90 });
    // 50 more star power: +10 delivered, +5 from the surprise, nothing else.
    expect(highStar.value - lowStar.value).toBeCloseTo(15, 9);
  });

  it('rolls the crowd on the night only with an rng', () => {
    const rolled = crowd({}, {}, stream('crowd'));
    const roll = expectRollRecorded(rolled, MATCH_RATING_STREAM);
    expect(roll.label).toBe('Crowd on the night');
    expect(rolled.value).toBeCloseTo(64.1725 + Number(roll.result), 9);
    expect(findTraceNodes(crowd().trace, 'roll')).toHaveLength(0);
    expect(crowd({}, { 'match.crowd.varianceSd': 0 }, stream('crowd')).value).toBeCloseTo(
      64.1725,
      9,
    );
  });

  it('reads the performance as one flat line', () => {
    const result = crowd();
    const performance = findTraceNodes(result.trace, 'input').find(
      (node) => node.label === 'Work rate',
    );
    expect(performance?.children).toBeUndefined();
  });

  it('fits the trace limits with real star power and expectation traces', () => {
    const tunables = createEngineTunables();
    const power = starPower(
      {
        regionName: 'Great Lakes',
        members: [
          { id: 'a', name: 'Kade Morrow', popularity: 80 },
          { id: 'b', name: 'Rex Vallor', popularity: 80 },
        ],
      },
      { tunables },
    );
    const expectation = crowdExpectation(
      {
        starPower: power,
        momentum: 0,
        role: 'mainEvent',
        roleLabel: 'Main event',
        importance: 'regular',
        televised: true,
      },
      { tunables },
    );
    const result = crowdScore({ ...inputs(), starPower: power, expectation }, { tunables });
    expectTraceReplays(result);
    expect(result.value).toBeCloseTo(64.1725, 9);
    expect(traceDepth(result.trace)).toBeLessThanOrEqual(TRACE_MAX_DEPTH);
    expect(findTraceNodes(result.trace, 'note').some(isTruncationNote)).toBe(false);
  });
});
