// The broadcast groundwork (ECO8-01): the airings table, the deal lifecycle fields, the bundle's
// registration and older saves. Design: docs/design/broadcast.md#airings-table.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import { ENTITY_KINDS } from '../../../src/core/ids';
import { checkWorld } from '../../../src/model/integrity';
import { AiringSchema, airingsTable } from '../../../src/model/entities/airing';
import { DealSchema } from '../../../src/model/entities/deal';
import { TABLES } from '../../../src/model/tables';
import { loadSave } from '../../../src/persistence/load';
import { documentToWorld } from '../../../src/persistence/world-document';
import { defaultSystems } from '../../../src/systems';
import {
  airingTraceRef,
  broadcastSystem,
  dealHealthTraceRef,
  incomeCategoryFor,
  AIRTIME_COST_CATEGORY,
} from '../../../src/systems/broadcast';
import { ALL_TUNABLES, createEngineTunables } from '../../../src/systems/tunables';
import { TEST_START_DATE } from '../../support/builders/build-row';
import { aDeal, anAiring } from '../../support/builders/media';
import { testId } from '../../support/ids';
import { parseIssues } from '../../support/schema-issues';
import { tinyWorld } from '../../support/worlds';

const BEFORE_AIRINGS = new URL(
  '../../fixtures/saves/v1-tiny-before-negotiations.json',
  import.meta.url,
);

function valid(schema: typeof AiringSchema | typeof DealSchema, row: unknown): boolean {
  return schema.safeParse(row).success;
}

const MISSED = {
  status: 'missed',
  missReason: 'showCancelled',
  quality: null,
  viewers: 0,
  income: 0,
  sharesPaid: 0,
  cost: 0,
} as const;

describe('AiringSchema', () => {
  it('accepts an aired row and a missed row', () => {
    expect(valid(AiringSchema, anAiring())).toBe(true);
    expect(valid(AiringSchema, { ...anAiring(), ...MISSED })).toBe(true);
    expect(valid(AiringSchema, { ...anAiring(), ...MISSED, expectedViewers: 0 })).toBe(true);
  });

  it('sets missReason exactly when the airing was missed', () => {
    expect(parseIssues(AiringSchema, { ...anAiring(), missReason: 'notRun' })).toContain(
      'missReason: missReason is set exactly when the airing was missed',
    );
    expect(parseIssues(AiringSchema, { ...anAiring(), ...MISSED, missReason: null })).toContain(
      'missReason: missReason is set exactly when the airing was missed',
    );
  });

  it('refuses a missed row with viewers, money or quality', () => {
    const missed = { ...anAiring(), ...MISSED };
    for (const field of ['viewers', 'income', 'sharesPaid', 'cost'] as const) {
      expect(valid(AiringSchema, { ...missed, [field]: 100 }), field).toBe(false);
    }
    expect(valid(AiringSchema, { ...missed, quality: { score: 50, source: 'neutral' } })).toBe(
      false,
    );
  });

  it('refuses unknown fields, an empty or long show name and a quality out of range', () => {
    expect(valid(AiringSchema, { ...anAiring(), extra: 1 })).toBe(false);
    expect(valid(AiringSchema, { ...anAiring(), showName: '' })).toBe(false);
    expect(valid(AiringSchema, { ...anAiring(), showName: 'x'.repeat(81) })).toBe(false);
    expect(valid(AiringSchema, { ...anAiring(), quality: { score: 101, source: 'show' } })).toBe(
      false,
    );
  });

  it('declares its refs and indexes', () => {
    expect(airingsTable.refs.map((ref) => [ref.path, ref.target, ref.nullable])).toEqual([
      ['dealId', 'deal', false],
      ['networkId', 'network', false],
      ['promotionId', 'promotion', false],
      ['eventInstanceId', 'eventInstance', true],
      ['eventDefinitionId', 'eventDefinition', true],
    ]);
    expect(airingsTable.indexes.map((index) => index.name)).toEqual([
      'byDeal',
      'byPromotion',
      'byEventInstance',
      'byAirDate',
    ]);
  });

  it('is registered in TABLES and ENTITY_KINDS', () => {
    expect(TABLES.airings).toBe(airingsTable);
    expect(ENTITY_KINDS.airing).toBe('air');
  });

  it("reports a dangling ref in tinyWorld's airing", () => {
    const { world, ids } = tinyWorld();
    expect(checkWorld(world, TABLES, { validateRows: true }).issues).toEqual([]);
    const [airingId] = ids.airings;
    const result = world.transact('break the airing', (tx) => {
      tx.update('airings', airingId!, { dealId: testId('deal', 99) });
    });
    expect(result.ok).toBe(true);
    const codes = checkWorld(world, TABLES).issues.map((issue) => issue.code);
    expect(codes).toContain('ref.dangling');
  });
});

describe('deal lifecycle fields', () => {
  const ended = { endedOn: addDays(TEST_START_DATE, 30), endedReason: 'lowViewers' } as const;

  it('are null on an active deal and set on an ended one', () => {
    expect(aDeal()).toMatchObject({
      endedOn: null,
      endedReason: null,
      renegotiatedOn: null,
      warnedOn: null,
    });
    expect(valid(DealSchema, { ...aDeal(), status: 'expired', ...ended })).toBe(true);
    expect(valid(DealSchema, { ...aDeal(), status: 'cancelled', ...ended })).toBe(true);
  });

  it('refuses end fields on a deal that has not ended, and an ended deal without them', () => {
    expect(valid(DealSchema, { ...aDeal(), ...ended })).toBe(false);
    expect(valid(DealSchema, { ...aDeal(), endedOn: ended.endedOn })).toBe(false);
    expect(valid(DealSchema, { ...aDeal(), status: 'expired' })).toBe(false);
    expect(valid(DealSchema, { ...aDeal(), status: 'cancelled', endedOn: ended.endedOn })).toBe(
      false,
    );
    expect(valid(DealSchema, { ...aDeal(), status: 'offered', ...ended })).toBe(false);
  });

  it('accept renegotiation and warning dates on an active deal', () => {
    const renegotiated = {
      ...aDeal(),
      renegotiatedOn: addDays(TEST_START_DATE, 3),
      warnedOn: addDays(TEST_START_DATE, 5),
    };
    expect(valid(DealSchema, renegotiated)).toBe(true);
  });

  it('default to null for a deal written before them', () => {
    const {
      endedOn: _endedOn,
      endedReason: _endedReason,
      renegotiatedOn: _renegotiatedOn,
      warnedOn: _warnedOn,
      ...older
    } = aDeal();
    expect(DealSchema.parse(older)).toMatchObject({
      endedOn: null,
      endedReason: null,
      renegotiatedOn: null,
      warnedOn: null,
    });
  });
});

describe('saves written before the airings table', () => {
  it('load with an empty airings table, null deal fields, and pass the world checks', async () => {
    const report = await loadSave(new Uint8Array(readFileSync(BEFORE_AIRINGS)), TABLES);
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    expect(report.doc.state.world.tables.airings).toEqual([]);
    for (const deal of report.doc.state.world.tables.deals) {
      expect(deal.endedOn).toBeNull();
      expect(deal.warnedOn).toBeNull();
    }
    const world = documentToWorld(report.doc, TABLES);
    expect(checkWorld(world, TABLES, { validateRows: true }).issues).toEqual([]);
  });
});

describe('the broadcast bundle', () => {
  it('is registered once, with nothing to run yet', () => {
    expect(defaultSystems.filter((system) => system.id === 'broadcast')).toEqual([broadcastSystem]);
    expect(new Set(defaultSystems.map((system) => system.id)).size).toBe(defaultSystems.length);
    expect(broadcastSystem.phases).toEqual([]);
  });

  it('defines its tunable in the Broadcast category', () => {
    const def = ALL_TUNABLES['broadcast.networks.minPopularityToList'];
    expect(def).toMatchObject({ kind: 'integer', default: 1, min: 0, max: 100, unit: 'points' });
    expect(def.category).toBe('Broadcast');
    expect(createEngineTunables().get('broadcast.networks.minPopularityToList')).toBe(1);
  });

  it('stores player airings and rival airings under separate trace kinds', () => {
    const airing = anAiring();
    expect(airingTraceRef(airing, true)).toEqual({ kind: 'broadcast.airing', id: airing.id });
    expect(airingTraceRef(airing, false)).toEqual({
      kind: 'broadcast.rivalAiring',
      id: airing.id,
    });
    expect(dealHealthTraceRef(airing.dealId)).toEqual({
      kind: 'broadcast.health',
      id: airing.dealId,
    });
  });

  it('posts each network kind under its own income category, airtime under production', () => {
    expect(incomeCategoryFor('tv')).toBe('broadcast');
    expect(incomeCategoryFor('ppv')).toBe('ppv');
    expect(incomeCategoryFor('streaming')).toBe('streaming');
    expect(AIRTIME_COST_CATEGORY).toBe('production');
  });
});
