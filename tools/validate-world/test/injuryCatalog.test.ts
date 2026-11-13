// `injury-catalog` (WRK6-01): every body part has an injury kind, labels are distinct, and every
// stored injury names a kind in the catalog.
import { describe, expect, it } from 'vitest';
import {
  BODY_PARTS,
  loadWorldFromPacks,
  packs,
  parseContentKey,
  type RawPack,
} from '@ringside/engine';
import { injuryCatalog } from '../src/rules/injuryCatalog';
import { checkRule, editRecords, readMiniWorld } from './helpers';

type JsonRecord = Record<string, unknown>;

function injuryKind(key: string, label: string, bodyPart: string): JsonRecord {
  return {
    key,
    label,
    bodyPart,
    minDays: 10,
    maxDays: 20,
    weight: 10,
    canWorkAnglesChance: 0.5,
    severityWeights: { minor: 60, moderate: 30, severe: 10 },
  };
}

/** One injury kind per body part, labelled after the part. */
const FULL_CATALOG: JsonRecord[] = BODY_PARTS.map((part) =>
  injuryKind(`${part}-hurt`, `Hurt ${part}`, part),
);

/** The mini world with `records` as mini-base's `injuries.json`. */
async function withInjuries(records: JsonRecord[]): Promise<RawPack[]> {
  const preNamed = (await readMiniWorld()).map((pack) =>
    pack.manifest.id === 'mini-base'
      ? {
          ...pack,
          manifest: {
            ...pack.manifest,
            files: { ...pack.manifest.files, injuryKind: 'injuries.json' },
          },
        }
      : pack,
  );
  return editRecords(preNamed, 'mini-base', 'injuryKind', () => records);
}

describe('injury-catalog', () => {
  it('skips a world with no injury catalog', async () => {
    expect(checkRule(injuryCatalog, await readMiniWorld(), ['mini-world'])).toEqual([]);
  });

  it('passes a catalog covering every body part with distinct labels', async () => {
    expect(checkRule(injuryCatalog, await withInjuries(FULL_CATALOG), ['mini-world'])).toEqual([]);
  });

  it('warns about each body part with no injury kind', async () => {
    const records = FULL_CATALOG.filter(
      (record) => record['bodyPart'] !== 'neck' && record['bodyPart'] !== 'back',
    );
    const issues = checkRule(injuryCatalog, await withInjuries(records), ['mini-world']);
    expect(issues.map((issue) => [issue.severity, issue.code, issue.packId])).toEqual([
      ['warning', 'injury-catalog', 'mini-base'],
      ['warning', 'injury-catalog', 'mini-base'],
    ]);
    expect(issues.map((issue) => issue.message)).toEqual([
      expect.stringMatching(/hurts the neck/),
      expect.stringMatching(/hurts the back/),
    ]);
  });

  it('reports a repeated label, ignoring case, on the later key', async () => {
    const records = [...FULL_CATALOG, injuryKind('zz-legs', 'HURT legs', 'legs')];
    const issues = checkRule(injuryCatalog, await withInjuries(records), ['mini-world']);
    expect(issues.map((issue) => [issue.severity, issue.file, issue.path])).toEqual([
      ['error', 'injuries.json', ['injuryKind', 'zz-legs', 'label']],
    ]);
    expect(issues[0]?.message).toMatch(/already used by injury\.legs-hurt/);
  });

  it("reports a person's injury that is not in the catalog, by the person's pack key", async () => {
    const rawPacks = await withInjuries(FULL_CATALOG);
    const loaded = loadWorldFromPacks(rawPacks, ['mini-world'], { seed: 'validate' });
    if (!loaded.ok) {
      throw new Error('mini-world did not load');
    }
    const { world } = loaded.value;
    const [personKey, personId] = Object.entries(world.meta.contentKeys['person'] ?? {})[0] ?? [];
    const person = world.tables.people.values().find((row) => row.id === personId);
    if (personKey === undefined || person === undefined) {
      throw new Error('mini-world has no people');
    }
    const injured = (kindKey: string) =>
      world.transact('injure', (tx) => {
        tx.update('people', person.id, (row) => ({
          ...row,
          injury: {
            kindKey: parseContentKey(kindKey),
            bodyPart: 'legs',
            since: world.meta.currentDate,
            expectedReturn: world.meta.currentDate,
            canWorkAngles: false,
          },
        }));
      });
    const resolved = packs.resolvePacks(rawPacks, ['mini-world']);
    if (!resolved.ok) {
      throw new Error('Packs did not resolve');
    }
    const merged = packs.mergeRecords(resolved.value);
    if (!merged.ok) {
      throw new Error('Packs did not merge');
    }

    expect(injured('injury.legs-hurt').ok).toBe(true);
    expect(injuryCatalog.check(world, merged.value)).toEqual([]);

    expect(injured('injury.torn-tail').ok).toBe(true);
    const issues = injuryCatalog.check(world, merged.value);
    expect(issues.map((issue) => [issue.severity, issue.recordKey, issue.path])).toEqual([
      ['error', personKey, ['person', personKey, 'injury', 'kindKey']],
    ]);
    expect(issues[0]?.message).toMatch(/injury\.torn-tail/);
  });
});
