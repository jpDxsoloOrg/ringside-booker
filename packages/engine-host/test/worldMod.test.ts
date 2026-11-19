/**
 * The workshop world mod converter, on a generated fictional database (worldModFixture.ts): the
 * mapping and the report, stable keys, picture references and the roster-only option, a missing
 * table, an unknown enum value, and an import through the host API that starts a new game and plays
 * a week. Also the shapes from installed mods that the engine's checks refused (UNITY-12): the
 * converter fixes the known ones, and the import check skips any other refused record.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packManifestSchema } from '@ringside/engine';
import type { RawPack, RecordKind } from '@ringside/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { readContentPacks } from '../src/contentPacks';
import { createEmbeddedHost } from '../src/host';
import { baseGeographyOf } from '../src/worldMod/base';
import { checkWorldModPack } from '../src/worldMod/check';
import { convertWorldMod } from '../src/worldMod/convert';
import type { WorldModConversion } from '../src/worldMod/convert';
import { decodeWorldModImageRef, encodeWorldModImageRef } from '../src/worldMod/imageRef';
import { makeWorldModDatabase, readTables } from './worldModFixture';

const CONTENT_ROOT = fileURLToPath(new URL('../../../content', import.meta.url));

function readContent(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.json')) {
        files[relative(CONTENT_ROOT, path).split(sep).join('/')] = JSON.parse(
          readFileSync(path, 'utf8'),
        );
      }
    }
  };
  walk(CONTENT_ROOT);
  return files;
}

type Tables = Record<string, Record<string, unknown>[]>;
type Rec = Record<string, unknown>;

let content: Record<string, unknown>;
let base: RawPack;
let tables: Tables;

function convert(input: Tables, rosterOnly = false): WorldModConversion {
  return convertWorldMod(input, baseGeographyOf(base), { rosterOnly });
}

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses a JSON object result from the host. */
function parse(json: string): Rec {
  const value: unknown = JSON.parse(json);
  if (!isRec(value)) throw new Error(`Not a JSON object: ${json.slice(0, 80)}`);
  return value;
}

function recordsOf(conversion: WorldModConversion, kind: RecordKind): Rec[] {
  if (!conversion.ok) throw new Error(conversion.errors.join('; '));
  const list: unknown = conversion.pack.files[kind];
  return Array.isArray(list) ? list.filter(isRec) : [];
}

function find(list: readonly Rec[], key: string): Rec {
  const found = list.find((record) => record['key'] === key);
  if (found === undefined) throw new Error(`No record ${key}`);
  return found;
}

beforeAll(async () => {
  content = readContent();
  const found = readContentPacks(content).packs.find((pack) => pack.manifest.id === 'base');
  if (found === undefined) throw new Error('The base pack is missing');
  base = found;
  tables = readTables(await makeWorldModDatabase());
});

describe('convertWorldMod', () => {
  it('maps the fictional world and reports what it left out', () => {
    const conversion = convert(tables);
    expect(conversion.ok).toBe(true);
    if (!conversion.ok) return;
    const { manifest } = conversion.pack;
    expect(manifest).toMatchObject({
      id: 'wm-testverse-classic',
      name: 'Testverse Classic',
      version: '7.0.0',
      kind: 'world',
      startDate: '2010-01-04',
      dependsOn: [{ id: 'base', version: `^${base.manifest.version}` }],
    });
    const { counts, warnings } = conversion.report;
    expect(counts).toMatchObject({
      person: 40,
      personDebutsLater: 1,
      promotion: 3,
      brand: 1,
      title: 3,
      titleReign: 6,
      team: 1,
      venue: 2,
      eventDefinition: 4,
      network: 1,
      deal: 1,
      // 36 wrestler contracts minus the 4 free agents, plus the crew (37-40).
      employment: 36,
    });
    const codes = new Map(warnings.map((warning) => [warning.code, warning.count]));
    expect(codes.get('not-born-yet')).toBe(1);
    expect(codes.get('future-promotion')).toBe(1);
    expect(codes.get('future-network')).toBe(1);
    expect(codes.get('expired-deal')).toBe(1);
    expect(codes.get('contract-party-missing')).toBe(1);
    // Warnings name source ids, never names.
    expect(warnings.find((warning) => warning.code === 'not-born-yet')?.examples).toEqual([
      'workers#41',
    ]);
    expect(conversion.report.notImported.some((entry) => entry.startsWith('stables:'))).toBe(true);

    const people = recordsOf(conversion, 'person');
    const champion = find(people, 'wm-w1');
    expect(champion).toMatchObject({
      givenName: 'Arlo',
      familyName: 'Quillon',
      defaultRingName: 'Arlo Quillon',
      roles: ['wrestler'],
      style: 'technician',
      basedInRegionKey: 'us-texas',
      career: { canOwn: true, canBook: true },
      motivation: 'money',
    });
    // A body condition left at 0 means "not set".
    expect(champion['condition']).toMatchObject({ torso: 100, legs: 88 });
    expect(find(people, 'wm-w38')).toMatchObject({ roles: ['announcer'], style: 'nonWrestler' });
    expect(find(people, 'wm-w35')).toMatchObject({ debutDate: '2021-06-01' });

    // The mod's Texas is the base map's; its other region is new, and the base regions it
    // replaces are emptied so the country is not counted twice.
    const regions = recordsOf(conversion, 'region');
    expect(find(people, 'wm-w2')['basedInRegionKey']).toBe('wm-r2');
    expect(find(regions, 'wm-r2')).toMatchObject({ countryKey: 'us', population: 5000000 });
    expect(find(regions, 'us-california')).toEqual({
      key: 'us-california',
      $override: 'patch',
      population: 0,
    });
    expect(regions.some((region) => region['key'] === 'us-texas')).toBe(false);
    const countries = recordsOf(conversion, 'country');
    expect(countries.map((country) => country['key'])).toEqual(['wm-c2']);
    expect(find(countries, 'wm-c2')).toMatchObject({ name: 'Valdoria', continentKey: 'eu' });

    const titles = recordsOf(conversion, 'title');
    expect(find(titles, 'wm-t3')).toMatchObject({
      status: 'retired',
      retiredOn: '2006-01-01',
      division: { maxWeightKg: 93 },
    });
    const reigns = recordsOf(conversion, 'titleReign');
    expect(find(reigns, 'wm-t1-current')).toMatchObject({
      holderPersonKeys: ['wm-w1'],
      wonOn: '2009-08-01',
      lostOn: null,
      endReason: null,
    });
    expect(find(reigns, 'wm-t2-current')['holderPersonKeys']).toEqual(['wm-w3', 'wm-w5']);

    const events = recordsOf(conversion, 'eventDefinition');
    expect(find(events, 'wm-e1')).toMatchObject({
      recurrence: { kind: 'weekly', weekdays: [0] },
      televised: true,
      importance: 'regular',
      preferredVenueKey: 'wm-v1',
    });
    expect(find(events, 'wm-e2')['recurrence']).toEqual({
      kind: 'annual',
      month: 8,
      week: 'last',
      weekday: 6,
    });
    expect(find(events, 'wm-e4')['recurrence']).toEqual({
      kind: 'dates',
      dates: ['2010-03-06', '2010-03-07'],
    });

    const employments = recordsOf(conversion, 'employment');
    expect(find(employments, 'wm-k2')).toMatchObject({
      terms: { kind: 'perAppearance', monthlyWage: 0 },
      alignment: 'face',
    });
    expect(find(employments, 'wm-k138')).toMatchObject({ role: 'announcer', push: 'none' });
  });

  it('gives the same keys and records when the same mod is converted again', () => {
    expect(JSON.stringify(convert(tables))).toBe(JSON.stringify(convert(tables)));
  });

  it('references pictures in place, and leaves every picture out for a roster-only import', () => {
    const withPictures = convert(tables);
    const people = recordsOf(withPictures, 'person');
    // The alternate picture in force on the start date wins over the default one.
    const ref = find(people, 'wm-w2')['imageRef'];
    expect(typeof ref).toBe('string');
    expect(decodeWorldModImageRef(String(ref))).toBe('people/Worker 2 2009.png');
    const logo = find(recordsOf(withPictures, 'promotion'), 'wm-p1')['logoRef'];
    expect(decodeWorldModImageRef(String(logo))).toBe('logos/GWF logo.png');
    // A show's logo (the calendar, booking and results show it, UNITY-13).
    const showLogo = find(recordsOf(withPictures, 'eventDefinition'), 'wm-e1')['logoRef'];
    expect(decodeWorldModImageRef(String(showLogo))).toBe('events/Granite Monday.png');
    expect(withPictures.report.pictures).toMatchObject({ people: 40, logos: 4 });

    const rosterOnly = convert(tables, true);
    expect(rosterOnly.report.picturesSkipped).toBe(true);
    expect(rosterOnly.report.pictures).toEqual({});
    expect(JSON.stringify(rosterOnly.ok ? rosterOnly.pack.files : null)).not.toMatch(
      /"(imageRef|logoRef)"/,
    );
  });

  it('fails clearly when the workers table is missing', async () => {
    const conversion = convert(readTables(await makeWorldModDatabase({ withoutWorkers: true })));
    expect(conversion.ok).toBe(false);
    if (conversion.ok) return;
    expect(conversion.errors).toContain('The database has no workers table');
  });

  it('warns about an unknown style and maps it to a default', async () => {
    const conversion = convert(
      readTables(await makeWorldModDatabase({ firstStyle: 'Interpretive Dance' })),
    );
    const warning = conversion.report.warnings.find((entry) => entry.code === 'unknown-style');
    expect(warning).toMatchObject({ count: 1, examples: ['workers#1'] });
    expect(find(recordsOf(conversion, 'person'), 'wm-w1')['style']).toBe('allRounder');
  });
});

describe('records the engine checks refuse (UNITY-12)', () => {
  let failing: Tables;

  beforeAll(async () => {
    failing = readTables(await makeWorldModDatabase({ withCheckFailures: true }));
  });

  function warningCount(conversion: WorldModConversion, code: string): number | undefined {
    return conversion.report.warnings.find((warning) => warning.code === code)?.count;
  }

  it('imports an active team with a member who has died as inactive', () => {
    const conversion = convert(failing);
    expect(warningCount(conversion, 'team-member-deceased')).toBe(1);
    expect(find(recordsOf(conversion, 'team'), 'wm-tt2')['status']).toBe('inactive');
    expect(find(recordsOf(conversion, 'team'), 'wm-tt1')['status']).toBe('active');
  });

  it('keeps only the first contract between the same person and promotion', () => {
    const conversion = convert(failing);
    expect(warningCount(conversion, 'duplicate-contract')).toBe(1);
    const keys = recordsOf(conversion, 'employment').map((record) => record['key']);
    expect(keys).toContain('wm-k3');
    expect(keys).not.toContain('wm-k201');
    // Contract 3 is still the person's only contract, so it stays exclusive.
    expect(find(recordsOf(conversion, 'employment'), 'wm-k3')['terms']).toMatchObject({
      exclusive: true,
    });
  });

  it('makes an exclusive contract non-exclusive when its person has other contracts', () => {
    const conversion = convert(failing);
    const employments = recordsOf(conversion, 'employment');
    expect(find(employments, 'wm-k202')['terms']).toMatchObject({ exclusive: false });
    expect(find(employments, 'wm-k2')['terms']).toMatchObject({ exclusive: false });
    const warning = conversion.report.warnings.find(
      (entry) => entry.code === 'exclusive-alongside-other-contracts',
    );
    expect(warning).toMatchObject({ count: 1, examples: ['contracts#202'] });
  });

  it('imports the mod through the host with no loader problems', () => {
    const host = createEmbeddedHost({ content });
    const imported = parse(host.importWorldMod(JSON.stringify({ tables: failing })));
    expect(imported['issues']).toEqual([]);
    expect(imported['ok']).toBe(true);
    // The converter fixed every shape itself: the check did not have to skip anything.
    const report = imported['report'];
    const codes =
      isRec(report) && Array.isArray(report['warnings'])
        ? report['warnings'].filter(isRec).map((warning) => String(warning['code']))
        : [];
    expect(codes).toContain('team-member-deceased');
    expect(codes.filter((code) => code.startsWith('check-'))).toEqual([]);
  });

  it('skips a record the checks refuse and reports it, then loads the rest', () => {
    const conversion = convert(failing);
    if (!conversion.ok) throw new Error(conversion.errors.join('; '));
    // A shape the converter does not fix: the team with a member who has died, made active again.
    const teams = recordsOf(conversion, 'team').map((team) =>
      team['key'] === 'wm-tt2' ? { ...team, status: 'active' } : team,
    );
    const pack = { ...conversion.pack, files: { ...conversion.pack.files, team: teams } };
    const others = readContentPacks(content).packs;
    const checked = checkWorldModPack(others, pack, conversion.report);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const skipped = checked.report.warnings.find(
      (warning) => warning.code === 'check-teams.deceasedMember',
    );
    expect(skipped).toMatchObject({ count: 1, examples: ['team:wm-tt2'] });
    expect(checked.report.counts['team']).toBe(1);
    const kept = checked.pack.files.team;
    expect(Array.isArray(kept) ? kept.length : 0).toBe(1);
    // The input pack is left as it was.
    expect(pack.files.team).toHaveLength(2);
  });

  it('fails when a problem is not tied to one of the mod records', () => {
    const conversion = convert(failing);
    if (!conversion.ok) throw new Error(conversion.errors.join('; '));
    const pack = {
      ...conversion.pack,
      manifest: packManifestSchema.parse({
        ...conversion.pack.manifest,
        dependsOn: [{ id: 'no-such-pack', version: '^1.0.0' }],
      }),
    };
    const checked = checkWorldModPack(readContentPacks(content).packs, pack, conversion.report);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.errorCount).toBeGreaterThan(0);
    expect(checked.issues[0]?.severity).toBe('error');
  });
});

describe('picture references', () => {
  it('round-trips any file name through the engine-safe encoding', () => {
    const names = ['A b_c (2).png', 'Ünïcode name.PNG', '.hidden.png', 'x%20y.png'];
    for (const name of names) {
      const ref = encodeWorldModImageRef('people', name);
      expect(ref).toMatch(/^wm\/people\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/);
      expect(decodeWorldModImageRef(String(ref))).toBe(`people/${decodeURIComponent(name)}`);
    }
  });
});

describe('importWorldMod through the host', () => {
  it('imports the world, starts a new game in it and plays a week', async () => {
    const host = createEmbeddedHost({ content });
    const imported = parse(host.importWorldMod(JSON.stringify({ tables, packId: 'wm-fixture' })));
    expect(imported['issues']).toEqual([]);
    expect(imported['ok']).toBe(true);
    const worlds = parse(host.listWorlds())['packs'];
    expect(worlds).toContainEqual(expect.objectContaining({ id: 'wm-fixture', imported: true }));

    const created = parse(
      host.newGame(
        JSON.stringify({
          rootPackId: 'wm-fixture',
          seed: 'world-mod-test',
          playerName: 'Test Booker',
          saveName: 'World mod test',
          seasonLength: { preset: '12m' },
          player: {
            mode: 'found',
            name: 'Fixture Test Wrestling',
            shortName: 'FTW',
            homeRegionKey: 'us-texas',
            style: 'traditional',
            size: 'small',
            color: '#335577',
            starterKit: false,
            weeklyShowDay: 3,
          },
          settings: {},
        }),
      ),
    );
    expect(created['ok']).toBe(true);

    let days = 0;
    for (let attempt = 0; attempt < 20 && days < 7; attempt += 1) {
      host.command('news.ackAlerts', '{}');
      const advanced = parse(await host.advanceDays(JSON.stringify({ maxDays: 7 - days })));
      expect(advanced['ok']).toBe(true);
      expect(advanced['failures']).toEqual([]);
      days += Number(advanced['daysAdvanced']);
    }
    expect(days).toBe(7);
  });

  it('exports an imported world and registers it again in a fresh host (UNITY-14)', () => {
    const first = createEmbeddedHost({ content });
    expect(parse(first.importWorldMod(JSON.stringify({ tables, packId: 'wm-stored' })))['ok']).toBe(
      true,
    );
    const exported = parse(first.exportImportedWorld('wm-stored'));
    expect(exported['ok']).toBe(true);
    expect(parse(first.exportImportedWorld('wm-missing'))['ok']).toBe(false);

    // A restart: a new host knows only the bundled worlds until the stored pack is registered.
    const second = createEmbeddedHost({ content });
    const stored = JSON.stringify({ pack: exported['pack'] });
    const registered = parse(second.registerImportedWorld(stored));
    expect(registered['ok']).toBe(true);
    expect(parse(second.listWorlds())['packs']).toContainEqual(
      expect.objectContaining({ id: 'wm-stored', imported: true }),
    );
    expect(parse(second.previewWorld('wm-stored'))['ok']).toBe(true);
    expect(parse(second.registerImportedWorld(JSON.stringify({ pack: { files: {} } })))['ok']).toBe(
      false,
    );
    expect(parse(second.removeImportedWorld('wm-stored'))['removed']).toBe(true);
  });
});
