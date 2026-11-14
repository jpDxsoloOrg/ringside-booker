// Which old segments the history roll-up keeps (POL4-08): a storyline's finale stays (CRTV3-01).
// Design: docs/design/save-format.md#history-retention
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import { segmentsToKeep } from '../../../src/systems/history/keep';
import { createEngineTunables } from '../../../src/systems/tunables';
import { worldBuilder } from '../../support/world-builder';

function worldWithUnratedMatch(asFinale: boolean) {
  return worldBuilder()
    .withGeography('mini')
    .withPromotion({}, (promotion) =>
      promotion.withRoster(2).withStoryline(
        { name: 'Test Feud' },
        {
          members: [
            [0, 'face'],
            [1, 'heel'],
          ],
        },
      ),
    )
    .withEventInstance()
    .withCompletedMatch({ show: 0, sides: [[0], [1]], result: null, run: false })
    .with('link the match', ({ tx, ids }) => {
      const [storylineId] = ids.storylines;
      const [segmentId] = ids.segments;
      if (storylineId === undefined || segmentId === undefined) throw new Error('missing rows');
      tx.update('segments', segmentId, { storylineIds: [storylineId] });
      if (asFinale) {
        tx.update('storylines', storylineId, { finaleSegmentId: segmentId });
      }
    })
    .build();
}

describe('segmentsToKeep', () => {
  it("keeps a storyline's finale segment whatever its age", () => {
    for (const asFinale of [false, true]) {
      const { world, ids } = worldWithUnratedMatch(asFinale);
      const keep = segmentsToKeep(
        world,
        addDays(world.meta.startDate, 400),
        createEngineTunables(),
      );
      expect(keep.has(ids.segments[0]!), String(asFinale)).toBe(asFinale);
    }
  });
});
