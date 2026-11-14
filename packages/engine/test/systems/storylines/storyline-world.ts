// A two-promotion world for the storylines tests (CRTV3-01). Design: docs/design/storylines.md
import {
  controllerViewer,
  createEngine,
  initialEngineState,
  type Engine,
} from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { QueryResult } from '../../../src/core/api/result';
import { addDays } from '../../../src/core/date';
import { storylinesSystem } from '../../../src/systems/storylines';
import { TEST_PLAYER_ID, TEST_START_DATE, worldBuilder, type BuiltWorld } from '../../support';

export const PLAYER_VIEWER = controllerViewer({ kind: 'human', playerId: TEST_PLAYER_ID });

/** The day the second show is on. */
export const SECOND_SHOW_DATE = addDays(TEST_START_DATE, 7);

/**
 * Promotion A is the player's: four wrestlers (`people[0..3]`), person 3 released, and three
 * storylines: `Test Cold Feud` (heat 40), `Test Hot Feud` (heat 85) and `Test Old Feud` (ended).
 * Promotion B is a rival with three wrestlers (`people[4..6]`) and one storyline, `Test Rival
 * Feud` (heat 90), that names person 0 as well. Two shows of A, on the start date and a week
 * later; `segments[0]` runs on the second show and `segments[1]` on the first, both linked to the
 * hot feud, with `segments[0]` its finale.
 */
export function storylineWorld(): BuiltWorld {
  return worldBuilder()
    .withGeography('mini')
    .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } }, (promotion) =>
      promotion
        .withRoster(4, {
          employment: (index) =>
            index === 3 ? { status: 'released', endedOn: TEST_START_DATE } : {},
        })
        .withStoryline(
          { name: 'Test Cold Feud', heat: 40 },
          {
            members: [
              [1, 'heel'],
              [0, 'face'],
              [2, 'neutral'],
            ],
          },
        )
        .withStoryline(
          { name: 'Test Hot Feud', heat: 85, summary: 'Two rivals.' },
          {
            members: [
              [0, 'face'],
              [1, 'heel'],
              [3, 'heel'],
            ],
          },
        )
        .withStoryline(
          {
            name: 'Test Old Feud',
            heat: 30,
            status: 'ended',
            endedOn: addDays(TEST_START_DATE, 3),
          },
          { members: [[2, 'face']] },
        ),
    )
    .withPromotion({}, (promotion) =>
      promotion
        .withRoster(3)
        .withStoryline({ name: 'Test Rival Feud', heat: 90 }, { members: [[0, 'heel']] }),
    )
    .withEventInstance({ name: 'Test Show One' })
    .withEventInstance({ name: 'Test Show Two', date: SECOND_SHOW_DATE })
    .withCompletedMatch({ show: 1, sides: [[0], [1]], result: 0 })
    .withCompletedMatch({ show: 0, sides: [[1], [0]], result: 1, slot: 2 })
    .with('link the feud', ({ tx, ids }) => {
      const hot = ids.storylines[1]!;
      const rival = ids.storylines[3]!;
      // The rival storyline names person 0 too, but on its own promotion's member.
      tx.update('storylines', rival, {
        members: [
          { personId: ids.people[4]!, side: 'heel' },
          { personId: ids.people[0]!, side: 'face' },
        ],
      });
      for (const segmentId of ids.segments) {
        tx.update('segments', segmentId, { storylineIds: [hot] });
      }
      tx.update('storylines', hot, { finaleSegmentId: ids.segments[0]! });
    })
    .build();
}

export function storylineEngine(built: BuiltWorld = storylineWorld()): Engine {
  return createEngine({
    state: initialEngineState(built.world),
    systems: [simSystem, storylinesSystem],
  });
}

/** The data of an ok result; fails the test otherwise. */
export function ok<T>(result: QueryResult<T>): T {
  if (!result.ok) {
    throw new Error(`query refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

/** The reason codes of a refused result. */
export function reasonCodes<T>(result: QueryResult<T>): string[] {
  return result.ok ? [] : result.reasons.map((reason) => reason.code);
}
