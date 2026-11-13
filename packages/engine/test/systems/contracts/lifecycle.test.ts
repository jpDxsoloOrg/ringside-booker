// The contract lifecycle and the endEmployment door (ECO4-01).
// Design: docs/design/contracts.md#lifecycle and #end-employment.
import { describe, expect, it } from 'vitest';
import { addDays, type GameDate } from '../../../src/core/date';
import type { EmploymentId, PersonId, PromotionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import { definePhase } from '../../../src/core/pipeline/phase';
import { runDay } from '../../../src/core/pipeline/runDay';
import { inputOf } from '../../../src/core/trace/helpers';
import { isFullTrace } from '../../../src/core/trace/store';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES, type GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import {
  CONTRACT_LIFECYCLE_PHASE_ID,
  endEmployment,
  runContractLifecycle,
  severanceTraceRef,
} from '../../../src/systems/contracts';
import {
  aContractConcern,
  anEmployment,
  aPerson,
  TEST_PLAYER_ID,
  worldBuilder,
} from '../../support';
import { expectSerialisable } from '../../support/trace';
import { DEFAULT_DAILY_WAGE } from '../finance/payroll-world';
import { contractsRuntime, runDays, runThrough } from './contract-world';

/**
 * The player's contracts renew automatically by default until ECO5 (`contracts.autoRenewPlayer`,
 * ECO4-02); these tests are about contracts running out, so they turn that off.
 */
const NO_PLAYER_AUTO_RENEWAL = { 'contracts.autoRenewPlayer': false } as const;
interface LifecycleWorld {
  readonly world: GameWorld;
  readonly human: PromotionId;
  readonly rival: PromotionId;
  /** The human promotion's two workers, then the rival's two. */
  readonly employments: readonly EmploymentId[];
  readonly people: readonly PersonId[];
  readonly today: GameDate;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`lifecycle world: missing ${what}`);
  }
  return value;
}

/** One human promotion and one computer promotion, two open-ended workers each. */
function lifecycleWorld(): LifecycleWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } }, (promotion) =>
      promotion.withRoster(2),
    )
    .withPromotion({}, (promotion) => promotion.withRoster(2))
    .build();
  return {
    world,
    human: required(ids.promotions.A, 'A'),
    rival: required(ids.promotions.B, 'B'),
    employments: ids.employments,
    people: ids.people,
    today: world.meta.currentDate,
  };
}

function edit(world: GameWorld, body: Parameters<GameWorld['transact']>[1]): void {
  const result = world.transact('test edit', body);
  if (!result.ok) {
    throw result.error;
  }
}

function wagesOn(world: GameWorld, promotionId: PromotionId, date: GameDate): number {
  return world.tables.ledgerEntries
    .lookup('byPromotion', promotionId)
    .filter((row) => row.category === 'wages' && row.date === date)
    .reduce((sum, row) => sum + row.amount, 0);
}

function activeContractsOf(world: GameWorld, personId: PersonId) {
  return world.tables.employments
    .lookup('byPerson', personId)
    .filter((employment) => employment.status === 'active');
}

function invariantCodes(world: GameWorld): string[] {
  return checkWorld(world, TABLES, { validateRows: true }).issues.map((issue) => issue.code);
}

/** Adds a new person with a signed contract at `promotionId` starting on `startsOn`. */
function addSignedDeal(
  built: LifecycleWorld,
  promotionId: PromotionId,
  startsOn: GameDate,
  personId?: PersonId,
): EmploymentId {
  let employmentId: EmploymentId | undefined;
  edit(built.world, (tx) => {
    const person =
      personId ?? tx.insert('people', aPerson({ id: tx.mintId('people') }, undefined)).id;
    employmentId = tx.insert(
      'employments',
      anEmployment({
        id: tx.mintId('employments'),
        personId: person,
        promotionId,
        status: 'signed',
        offeredOn: built.today,
        startsOn,
      }),
    ).id;
  });
  return required(employmentId, 'the signed deal');
}

describe('contracts.lifecycle', () => {
  it('is registered in the contracts group at order 10, daily, by the default systems', () => {
    const phases = defaultSystems.flatMap((system) => system.phases);
    expect(phases.find((phase) => phase.id === CONTRACT_LIFECYCLE_PHASE_ID)).toMatchObject({
      group: 'contracts',
      order: 10,
      cadence: { kind: 'daily' },
    });
  });

  it('starts a signed deal on its start date, not before, and pays it from that day', () => {
    const built = lifecycleWorld();
    const startsOn = addDays(built.today, 1);
    const signed = addSignedDeal(built, built.human, startsOn);
    const runtime = contractsRuntime(built.world);

    runDays(runtime, 1);
    expect(built.world.tables.employments.require(signed).status).toBe('signed');
    expect(wagesOn(built.world, built.human, built.today)).toBe(-2 * DEFAULT_DAILY_WAGE);

    runDays(runtime, 1);
    expect(built.world.tables.employments.require(signed).status).toBe('active');
    expect(wagesOn(built.world, built.human, startsOn)).toBe(-3 * DEFAULT_DAILY_WAGE);
    const started = runtime.bus.recent({ types: ['contract.started'] });
    expect(started.map((event) => event.payload.employmentId)).toEqual([signed]);
    expect(invariantCodes(built.world)).toEqual([]);
  });

  it('expires a contract on its end date: no wage that day, and the person is a free agent', () => {
    const built = lifecycleWorld();
    const [leaver, stayer] = built.employments;
    const endsOn = addDays(built.today, 1);
    edit(built.world, (tx) => {
      tx.update('employments', required(leaver, 'leaver'), { endsOn });
    });
    const runtime = contractsRuntime(built.world, NO_PLAYER_AUTO_RENEWAL);

    runDays(runtime, 1);
    expect(built.world.tables.employments.require(required(leaver, 'leaver')).status).toBe(
      'active',
    );
    expect(wagesOn(built.world, built.human, built.today)).toBe(-2 * DEFAULT_DAILY_WAGE);

    runDays(runtime, 1);
    const ended = built.world.tables.employments.require(required(leaver, 'leaver'));
    expect(ended).toMatchObject({ status: 'expired', endedOn: endsOn });
    expect(wagesOn(built.world, built.human, endsOn)).toBe(-DEFAULT_DAILY_WAGE);
    expect(activeContractsOf(built.world, ended.personId)).toEqual([]);
    // Open-ended deals never expire, and the player's contracts are never renewed.
    expect(built.world.tables.employments.require(required(stayer, 'stayer')).status).toBe(
      'active',
    );
    expect(
      runtime.bus.recent({ types: ['contract.expired'] }).map((event) => event.payload),
    ).toEqual([
      {
        employmentId: leaver,
        personId: ended.personId,
        promotionId: built.human,
        reasonKey: 'contracts.endDate',
      },
    ]);
    expect(runtime.bus.recent({ types: ['contract.renewed'] })).toEqual([]);
    expect(invariantCodes(built.world)).toEqual([]);
  });

  it('never expires open-ended contracts', () => {
    const built = lifecycleWorld();
    const runtime = contractsRuntime(built.world);
    runDays(runtime, 40);
    for (const employmentId of built.employments) {
      expect(built.world.tables.employments.require(employmentId).status).toBe('active');
    }
    expect(built.world.tables.contractConcerns.size).toBe(0);
  });

  it('ends the other active deal as a quit when an exclusive deal starts', () => {
    const built = lifecycleWorld();
    const rivalDeal = required(built.employments[2], 'the rival deal');
    const personId = built.world.tables.employments.require(rivalDeal).personId;
    const startsOn = addDays(built.today, 2);
    const signed = addSignedDeal(built, built.human, startsOn, personId);
    const runtime = contractsRuntime(built.world);

    runThrough(runtime, startsOn);
    expect(built.world.tables.employments.require(rivalDeal)).toMatchObject({
      status: 'quit',
      endedOn: startsOn,
    });
    expect(built.world.tables.employments.require(signed).status).toBe('active');
    expect(
      built.world.tables.contractConcerns.lookupOne('byEmployment', rivalDeal)?.ending,
    ).toEqual({ how: 'exclusiveDeal', severance: 0, traceRef: null });
    expect(runtime.bus.recent({ types: ['contract.quit'] }).map((event) => event.payload)).toEqual([
      {
        employmentId: rivalDeal,
        personId,
        promotionId: built.rival,
        how: 'exclusiveDeal',
        severance: 0,
      },
    ]);
    expect(invariantCodes(built.world)).not.toContain('employments.exclusiveConflict');
    expect(invariantCodes(built.world)).toEqual([]);
  });

  it('clears manager links to the leaver and keeps only how the contract ended on its concern row', () => {
    const built = lifecycleWorld();
    const [leaver, managed] = built.employments;
    const leaverId = required(leaver, 'leaver');
    const leaverPerson = built.world.tables.employments.require(leaverId).personId;
    const endsOn = addDays(built.today, 1);
    edit(built.world, (tx) => {
      tx.update('employments', leaverId, { endsOn });
      tx.update('employments', required(managed, 'managed'), { managerPersonId: leaverPerson });
      tx.insert(
        'contractConcerns',
        aContractConcern({
          id: tx.mintId('contractConcerns'),
          employmentId: leaverId,
          personId: leaverPerson,
          promotionId: built.human,
          expiryNotice: { raisedOn: built.today, seenOn: null },
          unhappy: { since: built.today, days: 3 },
          ending: null,
        }),
      );
    });
    const runtime = contractsRuntime(built.world, NO_PLAYER_AUTO_RENEWAL);
    runThrough(runtime, endsOn);

    expect(
      built.world.tables.employments.require(required(managed, 'managed')).managerPersonId,
    ).toBeNull();
    const concern = built.world.tables.contractConcerns.lookupOne('byEmployment', leaverId);
    expect(concern).toMatchObject({
      expiryNotice: null,
      unhappy: null,
      request: null,
      ending: { how: 'expired', severance: 0, traceRef: null },
    });
    expect(invariantCodes(built.world)).toEqual([]);
  });

  it('does nothing more when run twice on the same day, as on a show night run early', () => {
    const built = lifecycleWorld();
    const [leaver] = built.employments;
    edit(built.world, (tx) => {
      tx.update('employments', required(leaver, 'leaver'), { endsOn: addDays(built.today, 1) });
    });
    const signed = addSignedDeal(built, built.rival, addDays(built.today, 1));
    const again = definePhase({
      id: 'test.lifecycleAgain',
      group: 'contracts',
      order: 20,
      cadence: { kind: 'daily' },
      run: runContractLifecycle,
    });
    const runtime = contractsRuntime(built.world, NO_PLAYER_AUTO_RENEWAL, [again]);
    runDays(runtime, 2);
    expect(runtime.bus.recent({ types: ['contract.expired'] })).toHaveLength(1);
    expect(runtime.bus.recent({ types: ['contract.started'] })).toHaveLength(1);
    expect(built.world.tables.employments.require(signed).status).toBe('active');
  });

  it('every contract event is plain JSON', () => {
    const built = lifecycleWorld();
    const [leaver] = built.employments;
    edit(built.world, (tx) => {
      tx.update('employments', required(leaver, 'leaver'), { endsOn: addDays(built.today, 1) });
    });
    addSignedDeal(built, built.rival, addDays(built.today, 1));
    const runtime = contractsRuntime(built.world);
    runDays(runtime, 3);
    const events = runtime.bus.recent({
      types: [
        'contract.started',
        'contract.expired',
        'contract.released',
        'contract.quit',
        'contract.renewed',
      ],
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
    for (const event of events) {
      expectSerialisable(event.payload);
    }
  });
});

describe('endEmployment', () => {
  it('throws on an illegal move, and the whole step rolls back', () => {
    const built = lifecycleWorld();
    const target = required(built.employments[0], 'target');
    const failing = definePhase({
      id: 'test.illegalEnd',
      group: 'contracts',
      order: 50,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        ctx.tx.update('employments', target, { push: 'mainEvent' });
        endEmployment(ctx, {
          employmentId: target,
          to: 'withdrawn',
          reasonKey: 'test.illegal',
          source: 'player',
        });
      },
    });
    const runtime = contractsRuntime(built.world, {}, [failing]);
    const report = runDay(runtime);
    const step = report.steps.find((entry) => entry.stepId === 'test.illegalEnd');
    expect(step?.status).toBe('failed');
    expect(step?.error?.name).toBe('InvalidArgumentError');
    expect(built.world.tables.employments.require(target)).toMatchObject({
      status: 'active',
      push: 'midCard',
      endedOn: null,
    });
    expect(built.world.tables.contractConcerns.size).toBe(0);
  });

  it('pays severance once through the ledger, with a trace whose value is the amount', () => {
    const built = lifecycleWorld();
    const target = required(built.employments[0], 'target');
    const employment = built.world.tables.employments.require(target);
    const cashBefore = built.world.tables.promotions.require(built.human).cash;
    const release = definePhase({
      id: 'test.release',
      group: 'contracts',
      order: 50,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        if (ctx.date !== built.today) {
          return;
        }
        const result = endEmployment(ctx, {
          employmentId: target,
          to: 'released',
          reasonKey: 'test.release',
          source: 'player',
          mutual: true,
          severance: inputOf('Severance owed', 123_456.4, undefined, 'money'),
        });
        expect(result).toMatchObject({ severance: 123_456, traceRef: severanceTraceRef(target) });
        expect(result.ledgerEntryId).not.toBeNull();
      },
    });
    // Contracts only: no payroll, so the cash moves by the severance alone.
    const runtime = contractsRuntime(built.world, {}, [release], false);
    runDays(runtime, 1);

    const rows = built.world.tables.ledgerEntries
      .lookup('byPromotion', built.human)
      .filter((row) => row.category === 'severance');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount: -123_456,
      memo: `Severance: ${employment.ringName}`,
      refs: { personId: employment.personId },
    });
    expect(built.world.tables.promotions.require(built.human).cash).toBe(cashBefore - 123_456);
    const stored = runtime.traces.get(severanceTraceRef(target));
    if (stored === undefined || !isFullTrace(stored)) {
      throw new Error('expected the full severance trace for the player');
    }
    expect(stored.trace.value).toBe(123_456);
    expect(built.world.tables.contractConcerns.lookupOne('byEmployment', target)?.ending).toEqual({
      how: 'released',
      severance: cents(123_456),
      traceRef: severanceTraceRef(target),
    });
    const released = runtime.bus.recent({ types: ['contract.released'] });
    expect(released.map((event) => event.payload)).toEqual([
      {
        employmentId: target,
        personId: employment.personId,
        promotionId: built.human,
        severance: 123_456,
        source: 'player',
        mutual: true,
      },
    ]);
    expect(invariantCodes(built.world)).toEqual([]);
  });

  it('withdraws a signed future deal as a released contract that is not mutual', () => {
    const built = lifecycleWorld();
    const signed = addSignedDeal(built, built.human, addDays(built.today, 10));
    const withdraw = definePhase({
      id: 'test.withdraw',
      group: 'contracts',
      order: 50,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        if (ctx.date === built.today) {
          endEmployment(ctx, {
            employmentId: signed,
            to: 'withdrawn',
            reasonKey: 'test.withdraw',
            source: 'player',
            mutual: true,
          });
        }
      },
    });
    const runtime = contractsRuntime(built.world, {}, [withdraw]);
    runDays(runtime, 1);
    expect(built.world.tables.employments.require(signed).status).toBe('withdrawn');
    expect(
      runtime.bus.recent({ types: ['contract.released'] }).map((event) => event.payload.mutual),
    ).toEqual([false]);
    expect(built.world.tables.contractConcerns.lookupOne('byEmployment', signed)?.ending?.how).toBe(
      'withdrawn',
    );
  });
});
