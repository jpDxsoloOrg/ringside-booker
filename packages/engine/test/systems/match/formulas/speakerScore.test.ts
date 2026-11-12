// Talking segments (simple). Design: docs/design/match-rating.md#talking-segments-simple
import { describe, expect, it } from 'vitest';
import { RngRegistry, type RngStream } from '../../../../src/core/rng/registry';
import { findTraceNodes, type Traced } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  MATCH_RATING_STREAM,
  NO_VARIANCE_NOTE,
  PROMO_VARIANCE_LABEL,
  speakerScore,
  workerPerformance,
  type SpeakerScoreSide,
  type SpeakerScoreSpeaker,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectRollRecorded,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

const TUNABLES = createEngineTunables();
const PROMO = { name: 'Promo', speakerWeights: { mic: 0.5, charisma: 0.3, presence: 0.2 } };

function stream(seed: string): RngStream {
  return new RngRegistry(seed).stream(MATCH_RATING_STREAM);
}

/** A speaker with mic, charisma and presence all at `level`. */
function speaker(id: string, level: number): SpeakerScoreSpeaker {
  const name = `Speaker ${id}`;
  const talk = workerPerformance(
    {
      personId: id,
      name,
      axis: 'talk',
      attributes: {
        ringwork: 50,
        psychology: 50,
        athleticism: 50,
        safety: 50,
        mic: level,
        charisma: level,
        presence: level,
      },
      style: 'technician',
      fatigue: 0,
      injured: false,
      styleAffinity: [],
      talkWeights: PROMO.speakerWeights,
      angleTypeName: PROMO.name,
    },
    { tunables: TUNABLES },
  );
  return { id, name, talk };
}

function talk(
  sides: readonly SpeakerScoreSide[],
  overrides: TunableOverrides = {},
  rng?: RngStream,
): Traced<number> {
  const result = speakerScore(
    { angleType: PROMO, sides },
    { tunables: createEngineTunables(overrides), ...(rng === undefined ? {} : { rng }) },
  );
  expectTraceReplays(result);
  return result;
}

describe('speakerScore', () => {
  it("equals the speaker's talk with one speaker", () => {
    const solo = speaker('a', 72);
    const result = talk([{ side: 0, members: [solo] }]);
    expect(result.value).toBe(solo.talk.value);
    expect(result.value).toBeCloseTo(72, 9);
    expect(result.trace.label).toBe('Talk: Promo');
    expectTraceContains(result, { kind: 'note', label: NO_VARIANCE_NOTE });
    expectTraceContains(result, {
      kind: 'note',
      label: 'Speaker weights set by Promo: mic 0.5, charisma 0.3, presence 0.2',
    });
  });

  it('side-aggregates each side, then across sides', () => {
    // Side 1: 80 and 40 at decay 0.55 → 80 × 1/1.55 + 40 × 0.55/1.55 = 65.81.
    // Across: 65.81 and 50 at decay 0.7 → 65.81 × 1/1.7 + 50 × 0.7/1.7 = 59.3.
    const result = talk([
      { side: 0, members: [speaker('a', 40), speaker('b', 80)] },
      { side: 1, members: [speaker('c', 50)] },
    ]);
    const sideOne = 80 / 1.55 + (40 * 0.55) / 1.55;
    expect(result.value).toBeCloseTo(sideOne / 1.7 + (50 * 0.7) / 1.7, 9);
  });

  it('rolls how the promo landed only with an rng, and stays within 0..100', () => {
    const rolled = talk([{ side: 0, members: [speaker('a', 60)] }], {}, stream('promo'));
    const roll = expectRollRecorded(rolled, MATCH_RATING_STREAM);
    expect(roll.label).toBe(PROMO_VARIANCE_LABEL);
    expect(rolled.value).toBeCloseTo(60 + Number(roll.result), 9);
    const top = talk(
      [{ side: 0, members: [speaker('a', 100)] }],
      { 'match.angle.varianceSd': 20 },
      stream('top'),
    );
    expect(top.value).toBeLessThanOrEqual(100);
    expect(findTraceNodes(talk([{ side: 0, members: [speaker('a', 60)] }]).trace, 'roll')).toEqual(
      [],
    );
  });

  it('gives 0 for speakers with nothing to say', () => {
    expect(talk([{ side: 0, members: [speaker('a', 0), speaker('b', 0)] }]).value).toBe(0);
  });

  it('refuses a segment with no sides', () => {
    expect(() => talk([])).toThrow(/sides/);
  });
});
