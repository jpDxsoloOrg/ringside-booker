// Runtime catalogs (MTCH1-01): the readers phases, queries and commands use, and the snapshot's
// trip through a save.
// Design: docs/design/data-packs.md, "Match and segment catalogs".
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../src/core/content-key';
import {
  angleTypeOf,
  angleTypesOf,
  CatalogsSchema,
  hasCatalog,
  matchTypeOf,
  matchTypesOf,
  methodOf,
  methodsOf,
  type Catalogs,
  type MatchTypeDef,
} from '../../src/model/catalogs';
import { TABLES } from '../../src/model/tables';
import { WorldMetaSchema } from '../../src/model/world-meta';
import { createSaveDocumentSchema } from '../../src/persistence/save-document';
import { documentToWorld } from '../../src/persistence/world-document';
import { TEST_CATALOGS } from '../support/catalogs';
import { testSaveDocument } from '../support/saves';
import { aWorldMeta, worldBuilder } from '../support/world-builder';
import { emptyWorld, tinyWorld } from '../support/worlds';

function matchType(key: string, order: number, hidden = false): MatchTypeDef {
  return {
    key: parseContentKey(`match.${key}`),
    name: `Test ${key}`,
    order,
    sides: { min: 2, max: 2 },
    sideSize: { min: 1, max: 1 },
    equalSides: true,
    durationShift: 0,
    workRateFactor: 1,
    crowdFactor: 1,
    styleAffinity: [],
    allowsTitles: true,
    hidden,
  };
}

/** Match types whose order and key disagree, plus a hidden one. */
const ORDERED: Catalogs = {
  matchTypes: Object.fromEntries(
    [matchType('b', 10), matchType('a', 20), matchType('c', 10), matchType('secret', 5, true)].map(
      (def) => [def.key, def],
    ),
  ),
};

function readerOf(catalogs: Catalogs) {
  return { meta: { ...aWorldMeta(), catalogs } };
}

describe('catalog readers', () => {
  it('list by order, then key, and leave hidden entries out unless asked', () => {
    const read = readerOf(ORDERED);
    expect(matchTypesOf(read).map((def) => def.key)).toEqual(['match.b', 'match.c', 'match.a']);
    expect(matchTypesOf(read, { includeHidden: true }).map((def) => def.key)).toEqual([
      'match.secret',
      'match.b',
      'match.c',
      'match.a',
    ]);
  });

  it('find one entry by key, hidden or not, and undefined for an unknown key', () => {
    const read = readerOf(ORDERED);
    expect(matchTypeOf(read, 'match.secret')?.hidden).toBe(true);
    expect(matchTypeOf(read, 'match.missing')).toBeUndefined();
    expect(matchTypeOf(read, 'toString')).toBeUndefined();
  });

  it('return frozen data that does not share objects with the metadata', () => {
    const read = readerOf(ORDERED);
    const [first] = matchTypesOf(read);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.sides)).toBe(true);
    expect(first).not.toBe(read.meta.catalogs.matchTypes?.[parseContentKey('match.b')]);
    expect(matchTypeOf(read, 'match.b')).toBe(first);
  });

  it('read the shipped catalogs in display order', () => {
    const { world } = tinyWorld();
    expect(matchTypesOf(world).map((def) => def.key)).toEqual([
      'match.singles',
      'match.tag-team',
      'match.trios',
      'match.triple-threat',
      'match.four-way',
      'match.handicap',
      'match.battle-royal',
      'match.endurance',
      'match.sprint',
    ]);
    expect(angleTypesOf(world).map((def) => def.key)).toEqual([
      'angle.promo',
      'angle.interview',
      'angle.confrontation',
      'angle.attack',
      'angle.contract-signing',
      'angle.video-package',
    ]);
    expect(methodsOf(world).map((def) => [def.key, def.changesTitles])).toEqual([
      ['method.pinfall', true],
      ['method.submission', true],
      ['method.knockout', true],
      ['method.referee-stoppage', true],
      ['method.count-out', false],
      ['method.disqualification', false],
    ]);
    expect(angleTypeOf(world, 'angle.confrontation')?.defaultBeatKey).toBe('beat.staredown');
    expect(methodOf(world, 'method.disqualification')?.changesTitles).toBe(false);
    expect(matchTypeOf(world, 'match.battle-royal')).toMatchObject({
      sides: { min: 6, max: 30 },
      durationShift: 1,
      workRateFactor: 0.85,
      crowdFactor: 1.05,
      allowsTitles: false,
    });
  });

  it('give empty lists and undefined for a world without catalogs', () => {
    const { world } = emptyWorld();
    expect(world.meta.catalogs).toEqual({});
    expect(hasCatalog(world, 'matchTypes')).toBe(false);
    expect(matchTypesOf(world)).toEqual([]);
    expect(angleTypesOf(world)).toEqual([]);
    expect(methodsOf(world)).toEqual([]);
    expect(methodOf(world, 'method.pinfall')).toBeUndefined();
  });
});

describe('CatalogsSchema', () => {
  it('accepts the shipped catalogs and an empty object', () => {
    expect(CatalogsSchema.safeParse(TEST_CATALOGS).success).toBe(true);
    expect(CatalogsSchema.safeParse({}).success).toBe(true);
  });

  it('refuses an unknown catalog and a key that is not a content key', () => {
    expect(CatalogsSchema.safeParse({ gimmicks: {} }).success).toBe(false);
    expect(
      CatalogsSchema.safeParse({ matchTypes: { singles: matchType('singles', 1) } }).success,
    ).toBe(false);
  });

  it('defaults to {} for metadata saved before catalogs existed', () => {
    const older: Record<string, unknown> = { ...aWorldMeta() };
    delete older['catalogs'];
    expect(WorldMetaSchema.parse(older).catalogs).toEqual({});
  });
});

describe('catalogs in a save', () => {
  function roundTrip(world: Parameters<typeof testSaveDocument>[0]) {
    const doc = testSaveDocument(world);
    const parsed = createSaveDocumentSchema().parse(JSON.parse(JSON.stringify(doc)));
    return documentToWorld(parsed, TABLES);
  }

  it('round-trips the snapshot unchanged', () => {
    const { world } = tinyWorld();
    expect(roundTrip(world).meta.catalogs).toEqual(TEST_CATALOGS);
  });

  it('round-trips a world without catalogs as {}', () => {
    const { world } = worldBuilder().build();
    expect(roundTrip(world).meta.catalogs).toEqual({});
  });
});
