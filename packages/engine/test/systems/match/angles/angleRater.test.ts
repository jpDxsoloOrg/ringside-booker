// The beat rater (MTCH5-03): the only angle rater, for every promotion, on stored segments.
// Design: docs/design/angle-rating.md#the-beat-rater
import { afterEach, describe, expect, it } from 'vitest';
import type { SegmentId } from '../../../../src/core/ids';
import { RngRegistry } from '../../../../src/core/rng/registry';
import { constantOf, findTraceNodes, type TraceNode } from '../../../../src/core/trace';
import type { AngleBeat } from '../../../../src/model/entities/segment';
import {
  ANGLE_STREAM,
  beatAngleRater,
  NO_BEAT_CATALOG_NOTE,
  rateSegment,
  ratingInputFromSegment,
  resetMatchRegistriesForTests,
  segmentRaterFor,
  type SegmentRatingResult,
} from '../../../../src/systems/match';
import {
  clearRatingPolicyProvider,
  NEUTRAL_RATING_POLICY,
  registerRatingPolicyProvider,
} from '../../../../src/systems/match/rating/policy';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { anAngle, aParticipant } from '../../../support/builders/creative';
import type { WorldBuilder } from '../../../support/world-builder';
import { angleWorld, PROMO, PROMO_TYPE, WAR_OF_WORDS, type AngleWorld } from './angle-world';

afterEach(() => {
  resetMatchRegistriesForTests();
});

interface StoredAngle {
  readonly label: 'A' | 'B';
  /** Roster indexes (across both promotions) on side 0 and side 1. */
  readonly sides: readonly [readonly number[], readonly number[]];
  /** Each beat's roster indexes, in stored order. */
  readonly beats: readonly { beatKey: AngleBeat['beatKey']; people: readonly number[] }[];
  readonly preShow?: boolean;
}

/** A show for each promotion, then the given angles on them (with one pre-show slot each). */
function withAngles(angles: readonly StoredAngle[]): (builder: WorldBuilder) => WorldBuilder {
  return (builder) =>
    builder
      .withEventInstance({ format: { slots: 6, preShowSlots: 1 } }, 'A')
      .withEventInstance({ format: { slots: 6, preShowSlots: 1 } }, 'B')
      .with('angles', (context) => {
        const person = (index: number) => {
          const id = context.ids.people[index];
          if (id === undefined) {
            throw new Error(`no person ${String(index)}`);
          }
          return id;
        };
        for (const angle of angles) {
          const show = context.ids.eventInstances[angle.label === 'A' ? 0 : 1];
          if (show === undefined) {
            throw new Error('no show');
          }
          const segment = context.insert(
            'segments',
            anAngle(
              {
                eventInstanceId: show,
                preShow: angle.preShow ?? false,
                ...(angle.preShow === true ? { slot: 0 } : {}),
                angle: {
                  angleTypeKey: PROMO_TYPE,
                  beats: angle.beats.map((beat) => ({
                    beatKey: beat.beatKey,
                    personIds: beat.people.map(person),
                  })),
                },
              },
              context.sequence,
            ),
          );
          for (const [side, members] of angle.sides.entries()) {
            for (const index of members) {
              context.insert(
                'participants',
                aParticipant(
                  { segmentId: segment.id, personId: person(index), side, role: 'speaker' },
                  context.sequence,
                ),
              );
            }
          }
        }
      });
}

function segmentAt(setup: AngleWorld, index: number): SegmentId {
  const id = setup.ids.segments[index];
  if (id === undefined) {
    throw new Error(`no segment ${String(index)}`);
  }
  return id;
}

function rateStored(setup: AngleWorld, segmentId: SegmentId): SegmentRatingResult {
  const result = rateSegment(ratingInputFromSegment(setup.world, segmentId), {
    read: setup.world,
    tunables: createEngineTunables(),
    mode: 'live',
    seed: segmentId,
    rng: new RngRegistry('angle-rater').stream(ANGLE_STREAM),
  });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.data;
}

function notes(node: TraceNode): string[] {
  return findTraceNodes(node, 'note').map((note) => note.label);
}

/** War of words between roster 0 (side 0) and roster 1 (side 1), closed by a promo from 0. */
const FEUD: StoredAngle = {
  label: 'A',
  sides: [[0], [1]],
  beats: [
    { beatKey: WAR_OF_WORDS, people: [0, 1] },
    { beatKey: PROMO, people: [0] },
  ],
};

describe('the beat rater', () => {
  it('is the one angle rater, also after a registry reset', () => {
    expect(segmentRaterFor('angle')).toBe(beatAngleRater);
    resetMatchRegistriesForTests();
    expect(segmentRaterFor('angle')).toBe(beatAngleRater);
  });

  it('rates a stored angle through the registry, splitting a two-group beat by side', () => {
    const setup = angleWorld(withAngles([FEUD]));
    const result = rateStored(setup, segmentAt(setup, 0));
    expect(result.kind).toBe('angle');
    const angle = result.angle;
    expect(angle).toBeDefined();
    const [war, promo] = angle?.beats ?? [];
    expect(war?.groups.map((group) => group.people.map((person) => person.personId))).toEqual([
      [setup.wrestlers[0]],
      [setup.wrestlers[1]],
    ]);
    expect(promo?.groups.map((group) => group.label)).toEqual(['Speaker']);
    expect(result.talk?.value).toBe(angle?.delivered.value);
    expect(Number.isInteger(result.score.value)).toBe(true);
    expect(result.workers.map((worker) => worker.personId)).toEqual([
      setup.wrestlers[0],
      setup.wrestlers[1],
    ]);
  });

  it('rates an over-limit stored angle on its first beats, with a note, never throwing', () => {
    const setup = angleWorld(
      withAngles([
        {
          ...FEUD,
          preShow: true,
          beats: [...FEUD.beats, { beatKey: PROMO, people: [1] }],
        },
      ]),
    );
    const result = rateStored(setup, segmentAt(setup, 0));
    expect(result.slot.durationClass).toBe('short');
    expect(result.angle?.beats.map((beat) => beat.counted)).toEqual([true, true, false]);
    expect(result.angle?.beats[2]?.score).toBeNull();
    expect(notes(result.score.trace)).toContain('Only the first 2 beats count in a short slot');
  });

  it('reads the beats earlier on the card: pre-show first', () => {
    const setup = angleWorld(
      withAngles([
        FEUD,
        { label: 'A', sides: [[2], []], beats: [{ beatKey: PROMO, people: [2] }], preShow: true },
      ]),
    );
    const main = ratingInputFromSegment(setup.world, segmentAt(setup, 0));
    expect(main.angle?.earlierBeatKeysOnCard).toEqual([PROMO]);
    const preShow = ratingInputFromSegment(setup.world, segmentAt(setup, 1));
    expect(preShow.angle?.earlierBeatKeysOnCard).toEqual([]);
  });

  it('rates a computer-run promotion by the same rules; policy lines come from the provider', () => {
    const rivalFeud: StoredAngle = { ...FEUD, label: 'B', sides: [[4], [5]] };
    const rivalBeats = rivalFeud.beats.map((beat) => ({
      ...beat,
      people: beat.people.map((index) => index + 4),
    }));
    const setup = angleWorld(withAngles([{ ...rivalFeud, beats: rivalBeats }]));
    const segmentId = segmentAt(setup, 0);

    clearRatingPolicyProvider();
    const neutral = rateStored(setup, segmentId);
    expect(neutral.policy.label).toBe(NEUTRAL_RATING_POLICY.label);
    expect(neutral.angle?.beats).toHaveLength(2);

    registerRatingPolicyProvider(
      (_read, _tunables, promotionId) =>
        promotionId === setup.rival
          ? {
              ...NEUTRAL_RATING_POLICY,
              scoreBonus: constantOf('Score bonus', 5, 'Test shortcut'),
              label: 'Test shortcuts',
              lines: ['Test bonus'],
            }
          : NEUTRAL_RATING_POLICY,
      { id: 'test.policy' },
    );
    const shortcut = rateStored(setup, segmentId);
    expect(shortcut.policy.label).toBe('Test shortcuts');
    const bonusLines = findTraceNodes(shortcut.score.trace, 'add').filter(
      (node) => node.label === 'Test bonus +5',
    );
    expect(bonusLines).toHaveLength(1);
    // Everything before the bonus is the same: the beats and delivered do not change.
    expect(shortcut.angle?.delivered).toEqual(neutral.angle?.delivered);
    expect(shortcut.score.value).toBeGreaterThanOrEqual(neutral.score.value);
  });

  it('falls back to the simple rater on a save without a beat catalog, with a note', () => {
    const setup = angleWorld(withAngles([FEUD]));
    const dropped = setup.world.transact('drop beats', (tx) => {
      const { beats: _beats, ...catalogs } = setup.world.meta.catalogs;
      tx.setMeta({ catalogs });
    });
    if (!dropped.ok) {
      throw dropped.error;
    }
    const result = rateStored(setup, segmentAt(setup, 0));
    expect(result.angle).toBeUndefined();
    expect(notes(result.score.trace)).toContain(NO_BEAT_CATALOG_NOTE);
  });
});
