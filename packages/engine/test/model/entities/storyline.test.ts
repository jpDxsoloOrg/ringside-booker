import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_STORYLINE_PROGRESS,
  StorylineSchema,
  type StorylinePayoffRecord,
  type StorylineProgress,
} from '../../../src/model/entities/storyline';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import { loadSave } from '../../../src/persistence/load';
import { documentToWorld } from '../../../src/persistence/world-document';
import {
  check,
  date,
  emptyShowWorld,
  idOf,
  makeAngle,
  makeInstance,
  makeMatch,
  segmentId,
  makeStoryline,
  personId,
  promotionId,
  putSinglesMatch,
  storylineId,
} from '../../support/show-world';

describe('StorylineSchema', () => {
  it('accepts a valid storyline', () => {
    expect(StorylineSchema.safeParse(makeStoryline(1)).success).toBe(true);
  });

  it('requires endedOn exactly when the storyline has ended', () => {
    expect(StorylineSchema.safeParse(makeStoryline(1, { status: 'ended' })).success).toBe(false);
    expect(
      StorylineSchema.safeParse(makeStoryline(1, { endedOn: date('2026-02-01') })).success,
    ).toBe(false);
    expect(
      StorylineSchema.safeParse(makeStoryline(1, { status: 'ended', endedOn: date('2026-02-01') }))
        .success,
    ).toBe(true);
  });

  it('rejects an end before the start', () => {
    const storyline = makeStoryline(1, {
      status: 'ended',
      startedOn: date('2026-02-01'),
      endedOn: date('2026-01-01'),
    });
    expect(StorylineSchema.safeParse(storyline).success).toBe(false);
  });

  it('allows 1-12 unique members', () => {
    const withMembers = (count: number): unknown =>
      makeStoryline(1, {
        members: Array.from({ length: count }, (_unused, index) => ({
          personId: personId(index + 1),
          side: 'neutral' as const,
        })),
      });
    expect(StorylineSchema.safeParse(withMembers(0)).success).toBe(false);
    expect(StorylineSchema.safeParse(withMembers(1)).success).toBe(true);
    expect(StorylineSchema.safeParse(withMembers(12)).success).toBe(true);
    expect(StorylineSchema.safeParse(withMembers(13)).success).toBe(false);
    const duplicate = makeStoryline(1, {
      members: [
        { personId: personId(1), side: 'face' },
        { personId: personId(1), side: 'heel' },
      ],
    });
    expect(StorylineSchema.safeParse(duplicate).success).toBe(false);
  });

  it('defaults lastProgressOn and finaleSegmentId to null when a row leaves them out', () => {
    const older: Record<string, unknown> = { ...makeStoryline(1) };
    delete older['lastProgressOn'];
    delete older['finaleSegmentId'];
    const parsed = StorylineSchema.parse(older);
    expect(parsed.lastProgressOn).toBeNull();
    expect(parsed.finaleSegmentId).toBeNull();
  });

  it('rejects progress before the start', () => {
    const start = date('2026-02-01');
    expect(
      StorylineSchema.safeParse(makeStoryline(1, { startedOn: start, lastProgressOn: start }))
        .success,
    ).toBe(true);
    expect(
      StorylineSchema.safeParse(
        makeStoryline(1, { startedOn: start, lastProgressOn: date('2026-01-31') }),
      ).success,
    ).toBe(false);
  });

  it('caps the summary at 500 characters', () => {
    expect(StorylineSchema.safeParse(makeStoryline(1, { summary: 'x'.repeat(500) })).success).toBe(
      true,
    );
    expect(StorylineSchema.safeParse(makeStoryline(1, { summary: 'x'.repeat(501) })).success).toBe(
      false,
    );
  });
});

describe('storyline progress and payoff (CRTV4-01)', () => {
  const entry = (day: string, serial = 1): StorylineProgress => ({
    segmentId: segmentId(serial),
    eventInstanceId: idOf('eventInstance', 'evi', 1),
    date: date(day),
    heatBefore: 40,
    heatAfter: 45,
    traceId: null,
  });
  const payoff = (): StorylinePayoffRecord => ({
    paid: true,
    on: date('2026-03-01'),
    countedSegments: 4,
    heat: 72,
    members: [{ personId: personId(1), popularityDelta: 2, momentumDelta: 1, skipped: false }],
    traceId: null,
  });

  it('accepts progress in date order and refuses it going backwards', () => {
    expect(
      StorylineSchema.safeParse(
        makeStoryline(1, {
          progress: [entry('2026-01-05'), entry('2026-01-05'), entry('2026-02-01')],
        }),
      ).success,
    ).toBe(true);
    expect(
      StorylineSchema.safeParse(
        makeStoryline(1, { progress: [entry('2026-02-01'), entry('2026-01-05')] }),
      ).success,
    ).toBe(false);
  });

  it(`keeps at most ${String(MAX_STORYLINE_PROGRESS)} progress entries`, () => {
    const many = (count: number): unknown =>
      makeStoryline(1, { progress: Array.from({ length: count }, () => entry('2026-01-05')) });
    expect(StorylineSchema.safeParse(many(MAX_STORYLINE_PROGRESS)).success).toBe(true);
    expect(StorylineSchema.safeParse(many(MAX_STORYLINE_PROGRESS + 1)).success).toBe(false);
  });

  it('allows a payoff record only once the storyline has ended', () => {
    expect(StorylineSchema.safeParse(makeStoryline(1, { payoff: payoff() })).success).toBe(false);
    expect(
      StorylineSchema.safeParse(
        makeStoryline(1, { status: 'ended', endedOn: date('2026-03-01'), payoff: payoff() }),
      ).success,
    ).toBe(true);
  });

  it('fills both fields in for a row written before them', () => {
    const { progress: _progress, payoff: _payoff, ...older } = makeStoryline(1);
    const parsed = StorylineSchema.parse(older);
    expect(parsed.progress).toEqual([]);
    expect(parsed.payoff).toBeNull();
  });

  it('reports dangling progress segments, shows and payoff members', () => {
    const world = emptyShowWorld();
    world.tables.storylines._put(
      makeStoryline(1, {
        status: 'ended',
        endedOn: date('2026-03-01'),
        progress: [entry('2026-01-05', 9)],
        payoff: { ...payoff(), members: [{ ...payoff().members[0]!, personId: personId(99) }] },
      }),
    );
    expect(
      check(world)
        .issues.map((issue) => `${issue.code} ${issue.path ?? ''}`)
        .sort(),
    ).toEqual([
      'ref.dangling payoff.members[0].personId',
      'ref.dangling progress[0].eventInstanceId',
      'ref.dangling progress[0].segmentId',
    ]);
  });
});

describe('storylines table', () => {
  it('finds storylines by promotion and member, and segments by storyline', () => {
    const world = emptyShowWorld();
    world.tables.storylines._put(makeStoryline(1));
    world.tables.storylines._put(
      makeStoryline(2, { members: [{ personId: personId(3), side: 'heel' }] }),
    );
    world.tables.segments._put(makeMatch(1, { storylineIds: [storylineId(1), storylineId(2)] }));
    expect(world.tables.storylines.lookup('byPromotion', promotionId(1))).toHaveLength(2);
    expect(world.tables.storylines.lookup('byMember', personId(2)).map((row) => row.id)).toEqual([
      storylineId(1),
    ]);
    expect(world.tables.segments.lookup('byStoryline', storylineId(2))).toHaveLength(1);
  });

  it('reports a member who does not exist', () => {
    const world = emptyShowWorld();
    world.tables.storylines._put(
      makeStoryline(1, { members: [{ personId: personId(99), side: 'face' }] }),
    );
    expect(check(world).issues).toEqual([
      expect.objectContaining({ code: 'ref.dangling', path: 'members[0].personId' }),
    ]);
  });
});

function worldWithShow(): ReturnType<typeof emptyShowWorld> {
  const world = emptyShowWorld();
  world.tables.eventInstances._put(makeInstance(1));
  return world;
}

describe('storyline finale (CRTV3-01)', () => {
  it('accepts a finale segment that links the storyline', () => {
    const world = worldWithShow();
    putSinglesMatch(world, 1, { storylineIds: [storylineId(1)] });
    world.tables.storylines._put(makeStoryline(1, { finaleSegmentId: segmentId(1) }));
    expect(check(world).issues).toEqual([]);
  });

  it('flags a finale segment that does not link the storyline (finaleIsLinkedMatch)', () => {
    const world = worldWithShow();
    putSinglesMatch(world, 1, { storylineIds: [] });
    world.tables.storylines._put(makeStoryline(1, { finaleSegmentId: segmentId(1) }));
    expect(check(world).issues).toEqual([
      expect.objectContaining({
        code: 'storylines.finaleIsLinkedMatch',
        table: 'storylines',
        path: 'finaleSegmentId',
      }),
    ]);
  });

  it('reports a finale segment that does not exist as a dangling ref and a broken finale', () => {
    const world = emptyShowWorld();
    world.tables.storylines._put(makeStoryline(1, { finaleSegmentId: segmentId(9) }));
    expect(check(world).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ref.dangling', path: 'finaleSegmentId' }),
        expect.objectContaining({
          code: 'storylines.finaleIsLinkedMatch',
          message: expect.stringContaining('does not exist') as unknown,
        }),
      ]),
    );
    expect(check(world).issues).toHaveLength(2);
  });

  it('flags a finale that links the storyline but is not a match (CRTV4-01)', () => {
    const world = worldWithShow();
    world.tables.segments._put(makeAngle(1, { storylineIds: [storylineId(1)] }));
    world.tables.storylines._put(makeStoryline(1, { finaleSegmentId: segmentId(1) }));
    expect(check(world).issues).toEqual([
      expect.objectContaining({
        code: 'storylines.finaleIsLinkedMatch',
        table: 'storylines',
        path: 'finaleSegmentId',
        message: expect.stringContaining('is not a match') as unknown,
      }),
    ]);
  });

  it('loads a save from before the fields with both null', async () => {
    const before = new URL(
      '../../fixtures/saves/v1-tiny-before-storyline-progress.json',
      import.meta.url,
    );
    const report = await loadSave(new Uint8Array(readFileSync(before)), TABLES);
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    const world = documentToWorld(report.doc, TABLES);
    const storylines = world.tables.storylines.values();
    expect(storylines.length).toBeGreaterThan(0);
    for (const storyline of storylines) {
      expect(storyline.lastProgressOn).toBeNull();
      expect(storyline.finaleSegmentId).toBeNull();
      expect(storyline.progress).toEqual([]);
      expect(storyline.payoff).toBeNull();
    }
    expect(checkWorld(world, TABLES, { validateRows: true }).issues).toEqual([]);
  });
});
