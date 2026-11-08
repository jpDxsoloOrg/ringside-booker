import { describe, expect, it } from 'vitest';
import { StorylineSchema } from '../../../src/model/entities/storyline';
import {
  check,
  date,
  emptyShowWorld,
  makeMatch,
  makeStoryline,
  personId,
  promotionId,
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
