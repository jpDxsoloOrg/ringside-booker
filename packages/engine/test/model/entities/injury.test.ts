// The injuries table (WRK6-03). Design: docs/design/data-model.md, "Injuries".
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import { InjuryRecordSchema, injuriesTable } from '../../../src/model/entities/injury';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES, type GameWorld } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { loadSave } from '../../../src/persistence/load';
import { anInjury, TEST_INJURY_DAYS } from '../../support/builders/injury';
import { TEST_START_DATE } from '../../support/builders/build-row';
import { testId } from '../../support/ids';
import { worldBuilder } from '../../support/world-builder';

const BEFORE_INJURIES = new URL(
  '../../fixtures/saves/v1-tiny-before-injuries.json',
  import.meta.url,
);

function edit(world: GameWorld, body: Parameters<GameWorld['transact']>[1]): void {
  const result = world.transact('edit', body);
  if (!result.ok) {
    throw result.error;
  }
}

function injuredWorld() {
  const built = worldBuilder()
    .withGeography('mini')
    .withPromotion({}, (promotion) => promotion.withRoster(2))
    .withInjuryCatalog()
    .withInjury(0)
    .withInjury(1, { returnedOn: addDays(TEST_START_DATE, 3) })
    .build();
  const [open, closed] = built.ids.injuries;
  if (open === undefined || closed === undefined) {
    throw new Error('the injured world should have two injury rows');
  }
  return { ...built, open, closed };
}

describe('InjuryRecordSchema', () => {
  it('accepts the default row and a segment injury', () => {
    expect(InjuryRecordSchema.safeParse(anInjury()).success).toBe(true);
    expect(
      InjuryRecordSchema.safeParse(
        anInjury({ source: 'segment', segmentId: testId('segment'), severity: 'severe' }),
      ).success,
    ).toBe(true);
  });

  it('wants a segment exactly for a segment injury', () => {
    const row = anInjury();
    expect(InjuryRecordSchema.safeParse({ ...row, source: 'segment' }).success).toBe(false);
    expect(InjuryRecordSchema.safeParse({ ...row, segmentId: testId('segment') }).success).toBe(
      false,
    );
  });

  it('refuses a return before the injury and a loss outside 0..100', () => {
    const row = anInjury();
    const dayBefore = addDays(row.since, -1);
    expect(InjuryRecordSchema.safeParse({ ...row, expectedReturn: dayBefore }).success).toBe(false);
    expect(InjuryRecordSchema.safeParse({ ...row, returnedOn: dayBefore }).success).toBe(false);
    expect(InjuryRecordSchema.safeParse({ ...row, conditionLoss: -1 }).success).toBe(false);
    expect(InjuryRecordSchema.safeParse({ ...row, conditionLoss: 101 }).success).toBe(false);
    expect(InjuryRecordSchema.safeParse({ ...row, severity: 'mild' }).success).toBe(false);
  });
});

describe('injuries table', () => {
  it('is registered under prefix inj with its indexes', () => {
    expect(TABLES.injuries).toBe(injuriesTable);
    expect(injuriesTable.indexes.map((index) => index.name)).toEqual([
      'byPerson',
      'openByPerson',
      'awaitingNotice',
    ]);
    expect(injuredWorld().open).toMatch(/^inj_/);
  });

  it('passes every check with a current and a past injury, and the builder sets the pointer', () => {
    const { world, ids, open } = injuredWorld();
    expect(checkWorld(world, TABLES, { validateRows: true }).issues).toEqual([]);
    const row = world.tables.injuries.require(open);
    expect(world.tables.people.require(ids.people[0]!).injury).toEqual({
      kindKey: row.kindKey,
      bodyPart: row.bodyPart,
      since: TEST_START_DATE,
      expectedReturn: addDays(TEST_START_DATE, TEST_INJURY_DAYS),
      canWorkAngles: false,
    });
    expect(world.tables.people.require(ids.people[1]!).injury).toBeNull();
    expect(world.tables.injuries.lookup('byPerson', ids.people[1]!)).toHaveLength(1);
  });

  it('allows only one current injury per person', () => {
    const { world, ids } = injuredWorld();
    const result = world.transact('second', (tx) => {
      tx.insert('injuries', anInjury({ id: tx.mintId('injuries'), personId: ids.people[0]! }));
    });
    expect(result.ok).toBe(false);
  });

  it('flags an open row whose person has no matching pointer', () => {
    const { world, ids } = injuredWorld();
    edit(world, (tx) => {
      tx.update('people', ids.people[0]!, { injury: null });
    });
    expect(
      checkWorld(world, TABLES, { only: ['invariants'] }).issues.map((issue) => issue.code),
    ).toEqual(['injuries.openInjuryMatchesPerson']);
  });

  it('does not flag a pointer with no row, as a save from before the table may have', () => {
    const { world, ids, open } = injuredWorld();
    edit(world, (tx) => {
      tx.delete('injuries', open);
    });
    expect(world.tables.people.require(ids.people[0]!).injury).not.toBeNull();
    expect(checkWorld(world, TABLES, { only: ['invariants'] }).issues).toEqual([]);
  });

  it('finds rows awaiting notice', () => {
    const built = worldBuilder()
      .withGeography('mini')
      .withPromotion({}, (promotion) => promotion.withRoster(1))
      .withInjury(0, { noticedOn: null })
      .build();
    expect(built.world.tables.injuries.lookup('awaitingNotice', 'pending')).toHaveLength(1);
  });
});

describe('saves written before the injuries table', () => {
  it('load with an empty injuries table and pass the world checks', async () => {
    const report = await loadSave(new Uint8Array(readFileSync(BEFORE_INJURIES)), TABLES);
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    expect(report.doc.state.world.tables.injuries).toEqual([]);
    const world = documentToWorld(report.doc, TABLES);
    expect(checkWorld(world, TABLES, { validateRows: true }).issues).toEqual([]);
  });
});
