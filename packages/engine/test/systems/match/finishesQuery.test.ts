// `match.finishes` (MTCH2-01): the allowed finishes of a match type with effects, title flag and
// methods, narrowed by outcome kind; refusals for an unknown type and a save without finishes.
// Design: docs/design/match-finishes.md
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine, type Viewer } from '../../../src/core/api';
import { parseContentKey } from '../../../src/core/content-key';
import type { Catalogs } from '../../../src/model/catalogs';
import { defaultSystems } from '../../../src/systems';
import { TEST_CATALOGS } from '../../support/catalogs';
import { worldBuilder } from '../../support';
import { expectSerialisable } from '../../support/trace';

const PLAYER: Viewer = { kind: 'controller', controller: { kind: 'human', playerId: 'player-1' } };

function engineWith(catalogs: Catalogs): Engine {
  const built = worldBuilder().withCatalogs(catalogs).build();
  return createEngine({ state: initialEngineState(built.world), systems: defaultSystems });
}

describe('match.finishes', () => {
  it('returns every allowed finish with its effects, title flag and methods', () => {
    const result = engineWith(TEST_CATALOGS).query(
      'match.finishes',
      { matchTypeKey: parseContentKey('match.singles') },
      PLAYER,
    );
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    expect(result.data).toHaveLength(10);
    const [clean] = result.data;
    expect(clean?.summary.length).toBeGreaterThan(0);
    expect(clean).toEqual({
      key: 'finish.clean',
      name: 'Clean finish',
      summary: clean?.summary,
      category: 'clean',
      outcomeKind: 'win',
      allowsTitleChange: true,
      effects: { workRate: 0, crowd: 1 },
      methods: [
        { key: 'method.pinfall', name: 'Pinfall', changesTitles: true },
        { key: 'method.submission', name: 'Submission', changesTitles: true },
        { key: 'method.knockout', name: 'Knockout', changesTitles: true },
      ],
      autoPickable: true,
    });
    expectSerialisable(result.data);
  });

  it("narrows to one outcome kind: outcomeKind 'draw' gives the two draws", () => {
    const result = engineWith(TEST_CATALOGS).query(
      'match.finishes',
      { matchTypeKey: parseContentKey('match.singles'), outcomeKind: 'draw' },
      PLAYER,
    );
    expect(result.ok && result.data.map((option) => option.key)).toEqual([
      'finish.double-count-out',
      'finish.stalemate',
    ]);
  });

  it('drops the two-sides-only finishes for more sides', () => {
    const result = engineWith(TEST_CATALOGS).query(
      'match.finishes',
      { matchTypeKey: parseContentKey('match.singles'), sideCount: 3, outcomeKind: 'draw' },
      PLAYER,
    );
    expect(result.ok && result.data.map((option) => option.key)).toEqual(['finish.stalemate']);
  });

  it('refuses an unknown match type', () => {
    const result = engineWith(TEST_CATALOGS).query(
      'match.finishes',
      { matchTypeKey: parseContentKey('match.cage') },
      PLAYER,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reasons.map((reason) => [reason.code, reason.field])).toEqual([
      ['unknownMatchType', 'matchTypeKey'],
    ]);
  });

  it('refuses a save started before finishes existed', () => {
    const withoutFinishes: Catalogs = {
      matchTypes: TEST_CATALOGS.matchTypes ?? {},
      methods: TEST_CATALOGS.methods ?? {},
    };
    const result = engineWith(withoutFinishes).query(
      'match.finishes',
      { matchTypeKey: parseContentKey('match.singles') },
      PLAYER,
    );
    expect(!result.ok && result.reasons).toEqual([
      {
        code: 'noFinishCatalog',
        message: 'This save was started before finishes existed. Start a new game to use finishes.',
      },
    ]);
  });

  it('refuses a side count below 2', () => {
    const result = engineWith(TEST_CATALOGS).query(
      'match.finishes',
      { matchTypeKey: parseContentKey('match.singles'), sideCount: 1 },
      PLAYER,
    );
    expect(result.ok).toBe(false);
  });
});
