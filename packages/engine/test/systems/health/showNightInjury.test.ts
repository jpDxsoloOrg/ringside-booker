// WRK6-07 with MTCH4: an injury rolled in one of the player's matches on show night becomes a real
// injury through the built-in handler (`health.injure`), and the worker's Health tab shows it.
// Design: docs/design/health.md#works-with
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import type { PersonId } from '../../../src/core/ids';
import type { InjuryRecord } from '../../../src/model/entities/injury';
import { defaultSystems } from '../../../src/systems';
import { HEALTH_INJURY_HANDLER_ID } from '../../../src/systems/health';
import { getInjuryHandler, registerRiskModifier } from '../../../src/systems/match';
import { bookRunnable, PLAYER_ONE, validateWorld, who } from '../booking/validate-world';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/** Every competitor's injury roll comes up (at most one injury per match, MTCH4's limit). */
function certainInjuries(): void {
  cleanups.push(
    registerRiskModifier({
      id: 'test.certainInjury',
      order: 0,
      contribute: () => [{ source: 'Test: certain injury', personIds: null, injuryAdd: 1 }],
    }),
  );
}

function injuriesOf(engine: Engine, personId: PersonId): InjuryRecord[] {
  return engine
    .exportState()
    .world.tables.injuries.filter((injury) => injury.personId === personId);
}

describe('show-night injuries on the player’s show', () => {
  it('become one segment injury per match, through health.injure, shown on the Health tab', () => {
    expect(getInjuryHandler()?.id).toBe(HEALTH_INJURY_HANDLER_ID);
    certainInjuries();
    const built = validateWorld({ injuryCatalog: true });
    const card = bookRunnable(built);
    const engine = createEngine({
      state: {
        ...initialEngineState(built.world),
        tunableOverrides: { 'match.injury.maxChance': 1 },
      },
      systems: defaultSystems,
    });
    const ran = engine.command('shows.runTonight', { eventInstanceId: built.show }, PLAYER_ONE);
    expect(ran).toMatchObject({ ok: true });

    // Opener: Mia Torres v Leo Hart; main event: Ana Vale v Bo Stone. One injury each.
    const rows = engine
      .exportState()
      .world.tables.injuries.filter((injury) => injury.source === 'segment');
    expect(rows.map((row) => row.segmentId).sort()).toEqual([card.opener, card.mainEvent].sort());
    const openerPeople = [who(built, 6), who(built, 7)];
    const hurt = rows.find((row) => row.segmentId === card.opener);
    expect(hurt).toBeDefined();
    expect(openerPeople).toContain(hurt?.personId);
    const personId = hurt?.personId ?? openerPeople[0]!;
    // One row for the worker, open, from tonight.
    expect(injuriesOf(engine, personId)).toEqual([hurt]);
    expect(hurt).toMatchObject({ since: '2026-01-05', returnedOn: null, source: 'segment' });

    const profile = engine.query(
      'health.profile',
      { personId },
      {
        kind: 'controller',
        controller: PLAYER_ONE,
      },
    );
    expect(profile.ok).toBe(true);
    const current = profile.ok ? profile.data?.current : undefined;
    expect(current).toMatchObject({
      injuryId: hurt?.id,
      source: 'segment',
      segmentId: card.opener,
      expectedReturn: hurt?.expectedReturn,
    });
    // The in-match chance is the injury's "How it happened" Why?.
    expect(current?.chanceTraceRef).not.toBeNull();
  });
});
