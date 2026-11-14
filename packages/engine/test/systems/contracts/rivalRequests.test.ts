// How rivals answer their unhappy workers' release requests, and rival walk-outs (ECO4-03).
// Design: docs/design/contracts.md#rival-rules
import { describe, expect, it } from 'vitest';
import { definePhase } from '../../../src/core/pipeline/phase';
import { aiReleaseTraceRef, RELEASE_DECISION_KIND } from '../../../src/systems/contracts';
import { decisionKindOf, decisionSummaryText } from '../../../src/systems/aip';
import { applyMoraleChange } from '../../../src/systems/workers';
import { resetTestIds, rosterWorld } from '../../support';
import { contractsRuntime, runDays } from './contract-world';
import { ask, cashOf, employmentOf, OMNISCIENT } from './release-world';
import {
  concernOf,
  RIVAL_TITLE,
  TEST_MORALE_REASON,
  unhappyEngine,
  unhappyWorld,
} from './unhappy-world';

const AT_ONCE = { 'contracts.quit.days': 0 } as const;

function decisionText(
  run: ReturnType<typeof unhappyEngine>,
  id: Parameters<typeof aiReleaseTraceRef>[0],
) {
  return JSON.stringify(
    ask(run.engine.query('trace.get', { ref: aiReleaseTraceRef(id) }, OMNISCIENT)),
  );
}

describe('rival release requests', () => {
  it('refuses a champion and a main eventer, grants a lower carder and pays the share', async () => {
    const built = unhappyWorld();
    const run = unhappyEngine(built.world, AT_ONCE);
    const cashBefore = cashOf(run.engine, built.rival);
    for (const id of [built.rivalChampion, built.rivalMainEvent, built.rivalLower]) {
      run.setMorale(id, -60);
    }
    await run.advance(1);

    expect(employmentOf(run.engine, built.rivalChampion).status).toBe('active');
    expect(concernOf(run.engine, built.rivalChampion)?.request?.status).toBe('refused');
    expect(decisionText(run, built.rivalChampion)).toContain(`Holds a title (${RIVAL_TITLE})`);
    expect(employmentOf(run.engine, built.rivalChampion).morale).toBe(-70);

    expect(employmentOf(run.engine, built.rivalMainEvent).status).toBe('active');
    expect(decisionText(run, built.rivalMainEvent)).toContain(
      'Push main event at or above upper card',
    );

    expect(employmentOf(run.engine, built.rivalLower).status).toBe('quit');
    const ending = concernOf(run.engine, built.rivalLower)?.ending;
    expect(ending?.how).toBe('granted');
    expect(decisionText(run, built.rivalLower)).toContain('Lets unhappy workers go');
    const severanceRows = run.engine
      .exportState()
      .world.tables.ledgerEntries.filter(
        (row) => row.promotionId === built.rival && row.category === 'severance',
      );
    const paid: number = ending?.severance ?? 0;
    expect(severanceRows.map((row) => row.amount)).toEqual([-paid]);
    expect(ending?.severance).toBeGreaterThan(0);
    // Payroll may run too; the severance is exactly what left besides it.
    const otherRows = run.engine
      .exportState()
      .world.tables.ledgerEntries.filter(
        (row) => row.promotionId === built.rival && row.category !== 'severance',
      )
      .reduce((sum, row) => sum + row.amount, 0);
    expect(cashOf(run.engine, built.rival)).toBe(cashBefore - (ending?.severance ?? 0) + otherRows);

    // Rival requests never reach the player.
    expect(run.events.filter((event) => event.type === 'contract.releaseRequested')).toEqual([]);
  });

  it("logs each answer in the rival's Decision log, pointing at the answer's Why? (ECO4-05)", async () => {
    const built = unhappyWorld();
    const run = unhappyEngine(built.world, AT_ONCE);
    for (const id of [built.rivalChampion, built.rivalLower]) {
      run.setMorale(id, -60);
    }
    await run.advance(1);
    // The test engine runs the contracts system only, so read the rows and AIP1's text directly.
    const rows = run.engine
      .exportState()
      .world.tables.aiDecisions.filter((row) => row.kind === RELEASE_DECISION_KIND);
    const entries = rows.map((row) => ({
      ...row,
      chip: decisionKindOf(row.kind)?.chip,
      text: decisionSummaryText(row.summary),
    }));
    expect(rows.every((row) => row.promotionId === built.rival && row.brandId === null)).toBe(true);
    const champion = employmentOf(run.engine, built.rivalChampion);
    const lower = employmentOf(run.engine, built.rivalLower);
    expect(entries.map((entry) => [entry.kind, entry.chip, entry.text, entry.importance])).toEqual(
      expect.arrayContaining([
        [
          'release',
          'Releases',
          `Refused to let ${champion.ringName} go (Champions are always kept)`,
          1,
        ],
        [
          'release',
          'Releases',
          `Let ${lower.ringName} go at their request (Lets unhappy workers go)`,
          0,
        ],
      ]),
    );
    expect(entries).toHaveLength(2);
    const refused = entries.find((entry) => entry.importance === 1);
    expect(refused?.traceRef).toEqual(aiReleaseTraceRef(built.rivalChampion));
    expect(refused?.refs.personIds).toEqual([champion.personId]);
    expect(refused?.refs.titleIds).toHaveLength(1);
    // Rival requests stay private: a refusal shows to others only when the contract ends.
    expect(refused?.revealOn).toBe(champion.endsOn);
    expect(entries.find((entry) => entry.importance === 0)?.revealOn).toBe(
      entries.find((entry) => entry.importance === 0)?.date,
    );
  });

  it('grants a champion when champions are not kept by rule', async () => {
    const built = unhappyWorld();
    const run = unhappyEngine(built.world, { ...AT_ONCE, 'contracts.ai.keepChampions': false });
    run.setMorale(built.rivalChampion, -60);
    await run.advance(1);
    expect(employmentOf(run.engine, built.rivalChampion).status).toBe('quit');
    expect(decisionText(run, built.rivalChampion)).toContain(
      'Holds a title, but champions are not kept by rule',
    );
  });
});

describe('rival walk-outs are deterministic', () => {
  function yearOfWalkouts(): string[] {
    resetTestIds();
    const { world } = rosterWorld(30);
    // A test setup step: everyone starts deeply unhappy, through the morale door.
    let sunk = false;
    const setup = definePhase({
      id: 'unhappyTest.sinkMorale',
      group: 'contracts',
      order: 1,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        if (sunk) {
          return;
        }
        sunk = true;
        for (const employment of ctx.read.tables.employments.lookup('byStatus', 'active')) {
          applyMoraleChange(ctx, {
            employmentId: employment.id,
            delta: -80 - employment.morale,
            source: 'system',
            reason: TEST_MORALE_REASON,
          });
        }
      },
    });
    const runtime = contractsRuntime(world, { 'contracts.quit.days': 7 }, [setup]);
    runDays(runtime, 365);
    // Read from the contracts themselves: the recent-event log does not hold a whole year.
    return runtime.world.tables.contractConcerns
      .values()
      .filter((row) => row.ending !== null)
      .map((row) => {
        const employment = runtime.world.tables.employments.get(row.employmentId);
        return `${employment?.endedOn ?? '?'}:${row.employmentId}:${row.ending?.how ?? '?'}`;
      })
      .sort();
  }

  it('the same seed gives the same grants and walk-outs over 365 days', () => {
    const first = yearOfWalkouts();
    const second = yearOfWalkouts();
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.some((line) => line.endsWith(':walkedOut'))).toBe(true);
    expect(first.some((line) => line.endsWith(':granted'))).toBe(true);
  });
});
