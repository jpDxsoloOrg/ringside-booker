// Releases: contracts.release, its preview and releaseEmployment (ECO4-02).
// Design: docs/design/contracts.md#severance
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import type { EmploymentId } from '../../../src/core/ids';
import { runStep } from '../../../src/core/pipeline/runStep';
import type { Engine } from '../../../src/core/api';
import type { Controller } from '../../../src/model/controller';
import {
  RELEASE_REASON_KEY,
  releaseEmployment,
  severanceTraceRef,
  type ReleasePreview,
} from '../../../src/systems/contracts';
import { plainDate } from '../../../src/systems/health';
import { expectTraceReplays } from '../../support/trace';
import { contractsRuntime } from './contract-world';
import {
  ask,
  cashOf,
  COMPUTER,
  contractsEngine,
  employmentOf,
  OTHER_PLAYER,
  PLAYER,
  PLAYER_VIEW,
  releaseWorld,
  SHOW_NAME,
  START_CASH,
  TITLE_NAME,
} from './release-world';

function preview(engine: Engine, employmentId: EmploymentId, viewer = PLAYER_VIEW) {
  return ask(engine.query('contracts.releasePreview', { employmentId }, viewer));
}

function okPreview(
  engine: Engine,
  employmentId: EmploymentId,
): Extract<ReleasePreview, { kind: 'ok' }> {
  const result = preview(engine, employmentId);
  if (result.kind !== 'ok') {
    throw new Error(`expected a preview, got ${JSON.stringify(result.reasons)}`);
  }
  return result;
}

function release(
  engine: Engine,
  employmentId: EmploymentId,
  expectedSeverance: number,
  issuedBy: Controller = PLAYER,
) {
  return engine.command('contracts.release', { employmentId, expectedSeverance }, issuedBy);
}

function refusalCodes(result: { ok: boolean; reasons?: readonly { code: string }[] }): string[] {
  return result.ok ? [] : (result.reasons ?? []).map((reason) => reason.code);
}

describe('contracts.release', () => {
  it('pays exactly the preview, writes one Severance ledger row with its Why?, and ends the contract', () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    const shown = okPreview(engine, built.plain);
    expect(shown.mode).toBe('release');
    expect(shown.severance.value).toBe(4_319_753);
    expect(shown.cashBefore).toBe(START_CASH);
    expect(shown.cashAfter).toBe(START_CASH - 4_319_753);
    expectTraceReplays(shown.severance);

    const result = release(engine, built.plain, shown.severance.value);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data).toMatchObject({ severance: 4_319_753, cashAfter: shown.cashAfter });
    expect(cashOf(engine, built.human)).toBe(START_CASH - shown.severance.value);

    const state = engine.exportState();
    const rows = state.world.tables.ledgerEntries.filter(
      (row) => row.promotionId === built.human && row.category === 'severance',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(-shown.severance.value);
    expect(result.data.ledgerTraceRef).toEqual(rows[0]?.traceRef);
    // The ledger row's Why? is the severance paid, built on the severance trace.
    const ledgerRef = result.data.ledgerTraceRef;
    expect(ledgerRef).not.toBeNull();
    const why =
      ledgerRef === null ? null : ask(engine.query('trace.get', { ref: ledgerRef }, PLAYER_VIEW));
    expect(why?.value).toBe(-shown.severance.value);
    expect(JSON.stringify(why)).toContain('Months paid');
    const stored = ask(
      engine.query('trace.get', { ref: severanceTraceRef(built.plain) }, PLAYER_VIEW),
    );
    expect(stored?.value).toBe(shown.severance.value);

    expect(employmentOf(engine, built.plain)).toMatchObject({
      status: 'released',
      endedOn: built.today,
    });
    const ended = ask(engine.query('contracts.list', { tab: 'ended' }, PLAYER_VIEW));
    expect(ended.map((row) => row.employmentId)).toEqual([built.plain]);
    expect(ended[0]).toMatchObject({
      endReason: 'released',
      severancePaid: shown.severance.value,
      severanceTraceRef: severanceTraceRef(built.plain),
    });
  });

  it('withdraws a signed deal that has not started, at the unstarted factor', () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    const shown = okPreview(engine, built.signed);
    expect(shown.mode).toBe('withdraw');
    expect(shown.severance.trace).toBeDefined();
    const full = contractsEngine(releaseWorld().world, {
      'contracts.severance.unstartedFactor': 1,
    });
    const undiscounted = okPreview(full, built.signed).severance.value;
    expect(shown.severance.value).toBe(Math.floor(undiscounted * 0.5));
    const result = release(engine, built.signed, shown.severance.value);
    expect(result.ok).toBe(true);
    expect(employmentOf(engine, built.signed)).toMatchObject({
      status: 'withdrawn',
      endedOn: built.today,
    });
    const events = ask(
      engine.query('sim.recentEvents', { limit: 10, types: ['contract.released'] }, PLAYER_VIEW),
    );
    expect(events.map((event) => event.payload)).toEqual([
      expect.objectContaining({ employmentId: built.signed, mutual: false, source: 'player' }),
    ]);
  });

  it('refuses the owner, a rival, an ended contract and a stale amount, changing nothing', () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    const before = engine.exportState().world;

    expect(refusalCodes(release(engine, built.owner, 0))).toEqual(['isOwner']);
    expect(refusalCodes(release(engine, built.rivalWorker, 0))).toEqual(['notYourWorker']);
    for (const issuedBy of [OTHER_PLAYER, COMPUTER]) {
      expect(refusalCodes(release(engine, built.plain, 4_319_753, issuedBy))).toEqual([
        'notYourWorker',
      ]);
    }
    const stale = release(engine, built.plain, 4_000_000);
    expect(refusalCodes(stale)).toEqual(['severanceChanged']);
    expect(stale.ok ? '' : stale.reasons[0]?.message).toBe(
      'The amount changed to $43,197.53; check it again.',
    );
    expect(engine.exportState().world).toEqual(before);

    expect(release(engine, built.plain, 4_319_753).ok).toBe(true);
    expect(refusalCodes(release(engine, built.plain, 0))).toEqual(['notReleasable']);
    expect(preview(engine, built.plain)).toMatchObject({
      kind: 'refused',
      reasons: [{ code: 'notReleasable' }],
    });
  });

  it('refuses a stale preview once the day moves on (the severance shrinks every day)', async () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    const shown = okPreview(engine, built.plain);
    await engine.advanceDays({ maxDays: 1 });
    expect(refusalCodes(release(engine, built.plain, shown.severance.value))).toEqual([
      'severanceChanged',
    ]);
    const fresh = okPreview(engine, built.plain);
    expect(fresh.severance.value).toBeLessThan(shown.severance.value);
    expect(release(engine, built.plain, fresh.severance.value).ok).toBe(true);
  });
});

describe('contracts.releasePreview', () => {
  it('warns about a title, an iron-clad deal and a worker who is glad to go', () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    const shown = okPreview(engine, built.champion);
    expect(shown.warnings.map((warning) => warning.code)).toEqual([
      'holdsTitle',
      'ironClad',
      'gladToGo',
    ]);
    expect(shown.warnings[0]?.message).toBe(
      `Holds the ${TITLE_NAME}. If they leave, the title is vacated after 7 days.`,
    );
  });

  it('warns when the severance puts the promotion into debt', () => {
    const built = releaseWorld();
    const rich = okPreview(contractsEngine(built.world), built.plain);
    expect(rich.warnings.map((warning) => warning.code)).not.toContain('intoDebt');
    const poor = releaseWorld({ cash: 4_000_000 });
    const shown = okPreview(contractsEngine(poor.world), poor.plain);
    expect(shown.cashAfter).toBe(4_000_000 - 4_319_753);
    expect(shown.warnings.find((warning) => warning.code === 'intoDebt')?.message).toBe(
      'This puts you $3,197.53 in debt.',
    );
  });

  it('warns about a booking on a show still to come', () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    const shown = okPreview(engine, built.plain);
    const booked = shown.warnings.find((warning) => warning.code === 'bookedSoon');
    expect(booked).toMatchObject({
      message: `Booked on ${SHOW_NAME}, ${plainDate(addDays(built.today, 5))}.`,
      subject: { kind: 'eventInstance', id: built.show },
    });
  });

  it("refuses a rival's worker without telling anything about their contract", () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    const refused = preview(engine, built.rivalWorker);
    expect(refused).toEqual({
      kind: 'refused',
      reasons: [expect.objectContaining({ code: 'notYourWorker' })],
    });
  });
});

describe('releaseEmployment', () => {
  it('pays nothing with a factor of 0 ("Fired for cause") and still ends the contract', () => {
    const built = releaseWorld();
    const runtime = contractsRuntime(built.world, {}, [], false);
    const report = runStep(runtime, 'test.fire', { kind: 'phase', id: 'test.fire' }, (ctx) => {
      const result = releaseEmployment(ctx, {
        employmentId: built.plain,
        source: 'system',
        reasonKey: 'test.conduct',
        severanceFactor: { value: 0, label: 'Fired for cause' },
      });
      expect(result).toMatchObject({ to: 'released', severance: 0, ledgerEntryId: null });
    });
    expect(report.status).toBe('ok');
    expect(built.world.tables.employments.require(built.plain).status).toBe('released');
    expect(built.world.tables.promotions.require(built.human).cash).toBe(START_CASH);
    expect(built.world.tables.ledgerEntries.lookup('byPromotion', built.human)).toEqual([]);
  });

  it('is what the command runs: same reason key, same severance', () => {
    const built = releaseWorld();
    const runtime = contractsRuntime(built.world, {}, [], false);
    runStep(runtime, 'test.cut', { kind: 'phase', id: 'test.cut' }, (ctx) => {
      const result = releaseEmployment(ctx, {
        employmentId: built.plain,
        source: 'system',
        reasonKey: RELEASE_REASON_KEY,
      });
      expect(result).toMatchObject({ to: 'released', severance: 4_319_753, mutual: false });
      expect(result.ledgerTraceRef).not.toBeNull();
    });
    expect(built.world.tables.promotions.require(built.human).cash).toBe(START_CASH - 4_319_753);
  });
});
