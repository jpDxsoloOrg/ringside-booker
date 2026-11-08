import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MigrationError, RegistryError } from '../../src/core/errors';
import {
  isJsonArray,
  isJsonObject,
  isJsonValue,
  type JsonObject,
  type JsonValue,
} from '../../src/core/json';
import { TABLES } from '../../src/model/tables';
import { encodeSave } from '../../src/persistence/codec';
import { loadSave } from '../../src/persistence/load';
import {
  assertMigrationChain,
  CURRENT_FORMAT_VERSION,
  MIGRATIONS,
  type Migration,
} from '../../src/persistence/migrations/registry';
import { runMigrations } from '../../src/persistence/migrations/run';
import { tinySaveDocument } from '../support/saves';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../src/persistence/migrations/', import.meta.url));
const SAVE_FIXTURES_DIR = fileURLToPath(new URL('../fixtures/saves/', import.meta.url));

/** Migration files are named `vNNNN-to-vNNNN-<slug>.ts`. */
const MIGRATION_FILE = /^v(\d{4})-to-v(\d{4})-[a-z0-9-]+\.ts$/;

function objectAt(value: JsonValue | undefined, what: string): JsonObject {
  if (value === undefined || !isJsonObject(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value;
}

/** Rewrites every person row of a document, the way a real migration walks raw JSON. */
function mapPeople(doc: JsonObject, mapPerson: (person: JsonObject) => JsonObject): JsonObject {
  const state = objectAt(doc['state'], 'state');
  const world = objectAt(state['world'], 'state.world');
  const tables = objectAt(world['tables'], 'state.world.tables');
  const mapped = peopleOf(doc).map((person) => mapPerson(objectAt(person, 'a person')));
  return {
    ...doc,
    state: { ...state, world: { ...world, tables: { ...tables, people: mapped } } },
  };
}

const renameMic: Migration = {
  from: 1,
  to: 2,
  title: 'Rename mic to talking',
  up: (doc) =>
    mapPeople(doc, (person) => {
      const { mic, ...attributes } = objectAt(person['attributes'], 'attributes');
      return { ...person, attributes: { ...attributes, talking: mic ?? 50 } };
    }),
};

const addWeather: Migration = {
  from: 2,
  to: 3,
  title: 'Add the weather setting',
  up: (doc) => {
    const state = objectAt(doc['state'], 'state');
    const world = objectAt(state['world'], 'state.world');
    const meta = objectAt(world['meta'], 'state.world.meta');
    return {
      ...doc,
      state: { ...state, world: { ...world, meta: { ...meta, weatherEnabled: false } } },
    };
  },
};

const TEST_CHAIN: readonly Migration[] = [renameMic, addWeather];

function tinyDocAsJson(): JsonObject {
  const parsed: unknown = JSON.parse(JSON.stringify(tinySaveDocument()));
  if (!isJsonValue(parsed)) {
    throw new Error('the document is not JSON');
  }
  return objectAt(parsed, 'the document');
}

function peopleOf(doc: JsonObject): readonly JsonValue[] {
  const state = objectAt(doc['state'], 'state');
  const world = objectAt(state['world'], 'state.world');
  const people = objectAt(world['tables'], 'state.world.tables')['people'];
  if (people === undefined || !isJsonArray(people)) {
    throw new Error('state.world.tables.people is not an array');
  }
  return people;
}

/** Lets a migration return a value the type system would refuse, as a buggy one could. */
function corruptResult(value: unknown): JsonObject {
  return z.custom<JsonObject>(() => true).parse(value);
}

describe('the real migration chain', () => {
  it('is contiguous and ends at the current format version', () => {
    expect(() => {
      assertMigrationChain(MIGRATIONS, CURRENT_FORMAT_VERSION);
    }).not.toThrow();
  });

  it('has a source file named vNNNN-to-vNNNN-<slug>.ts for every step, and nothing else', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((name) => /^v\d/.test(name));
    for (const file of files) {
      expect(file).toMatch(MIGRATION_FILE);
    }
    const steps = files.map((file) => {
      const match = MIGRATION_FILE.exec(file);
      return { from: Number(match?.[1]), to: Number(match?.[2]) };
    });
    expect(steps).toEqual(MIGRATIONS.map(({ from, to }) => ({ from, to })));
  });

  it('has a save fixture for every version it migrates from, which loads cleanly', async () => {
    const fixtures = readdirSync(SAVE_FIXTURES_DIR);
    for (const migration of MIGRATIONS) {
      const fixture = fixtures.find((name) => {
        const match = /^v(\d+)-.+\.json$/.exec(name);
        return match !== null && Number(match[1]) === migration.from;
      });
      expect(fixture, `fixture for v${String(migration.from)}`).toBeDefined();
      const bytes = new Uint8Array(readFileSync(`${SAVE_FIXTURES_DIR}${fixture ?? ''}`));
      const report = await loadSave(bytes, TABLES);
      expect(report.ok, `v${String(migration.from)} fixture loads`).toBe(true);
    }
    expect(existsSync(`${SAVE_FIXTURES_DIR}v${String(CURRENT_FORMAT_VERSION)}-tiny.json`)).toBe(
      true,
    );
  });
});

describe('assertMigrationChain', () => {
  it('accepts an empty chain at v1 and a contiguous chain at its end', () => {
    expect(() => {
      assertMigrationChain([], 1);
    }).not.toThrow();
    expect(() => {
      assertMigrationChain(TEST_CHAIN, 3);
    }).not.toThrow();
  });

  it('refuses a gap, a step that skips a version, or the wrong end', () => {
    expect(() => {
      assertMigrationChain([addWeather], 3);
    }).toThrow(RegistryError);
    expect(() => {
      assertMigrationChain([{ ...renameMic, to: 3 }], 3);
    }).toThrow(/expected v1 to v2/);
    expect(() => {
      assertMigrationChain(TEST_CHAIN, 4);
    }).toThrow(/reach v3 but the current format version is v4/);
    expect(() => {
      assertMigrationChain([], 0);
    }).toThrow(RegistryError);
  });
});

describe('runMigrations', () => {
  it('upgrades a v1 document to v3, running each step once in order', () => {
    const input = tinyDocAsJson();
    const before = JSON.stringify(input);
    const { doc, applied } = runMigrations(input, TEST_CHAIN, 3);

    expect(applied).toEqual([
      { from: 1, to: 2, title: 'Rename mic to talking' },
      { from: 2, to: 3, title: 'Add the weather setting' },
    ]);
    expect(doc['formatVersion']).toBe(3);
    const person = objectAt(peopleOf(doc)[0], 'the first person after migration');
    const attributes = objectAt(person['attributes'], 'attributes');
    expect(attributes['mic']).toBeUndefined();
    expect(attributes['talking']).toBe(50);
    const meta = objectAt(
      objectAt(objectAt(doc['state'], 'state')['world'], 'world')['meta'],
      'meta',
    );
    expect(meta['weatherEnabled']).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('runs only the steps after the document version', () => {
    const v2 = { ...tinyDocAsJson(), formatVersion: 2 };
    const { applied } = runMigrations(v2, TEST_CHAIN, 3);
    expect(applied.map((step) => step.title)).toEqual(['Add the weather setting']);
  });

  it('returns a current document untouched', () => {
    const doc = tinyDocAsJson();
    expect(runMigrations(doc, MIGRATIONS, CURRENT_FORMAT_VERSION)).toEqual({ doc, applied: [] });
  });

  it('hands every step its own copy, so a mutating step cannot change the caller document', () => {
    const mutating: Migration = {
      from: 1,
      to: 2,
      title: 'Mutates its input',
      up: (doc) => {
        Reflect.set(doc, 'header', 'gone');
        return doc;
      },
    };
    const input = tinyDocAsJson();
    const result = runMigrations(input, [mutating], 2);
    expect(result.doc['header']).toBe('gone');
    expect(isJsonObject(input['header'] ?? null)).toBe(true);
  });

  it('wraps a throwing step in a MigrationError naming it', () => {
    const throwing: Migration = {
      ...renameMic,
      up: () => {
        throw new Error('people table is missing');
      },
    };
    expect(() => runMigrations(tinyDocAsJson(), [throwing, addWeather], 3)).toThrow(
      new MigrationError(1, 2, 'Rename mic to talking', 'people table is missing'),
    );
  });

  it('refuses a step that returns something other than a JSON object', () => {
    const badResult: Migration = { ...renameMic, up: () => corruptResult({ lookup: new Map() }) };
    expect(() => runMigrations(tinyDocAsJson(), [badResult], 2)).toThrow(/not plain JSON/);
  });
});

describe('loadSave with a failing migration', () => {
  it('stops at the migrate stage and names the step', async () => {
    const throwing: Migration = {
      ...renameMic,
      up: () => {
        throw new Error('people table is missing');
      },
    };
    const bytes = await encodeSave(tinySaveDocument());
    const report = await loadSave(bytes, TABLES, {
      migrations: { list: [throwing, addWeather], current: 3 },
    });
    expect(report).toMatchObject({ ok: false, stage: 'migrate', truncated: 0 });
    expect(!report.ok && report.issues[0]?.message).toBe(
      'Save migration v1 → v2 "Rename mic to talking" failed: people table is missing',
    );
  });
});
