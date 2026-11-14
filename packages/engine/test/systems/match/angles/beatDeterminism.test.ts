// Beat formulas on the match.angle stream: same preview seed, same result. Design:
// docs/design/angle-rating.md#beat-worker-value and #beat-score
import { describe, expect, it } from 'vitest';
import type { RngStream } from '../../../../src/core/rng/registry';
import { findTraceNodes, type TraceNode, type Traced } from '../../../../src/core/trace';
import {
  anglePreviewStream,
  beatScore,
  beatWorkerValue,
  STAT_NOISE_LABEL,
  type BeatWorkerValueInputs,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectRollRecorded } from '../../../support/trace';

const TUNABLES = createEngineTunables();
const WORLD_SEED = 'determinism-world';

const AVA: BeatWorkerValueInputs = {
  personName: 'Ava Stone',
  stats: ['mic', 'charisma'],
  values: { mic: 60, charisma: 55 },
  morale: -40,
  momentum: 30,
  manager: { name: 'Rex Halden', values: { mic: 82 }, morale: 10 },
  managerCanStandIn: true,
  isViewersWorker: true,
};
const HAL: BeatWorkerValueInputs = {
  ...AVA,
  personName: 'Hal Price',
  stats: ['broadcasting'],
  values: { broadcasting: 70 },
  manager: null,
};

function rateBeat(rng: RngStream): Traced<number> {
  const deps = { tunables: TUNABLES, rng };
  return beatScore(
    {
      beatName: 'Interview',
      groups: [
        {
          label: 'Speaker',
          weight: 3,
          optional: false,
          workerValues: [beatWorkerValue(AVA, deps)],
        },
        { label: 'Host', weight: 1, optional: true, workerValues: [beatWorkerValue(HAL, deps)] },
      ],
    },
    deps,
  );
}

/** The trace's shape: every node's kind and label, without values. */
function shape(node: TraceNode): unknown {
  return { kind: node.kind, label: node.label, children: (node.children ?? []).map(shape) };
}

/**
 * What the noise cannot touch: the best-stat decisions, and each person's value just before their
 * own roll. (The beat's total before its roll already holds the people's rolls.)
 */
function beforeNoise(result: Traced<number>): { decisions: unknown[]; beforeRolls: number[] } {
  return {
    decisions: findTraceNodes(result.trace, 'decision'),
    beforeRolls: findTraceNodes(result.trace, 'add')
      .filter((node) => node.label === STAT_NOISE_LABEL)
      .map((node) => node.before),
  };
}

describe('beat formulas on a preview seed', () => {
  it('give the same value and trace twice for the same seed', () => {
    const first = rateBeat(anglePreviewStream(WORLD_SEED, 7));
    const second = rateBeat(anglePreviewStream(WORLD_SEED, 7));
    expect(second).toStrictEqual(first);
    expectRollRecorded(first, 'match.angle');
  });

  it('move only the noise lines for a different seed', () => {
    const results = [1, 2, 3, 4, 5].map((seed) => rateBeat(anglePreviewStream(WORLD_SEED, seed)));
    const values = new Set(results.map((result) => result.value));
    expect(values.size).toBeGreaterThan(1);
    const [first, ...rest] = results;
    if (first === undefined) {
      expect.fail('no results');
    }
    expect(beforeNoise(first).beforeRolls).toHaveLength(2);
    for (const other of rest) {
      expect(shape(other.trace)).toStrictEqual(shape(first.trace));
      expect(beforeNoise(other)).toStrictEqual(beforeNoise(first));
    }
  });
});
