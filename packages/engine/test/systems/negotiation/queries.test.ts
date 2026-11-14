// contracts.askingTerms and contracts.freeAgents (ECO5-02). Design: docs/design/negotiation.md#free-agents
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import { INVALID_ARGS } from '../../../src/core/api/result';
import {
  CURRENT_DEAL_FLOOR_LABEL,
  NOT_YOUR_CONTRACT_MESSAGE,
  NOT_YOUR_PROMOTION_MESSAGE,
} from '../../../src/systems/negotiation';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';
import {
  ask,
  MY_WAGE,
  negotiationEngine,
  negotiationWorld,
  OMNISCIENT,
  OTHER_PLAYER,
  OTHER_VIEW,
  PLAYER_VIEW,
  RIVAL_FEE,
  RIVAL_NAME,
  RIVAL_WAGE,
} from './negotiation-world';

describe('contracts.askingTerms brand options (ECO5-06)', () => {
  it("lists the promotion's running brands, flagship first", () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const view = ask(
      engine.query(
        'contracts.askingTerms',
        { promotionId: setup.human, personId: setup.veteran },
        PLAYER_VIEW,
      ),
    );
    const expected = setup.world.tables.brands
      .lookup('byPromotion', setup.human)
      .filter((brand) => brand.active)
      .sort((left, right) => left.priority - right.priority)
      .map((brand) => ({ brandId: brand.id, name: brand.name }));
    expect(view.brandOptions).toEqual(expected);
  });
});

describe('contracts.freeAgents', () => {
  it('lists free agents and the workers whose deals elsewhere leave them open to offers', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const rows = ask(
      engine.query('contracts.freeAgents', { promotionId: setup.human }, PLAYER_VIEW),
    );
    const listed = new Map(rows.map((row) => [row.personId, row]));

    expect(listed.get(setup.free)?.situation).toBe('freeAgent');
    expect(listed.get(setup.veteran)?.situation).toBe('freeAgent');
    expect(listed.get(setup.person(setup.rivalFee))?.situation).toBe('perAppearanceElsewhere');
    const ending = listed.get(setup.person(setup.rivalEnding));
    expect(ending?.situation).toBe('endingSoonElsewhere');
    expect(ending?.otherPromotionName).toBe(RIVAL_NAME);
    expect(ending?.endsOn).toBe(addDays(setup.today, 20));

    // Blocked by an exclusive deal (active or signed), already yours, or unavailable.
    for (const personId of [
      setup.person(setup.rivalLocked),
      setup.signedPerson,
      setup.person(setup.mine),
      setup.person(setup.mineFee),
      setup.retired,
      setup.rookie,
    ]) {
      expect(listed.has(personId)).toBe(false);
    }
    // Nobody in the list has an exclusive signed or active deal outside its approach window.
    for (const row of rows) {
      const exclusiveElsewhere = setup.world.tables.employments
        .lookup('byPerson', row.personId)
        .filter(
          (employment) =>
            (employment.status === 'signed' || employment.status === 'active') &&
            employment.terms.exclusive,
        );
      for (const employment of exclusiveElsewhere) {
        expect(employment.endsOn).toBe(addDays(setup.today, 20));
      }
    }
    expectSerialisable(rows);
  });

  it('filters to free agents only, and by role, gender and search', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const query = (args: Record<string, unknown>) =>
      ask(engine.query('contracts.freeAgents', { promotionId: setup.human, ...args }, PLAYER_VIEW));
    const free = query({ situation: 'freeAgent' });
    expect(free.map((row) => row.situation)).toEqual(free.map(() => 'freeAgent'));
    expect(free.map((row) => row.personId).sort()).toEqual([setup.free, setup.veteran].sort());
    expect(query({ role: 'referee' })).toEqual([]);
    expect(query({ gender: 'female' })).toEqual([]);
    const name = setup.world.tables.people.require(setup.veteran).defaultRingName;
    expect(query({ search: name.toUpperCase() }).map((row) => row.personId)).toEqual([
      setup.veteran,
    ]);
  });

  it('sorts by market value, highest first, with the same asks as contracts.askingTerms', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const rows = ask(
      engine.query('contracts.freeAgents', { promotionId: setup.human }, PLAYER_VIEW),
    );
    const values = rows.map(
      (row) =>
        ask(
          engine.query(
            'contracts.askingTerms',
            { promotionId: setup.human, personId: row.personId },
            PLAYER_VIEW,
          ),
        ).marketValue.value,
    );
    expect(values).toEqual([...values].sort((left, right) => right - left));
    for (const row of rows) {
      const written = ask(
        engine.query(
          'contracts.askingTerms',
          { promotionId: setup.human, personId: row.personId, kind: 'written' },
          PLAYER_VIEW,
        ),
      );
      const perAppearance = ask(
        engine.query(
          'contracts.askingTerms',
          { promotionId: setup.human, personId: row.personId, kind: 'perAppearance' },
          PLAYER_VIEW,
        ),
      );
      expect(row.askMonthly).toBe(written.monthlyWage.value);
      expect(row.askPerAppearance).toBe(perAppearance.perAppearanceFee.value);
      expect(row.bestKind).toBe('written');
    }
  });

  it('shows the cooldown, and other bidders by name only', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const rows = ask(
      engine.query('contracts.freeAgents', { promotionId: setup.human }, PLAYER_VIEW),
    );
    const free = rows.find((row) => row.personId === setup.free);
    expect(free?.cooldownUntil).toBe(addDays(setup.today, 12));
    expect(free?.openNegotiationId).toBeNull();
    expect(free?.competingBidders).toEqual([RIVAL_NAME]);
  });

  it('never returns rival wages, fees or morale', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const rows = ask(
      engine.query('contracts.freeAgents', { promotionId: setup.human }, PLAYER_VIEW),
    );
    const terms = [setup.rivalEnding, setup.rivalFee, setup.rivalLocked].map((employmentId) =>
      ask(
        engine.query(
          'contracts.askingTerms',
          { promotionId: setup.human, personId: setup.person(employmentId) },
          PLAYER_VIEW,
        ),
      ),
    );
    const text = JSON.stringify({ rows, terms });
    expect(text).not.toContain(String(RIVAL_WAGE));
    expect(text).not.toContain(String(RIVAL_FEE));
    expect(text).not.toContain('"morale"');
    expect(text).not.toContain('potential');
    // The rival deal adds the under-contract premium instead of a floor.
    for (const asked of terms) {
      expect(JSON.stringify(asked.monthlyWage.trace)).not.toContain(CURRENT_DEAL_FLOOR_LABEL);
      expect(JSON.stringify(asked.monthlyWage.trace)).toContain('Under contract elsewhere');
    }
  });

  it('refuses a promotion the viewer does not run', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    for (const [promotionId, viewer] of [
      [setup.rival, PLAYER_VIEW],
      [setup.human, OMNISCIENT],
    ] as const) {
      const result = engine.query('contracts.freeAgents', { promotionId }, viewer);
      expect(result).toEqual({
        ok: false,
        reasons: [
          { code: INVALID_ARGS, message: NOT_YOUR_PROMOTION_MESSAGE, field: 'promotionId' },
        ],
      });
    }
  });
});

describe('contracts.askingTerms', () => {
  it('returns a full ask whose numbers replay, with who may be approached', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const terms = ask(
      engine.query(
        'contracts.askingTerms',
        { promotionId: setup.human, personId: setup.free },
        PLAYER_VIEW,
      ),
    );
    for (const traced of [
      terms.marketValue,
      terms.monthlyWage,
      terms.perAppearanceFee,
      terms.signingBonus,
      terms.startPatience,
      terms.preferredLengthMonths,
    ]) {
      expectTraceReplays(traced);
    }
    expect(terms.kind).toBe('written');
    expect(terms.exclusive).toBe(true);
    expect(terms.eligibility).toMatchObject({ situation: 'freeAgent', earliestStart: setup.today });
    expect(terms.perks.map((perk) => perk.term)).toEqual(['perk.travelCovered']);
    expect(terms.signingBonus.value).toBe(terms.monthlyWage.value);
    expect(terms.refusal).toBeNull();
    expectSerialisable(terms);
  });

  it('gives an exclusive worker elsewhere a blocked eligibility with the day talks open', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const terms = ask(
      engine.query(
        'contracts.askingTerms',
        { promotionId: setup.human, personId: setup.person(setup.rivalLocked) },
        PLAYER_VIEW,
      ),
    );
    expect(terms.eligibility.situation).toBe('underContract');
    expect(terms.eligibility.earliestStart).toBe(addDays(setup.today, 200));
    expect(terms.eligibility.otherPromotionIds).toEqual([setup.rival]);
    expect(terms.eligibility.reasons[0]?.message).toContain(
      `exclusive contract with ${RIVAL_NAME}`,
    );
  });

  it("floors a renewal at the worker's current deal with you", () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const terms = ask(
      engine.query(
        'contracts.askingTerms',
        { promotionId: setup.human, personId: setup.person(setup.mine), renewalOf: setup.mine },
        PLAYER_VIEW,
      ),
    );
    expect(terms.renewalOf).toBe(setup.mine);
    expect(terms.monthlyWage.value).toBeGreaterThanOrEqual(MY_WAGE);
    expect(JSON.stringify(terms.monthlyWage.trace)).toContain(CURRENT_DEAL_FLOOR_LABEL);
    expect(terms.eligibility.situation).toBe('yours');
    expect(terms.renewalDecision?.value).toBe(true);
  });

  it("refuses a renewal of a contract that is not this promotion's with this worker", () => {
    const setup = negotiationWorld({ rivalController: OTHER_PLAYER });
    const engine = negotiationEngine(setup.world);
    const refused = { code: INVALID_ARGS, message: NOT_YOUR_CONTRACT_MESSAGE, field: 'renewalOf' };
    // The other player asks about my worker's renewal through their own promotion.
    expect(
      engine.query(
        'contracts.askingTerms',
        { promotionId: setup.rival, personId: setup.person(setup.mine), renewalOf: setup.mine },
        OTHER_VIEW,
      ),
    ).toEqual({ ok: false, reasons: [refused] });
    // ...or through mine.
    expect(
      engine.query(
        'contracts.askingTerms',
        { promotionId: setup.human, personId: setup.person(setup.mine), renewalOf: setup.mine },
        OTHER_VIEW,
      ),
    ).toEqual({
      ok: false,
      reasons: [{ code: INVALID_ARGS, message: NOT_YOUR_PROMOTION_MESSAGE, field: 'promotionId' }],
    });
    // A contract of another worker.
    expect(
      engine.query(
        'contracts.askingTerms',
        { promotionId: setup.human, personId: setup.free, renewalOf: setup.mine },
        PLAYER_VIEW,
      ),
    ).toEqual({ ok: false, reasons: [refused] });
  });

  it('gives the omniscient viewer invalidArgs: it runs no promotion', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const result = engine.query(
      'contracts.askingTerms',
      { promotionId: setup.human, personId: setup.free },
      OMNISCIENT,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reasons[0]?.code).toBe(INVALID_ARGS);
  });
});
