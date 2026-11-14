// The match system's queries. Design: docs/design/match-rating.md
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine, type Viewer } from '../../../src/core/api';
import { parseContentKey } from '../../../src/core/content-key';
import type { Catalogs } from '../../../src/model/catalogs';
import { defaultSystems } from '../../../src/systems';
import { TEST_CATALOGS } from '../../support/catalogs';
import { worldBuilder } from '../../support';
import { expectSerialisable } from '../../support/trace';

const OMNISCIENT: Viewer = { kind: 'omniscient' };
const PLAYER: Viewer = { kind: 'controller', controller: { kind: 'human', playerId: 'player-1' } };

function engineWith(catalogs: Catalogs | null, overrides: Record<string, number> = {}): Engine {
  const builder = worldBuilder();
  const built = catalogs === null ? builder.build() : builder.withCatalogs(catalogs).build();
  return createEngine({
    state: { ...initialEngineState(built.world), tunableOverrides: overrides },
    systems: defaultSystems,
  });
}

function fieldNamesOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(fieldNamesOf);
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([name, child]) => [name, ...fieldNamesOf(child)]);
}

/** The base catalogs with the sprint marked hidden. */
function catalogsWithHiddenSprint(): Catalogs {
  const matchTypes = Object.fromEntries(
    Object.entries(TEST_CATALOGS.matchTypes ?? {}).map(([key, def]) => [
      key,
      def.key === 'match.sprint' ? { ...def, hidden: true } : def,
    ]),
  );
  return { ...TEST_CATALOGS, matchTypes };
}

describe('match.catalog', () => {
  it('lists the base types in order', () => {
    const result = engineWith(TEST_CATALOGS).query('match.catalog', {}, PLAYER);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    const catalog = result.data;
    expect(catalog.available).toBe(true);
    expect(catalog.matchTypes.map((option) => option.key)).toEqual([
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
    const orders = catalog.matchTypes.map((option) => option.order);
    expect(orders).toEqual([...orders].sort((left, right) => left - right));
    expect(catalog.angleTypes[0]?.key).toBe('angle.promo');
    expect(catalog.methods[0]?.key).toBe('method.pinfall');
    const battleRoyal = catalog.matchTypes.find((option) => option.key === 'match.battle-royal');
    expect(battleRoyal?.durationShift).toBe(1);
    expect(typeof battleRoyal?.allowsTitles).toBe('boolean');
    expect(typeof catalog.methods[0]?.changesTitles).toBe('boolean');
    expect(catalog.matchTypes.every((option) => option.shortName.length > 0)).toBe(true);
    expectSerialisable(catalog);
  });

  it('hides hidden types unless asked', () => {
    const engine = engineWith(catalogsWithHiddenSprint());
    const shown = engine.query('match.catalog', {}, OMNISCIENT);
    const all = engine.query('match.catalog', { includeHidden: true }, OMNISCIENT);
    if (!shown.ok || !all.ok) {
      throw new Error('match.catalog was refused');
    }
    expect(shown.data.matchTypes.map((option) => option.key)).not.toContain('match.sprint');
    expect(all.data.matchTypes.map((option) => option.key)).toContain('match.sprint');
    expect(all.data.matchTypes.find((option) => option.key === 'match.sprint')?.hidden).toBe(true);
  });

  it('says the catalog is not available on a world without catalogs', () => {
    const result = engineWith(null).query('match.catalog', {}, PLAYER);
    expect(result).toEqual({
      ok: true,
      data: {
        matchTypes: [],
        angleTypes: [],
        methods: [],
        beats: [],
        angleTemplates: [],
        available: false,
      },
    });
  });

  it('refuses bad arguments without throwing', () => {
    const result = engineWith(TEST_CATALOGS).queryRaw(
      'match.catalog',
      { includeHidden: 'yes' },
      PLAYER,
    );
    expect(result.ok).toBe(false);
  });
});

describe('match.slotInfo', () => {
  it('gives a midcard singles a standard class and weight 1, with both traces', () => {
    const result = engineWith(TEST_CATALOGS).query(
      'match.slotInfo',
      { slotRole: 'midcard', kind: 'match', typeKey: parseContentKey('match.singles') },
      PLAYER,
    );
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    expect(result.data).toMatchObject({
      role: 'midcard',
      roleLabel: 'Midcard',
      durationClass: 'standard',
      durationLabel: 'Standard',
      weight: 1,
    });
    expect(result.data.durationTrace.kind).toBe('decision');
    expect(result.data.weightTrace.kind).toBe('formula');
    expect(fieldNamesOf(result.data).filter((name) => /minute|length/i.test(name))).toEqual([]);
    expectSerialisable(result.data);
  });

  it('agrees with match.slotRoles for the main event and shifts by the match type', () => {
    const engine = engineWith(TEST_CATALOGS);
    const main = engine.query(
      'match.slotInfo',
      { slotRole: 'mainEvent', kind: 'match', typeKey: parseContentKey('match.singles') },
      PLAYER,
    );
    const sprint = engine.query(
      'match.slotInfo',
      { slotRole: 'midcard', kind: 'match', typeKey: parseContentKey('match.sprint') },
      PLAYER,
    );
    const talk = engine.query(
      'match.slotInfo',
      { slotRole: 'midcard', kind: 'angle', typeKey: parseContentKey('angle.promo') },
      PLAYER,
    );
    if (!main.ok || !sprint.ok || !talk.ok) {
      throw new Error('match.slotInfo was refused');
    }
    expect([main.data.durationLabel, main.data.weight]).toEqual(['Long', 1.75]);
    expect(sprint.data.durationLabel).toBe('Short');
    expect(talk.data.durationLabel).toBe('Standard');
  });

  it('refuses a match with no or an unknown match type', () => {
    const engine = engineWith(TEST_CATALOGS);
    const missing = engine.query('match.slotInfo', { slotRole: 'opener', kind: 'match' }, PLAYER);
    const unknown = engine.query(
      'match.slotInfo',
      { slotRole: 'opener', kind: 'match', typeKey: parseContentKey('match.nope') },
      PLAYER,
    );
    expect(missing).toMatchObject({
      ok: false,
      reasons: [{ code: 'invalidArgs', field: 'typeKey' }],
    });
    expect(unknown).toMatchObject({
      ok: false,
      reasons: [{ code: 'invalidArgs', field: 'typeKey' }],
    });
    expect(
      engine.queryRaw('match.slotInfo', { slotRole: 'opener', kind: 'angle', minutes: 5 }, PLAYER)
        .ok,
    ).toBe(false);
  });
});

describe('match.slotRoles', () => {
  it('returns one row per slot of a 6-slot card with a pre-show', () => {
    const result = engineWith(TEST_CATALOGS).query(
      'match.slotRoles',
      { slots: 6, preShowSlots: 1 },
      PLAYER,
    );
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    const rows = result.data;
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => [row.slot, row.preShow, row.role, row.durationClass])).toEqual([
      [1, true, 'preShow', 'short'],
      [1, false, 'opener', 'standard'],
      [2, false, 'midcard', 'standard'],
      [3, false, 'midcard', 'standard'],
      [4, false, 'midcard', 'standard'],
      [5, false, 'semiMain', 'standard'],
      [6, false, 'mainEvent', 'long'],
    ]);
    expect(rows.map((row) => row.roleLabel)).toEqual([
      'Pre-show',
      'Opener',
      'Midcard',
      'Midcard',
      'Midcard',
      'Semi-main',
      'Main event',
    ]);
    expect(rows.map((row) => row.weight)).toEqual([0.4, 0.9, 1, 1, 1, 1.25, 1.75]);
    expect(rows[6]?.roleTrace.kind).toBe('decision');
    expect(fieldNamesOf(rows).filter((name) => /minute|length/i.test(name))).toEqual([]);
    expectSerialisable(rows);
  });

  it('shifts slots by their match types', () => {
    const result = engineWith(TEST_CATALOGS).query(
      'match.slotRoles',
      {
        slots: 3,
        preShowSlots: 0,
        matchTypeKeys: [
          parseContentKey('match.sprint'),
          parseContentKey('match.battle-royal'),
          parseContentKey('match.sprint'),
        ],
      },
      OMNISCIENT,
    );
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    expect(result.data.map((row) => row.durationLabel)).toEqual(['Short', 'Long', 'Long']);
  });

  it('names the index of an unknown match type', () => {
    const result = engineWith(TEST_CATALOGS).query(
      'match.slotRoles',
      {
        slots: 3,
        preShowSlots: 1,
        matchTypeKeys: [
          null,
          parseContentKey('match.singles'),
          parseContentKey('match.nope'),
          null,
        ],
      },
      PLAYER,
    );
    expect(result).toEqual({
      ok: false,
      reasons: [
        {
          code: 'invalidArgs',
          message: 'matchTypeKeys[2]: there is no match type "match.nope"',
          field: 'matchTypeKeys[2]',
        },
      ],
    });
  });

  it('refuses bad arguments with reasons, never throwing', () => {
    const engine = engineWith(TEST_CATALOGS);
    const bad: unknown[] = [
      { slots: 2, preShowSlots: 0 },
      { slots: 13, preShowSlots: 0 },
      { slots: 6, preShowSlots: 4 },
      { slots: 6.5, preShowSlots: 0 },
      { slots: 6, preShowSlots: 0, matchTypeKeys: [parseContentKey('match.singles')] },
      { slots: 6, preShowSlots: 0, minutes: 30 },
      null,
    ];
    for (const args of bad) {
      const result = engine.queryRaw('match.slotRoles', args, PLAYER);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reasons.every((reason) => reason.code === 'invalidArgs')).toBe(true);
      }
    }
  });

  it('works on a world without catalogs when no match types are given', () => {
    const result = engineWith(null).query('match.slotRoles', { slots: 4, preShowSlots: 0 }, PLAYER);
    expect(result.ok).toBe(true);
  });
});
