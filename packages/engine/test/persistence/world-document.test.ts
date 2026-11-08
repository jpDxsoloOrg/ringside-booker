import { describe, expect, it } from 'vitest';
import { EntityNotFoundError, SaveDocumentError } from '../../src/core/errors';
import { checkWorld } from '../../src/model/integrity';
import { TABLES } from '../../src/model/tables';
import {
  createSaveDocumentSchema,
  SerializedWorldSchema,
} from '../../src/persistence/save-document';
import {
  createSaveDocument,
  documentToWorld,
  serialiseWorld,
  worldToDocument,
} from '../../src/persistence/world-document';
import { testId } from '../support/ids';
import { PLACEHOLDER_SIM_STATE, TEST_SAVED_AT, testSaveDocument } from '../support/saves';
import { serialiseWorld as serialiseGolden } from '../support/serialise';
import { tinyWorld } from '../support/worlds';

const EXTRAS = {
  headerPromotionId: null,
  savedAt: TEST_SAVED_AT,
  label: 'Round trip',
  engineVersion: '0.1.0',
} as const;

describe('SerializedWorldSchema', () => {
  it('has one table array for every registered table', () => {
    expect(Object.keys(SerializedWorldSchema.shape.tables.shape).sort()).toEqual(
      Object.keys(TABLES).sort(),
    );
  });
});

describe('worldToDocument', () => {
  it('writes every table as an array of rows in ascending ID order', () => {
    const { world } = tinyWorld();
    const doc = worldToDocument(world, { ...EXTRAS, simState: {} });
    for (const [name, rows] of Object.entries(doc.state.world.tables)) {
      const ids = rows.map((row) => row.id);
      expect(ids, name).toEqual([...ids].sort());
      expect(rows.length, name).toBeGreaterThan(0);
    }
  });

  it('stores the same world the golden fixture serialises', () => {
    const { world } = tinyWorld();
    const doc = worldToDocument(world, { ...EXTRAS, simState: {} });
    expect(doc.state.world).toEqual(JSON.parse(serialiseGolden(world)));
  });

  it('stores missing simulation parts as null', () => {
    const { world } = tinyWorld();
    const doc = worldToDocument(world, { ...EXTRAS, simState: { rng: { position: 3 } } });
    expect(doc.state.rng).toEqual({ position: 3 });
    expect(doc.state.traces).toBeNull();
    expect(doc.state.commandLog).toBeNull();
  });

  it('round-trips: worldToDocument(documentToWorld(doc)) deep-equals doc', () => {
    const { world, ids } = tinyWorld();
    const extras = {
      ...EXTRAS,
      headerPromotionId: ids.promotions.A ?? null,
      simState: PLACEHOLDER_SIM_STATE,
    };
    const doc = worldToDocument(world, extras);
    const rebuilt = documentToWorld(doc, TABLES);
    expect(worldToDocument(rebuilt, extras)).toEqual(doc);
  });
});

describe('createSaveDocument', () => {
  it('builds a document that validates against the default schema', () => {
    const { world } = tinyWorld();
    const doc = createSaveDocument(
      {
        world: serialiseWorld(world),
        rng: null,
        tunableOverrides: null,
        traces: null,
        events: null,
        failureLog: null,
        commandLog: null,
      },
      EXTRAS,
    );
    const result = createSaveDocumentSchema().safeParse(doc);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(doc.format).toBe('ringside-booker/save');
    expect(doc.formatVersion).toBe(1);
  });

  it('builds the header from the world and the named promotion', () => {
    const { world, ids } = tinyWorld();
    const promotionB = ids.promotions.B ?? null;
    const doc = createSaveDocument(
      { world: serialiseWorld(world), ...PLACEHOLDER_SIM_STATE },
      { ...EXTRAS, headerPromotionId: promotionB, label: 'Rival view' },
    );
    expect(doc.header).toEqual({
      worldName: 'Test Tiny World',
      promotionName: 'Test Promotion B',
      promotionShortName: 'TPB',
      gameDate: world.meta.currentDate,
      startDate: world.meta.startDate,
      daysSimulated: world.meta.daysSimulated,
      cash: 250_000_000,
      label: 'Rival view',
    });
  });

  it('leaves the promotion fields null in a sandbox or observer save', () => {
    const doc = testSaveDocument(tinyWorld().world);
    expect(doc.header.promotionName).toBeNull();
    expect(doc.header.promotionShortName).toBeNull();
    expect(doc.header.cash).toBeNull();
  });

  it('throws for a header promotion the world does not have', () => {
    const { world } = tinyWorld();
    expect(() =>
      createSaveDocument(
        { world: serialiseWorld(world), ...PLACEHOLDER_SIM_STATE },
        { ...EXTRAS, headerPromotionId: testId('promotion', 99) },
      ),
    ).toThrow(EntityNotFoundError);
  });
});

describe('documentToWorld', () => {
  it('rebuilds indexes and passes the integrity check', () => {
    const { world, ids } = tinyWorld();
    const rebuilt = documentToWorld(testSaveDocument(world), TABLES);
    const promotionA = ids.promotions.A;
    if (promotionA === undefined) {
      throw new Error('tinyWorld has no promotion A');
    }
    expect(rebuilt.tables.employments.lookup('byPromotion', promotionA)).toEqual(
      world.tables.employments.lookup('byPromotion', promotionA),
    );
    expect(rebuilt.tables.people.size).toBe(world.tables.people.size);
    expect(checkWorld(rebuilt, TABLES).ok).toBe(true);
  });

  it('gives the world the ID factory and write mode it is asked for', () => {
    const rebuilt = documentToWorld(testSaveDocument(tinyWorld().world), TABLES, {
      validateWrites: 'always',
    });
    const result = rebuilt.transact('bad write', (tx) => {
      const [personId] = tx.view.tables.people.ids();
      tx.update('people', personId!, { fatigue: 140 });
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a table the registry does not know', () => {
    const doc = testSaveDocument(tinyWorld().world);
    const tables = { ...doc.state.world.tables, gimmicks: [] };
    expect(() =>
      documentToWorld({ state: { world: { meta: doc.state.world.meta, tables } } }, TABLES),
    ).toThrow(new SaveDocumentError('state.world.tables.gimmicks', 'is not a table of this game'));
  });

  it('refuses a repeated ID with the path of the second row', () => {
    const doc = structuredClone(testSaveDocument(tinyWorld().world));
    const people = doc.state.world.tables.people;
    people[1] = { ...people[1]!, id: people[0]!.id };
    expect(() => documentToWorld(doc, TABLES)).toThrow(
      /state\.world\.tables\.people\[1\]: repeats/,
    );
  });

  it('refuses a row whose ID is of another kind', () => {
    const doc = testSaveDocument(tinyWorld().world);
    const tables = { ...doc.state.world.tables, brands: doc.state.world.tables.people };
    expect(() =>
      documentToWorld({ state: { world: { meta: doc.state.world.meta, tables } } }, TABLES),
    ).toThrow(/state\.world\.tables\.brands\[0\]: id is not a brand ID/);
  });
});
