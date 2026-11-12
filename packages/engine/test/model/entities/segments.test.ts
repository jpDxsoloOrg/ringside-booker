import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { UniqueIndexError } from '../../../src/core/errors';
import { ZERO_CENTS } from '../../../src/core/money';
import type { TitleId } from '../../../src/core/ids';
import { EventDefinitionSchema } from '../../../src/model/entities/event-definition';
import { EventInstanceSchema } from '../../../src/model/entities/event-instance';
import { MAX_SIDE, ParticipantSchema } from '../../../src/model/entities/participant';
import {
  isAngle,
  isMatch,
  MatchOutcomeSchema,
  SegmentSchema,
  type Segment,
} from '../../../src/model/entities/segment';
import {
  check,
  emptyShowWorld,
  instanceId,
  issueCodes,
  key,
  makeAngle,
  makeInstance,
  makeMatch,
  makeParticipant,
  makeTitle,
  personId,
  promotionId,
  putSinglesMatch,
  segmentId,
  titleId,
  type ShowWorld,
} from '../../support/show-world';

const COMPLETED_RESULT = {
  score: 60,
  rawScore: 60,
  traceId: null,
  attendance: 900,
  gate: ZERO_CENTS,
  viewers: null,
};

function worldWithInstance(
  format: { slots: number; preShowSlots: number } = { slots: 6, preShowSlots: 2 },
): ShowWorld {
  const world = emptyShowWorld();
  world.tables.eventInstances._put(makeInstance(1, { format }));
  return world;
}

/** Every object key reachable in a zod schema, through objects, unions, arrays and nullables. */
function collectKeys(schema: unknown, found: Set<string>): Set<string> {
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, unknown> = schema.shape;
    for (const [field, child] of Object.entries(shape)) {
      found.add(field);
      collectKeys(child, found);
    }
  } else if (schema instanceof z.ZodUnion) {
    for (const option of schema.options) {
      collectKeys(option, found);
    }
  } else if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    collectKeys(schema.unwrap(), found);
  } else if (schema instanceof z.ZodArray) {
    collectKeys(schema.element, found);
  }
  return found;
}

describe('slots, never minutes (D-10)', () => {
  it('has no field for minutes, length, duration or slot role', () => {
    const keys = new Set<string>();
    collectKeys(EventDefinitionSchema, keys);
    collectKeys(EventInstanceSchema, keys);
    collectKeys(SegmentSchema, keys);
    // The walk reaches nested shapes: the recurrence, the format, both segment kinds and beats.
    expect(keys).toContain('weekdays');
    expect(keys).toContain('preShowSlots');
    expect(keys).toContain('winningSide');
    expect(keys).toContain('beatKey');
    expect([...keys].filter((field) => /minute|length|duration|role/i.test(field))).toEqual([]);
  });
});

describe('SegmentSchema', () => {
  it('accepts a match and an angle', () => {
    expect(SegmentSchema.safeParse(makeMatch(1)).success).toBe(true);
    expect(SegmentSchema.safeParse(makeAngle(2)).success).toBe(true);
  });

  it('rejects a match without its match field', () => {
    const withoutMatch = Object.fromEntries(
      Object.entries(makeMatch(1)).filter(([field]) => field !== 'match'),
    );
    expect(SegmentSchema.safeParse(withoutMatch).success).toBe(false);
  });

  it('rejects an angle carrying a match field', () => {
    const angle = { ...makeAngle(1), match: makeMatch(2).match };
    expect(SegmentSchema.safeParse(angle).success).toBe(false);
  });

  it('rejects a segment without a kind', () => {
    const withoutKind = Object.fromEntries(
      Object.entries(makeMatch(1)).filter(([field]) => field !== 'kind'),
    );
    expect(SegmentSchema.safeParse(withoutKind).success).toBe(false);
  });

  it('rejects an angle beat with any field besides beatKey and personIds', () => {
    const angle = makeAngle(1);
    const beats = [{ beatKey: key('beat.callout'), personIds: [personId(1)], minutes: 3 }];
    expect(SegmentSchema.safeParse({ ...angle, angle: { ...angle.angle, beats } }).success).toBe(
      false,
    );
  });

  it('allows 1-8 beats in an angle', () => {
    const angle = makeAngle(1);
    const beat = { beatKey: key('beat.callout'), personIds: [personId(1)] };
    const withBeats = (count: number): unknown => ({
      ...angle,
      angle: { ...angle.angle, beats: Array.from({ length: count }, () => beat) },
    });
    expect(SegmentSchema.safeParse(withBeats(0)).success).toBe(false);
    expect(SegmentSchema.safeParse(withBeats(8)).success).toBe(true);
    expect(SegmentSchema.safeParse(withBeats(9)).success).toBe(false);
  });

  it('rates in quarter stars from 0 to 5', () => {
    const rated = (stars: number): unknown => ({
      ...makeMatch(1),
      rating: { score: 70, stars, workRate: 68, crowd: 72, expectation: 65, traceId: null },
    });
    expect(SegmentSchema.safeParse(rated(4.1)).success).toBe(false);
    expect(SegmentSchema.safeParse(rated(4.25)).success).toBe(true);
    expect(SegmentSchema.safeParse(rated(0)).success).toBe(true);
    expect(SegmentSchema.safeParse(rated(5)).success).toBe(true);
    expect(SegmentSchema.safeParse(rated(5.25)).success).toBe(false);
  });

  it('allows at most four announcers', () => {
    const crew = {
      refereeId: null,
      producerId: null,
      announcerIds: [personId(1), personId(2), personId(3), personId(4), personId(5)],
    };
    expect(SegmentSchema.safeParse({ ...makeMatch(1), crew }).success).toBe(false);
  });

  it('types outcomes as a union', () => {
    const outcome = (value: unknown): unknown => ({ ...makeMatch(1), outcome: value });
    expect(SegmentSchema.safeParse(outcome({ kind: 'draw' })).success).toBe(true);
    expect(SegmentSchema.safeParse(outcome({ kind: 'noContest' })).success).toBe(true);
    expect(
      SegmentSchema.safeParse(
        outcome({ kind: 'win', winningSide: 1, methodKey: key('method.pinfall') }),
      ).success,
    ).toBe(true);
    expect(SegmentSchema.safeParse(outcome({ kind: 'win', winningSide: 1 })).success).toBe(false);
    expect(SegmentSchema.safeParse(outcome({ kind: 'draw', winningSide: 0 })).success).toBe(false);
  });

  it('narrows with isMatch and isAngle', () => {
    const segments: Segment[] = [
      makeMatch(1, { match: { ...makeMatch(1).match, titleIds: [titleId(1)] } }),
      makeAngle(2),
    ];
    const titleIds: TitleId[] = [];
    for (const segment of segments) {
      if (isMatch(segment)) {
        expectTypeOf(segment.match.titleIds).toEqualTypeOf<TitleId[]>();
        // @ts-expect-error -- a match segment has no angle field
        expect(segment.angle).toBeUndefined();
        titleIds.push(...segment.match.titleIds);
      } else {
        expectTypeOf(segment.angle.beats).toBeArray();
      }
    }
    expect(titleIds).toEqual([titleId(1)]);
    expect(segments.filter(isAngle).map((segment) => segment.angle.angleTypeKey)).toEqual([
      key('angle.promo'),
    ]);
  });
});

describe('ParticipantSchema', () => {
  it('accepts sides 0-29 only, so a 30-person battle royal fits', () => {
    expect(MAX_SIDE).toBe(29);
    expect(ParticipantSchema.safeParse(makeParticipant(1, { side: 7 })).success).toBe(true);
    expect(ParticipantSchema.safeParse(makeParticipant(1, { side: 29 })).success).toBe(true);
    expect(ParticipantSchema.safeParse(makeParticipant(1, { side: 30 })).success).toBe(false);
    expect(ParticipantSchema.safeParse(makeParticipant(1, { side: -1 })).success).toBe(false);
  });

  it('lets a win name side 29 and refuses side 30', () => {
    const win = (winningSide: number) => ({
      kind: 'win',
      winningSide,
      methodKey: key('method.pinfall'),
    });
    expect(MatchOutcomeSchema.safeParse(win(29)).success).toBe(true);
    expect(MatchOutcomeSchema.safeParse(win(30)).success).toBe(false);
  });
});

describe('card slots', () => {
  it('accepts a full, contiguous card', () => {
    const world = worldWithInstance();
    for (let slot = 0; slot < 6; slot += 1) {
      putSinglesMatch(world, slot + 1, { slot });
    }
    expect(check(world)).toEqual({ ok: true, issues: [], truncated: 0 });
    expect(world.tables.segments.lookup('byEventInstance', instanceId(1))).toHaveLength(6);
  });

  it('rejects two main-card segments in slot 2 with bySlot', () => {
    const world = worldWithInstance();
    world.tables.segments._put(makeMatch(1, { slot: 2 }));
    expect(() => {
      world.tables.segments._put(makeAngle(2, { slot: 2 }));
    }).toThrow(UniqueIndexError);
  });

  it('allows pre-show slot 0 alongside main-card slot 0', () => {
    const world = worldWithInstance();
    putSinglesMatch(world, 1, { slot: 0, preShow: false });
    putSinglesMatch(world, 2, { slot: 0, preShow: true });
    expect(check(world).ok).toBe(true);
  });

  it('reports main-card slots 0, 1, 3 as not contiguous', () => {
    const world = worldWithInstance();
    putSinglesMatch(world, 1, { slot: 0 });
    putSinglesMatch(world, 2, { slot: 1 });
    putSinglesMatch(world, 3, { slot: 3 });
    const report = check(world);
    expect(issueCodes(report)).toEqual(['segments.slotsNotContiguous']);
    expect(report.issues[0]).toEqual(
      expect.objectContaining({ table: 'eventInstances', id: instanceId(1) }),
    );
  });

  it('reports a pre-show that does not start at slot 0', () => {
    const world = worldWithInstance();
    putSinglesMatch(world, 1, { slot: 1, preShow: true });
    expect(issueCodes(check(world))).toEqual(['segments.slotsNotContiguous']);
  });

  it('reports 7 main-card segments on a 6-slot instance', () => {
    const world = worldWithInstance({ slots: 6, preShowSlots: 0 });
    for (let slot = 0; slot < 7; slot += 1) {
      putSinglesMatch(world, slot + 1, { slot });
    }
    expect(issueCodes(check(world))).toEqual(['segments.tooManyMainCard']);
  });

  it('reports 3 pre-show segments on an instance with 2 pre-show slots', () => {
    const world = worldWithInstance({ slots: 6, preShowSlots: 2 });
    for (let slot = 0; slot < 3; slot += 1) {
      putSinglesMatch(world, slot + 1, { slot, preShow: true });
    }
    expect(issueCodes(check(world))).toEqual(['segments.tooManyPreShow']);
  });
});

describe('participants and sides', () => {
  it('reports a winningSide that has no competitor', () => {
    const world = worldWithInstance();
    world.tables.eventInstances._put(
      makeInstance(1, { status: 'completed', result: COMPLETED_RESULT }),
    );
    putSinglesMatch(world, 1, {
      outcome: { kind: 'win', winningSide: 3, methodKey: key('method.pinfall') },
    });
    const report = check(world);
    expect(issueCodes(report)).toEqual(['segments.winningSideWithoutCompetitor']);
    expect(report.issues[0]?.path).toBe('outcome.winningSide');
  });

  it('accepts a winningSide that has a competitor', () => {
    const world = worldWithInstance();
    world.tables.eventInstances._put(
      makeInstance(1, { status: 'completed', result: COMPLETED_RESULT }),
    );
    putSinglesMatch(world, 1, {
      outcome: { kind: 'win', winningSide: 1, methodKey: key('method.pinfall') },
      rating: { score: 72, stars: 3.5, workRate: 70, crowd: 74, expectation: 66, traceId: null },
    });
    expect(check(world).ok).toBe(true);
  });

  it('does not count a ringside manager as a competing side', () => {
    const world = worldWithInstance();
    world.tables.segments._put(makeMatch(1));
    world.tables.participants._put(makeParticipant(1, { personId: personId(1), side: 0 }));
    world.tables.participants._put(
      makeParticipant(2, { personId: personId(2), side: 1, role: 'ringside' }),
    );
    expect(issueCodes(check(world))).toEqual(['segments.tooFewSides']);
  });

  it('reports a match with competitors on only one side', () => {
    const world = worldWithInstance();
    world.tables.segments._put(makeMatch(1));
    world.tables.participants._put(makeParticipant(1, { personId: personId(1), side: 0 }));
    world.tables.participants._put(makeParticipant(2, { personId: personId(2), side: 0 }));
    expect(issueCodes(check(world))).toEqual(['segments.tooFewSides']);
  });

  it('does not ask an angle for competing sides', () => {
    const world = worldWithInstance();
    world.tables.segments._put(makeAngle(1));
    world.tables.participants._put(makeParticipant(1, { role: 'speaker' }));
    expect(check(world).ok).toBe(true);
  });

  it('rejects the same person twice in one segment with bySegmentPerson', () => {
    const world = worldWithInstance();
    world.tables.segments._put(makeMatch(1));
    world.tables.participants._put(makeParticipant(1, { personId: personId(1), side: 0 }));
    expect(() => {
      world.tables.participants._put(makeParticipant(2, { personId: personId(1), side: 1 }));
    }).toThrow(UniqueIndexError);
  });

  it('finds every segment a person was in with byPerson', () => {
    const world = worldWithInstance();
    putSinglesMatch(world, 1, { slot: 0 });
    putSinglesMatch(world, 2, { slot: 1 });
    const segmentIds = world.tables.participants
      .lookup('byPerson', personId(1))
      .map((participant) => participant.segmentId);
    expect(segmentIds).toEqual([segmentId(1), segmentId(2)]);
  });
});

describe('segments against their instance', () => {
  it('reports a rating or outcome before the show is completed', () => {
    const world = worldWithInstance();
    putSinglesMatch(world, 1, { slot: 0, outcome: { kind: 'draw' } });
    world.tables.segments._put(
      makeAngle(2, {
        slot: 1,
        rating: { score: 50, stars: 2, workRate: null, crowd: 52, expectation: 48, traceId: null },
      }),
    );
    expect(issueCodes(check(world))).toEqual([
      'segments.resultBeforeCompletion',
      'segments.resultBeforeCompletion',
    ]);
  });

  it('reports a title from another promotion', () => {
    const world = worldWithInstance();
    world.tables.titles._put(makeTitle(1, { promotionId: promotionId(2) }));
    putSinglesMatch(world, 1, {
      match: { ...makeMatch(1).match, titleIds: [titleId(1)] },
    });
    const report = check(world);
    expect(issueCodes(report)).toEqual(['segments.titleFromOtherPromotion']);
    expect(report.issues[0]?.path).toBe('match.titleIds[0]');
  });

  it('finds title matches with byTitle', () => {
    const world = worldWithInstance();
    world.tables.titles._put(makeTitle(1));
    putSinglesMatch(world, 1, { match: { ...makeMatch(1).match, titleIds: [titleId(1)] } });
    expect(world.tables.segments.lookup('byTitle', titleId(1))).toHaveLength(1);
    expect(check(world).ok).toBe(true);
  });

  it('reports dangling crew and beat references with their paths', () => {
    const world = worldWithInstance();
    world.tables.segments._put(
      makeAngle(1, {
        crew: { refereeId: null, producerId: null, announcerIds: [personId(99)] },
        angle: {
          angleTypeKey: key('angle.promo'),
          beats: [{ beatKey: key('beat.callout'), personIds: [personId(1), personId(98)] }],
        },
      }),
    );
    expect(check(world).issues.map((issue) => issue.path)).toEqual([
      'crew.announcerIds[0]',
      'angle.beats[0].personIds[1]',
    ]);
  });
});
