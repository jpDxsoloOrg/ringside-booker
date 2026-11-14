// `angle-beats` (MTCH5-01): the angle types' beat lists name beats, and every stored angle beat is
// allowed, cast from the segment's participants and fills its groups.
import { describe, expect, it } from 'vitest';
import {
  BEAT_ISSUE_CODES,
  checkBeatCatalog,
  checkSegmentBeats,
  isMatch,
  parseContentKey,
  type AngleBeat,
  type AngleSegment,
  type Catalogs,
  type MergedContent,
  type PersonId,
} from '@ringside/engine';
import { tinyWorld, type BuiltWorld } from '@ringside/engine/testing/fixtures';
import { angleBeats } from '../src/rules/angleBeats';
import { loadForRules, readMiniWorld } from './helpers';

type GameWorld = BuiltWorld['world'];

/** Merged content with no catalogs, so the rule reads the world's own snapshot. */
async function noCatalogContent(): Promise<MergedContent> {
  return loadForRules(await readMiniWorld(), ['mini-world']).content;
}

function theAngle(world: GameWorld): AngleSegment {
  const angle = world.tables.segments
    .values()
    .find((segment): segment is AngleSegment => !isMatch(segment));
  if (angle === undefined) {
    throw new Error('tinyWorld has no angle');
  }
  return angle;
}

/** The angle's two speakers: side 0 first. */
function speakers(world: GameWorld): [PersonId, PersonId] {
  const [first, second] = world.tables.participants
    .lookup('bySegment', theAngle(world).id)
    .slice()
    .sort((left, right) => left.side - right.side)
    .map((participant) => participant.personId);
  if (first === undefined || second === undefined) {
    throw new Error('the tiny angle has fewer than two speakers');
  }
  return [first, second];
}

function outsiders(world: GameWorld, count: number): PersonId[] {
  const inAngle = new Set(speakers(world));
  return world.tables.people
    .values()
    .filter((person) => !inAngle.has(person.id))
    .slice(0, count)
    .map((person) => person.id);
}

function setBeats(world: GameWorld, beats: AngleBeat[]): string {
  const angle = theAngle(world);
  const result = world.transact('rewrite beats', (tx) => {
    tx.update('segments', angle.id, () => ({ ...angle, angle: { ...angle.angle, beats } }));
  });
  if (!result.ok) {
    throw result.error;
  }
  return angle.id;
}

function addSpeakers(world: GameWorld, personIds: readonly PersonId[], side: number): void {
  const angle = theAngle(world);
  const result = world.transact('add speakers', (tx) => {
    for (const personId of personIds) {
      tx.create('participants', {
        segmentId: angle.id,
        personId,
        side,
        role: 'speaker',
        teamId: null,
        entranceOrder: null,
        eliminationOrder: null,
      });
    }
  });
  if (!result.ok) {
    throw result.error;
  }
}

function beat(key: string, personIds: PersonId[]): AngleBeat {
  return { beatKey: parseContentKey(key), personIds };
}

async function check(world: GameWorld) {
  return angleBeats.check(world, await noCatalogContent());
}

function codes(world: GameWorld): string[] {
  return checkSegmentBeats(world).map((issue) => issue.code);
}

describe('angle-beats', () => {
  it('passes the tiny world', async () => {
    const { world } = tinyWorld();
    expect(await check(world)).toEqual([]);
  });

  it('reports an unknown beat', async () => {
    const { world } = tinyWorld();
    const [a] = speakers(world);
    const id = setBeats(world, [beat('beat.monologue', [a])]);
    const issues = await check(world);
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['angle-beats', ['segments', id, 'angle', 'beats', '0', 'beatKey']],
    ]);
    expect(issues[0]?.message).toMatch(/^segments\.unknownBeat: /);
  });

  it("reports a beat the angle type doesn't allow", () => {
    const { world } = tinyWorld();
    const [a, b] = speakers(world);
    setBeats(world, [beat('beat.brawl', [a, b])]);
    expect(codes(world)).toEqual([BEAT_ISSUE_CODES.beatNotAllowed]);
  });

  it('reports someone in a beat who is not a participant', () => {
    const { world } = tinyWorld();
    const [a] = speakers(world);
    const [outsider] = outsiders(world, 1);
    if (outsider === undefined) {
      throw new Error('no outsider');
    }
    setBeats(world, [beat('beat.promo', [a, outsider])]);
    expect(codes(world)).toEqual([BEAT_ISSUE_CODES.beatPersonNotParticipant]);
  });

  it('reports an empty required second group', () => {
    const { world } = tinyWorld();
    const [a] = speakers(world);
    setBeats(world, [beat('beat.war-of-words', [a])]);
    expect(codes(world)).toEqual([BEAT_ISSUE_CODES.beatGroupEmpty]);
  });

  it('reports a group with too many people, and lets an optional group stay empty', () => {
    const { world } = tinyWorld();
    const [a] = speakers(world);
    const extra = outsiders(world, 2);
    addSpeakers(world, extra, 0);
    setBeats(world, [beat('beat.announcement', [a, ...extra])]);
    expect(codes(world)).toEqual([BEAT_ISSUE_CODES.beatGroupSize]);
    setBeats(world, [beat('beat.announcement', [a])]);
    expect(codes(world)).toEqual([]);
  });

  it("reports an angle type beat list naming a beat that doesn't exist", async () => {
    const { world } = tinyWorld();
    const catalogs: Catalogs = structuredClone(world.meta.catalogs);
    const promo = catalogs.angleTypes?.[parseContentKey('angle.promo')];
    if (promo === undefined) {
      throw new Error('no promo angle type');
    }
    promo.beatKeys = [parseContentKey('beat.promo'), parseContentKey('beat.monologue')];
    const view = { ...world, meta: { ...world.meta, catalogs } };
    const issues = angleBeats.check(view, await noCatalogContent());
    // The tiny angle's war of words is no longer allowed either.
    expect(issues.map((issue) => [issue.path.slice(-3), issue.message.split(':')[0]])).toEqual([
      [['angle.promo', 'beatKeys', 1], 'catalog.unknownBeat'],
      [['beats', '1', 'beatKey'], 'segments.beatNotAllowed'],
    ]);
  });

  it('reports a beat list that leaves out the default beat or a default that is not a beat', () => {
    const { world } = tinyWorld();
    const catalogs: Catalogs = structuredClone(world.meta.catalogs);
    const { angleTypes } = catalogs;
    const promo = angleTypes?.[parseContentKey('angle.promo')];
    const video = angleTypes?.[parseContentKey('angle.video-package')];
    if (promo === undefined || video === undefined) {
      throw new Error('missing angle types');
    }
    // The runtime schema refuses both, so they are only reachable as raw data.
    promo.beatKeys = [parseContentKey('beat.war-of-words')];
    video.defaultBeatKey = parseContentKey('beat.trailer');
    expect(checkBeatCatalog(catalogs).map((issue) => [issue.key, issue.code])).toEqual([
      ['angle.promo', BEAT_ISSUE_CODES.defaultBeatNotAllowed],
      ['angle.video-package', BEAT_ISSUE_CODES.unknownDefaultBeat],
    ]);
  });

  it('checks nothing in a world without a beat catalog', async () => {
    const { world } = tinyWorld();
    setBeats(world, [beat('beat.monologue', speakers(world))]);
    const withoutBeats = Object.fromEntries(
      Object.entries(world.meta.catalogs).filter(([name]) => name !== 'beats'),
    );
    const view = { ...world, meta: { ...world.meta, catalogs: withoutBeats } };
    expect(angleBeats.check(view, await noCatalogContent())).toEqual([]);
  });
});
