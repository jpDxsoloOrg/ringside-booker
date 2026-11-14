// The beat catalog and angle templates (MTCH5-01): the shipped base pack, refusals with their pack
// issue codes, casting every template, trimming templates to a slot and `match.catalog`.
// Design: docs/design/angle-rating.md.
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Viewer } from '../../../../src/core/api';
import type { PersonId } from '../../../../src/core/ids';
import {
  angleTemplatesOf,
  angleTypesOf,
  beatOf,
  beatsOf,
  hasBeatCatalog,
  isBeatAllowed,
  type AngleTemplateDef,
} from '../../../../src/model/catalogs';
import {
  checkReferences,
  mergeRecords,
  resolvePacks,
  type MergedRecords,
  type PackIssue,
  type RawPack,
} from '../../../../src/persistence/packs';
import { defaultSystems } from '../../../../src/systems';
import {
  assignAngleSides,
  beatGroupsOf,
  toStoredBeat,
} from '../../../../src/systems/match/angles/beatGroups';
import {
  angleTemplatesFor,
  castTemplate,
  fitTemplate,
} from '../../../../src/systems/match/angles/templates';
import { worldBuilder } from '../../../support';
import { testId } from '../../../support/ids';
import { TEST_CATALOGS } from '../../../support/catalogs';
import { readBasePack } from '../../world/people/base-world';

const PLAYER: Viewer = { kind: 'controller', controller: { kind: 'human', playerId: 'player-1' } };
const CATALOG_READER = worldBuilder().withCatalogs(TEST_CATALOGS).build().world;
const NO_CATALOGS = worldBuilder().build().world;

type JsonRecord = Record<string, unknown>;

function recordsOf(pack: RawPack, kind: 'beat' | 'angleTemplate'): JsonRecord[] {
  const file: unknown = pack.files[kind];
  if (!Array.isArray(file)) {
    throw new Error(`the base pack has no ${kind} file`);
  }
  const records: unknown[] = file;
  return records.filter(isRecord);
}

/** The base pack with one record of `kind` replaced by `change(record)`. */
function basePackWith(
  kind: 'beat' | 'angleTemplate',
  key: string,
  change: (record: JsonRecord) => JsonRecord,
): RawPack {
  const pack = readBasePack();
  const records = recordsOf(pack, kind).map((record) =>
    record['key'] === key ? change(record) : record,
  );
  return { ...pack, files: { ...pack.files, [kind]: records } };
}

/** Resolve, merge and check references; every issue found. */
function loadIssues(pack: RawPack): PackIssue[] {
  const resolved = resolvePacks([pack], ['base']);
  if (!resolved.ok) {
    return [...resolved.issues];
  }
  const merged = mergeRecords(resolved.value);
  if (!merged.ok) {
    return [...merged.issues];
  }
  return [...merged.issues, ...checkReferences(merged.value.records)];
}

function baseRecords(): MergedRecords {
  const resolved = resolvePacks([readBasePack()], ['base']);
  if (!resolved.ok) {
    throw new Error('the base pack did not resolve');
  }
  const merged = mergeRecords(resolved.value);
  if (!merged.ok) {
    throw new Error('the base pack did not merge');
  }
  return merged.value.records;
}

function template(key: string): AngleTemplateDef {
  const found = angleTemplatesOf(CATALOG_READER).find((entry) => entry.key === `template.${key}`);
  if (found === undefined) {
    throw new Error(`no template ${key}`);
  }
  return found;
}

const P1 = testId('person', 1);
const P2 = testId('person', 2);
const P3 = testId('person', 3);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A beat record's groups, as plain records. */
function groupsOf(record: JsonRecord): JsonRecord[] {
  const groups: unknown = record['groups'];
  if (!Array.isArray(groups)) {
    throw new Error('a beat with no groups');
  }
  const list: unknown[] = groups;
  return list.filter(isRecord);
}

describe('the shipped beat catalog', () => {
  it('loads with the base pack with no issues', () => {
    expect(loadIssues(readBasePack())).toEqual([]);
  });

  it('has the 13 beats and 8 templates', () => {
    const records = baseRecords();
    expect(records.beat.size).toBe(13);
    expect(records.angleTemplate.size).toBe(8);
    expect(beatsOf(CATALOG_READER).map((beat) => beat.key)).toEqual([
      'beat.announcement',
      'beat.attack',
      'beat.backstage-skit',
      'beat.brawl',
      'beat.celebration',
      'beat.contract-signing',
      'beat.entrance',
      'beat.interview',
      'beat.promo',
      'beat.pull-apart',
      'beat.staredown',
      'beat.video-package',
      'beat.war-of-words',
    ]);
    expect(angleTemplatesOf(CATALOG_READER).map((entry) => entry.key)).toEqual([
      'template.ambush',
      'template.backstage-plot',
      'template.feud-opener',
      'template.hype-video',
      'template.sit-down-interview',
      'template.solo-promo',
      'template.title-contract',
      'template.victory-lap',
    ]);
  });

  it("lists each angle type's beats, its default among them", () => {
    for (const angleType of angleTypesOf(CATALOG_READER, { includeHidden: true })) {
      expect(angleType.beatKeys, angleType.key).toBeDefined();
      expect(isBeatAllowed(angleType, angleType.defaultBeatKey), angleType.key).toBe(true);
      for (const beatKey of angleType.beatKeys ?? []) {
        expect(beatOf(CATALOG_READER, beatKey), beatKey).toBeDefined();
      }
    }
    expect(isBeatAllowed({}, 'beat.brawl')).toBe(true);
  });

  it('says whether a world holds the beat catalog', () => {
    expect(hasBeatCatalog(CATALOG_READER)).toBe(true);
    expect(hasBeatCatalog(NO_CATALOGS)).toBe(false);
    expect(beatsOf(NO_CATALOGS)).toEqual([]);
  });
});

describe('beat and template refusals', () => {
  const codes = (pack: RawPack) => loadIssues(pack).map((issue) => [issue.code, issue.path]);

  it('refuses a beat with minutes', () => {
    const pack = basePackWith('beat', 'promo', (record) => ({ ...record, minutes: 3 }));
    expect(codes(pack)).toEqual([['schema', ['beat', 'promo']]]);
  });

  it('refuses a third group and an optional first group', () => {
    const third = basePackWith('beat', 'war-of-words', (record) => {
      const groups = groupsOf(record);
      return { ...record, groups: [...groups, ...groups.slice(0, 1)] };
    });
    expect(codes(third)).toEqual([['schema', ['beat', 'war-of-words', 'groups']]]);
    const optionalFirst = basePackWith('beat', 'promo', (record) => ({
      ...record,
      groups: groupsOf(record).map((group) => ({ ...group, optional: true })),
    }));
    expect(codes(optionalFirst)).toEqual([['schema', ['beat', 'promo', 'groups', 0, 'optional']]]);
  });

  it('refuses an unknown stat', () => {
    const pack = basePackWith('beat', 'promo', (record) => ({
      ...record,
      groups: groupsOf(record).map((group) => ({ ...group, stats: ['mic', 'swagger'] })),
    }));
    expect(codes(pack)).toEqual([['schema', ['beat', 'promo', 'groups', 0, 'stats', 1]]]);
  });

  it('refuses a template using a beat its angle type does not allow', () => {
    const pack = basePackWith('angleTemplate', 'hype-video', (record) => ({
      ...record,
      beats: [{ beatKey: 'promo', groupOne: 'a', groupTwo: null, optional: false }],
    }));
    expect(codes(pack)).toEqual([
      ['beat-not-allowed', ['angleTemplate', 'hype-video', 'beats', 0, 'beatKey']],
    ]);
  });

  it('refuses a groupTwo on a one-group beat and a missing required one', () => {
    const extra = basePackWith('angleTemplate', 'solo-promo', (record) => ({
      ...record,
      beats: [{ beatKey: 'promo', groupOne: 'a', groupTwo: 'b', optional: false }],
    }));
    expect(codes(extra)).toEqual([
      ['schema', ['angleTemplate', 'solo-promo', 'beats', 0, 'groupTwo']],
    ]);
    const missing = basePackWith('angleTemplate', 'ambush', (record) => ({
      ...record,
      beats: [{ beatKey: 'attack', groupOne: 'a', groupTwo: null, optional: false }],
    }));
    expect(codes(missing)).toEqual([
      ['schema', ['angleTemplate', 'ambush', 'beats', 0, 'groupTwo']],
    ]);
  });

  it('refuses a template whose beats are all optional', () => {
    const pack = basePackWith('angleTemplate', 'solo-promo', (record) => ({
      ...record,
      beats: [{ beatKey: 'promo', groupOne: 'a', groupTwo: null, optional: true }],
    }));
    expect(codes(pack)).toEqual([['schema', ['angleTemplate', 'solo-promo', 'beats']]]);
  });
});

describe('casting templates', () => {
  it('casts every template with a, b and a host, and round-trips it through stored beats', () => {
    for (const entry of angleTemplatesOf(CATALOG_READER)) {
      const cast = castTemplate(entry, { a: [P1], b: [P2], host: P3 });
      expect(cast, entry.key).toHaveLength(entry.beats.length);
      for (const beat of cast) {
        expect(beat.groupOne.length, `${entry.key} ${beat.beatKey}`).toBeGreaterThan(0);
      }
      const assigned = assignAngleSides(cast);
      if (!('sides' in assigned)) {
        throw new Error(`${entry.key}: ${JSON.stringify(assigned.conflict)}`);
      }
      const sideOf = (personId: PersonId) => assigned.sides[personId];
      for (const beat of cast) {
        const catalogBeat = beatOf(CATALOG_READER, beat.beatKey);
        if (catalogBeat === undefined) {
          throw new Error(`no beat ${beat.beatKey}`);
        }
        expect(beatGroupsOf(toStoredBeat(beat), catalogBeat, sideOf), entry.key).toEqual(beat);
      }
    }
  });

  it('drops a host-only beat without a host and leaves an optional host group empty', () => {
    const contract = castTemplate(template('title-contract'), { a: [P1], b: [P2], host: null });
    expect(contract.map((beat) => beat.beatKey)).toEqual([
      'beat.contract-signing',
      'beat.staredown',
    ]);
    const interview = castTemplate(template('sit-down-interview'), {
      a: [P1],
      b: [],
      host: null,
    });
    expect(interview[0]).toEqual({ beatKey: 'beat.interview', groupOne: [P1], groupTwo: [] });
  });

  it('puts both sides in an ab group', () => {
    const [, , brawl] = castTemplate(template('feud-opener'), { a: [P1], b: [P2], host: null });
    expect(brawl).toEqual({ beatKey: 'beat.brawl', groupOne: [P1, P2], groupTwo: [] });
  });
});

describe('fitTemplate', () => {
  const keys = (beats: readonly { beatKey: string }[] | undefined) =>
    beats?.map((beat) => beat.beatKey);

  it('drops optional beats from the front until the template fits', () => {
    const feud = template('feud-opener');
    expect(fitTemplate(feud, 1)).toBeNull();
    expect(keys(fitTemplate(feud, 2)?.beats)).toEqual(['beat.war-of-words', 'beat.brawl']);
    expect(keys(fitTemplate(feud, 2)?.dropped)).toEqual(['beat.staredown']);
    expect(keys(fitTemplate(feud, 4)?.beats)).toEqual([
      'beat.staredown',
      'beat.war-of-words',
      'beat.brawl',
    ]);
    expect(fitTemplate(feud, 8)?.dropped).toEqual([]);

    const contract = template('title-contract');
    expect(keys(fitTemplate(contract, 2)?.beats)).toEqual([
      'beat.contract-signing',
      'beat.staredown',
    ]);
    expect(keys(fitTemplate(contract, 1)?.beats)).toEqual(['beat.contract-signing']);
  });

  it('never refuses the solo promo', () => {
    for (const limit of [1, 2, 4, 8]) {
      expect(fitTemplate(template('solo-promo'), limit), String(limit)).not.toBeNull();
    }
  });

  it('lists fitting templates by key, for one purpose or all', () => {
    expect(
      angleTemplatesFor(CATALOG_READER, { maxBeats: 1 }).map((fit) => fit.template.key),
    ).toEqual([
      'template.ambush',
      'template.backstage-plot',
      'template.hype-video',
      'template.sit-down-interview',
      'template.solo-promo',
      'template.title-contract',
      'template.victory-lap',
    ]);
    expect(
      angleTemplatesFor(CATALOG_READER, { purpose: 'buildFeud', maxBeats: 8 }).map(
        (fit) => fit.template.key,
      ),
    ).toEqual(['template.ambush', 'template.backstage-plot']);
  });
});

describe('match.catalog beats and templates', () => {
  function catalogOf(catalogs: typeof TEST_CATALOGS) {
    const built = worldBuilder().withCatalogs(catalogs).build();
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: defaultSystems,
    });
    const result = engine.query('match.catalog', { includeHidden: true }, PLAYER);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    return result.data;
  }

  it('returns 13 beats, 8 templates and a beat list on every angle type', () => {
    const catalog = catalogOf(TEST_CATALOGS);
    expect(catalog.beats).toHaveLength(13);
    expect(catalog.angleTemplates).toHaveLength(8);
    for (const angleType of catalog.angleTypes) {
      expect(angleType.beatKeys.length, angleType.key).toBeGreaterThan(0);
    }
    const feud = catalog.angleTemplates.find((entry) => entry.key === 'template.feud-opener');
    expect(feud?.requiredBeatCount).toBe(2);
    expect(feud?.beats.map((beat) => beat.optional)).toEqual([true, false, false]);
    const interview = catalog.beats.find((beat) => beat.key === 'beat.interview');
    expect(interview?.groups.map((group) => [group.label, group.optional])).toEqual([
      ['Guest', false],
      ['Host', true],
    ]);
  });

  it('holds no minutes, length or duration anywhere', () => {
    const { beats, angleTemplates, angleTypes } = catalogOf(TEST_CATALOGS);
    const text = JSON.stringify({ beats, angleTemplates, angleTypes });
    const names = text.match(/"[A-Za-z]+":/g) ?? [];
    expect(names.filter((name) => /minute|length|duration/i.test(name))).toEqual([]);
  });

  it('gives empty beat lists on a save from before beats', () => {
    const { beats: _beats, angleTemplates: _templates, ...older } = TEST_CATALOGS;
    const catalog = catalogOf(older);
    expect(catalog.beats).toEqual([]);
    expect(catalog.angleTemplates).toEqual([]);
    expect(catalog.angleTypes.every((angleType) => angleType.beatKeys.length === 0)).toBe(true);
  });
});
