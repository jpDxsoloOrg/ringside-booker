import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StorylineSchema } from '../../../src/model/entities/storyline';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import { loadSave } from '../../../src/persistence/load';
import { documentToWorld } from '../../../src/persistence/world-document';
import {
  check,
  date,
  emptyShowWorld,
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

  it('flags a finale segment that does not link the storyline (finaleIsLinked)', () => {
    const world = worldWithShow();
    putSinglesMatch(world, 1, { storylineIds: [] });
    world.tables.storylines._put(makeStoryline(1, { finaleSegmentId: segmentId(1) }));
    expect(check(world).issues).toEqual([
      expect.objectContaining({
        code: 'storylines.finaleIsLinked',
        table: 'storylines',
        path: 'finaleSegmentId',
      }),
    ]);
  });

  it('reports a finale segment that does not exist as a dangling ref', () => {
    const world = emptyShowWorld();
    world.tables.storylines._put(makeStoryline(1, { finaleSegmentId: segmentId(9) }));
    expect(check(world).issues).toEqual([
      expect.objectContaining({ code: 'ref.dangling', path: 'finaleSegmentId' }),
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
    }
    expect(checkWorld(world, TABLES, { validateRows: true }).issues).toEqual([]);
  });
});
