// The stored-segment adapter (MTCH1-05): the tiny world's segments as rating inputs.
// Design: docs/design/match-rating.md#the-stored-segment-adapter
import { describe, expect, it } from 'vitest';
import { EntityNotFoundError } from '../../../../src/core/errors';
import { parseId } from '../../../../src/core/ids';
import { isMatch } from '../../../../src/model/entities/segment';
import { ratingInputFromSegment } from '../../../../src/systems/match';
import { personAt, tinyRating } from './fixtures';

describe('ratingInputFromSegment', () => {
  it('round-trips every tiny world segment: kind, type, sides, slot and show', () => {
    const { world } = tinyRating();
    for (const segment of world.tables.segments.values()) {
      const input = ratingInputFromSegment(world, segment.id);
      const show = world.tables.eventInstances.require(segment.eventInstanceId);
      const role = isMatch(segment) ? 'competitor' : 'speaker';
      const cast = world.tables.participants
        .lookup('bySegment', segment.id)
        .filter((participant) => participant.role === role);

      expect(input.kind).toBe(segment.kind);
      expect(input.typeKey).toBe(
        isMatch(segment) ? segment.match.matchTypeKey : segment.angle.angleTypeKey,
      );
      expect(input.sides.flatMap((side) => side.personIds).sort()).toEqual(
        cast.map((participant) => participant.personId).sort(),
      );
      for (const side of input.sides) {
        for (const personId of side.personIds) {
          expect(cast.find((participant) => participant.personId === personId)?.side).toBe(
            side.side,
          );
        }
      }
      expect(input.slot).toEqual({
        slot: segment.slot + 1,
        slots: show.format.slots,
        preShow: segment.preShow,
      });
      expect(input.event).toEqual({
        importance: show.importance,
        regionId: show.regionId,
        televised: true,
        date: show.date,
      });
      expect(input.promotionId).toBe(show.promotionId);
    }
  });

  it('maps the title match to people[0] against people[1] and the promo to its speakers', () => {
    const { world, mainEvent, promo, people } = tinyRating();
    expect(ratingInputFromSegment(world, mainEvent.id).sides).toEqual([
      { side: 0, personIds: [personAt(people, 0)] },
      { side: 1, personIds: [personAt(people, 1)] },
    ]);
    expect(ratingInputFromSegment(world, promo.id)).toMatchObject({
      kind: 'angle',
      sides: [
        { side: 0, personIds: [personAt(people, 0)] },
        { side: 1, personIds: [personAt(people, 1)] },
      ],
    });
  });

  it('orders a side by entrance order, then id, and leaves out other roles', () => {
    const { world, mainEvent, people } = tinyRating();
    const cast = world.tables.participants.lookup('bySegment', mainEvent.id);
    const result = world.transact('regroup', (tx) => {
      for (const [index, participant] of cast.entries()) {
        tx.update('participants', participant.id, { side: 0, entranceOrder: 2 - index });
      }
    });
    if (!result.ok) {
      throw result.error;
    }
    expect(ratingInputFromSegment(world, mainEvent.id).sides).toEqual([
      { side: 0, personIds: [personAt(people, 1), personAt(people, 0)] },
    ]);
    const asRingside = world.transact('ringside', (tx) => {
      const first = cast[0];
      if (first !== undefined) {
        tx.update('participants', first.id, { role: 'ringside' });
      }
    });
    if (!asRingside.ok) {
      throw asRingside.error;
    }
    expect(ratingInputFromSegment(world, mainEvent.id).sides).toEqual([
      { side: 0, personIds: [personAt(people, 1)] },
    ]);
  });

  it('throws for a segment that does not exist', () => {
    const { world } = tinyRating();
    expect(() => ratingInputFromSegment(world, parseId('segment', 'seg_9999999999'))).toThrow(
      EntityNotFoundError,
    );
  });
});
