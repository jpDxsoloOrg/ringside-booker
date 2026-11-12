// `segment-finishes` (MTCH2-01): a stored match's planned finish names a finish, is allowed for
// the match, and agrees with the outcome and its method.
import { describe, expect, it } from 'vitest';
import {
  checkSegmentFinishes,
  isMatch,
  parseContentKey,
  SEGMENT_FINISH_ISSUE_CODES,
  type MatchSegment,
  type MergedContent,
  type Segment,
} from '@ringside/engine';
import { tinyWorld, type BuiltWorld } from '@ringside/engine/testing/fixtures';
import { segmentFinishes } from '../src/rules/segmentFinishes';
import { loadForRules, readMiniWorld } from './helpers';

type GameWorld = BuiltWorld['world'];

/** Merged content with no catalogs, so the rule reads the world's own snapshot. */
async function noCatalogContent(): Promise<MergedContent> {
  return loadForRules(await readMiniWorld(), ['mini-world']).content;
}

function titleMatch(world: GameWorld): MatchSegment {
  const match = world.tables.segments
    .values()
    .find(
      (segment): segment is MatchSegment => isMatch(segment) && segment.match.finishKey !== null,
    );
  if (match === undefined) {
    throw new Error('tinyWorld has no match with a planned finish');
  }
  return match;
}

/** Rewrites the title match (finish.clean, a two-sided win by pinfall). */
function rewriteTitleMatch(world: GameWorld, change: (segment: MatchSegment) => Segment): string {
  const match = titleMatch(world);
  const result = world.transact('rewrite segment', (tx) => {
    tx.update('segments', match.id, () => change(match));
  });
  if (!result.ok) {
    throw result.error;
  }
  return match.id;
}

/** Puts one more competitor, on a third side, into the title match. */
function addThirdSide(world: GameWorld): void {
  const match = titleMatch(world);
  const inMatch = new Set(
    world.tables.participants
      .lookup('bySegment', match.id)
      .map((participant) => participant.personId),
  );
  const outsider = world.tables.people.values().find((person) => !inMatch.has(person.id));
  if (outsider === undefined) {
    throw new Error('tinyWorld has no one outside the title match');
  }
  const result = world.transact('add a side', (tx) => {
    tx.create('participants', {
      segmentId: match.id,
      personId: outsider.id,
      side: 2,
      role: 'competitor',
      teamId: null,
      entranceOrder: null,
      eliminationOrder: null,
    });
  });
  if (!result.ok) {
    throw result.error;
  }
}

async function check(world: GameWorld) {
  return segmentFinishes.check(world, await noCatalogContent());
}

describe('segment-finishes', () => {
  it('passes the tiny world', async () => {
    const { world } = tinyWorld();
    expect(titleMatch(world).match.finishKey).toBe('finish.clean');
    expect(await check(world)).toEqual([]);
  });

  it('reports an unknown finish', async () => {
    const { world } = tinyWorld();
    const id = rewriteTitleMatch(world, (segment) => ({
      ...segment,
      match: { ...segment.match, finishKey: parseContentKey('finish.time-limit') },
    }));
    const issues = await check(world);
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['segment-finishes', ['segments', id, 'match', 'finishKey']],
    ]);
    expect(checkSegmentFinishes(world).map((issue) => issue.code)).toEqual([
      SEGMENT_FINISH_ISSUE_CODES.unknownFinish,
    ]);
    expect(issues[0]?.message).toMatch(/^segments\.unknownFinish: /);
  });

  it('reports a finish not allowed for the side count', async () => {
    const { world } = tinyWorld();
    const id = rewriteTitleMatch(world, (segment) => ({
      ...segment,
      match: { ...segment.match, finishKey: parseContentKey('finish.double-count-out') },
      outcome: { kind: 'draw' },
    }));
    addThirdSide(world);
    const issues = await check(world);
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['segment-finishes', ['segments', id, 'match', 'finishKey']],
    ]);
    expect(checkSegmentFinishes(world).map((issue) => issue.code)).toEqual([
      SEGMENT_FINISH_ISSUE_CODES.finishNotAllowed,
    ]);
  });

  it('reports an outcome of the wrong kind', async () => {
    const { world } = tinyWorld();
    const id = rewriteTitleMatch(world, (segment) => ({
      ...segment,
      match: { ...segment.match, finishKey: parseContentKey('finish.stalemate') },
    }));
    const issues = await check(world);
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['segment-finishes', ['segments', id, 'outcome', 'kind']],
    ]);
    expect(checkSegmentFinishes(world).map((issue) => issue.code)).toEqual([
      SEGMENT_FINISH_ISSUE_CODES.finishOutcomeMismatch,
    ]);
  });

  it("reports a win method that is not one of the finish's methods", async () => {
    const { world } = tinyWorld();
    const id = rewriteTitleMatch(world, (segment) => ({
      ...segment,
      outcome: { kind: 'win', winningSide: 0, methodKey: parseContentKey('method.count-out') },
    }));
    const issues = await check(world);
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['segment-finishes', ['segments', id, 'outcome', 'methodKey']],
    ]);
    expect(checkSegmentFinishes(world).map((issue) => issue.code)).toEqual([
      SEGMENT_FINISH_ISSUE_CODES.methodNotInFinish,
    ]);
  });

  it('checks nothing in a world without a finish catalog', async () => {
    const { world } = tinyWorld();
    rewriteTitleMatch(world, (segment) => ({
      ...segment,
      match: { ...segment.match, finishKey: parseContentKey('finish.time-limit') },
    }));
    const withoutFinishes = Object.fromEntries(
      Object.entries(world.meta.catalogs).filter(([name]) => name !== 'finishes'),
    );
    const view = { ...world, meta: { ...world.meta, catalogs: withoutFinishes } };
    expect(segmentFinishes.check(view, await noCatalogContent())).toEqual([]);
  });
});
