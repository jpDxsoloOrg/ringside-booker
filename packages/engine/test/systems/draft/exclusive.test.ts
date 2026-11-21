// DRF-12 draft contracts are exclusive: in a draft game every drafted job signs exclusive (per
// appearance too), negotiations hold to it, the post-draft fills are exclusive, nobody else can
// sign or book such a worker, and a game without a draft is unchanged.
// Design: docs/design/draft.md#contracts
import { describe, expect, it } from 'vitest';
import type { EngineState } from '../../../src/core/api';
import type { PromotionId } from '../../../src/core/ids';
import { askingTermsFor } from '../../../src/systems/negotiation/asking';
import { draftForcesExclusive } from '../../../src/systems/draft/rights';
import { createEngineTunables } from '../../../src/systems/tunables';
import { anOffer } from '../../support';
import { engineOf, PLAYER, PLAYER_VIEW, run, startDraftGame, worldOf } from './draft-game';

function humanOf(state: EngineState): PromotionId {
  return state.world.tables.promotions.find((row) => row.controller.kind === 'human')!.id;
}

function setReserveMonths(engine: ReturnType<typeof engineOf>, value: number): void {
  run(engine.command('tunables.setOverride', { key: 'draft.ai.reserveMonths', value }, PLAYER));
}

describe('contracts signed at the pick', () => {
  const engine = engineOf(startDraftGame());
  run(engine.command('draft.autoPickRest', {}, PLAYER));
  const state = engine.exportState();

  it('are exclusive, per-appearance ones included', () => {
    const signed = state.world.tables.draftPicks.map((pick) =>
      state.world.tables.employments.find((row) => row.id === pick.employmentId)!,
    );
    expect(signed.length).toBeGreaterThan(0);
    expect(signed.some((row) => row.terms.kind === 'perAppearance')).toBe(true);
    expect(signed.every((row) => row.terms.exclusive)).toBe(true);
  });

  it('charge what the board priced: the exclusive ask', () => {
    for (const pick of state.world.tables.draftPicks) {
      expect(pick.cost, pick.personId).toBeGreaterThan(0);
    }
    const world = worldOf(state);
    const tunables = createEngineTunables();
    const [rival] = state.world.tables.drafts[0]!.order.filter((id) => id !== humanOf(state));
    const free = state.world.tables.people.find(
      (person) =>
        person.roles.includes('wrestler') &&
        !state.world.tables.employments.some((row) => row.personId === person.id),
    )!;
    const ask = askingTermsFor(world, tunables, {
      personId: free.id,
      promotionId: rival!,
      date: world.meta.currentDate,
    });
    expect(ask.exclusive).toBe(true);
    expect(ask.exclusiveForced).toBe(true);
    expect(ask.exclusiveAllowed).toBe(true);
    const plain = askingTermsFor(world, tunables, {
      personId: free.id,
      promotionId: rival!,
      date: world.meta.currentDate,
      exclusive: false,
    });
    // Asked for non-exclusive, the draft game still prices the exclusive deal.
    expect(plain.exclusive).toBe(true);
    expect(plain.perAppearanceFee.value).toBe(ask.perAppearanceFee.value);
  });

  it('keep the worker from another promotion: no offer, no booking', () => {
    const mine = humanOf(state);
    const theirs = state.world.tables.draftPicks.find(
      (pick) =>
        pick.promotionId !== mine &&
        state.world.tables.employments.find((row) => row.id === pick.employmentId)?.terms.kind ===
          'perAppearance',
    )!;
    const offer = engine.command(
      'contracts.makeOffer',
      {
        promotionId: mine,
        personId: theirs.personId,
        offer: anOffer({ terms: { kind: 'perAppearance', exclusive: true } }),
      },
      PLAYER,
    );
    expect(offer.ok).toBe(false);
    if (!offer.ok) {
      expect(offer.reasons.map((reason) => reason.message).join(' ')).toMatch(
        /Under an exclusive contract/,
      );
    }
    run(engine.command('draft.finish', {}, PLAYER));
    const show = engine
      .exportState()
      .world.tables.eventInstances.find(
        (row) => row.promotionId === mine && row.status === 'scheduled',
      )!;
    const pickable = run(
      engine.query(
        'booking.availableWorkers',
        { eventInstanceId: show.id, kind: 'match' },
        PLAYER_VIEW,
      ),
    );
    expect(pickable.people.some((row) => row.personId === theirs.personId)).toBe(false);
  });
});

describe('negotiate-after', () => {
  it('refuses a non-exclusive offer to a pick, and rivals settle exclusive', () => {
    const engine = engineOf(startDraftGame({ settings: { draftNegotiateAfter: true } }));
    run(engine.command('draft.autoPickRest', {}, PLAYER));
    run(engine.command('draft.finish', {}, PLAYER));
    const state = engine.exportState();
    const mine = humanOf(state);
    const pick = state.world.tables.draftPicks.find(
      (row) => row.promotionId === mine && row.status === 'reserved',
    )!;
    const refused = engine.command(
      'contracts.makeOffer',
      {
        promotionId: mine,
        personId: pick.personId,
        offer: anOffer({ terms: { kind: 'perAppearance', exclusive: false } }),
      },
      PLAYER,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reasons.map((reason) => reason.code)).toContain('draft.exclusiveOnly');
    }
    const settled = state.world.tables.draftPicks.filter(
      (row) => row.promotionId !== mine && row.status === 'signed',
    );
    expect(settled.length).toBeGreaterThan(0);
    for (const row of settled) {
      const contract = state.world.tables.employments.find((item) => item.id === row.employmentId)!;
      expect(contract.terms.exclusive).toBe(true);
    }
  });
});

describe('the free-agent fills after the draft', () => {
  it('are exclusive per-appearance deals', () => {
    const engine = engineOf(startDraftGame({ settings: { draftStartingCash: '250k' } }));
    setReserveMonths(engine, 60);
    run(engine.command('draft.autoPickRest', {}, PLAYER));
    const finish = run(engine.command('draft.finish', {}, PLAYER));
    expect(finish.filled).toBeGreaterThan(0);
    const state = engine.exportState();
    const picked = new Set(state.world.tables.draftPicks.map((pick) => pick.personId));
    const fills = state.world.tables.employments.filter(
      (row) => row.status === 'active' && row.role === 'wrestler' && !picked.has(row.personId),
    );
    expect(fills.length).toBe(finish.filled);
    for (const row of fills) {
      expect(row.terms.kind).toBe('perAppearance');
      expect(row.terms.exclusive).toBe(true);
    }
  });
});

describe('the rule', () => {
  it('covers drafted jobs only: wrestlers, staff when staff are drafted, never bookers', () => {
    const plain = worldOf(startDraftGame());
    expect(draftForcesExclusive(plain, 'wrestler')).toBe(true);
    expect(draftForcesExclusive(plain, 'referee')).toBe(false);
    expect(draftForcesExclusive(plain, 'booker')).toBe(false);
    const staff = worldOf(startDraftGame({ settings: { draftStaff: true } }));
    expect(draftForcesExclusive(staff, 'referee')).toBe(true);
    expect(draftForcesExclusive(staff, 'booker')).toBe(false);
  });

  it('leaves a game without a draft as it was', () => {
    const state = startDraftGame({ settings: { draftStart: false } });
    const world = worldOf(state);
    expect(draftForcesExclusive(world, 'wrestler')).toBe(false);
    const tunables = createEngineTunables();
    const mine = humanOf(state);
    const free = state.world.tables.people.find(
      (person) =>
        person.roles.includes('wrestler') &&
        !state.world.tables.employments.some(
          (row) => row.personId === person.id && row.status === 'active',
        ),
    );
    if (free === undefined) {
      return;
    }
    const ask = askingTermsFor(world, tunables, {
      personId: free.id,
      promotionId: mine,
      date: world.meta.currentDate,
      kind: 'perAppearance',
    });
    expect(ask.exclusiveForced).toBe(false);
    expect(ask.exclusive).toBe(false);
  });
});
