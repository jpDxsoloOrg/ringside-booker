// `segment-keys` (MTCH1-01): stored segment keys resolve against the catalogs the packs define,
// and the catalogs are usable for booking.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cents,
  loadWorldFromPacks,
  packs,
  parseContentKey,
  type LoadedWorld,
  type RawPack,
} from '@ringside/engine';
import { formatIssue } from '../src/issues';
import { segmentKeys } from '../src/rules/segmentKeys';
import { readMiniWorld, REPO_ROOT } from './helpers';

const MINI_ROOTS = ['mini-world'];

type JsonRecord = Record<string, unknown>;

function shippedCatalog(file: string): JsonRecord[] {
  const parsed: unknown = JSON.parse(
    readFileSync(join(REPO_ROOT, 'content/base/catalogs', file), 'utf8'),
  );
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} is not an array`);
  }
  const records: unknown[] = parsed;
  return records.filter(
    (record): record is JsonRecord =>
      typeof record === 'object' && record !== null && !Array.isArray(record),
  );
}

const CATALOG_FILES = {
  matchType: 'catalogs/match-types.json',
  angleType: 'catalogs/angle-types.json',
  method: 'catalogs/methods.json',
  finish: 'catalogs/finishes.json',
} as const;

type CatalogKind = keyof typeof CATALOG_FILES;

const CATALOG_KINDS: readonly CatalogKind[] = ['matchType', 'angleType', 'method', 'finish'];

/** The mini world with the shipped catalogs added to its base pack, each file edited by `edit`. */
async function miniWorldWithCatalogs(
  edit: Partial<Record<CatalogKind, (records: JsonRecord[]) => JsonRecord[]>> = {},
): Promise<RawPack[]> {
  const rawPacks = await readMiniWorld();
  return rawPacks.map((pack) => {
    if (pack.manifest.id !== 'mini-base') {
      return pack;
    }
    const files = { ...pack.files };
    for (const kind of CATALOG_KINDS) {
      const change = edit[kind] ?? ((records: JsonRecord[]) => records);
      files[kind] = change(shippedCatalog(CATALOG_FILES[kind].replace('catalogs/', '')));
    }
    return {
      manifest: { ...pack.manifest, files: { ...pack.manifest.files, ...CATALOG_FILES } },
      files,
    };
  });
}

function load(rawPacks: readonly RawPack[]) {
  const loaded = loadWorldFromPacks(rawPacks, MINI_ROOTS, { seed: 'validate' });
  if (!loaded.ok) {
    throw new Error(loaded.issues.map(packs.formatPackIssue).join('\n'));
  }
  const resolved = packs.resolvePacks(rawPacks, MINI_ROOTS);
  if (!resolved.ok) {
    throw new Error('Packs did not resolve');
  }
  const merged = packs.mergeRecords(resolved.value);
  if (!merged.ok) {
    throw new Error('Packs did not merge');
  }
  return { world: loaded.value.world, content: merged.value };
}

/** Adds a completed show with a won match and an angle carrying the given keys. */
function addShow(
  world: LoadedWorld['world'],
  keys: { matchTypeKey: string; methodKey: string; angleTypeKey: string },
): void {
  const promotion = world.tables.promotions.values()[0];
  const region = world.tables.regions.values()[0];
  if (promotion === undefined || region === undefined) {
    throw new Error('The mini world has no promotion or region');
  }
  const shared = {
    label: null,
    storylineIds: [],
    crew: { refereeId: null, producerId: null, announcerIds: [] },
    rating: null,
  };
  const result = world.transact('add a show', (tx) => {
    const show = tx.create('eventInstances', {
      promotionId: promotion.id,
      eventDefinitionId: null,
      brandId: null,
      name: 'Test Show',
      importance: 'regular',
      format: { slots: 2, preShowSlots: 0 },
      date: world.meta.startDate,
      airDate: world.meta.startDate,
      status: 'completed',
      venueId: null,
      regionId: region.id,
      result: {
        score: 50,
        rawScore: 50,
        traceId: null,
        attendance: 100,
        gate: cents(100_000),
        viewers: 0,
      },
      cancellation: null,
    });
    // Built first and passed as variables: `tx.create` takes the segment union with its ID left
    // out, which keeps only the fields both kinds share for an object literal's excess check.
    const match = {
      ...shared,
      eventInstanceId: show.id,
      slot: 0,
      preShow: false,
      kind: 'match' as const,
      match: {
        matchTypeKey: parseContentKey(keys.matchTypeKey),
        stipulationKeys: [],
        titleIds: [],
        finishKey: null,
      },
      outcome: {
        kind: 'win' as const,
        winningSide: 0,
        methodKey: parseContentKey(keys.methodKey),
      },
    };
    const angle = {
      ...shared,
      eventInstanceId: show.id,
      slot: 1,
      preShow: false,
      kind: 'angle' as const,
      angle: {
        angleTypeKey: parseContentKey(keys.angleTypeKey),
        beats: [{ beatKey: parseContentKey('beat.promo'), personIds: [] }],
      },
    };
    tx.create('segments', match);
    tx.create('segments', angle);
  });
  if (!result.ok) {
    throw result.error;
  }
}

/** The shipped match types with two sides of one (or more) person each. */
const SINGLES_LIKE = ['singles', 'endurance', 'sprint', 'handicap', 'tag-team', 'trios'];

describe('segment-keys', () => {
  it('passes the mini world with the shipped catalogs and resolvable segments', async () => {
    const { world, content } = load(await miniWorldWithCatalogs());
    addShow(world, {
      matchTypeKey: 'match.singles',
      methodKey: 'method.pinfall',
      angleTypeKey: 'angle.promo',
    });
    expect(segmentKeys.check(world, content).map(formatIssue)).toEqual([]);
  });

  it('reports each unknown segment key with the segment id and field', async () => {
    const { world, content } = load(await miniWorldWithCatalogs());
    addShow(world, {
      matchTypeKey: 'match.cage',
      methodKey: 'finish.pinfall',
      angleTypeKey: 'angle.seance',
    });
    const segments = world.tables.segments.values();
    const match = segments.find((segment) => segment.kind === 'match');
    const angle = segments.find((segment) => segment.kind === 'angle');
    const issues = segmentKeys.check(world, content);
    // Issues come in segment ID order; compare as a set of (segment, field) pairs.
    expect(issues.map((issue) => [issue.severity, issue.code, issue.packId, issue.path])).toEqual(
      expect.arrayContaining([
        ['error', 'segment-keys', 'mini-world', ['segments', match?.id, 'match', 'matchTypeKey']],
        ['error', 'segment-keys', 'mini-world', ['segments', match?.id, 'outcome', 'methodKey']],
        ['error', 'segment-keys', 'mini-world', ['segments', angle?.id, 'angle', 'angleTypeKey']],
      ]),
    );
    expect(issues).toHaveLength(3);
  });

  it('checks no segment keys when the packs define no catalogs', async () => {
    const { world, content } = load(await readMiniWorld());
    addShow(world, {
      matchTypeKey: 'match.cage',
      methodKey: 'finish.pinfall',
      angleTypeKey: 'angle.seance',
    });
    expect(segmentKeys.check(world, content)).toEqual([]);
  });

  it('fails catalogs with no visible singles-like match type', async () => {
    const { world, content } = load(
      await miniWorldWithCatalogs({
        matchType: (records) =>
          records.map((record) =>
            SINGLES_LIKE.includes(String(record['key'])) ? { ...record, hidden: true } : record,
          ),
      }),
    );
    expect(segmentKeys.check(world, content).map(formatIssue)).toEqual([
      'error segment-keys mini-base/catalogs/match-types.json matchType.battle-royal: No visible match type has sides.min 2 and sideSize.min 1; booking needs at least one singles-like match type',
    ]);
  });

  it('fails two entries of one catalog with the same name', async () => {
    const { world, content } = load(
      await miniWorldWithCatalogs({
        method: (records) =>
          records.map((record) =>
            record['key'] === 'submission' ? { ...record, name: 'pinfall!' } : record,
          ),
      }),
    );
    expect(segmentKeys.check(world, content).map(formatIssue)).toEqual([
      'error segment-keys mini-base/catalogs/methods.json method.submission.name: method submission is named "pinfall!", already used by pinfall',
    ]);
  });

  it('fails a finish catalog that leaves a match type with no automatic win finish', async () => {
    const { world, content } = load(
      await miniWorldWithCatalogs({
        finish: (records) =>
          records.map((record) => {
            if (record['key'] === 'clean') {
              return { ...record, matchTypes: { except: ['sprint'] } };
            }
            return record['outcomeKind'] === 'win' ? { ...record, autoWeight: 0 } : record;
          }),
      }),
    );
    expect(segmentKeys.check(world, content).map(formatIssue)).toEqual([
      'error segment-keys mini-base/catalogs/match-types.json matchType.sprint: match type match.sprint allows no win finish with an autoWeight above 0, so no finish can be picked automatically',
    ]);
  });
});
