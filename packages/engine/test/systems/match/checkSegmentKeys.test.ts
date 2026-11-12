// The segment key check (MTCH1-01): every stored match type, win method and angle type key
// resolves in the world's catalogs, and a missing one is reported with the segment and the field.
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../src/core/content-key';
import type { SegmentId } from '../../../src/core/ids';
import { isAngle, isMatch, type Segment } from '../../../src/model/entities/segment';
import type { GameWorld } from '../../../src/model/tables';
import {
  checkSegmentContentKeys,
  SEGMENT_KEY_ISSUE_CODES,
} from '../../../src/systems/match/catalog/checkSegmentKeys';
import { tinyWorld } from '../../support/worlds';

function segmentsOf(world: GameWorld): readonly Segment[] {
  return world.tables.segments.values();
}

/** Rewrites one segment of the world in place. */
function rewrite(world: GameWorld, id: SegmentId, change: (segment: Segment) => Segment): void {
  const result = world.transact('rewrite segment', (tx) => {
    tx.update('segments', id, change);
  });
  if (!result.ok) {
    throw result.error;
  }
}

function firstMatch(world: GameWorld): Segment {
  const match = segmentsOf(world).find((segment) => isMatch(segment) && segment.outcome !== null);
  if (match === undefined) {
    throw new Error('tinyWorld has no completed match');
  }
  return match;
}

function firstAngle(world: GameWorld): Segment {
  const angle = segmentsOf(world).find((segment) => isAngle(segment));
  if (angle === undefined) {
    throw new Error('tinyWorld has no angle');
  }
  return angle;
}

describe('checkSegmentContentKeys', () => {
  it('finds nothing wrong with the tiny world', () => {
    const { world } = tinyWorld();
    expect(segmentsOf(world)).toHaveLength(4);
    expect(checkSegmentContentKeys(world)).toEqual([]);
  });

  it('reports an unknown match type with the segment id and field path', () => {
    const { world } = tinyWorld();
    const match = firstMatch(world);
    rewrite(world, match.id, (segment) =>
      isMatch(segment)
        ? { ...segment, match: { ...segment.match, matchTypeKey: parseContentKey('match.cage') } }
        : segment,
    );
    expect(checkSegmentContentKeys(world)).toEqual([
      {
        code: SEGMENT_KEY_ISSUE_CODES.matchType,
        table: 'segments',
        id: match.id,
        path: 'match.matchTypeKey',
        message: `segments ${match.id}: match.matchTypeKey match.cage is not a match type in this world's catalog`,
      },
    ]);
  });

  it('reports an unknown win method', () => {
    const { world } = tinyWorld();
    const match = firstMatch(world);
    rewrite(world, match.id, (segment) =>
      isMatch(segment) && segment.outcome?.kind === 'win'
        ? {
            ...segment,
            outcome: { ...segment.outcome, methodKey: parseContentKey('finish.pinfall') },
          }
        : segment,
    );
    expect(
      checkSegmentContentKeys(world).map((issue) => [issue.code, issue.id, issue.path]),
    ).toEqual([[SEGMENT_KEY_ISSUE_CODES.method, match.id, 'outcome.methodKey']]);
  });

  it('reports an unknown angle type', () => {
    const { world } = tinyWorld();
    const angle = firstAngle(world);
    rewrite(world, angle.id, (segment) =>
      isAngle(segment)
        ? { ...segment, angle: { ...segment.angle, angleTypeKey: parseContentKey('angle.seance') } }
        : segment,
    );
    expect(
      checkSegmentContentKeys(world).map((issue) => [issue.code, issue.id, issue.path]),
    ).toEqual([[SEGMENT_KEY_ISSUE_CODES.angleType, angle.id, 'angle.angleTypeKey']]);
  });

  it('skips beats, finishes and stipulations, whose catalogs do not exist yet', () => {
    const { world } = tinyWorld();
    const match = firstMatch(world);
    const angle = firstAngle(world);
    rewrite(world, match.id, (segment) =>
      isMatch(segment)
        ? {
            ...segment,
            match: {
              ...segment.match,
              finishKey: parseContentKey('finish.anything'),
              stipulationKeys: [parseContentKey('stipulation.anything')],
            },
          }
        : segment,
    );
    rewrite(world, angle.id, (segment) =>
      isAngle(segment)
        ? {
            ...segment,
            angle: {
              ...segment.angle,
              beats: segment.angle.beats.map((beat) => ({
                ...beat,
                beatKey: parseContentKey('beat.anything'),
              })),
            },
          }
        : segment,
    );
    expect(checkSegmentContentKeys(world)).toEqual([]);
  });

  it('checks nothing in a world without catalogs', () => {
    const { world } = tinyWorld();
    const match = firstMatch(world);
    rewrite(world, match.id, (segment) =>
      isMatch(segment)
        ? { ...segment, match: { ...segment.match, matchTypeKey: parseContentKey('match.cage') } }
        : segment,
    );
    const result = world.transact('drop catalogs', (tx) => {
      tx.setMeta({ catalogs: {} });
    });
    expect(result.ok).toBe(true);
    expect(checkSegmentContentKeys(world)).toEqual([]);
  });
});
