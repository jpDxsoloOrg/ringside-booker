// Renewal policies and the simple rival renewal (ECO4-01).
// Design: docs/design/contracts.md#simple-renewals.
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, compareDates, diffDays, type GameDate } from '../../../src/core/date';
import type { EmploymentId, PromotionId } from '../../../src/core/ids';
import { RngRegistry } from '../../../src/core/rng/registry';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES, type GameWorld } from '../../../src/model/tables';
import {
  AI_RENEWAL_STREAM,
  aiRenewalDecision,
  clearRenewalPoliciesForTests,
  registerRenewalPolicy,
  renewalPolicies,
  renewalTraceRef,
  SIMPLE_RIVAL_RENEWAL_POLICY_ID,
  titlesHeldBy,
} from '../../../src/systems/contracts';
import { createEngineTunables } from '../../../src/systems/tunables';
import { resetTestIds, rosterWorld, TEST_PLAYER_ID, worldBuilder } from '../../support';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';
import { contractsRuntime, runDays, runThrough, setEndsOn } from './contract-world';

interface RenewalWorld {
  readonly world: GameWorld;
  readonly human: PromotionId;
  readonly rival: PromotionId;
  /** The rival's champion (main event), upper-card and lower-card workers. */
  readonly champion: EmploymentId;
  readonly upper: EmploymentId;
  readonly lower: EmploymentId;
  /** The player's upper-card worker. */
  readonly mine: EmploymentId;
  /** The day every one of these contracts ends. */
  readonly endsOn: GameDate;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`renewal world: missing ${what}`);
  }
  return value;
}

const PUSHES = ['lowerCard', 'upperCard', 'lowerCard'] as const;

function renewalWorld(settings: { levelPlayingField?: boolean } = {}): RenewalWorld {
  resetTestIds();
  const { world, ids } = worldBuilder({ settings })
    .withGeography('mini')
    .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } }, (promotion) =>
      promotion.withRoster(1, { employment: () => ({ push: 'upperCard' }) }),
    )
    .withPromotion({}, (promotion) =>
      promotion
        .withRoster(3, { employment: (index) => ({ push: PUSHES[index] ?? 'lowerCard' }) })
        .withTitle({}, { holder: 0 }),
    )
    .build();
  const endsOn = addDays(world.meta.currentDate, 2);
  for (const employmentId of ids.employments) {
    setEndsOn(world, employmentId, endsOn);
  }
  const [mine, champion, upper, lower] = ids.employments;
  return {
    world,
    human: required(ids.promotions.A, 'A'),
    rival: required(ids.promotions.B, 'B'),
    champion: required(champion, 'champion'),
    upper: required(upper, 'upper'),
    lower: required(lower, 'lower'),
    mine: required(mine, 'mine'),
    endsOn,
  };
}

function run(built: RenewalWorld, overrides: TunableOverrides = {}) {
  const runtime = contractsRuntime(built.world, overrides);
  runThrough(runtime, built.endsOn);
  return runtime;
}

function statusOf(built: RenewalWorld, employmentId: EmploymentId): string {
  return built.world.tables.employments.require(employmentId).status;
}

function expectRenewedInRange(built: RenewalWorld, employmentId: EmploymentId): void {
  const employment = built.world.tables.employments.require(employmentId);
  expect(employment.status).toBe('active');
  const endsOn = required(employment.endsOn ?? undefined, 'new end date');
  const days = diffDays(built.endsOn, endsOn);
  expect(days).toBeGreaterThanOrEqual(365);
  expect(days).toBeLessThanOrEqual(1095);
}

describe('the renewal policy registry', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('holds the simple rival renewal by default', () => {
    expect(renewalPolicies().map((policy) => policy.id)).toContain(SIMPLE_RIVAL_RENEWAL_POLICY_ID);
  });

  it('asks policies by order then id, and the first non-null answer wins', () => {
    restore = clearRenewalPoliciesForTests();
    const asked: string[] = [];
    registerRenewalPolicy({
      id: 'test.second',
      order: 2,
      decide: () => {
        asked.push('second');
        return { renew: false };
      },
    });
    registerRenewalPolicy({
      id: 'test.first',
      order: 1,
      decide: () => {
        asked.push('first');
        return null;
      },
    });
    registerRenewalPolicy({
      id: 'test.never',
      order: 3,
      decide: () => {
        asked.push('never');
        return null;
      },
    });
    expect(renewalPolicies().map((policy) => policy.id)).toEqual([
      'test.first',
      'test.second',
      'test.never',
    ]);
    const built = renewalWorld();
    run(built);
    // The champion is let go: the test policy answered before the built-in one could keep them.
    expect(statusOf(built, built.champion)).toBe('expired');
    expect(asked.slice(0, 2)).toEqual(['first', 'second']);
    expect(asked).not.toContain('never');
  });

  it('refuses a malformed or repeated id', () => {
    const decide = () => null;
    expect(() => registerRenewalPolicy({ id: 'bad id', order: 1, decide })).toThrow(
      /system.camelName/,
    );
    expect(() =>
      registerRenewalPolicy({ id: SIMPLE_RIVAL_RENEWAL_POLICY_ID, order: 1, decide }),
    ).toThrow(/already registered/);
  });
});

describe('the simple rival renewal', () => {
  it("renews a rival's champion and upper-card worker for a length in the tunable range", () => {
    const built = renewalWorld();
    const runtime = run(built);
    expectRenewedInRange(built, built.champion);
    expectRenewedInRange(built, built.upper);
    const renewed = runtime.bus.recent({ types: ['contract.renewed'] });
    const champion = renewed.find((event) => event.payload.employmentId === built.champion);
    expect(champion?.payload).toMatchObject({
      promotionId: built.rival,
      previousEndsOn: built.endsOn,
      source: 'ai',
    });
    for (const event of renewed) {
      expectSerialisable(event.payload);
    }
    // A rival's renewal Why? is stored, as a summary only (rival contracts are private).
    expect(runtime.traces.get(renewalTraceRef(built.champion, built.endsOn))).toMatchObject({
      summaryOnly: true,
      value: 'renew',
    });
    expect(checkWorld(built.world, TABLES, { validateRows: true }).issues).toEqual([]);
  });

  it('decides a lower-card worker by the seeded roll: the same seed gives the same answer', () => {
    const first = renewalWorld();
    run(first);
    const second = renewalWorld();
    run(second);
    expect(['active', 'expired']).toContain(statusOf(first, first.lower));
    expect(second.world.tables.employments.require(second.lower)).toEqual(
      first.world.tables.employments.require(first.lower),
    );
  });

  it("never renews the player's contracts (with the player's automatic renewal off)", () => {
    const built = renewalWorld();
    run(built, { 'contracts.ai.renewChance': 1, 'contracts.autoRenewPlayer': false });
    expect(statusOf(built, built.mine)).toBe('expired');
  });

  it('lets every rival contract expire when the rule is off or the playing field is level', () => {
    const off = renewalWorld();
    run(off, { 'ai.contracts.simpleRenewals': false });
    const level = renewalWorld({ levelPlayingField: true });
    run(level);
    for (const built of [off, level]) {
      for (const employmentId of [built.champion, built.upper, built.lower]) {
        expect(statusOf(built, employmentId)).toBe('expired');
      }
    }
  });

  it('renews only the keepers at a 0 chance, and everyone at 1', () => {
    const none = renewalWorld();
    run(none, { 'contracts.ai.renewChance': 0 });
    expect([none.champion, none.upper, none.lower].map((id) => statusOf(none, id))).toEqual([
      'active',
      'active',
      'expired',
    ]);
    const all = renewalWorld();
    run(all, { 'contracts.ai.renewChance': 1 });
    for (const employmentId of [all.champion, all.upper, all.lower]) {
      expectRenewedInRange(all, employmentId);
    }
  });

  it('keeps champions only while contracts.ai.keepChampions is on', () => {
    const built = renewalWorld();
    run(built, { 'contracts.ai.keepChampions': false, 'contracts.ai.renewChance': 0 });
    expect(statusOf(built, built.champion)).toBe('expired');
    expect(statusOf(built, built.upper)).toBe('active');
  });
});

describe('aiRenewalDecision', () => {
  it('rolls a length that replays, and reads a swapped range the right way round', () => {
    const tunables = createEngineTunables({
      'contracts.ai.renewMinDays': 400,
      'contracts.ai.renewMaxDays': 380,
    });
    const stream = new RngRegistry('renewal-seed').stream(AI_RENEWAL_STREAM);
    const result = aiRenewalDecision({ push: 'mainEvent', titlesHeld: 0 }, { tunables, stream });
    expect(result.decision.value).toBe('renew');
    const days = required(result.days ?? undefined, 'days');
    expect(days.value).toBeGreaterThanOrEqual(380);
    expect(days.value).toBeLessThanOrEqual(400);
    expectTraceReplays(days);
    expectSerialisable(result.decision);
  });

  it('lets a worker go on a failed roll without rolling a length', () => {
    const tunables = createEngineTunables({ 'contracts.ai.renewChance': 0 });
    const stream = new RngRegistry('renewal-seed').stream(AI_RENEWAL_STREAM);
    const result = aiRenewalDecision({ push: 'midCard', titlesHeld: 0 }, { tunables, stream });
    expect(result).toMatchObject({ decision: { value: 'letGo' }, days: null });
  });
});

describe('titlesHeldBy', () => {
  it("lists a champion's open reigns, optionally for one promotion only", () => {
    const built = renewalWorld();
    const champion = built.world.tables.employments.require(built.champion);
    const held = titlesHeldBy(built.world, champion.personId);
    expect(held).toHaveLength(1);
    expect(titlesHeldBy(built.world, champion.personId, built.rival)).toEqual(held);
    expect(titlesHeldBy(built.world, champion.personId, built.human)).toEqual([]);
    const upper = built.world.tables.employments.require(built.upper);
    expect(titlesHeldBy(built.world, upper.personId)).toEqual([]);
  });
});

describe('rival rosters over three years', () => {
  it('keep at least half their starting active roster', () => {
    resetTestIds();
    const { world, ids } = rosterWorld(60);
    const start = world.meta.currentDate;
    // Spread the end dates over the first three years, as a new game's randomised lengths do.
    ids.employments.forEach((employmentId, index) => {
      setEndsOn(world, employmentId, addDays(start, 365 + ((index * 37) % 730)));
    });
    const promotionId = required(ids.promotions.A, 'A');
    const activeCount = (): number =>
      world.tables.employments.lookup('byPromotionStatus', `${promotionId}|active`).length;
    const before = activeCount();
    const runtime = contractsRuntime(world, {}, [], false);
    runDays(runtime, 1095);
    const after = activeCount();
    expect(compareDates(world.meta.currentDate, addDays(start, 1095))).toBe(0);
    expect(after * 2).toBeGreaterThanOrEqual(before);
    expect(after).toBeLessThan(before);
    expect(checkWorld(world, TABLES, { validateRows: true }).issues).toEqual([]);
  });
});
