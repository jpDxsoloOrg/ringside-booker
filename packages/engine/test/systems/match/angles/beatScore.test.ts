// Beat score. Design: docs/design/angle-rating.md#beat-score
import { describe, expect, it } from 'vitest';
import { RngRegistry, type RngStream } from '../../../../src/core/rng/registry';
import { findTraceNodes, inputOf, type Traced } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  ANGLE_STREAM,
  BEAT_NOISE_LABEL,
  beatScore,
  emptyRequiredGroupNote,
  NO_NOISE_BRANCH,
  skippedGroupNote,
  type BeatScoreGroup,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectRollRecorded,
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

const QUIET: TunableOverrides = { 'match.angle.beatNoise': 0 };

function stream(seed = 'beat-score'): RngStream {
  return new RngRegistry(seed).stream(ANGLE_STREAM);
}

/** A worker value with no story, titled with the person's name. */
function person(name: string, value: number): Traced<number> {
  return inputOf(name, value);
}

function group(
  label: string,
  values: readonly Traced<number>[],
  weight = 1,
  optional = false,
): BeatScoreGroup {
  return { label, weight, optional, workerValues: values };
}

function score(
  groups: readonly BeatScoreGroup[],
  overrides: TunableOverrides = QUIET,
  rng: RngStream = stream(),
): Traced<number> {
  const result = beatScore(
    { beatName: 'Interview', groups },
    { tunables: createEngineTunables(overrides), rng },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('beatScore', () => {
  it('scores one group as the mean of its people', () => {
    const result = score([group('Speakers', [person('Ava', 70), person('Bo', 50)])]);
    expect(result.value).toBe(60);
    expect(result.trace.label).toBe('Beat: Interview');
    expect(result.trace.docRef).toBe('angle-rating.md#beat-score');
    // Each person sits in the trace under their own name.
    expectTraceContains(result, { kind: 'input', label: 'Ava' });
    expectTraceContains(result, { kind: 'add', label: 'Bo' });
  });

  it('weights two groups 3:1 (interview)', () => {
    const result = score([
      group('Speaker', [person('Ava', 80)], 3),
      group('Host', [person('Hal', 40)], 1, true),
    ]);
    // (3 × 80 + 1 × 40) / 4 = 70.
    expect(result.value).toBe(70);
  });

  it('leaves out an empty optional host group', () => {
    const result = score([group('Speaker', [person('Ava', 80)], 3), group('Host', [], 1, true)]);
    expect(result.value).toBe(80);
    expectTraceContains(result, { kind: 'note', label: skippedGroupNote('Host') });
    expect(skippedGroupNote('Host')).toBe('Host: nobody, not counted');
  });

  it('scores 0 with a note when a required group is empty, and draws no roll', () => {
    const result = score([group('Talker', [person('Ava', 80)]), group('Listener', [])], {
      'match.angle.beatNoise': 15,
    });
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: emptyRequiredGroupNote('Listener') });
    expect(findTraceNodes(result.trace, 'roll')).toHaveLength(0);
  });

  it('draws no roll when beatNoise is 0', () => {
    const result = score([group('Speaker', [person('Ava', 55)])]);
    expect(result.value).toBe(55);
    expect(findTraceNodes(result.trace, 'roll')).toHaveLength(0);
    expectTraceContains(result, { kind: 'branch', label: NO_NOISE_BRANCH });
  });

  it.each([5, 15])('rolls up to %i points either way on match.angle', (spread) => {
    const result = score(
      [group('Speaker', [person('Ava', 50)])],
      { 'match.angle.beatNoise': spread },
      stream(`spread-${String(spread)}`),
    );
    const roll = expectRollRecorded(result, 'match.angle');
    expect(roll.label).toBe(BEAT_NOISE_LABEL);
    expect([roll.min, roll.max]).toEqual([-spread, spread]);
    expect(result.value).toBe(50 + Number(roll.result));
  });

  /** Finds a seed whose first beat roll at spread 15 gives `wanted`. */
  function seedRolling(wanted: (roll: number) => boolean): string {
    for (let index = 0; index < 500; index += 1) {
      const seed = `clamp-${String(index)}`;
      const probe = beatScore(
        { beatName: 'Probe', groups: [group('Speaker', [person('Ava', 50)])] },
        { tunables: createEngineTunables({ 'match.angle.beatNoise': 15 }), rng: stream(seed) },
      );
      if (wanted(probe.value - 50)) {
        return seed;
      }
    }
    throw new Error('no seed found');
  }

  it('keeps a score just below 0 at 0', () => {
    const seed = seedRolling((roll) => roll < -1);
    const result = score(
      [group('Speaker', [person('Ava', 1)])],
      { 'match.angle.beatNoise': 15 },
      stream(seed),
    );
    const clamp = expectTraceContains(result, { kind: 'clamp' });
    expect(clamp.before).toBeLessThan(0);
    expect(clamp.applied).toBe(true);
    expect(result.value).toBe(0);
  });

  it('keeps a score above 100 at 100, and leaves exactly 100 alone', () => {
    const seed = seedRolling((roll) => roll > 1);
    const result = score(
      [group('Speaker', [person('Ava', 99)])],
      { 'match.angle.beatNoise': 15 },
      stream(seed),
    );
    const clamp = expectTraceContains(result, { kind: 'clamp' });
    expect(clamp.before).toBeGreaterThan(100);
    expect(clamp.applied).toBe(true);
    expect(result.value).toBe(100);

    const exact = score([group('Speaker', [person('Ava', 100)])]);
    expect(exact.value).toBe(100);
    expect(expectTraceContains(exact, { kind: 'clamp' }).applied).toBe(false);
  });

  it('does not round', () => {
    const result = score([group('Speakers', [person('Ava', 70), person('Bo', 51)])]);
    expect(result.value).toBe(60.5);
    expect(findTraceNodes(result.trace, 'round')).toHaveLength(0);
  });

  it('refuses a beat with no groups', () => {
    expect(() => score([])).toThrow(/at least one group/);
  });
});
