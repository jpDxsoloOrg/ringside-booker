// The negotiation groundwork (ECO5-01): the negotiations table, its invariants, saves, and the
// registries. Design: docs/design/negotiation.md.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import { RegistryError } from '../../../src/core/errors';
import { cents } from '../../../src/core/money';
import { defaultSystems } from '../../../src/systems';
import {
  NEGOTIATION_HISTORY_MAX,
  NegotiationSchema,
  negotiationsTable,
  personPromotionKey,
  type Negotiation,
  type NegotiationRound,
} from '../../../src/model/entities/negotiation';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import { encodeSave } from '../../../src/persistence/codec';
import { loadSave } from '../../../src/persistence/load';
import { documentToWorld } from '../../../src/persistence/world-document';
import { REACH_TOO_LOW } from '../../../src/systems/negotiation/formulas/reachGate';
import { OfferSchema } from '../../../src/systems/negotiation/offer';
import {
  clearAskModifiersForTests,
  clearEnforcedTermsForTests,
  clearOfferKindsForTests,
  isTermEnforced,
  listAskModifiers,
  listEnforcedTerms,
  listOfferKinds,
  listPatienceModifiers,
  offerKind,
  registerAskModifier,
  registerEnforcedTerm,
  registerOfferKind,
  registerPatienceModifier,
  type NegotiationModifier,
} from '../../../src/systems/negotiation/registries';
import { ALL_TUNABLES, createEngineTunables } from '../../../src/systems/tunables';
import type { EmploymentId } from '../../../src/core/ids';
import { TEST_START_DATE, type DeepPartial } from '../../support/builders/build-row';
import { aNegotiation, anEmployment, anOffer } from '../../support/builders/promotions';
import { testSaveDocument } from '../../support/saves';
import { worldBuilder, type BuiltWorld } from '../../support/world-builder';
import { tinyWorld } from '../../support/worlds';

const BEFORE_NEGOTIATIONS = new URL(
  '../../fixtures/saves/v1-tiny-before-negotiations.json',
  import.meta.url,
);

function invalid(row: unknown): boolean {
  return !NegotiationSchema.safeParse(row).success;
}

describe('OfferSchema', () => {
  it('accepts the default offer and refuses unknown terms and too many extra fields', () => {
    const offer = anOffer();
    expect(OfferSchema.safeParse(offer).success).toBe(true);
    expect(OfferSchema.safeParse({ ...offer, bonus: 1 }).success).toBe(false);
    expect(OfferSchema.safeParse({ ...offer, lengthMonths: 121 }).success).toBe(false);
    const extra = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [`k${String(index)}`, index]),
    );
    expect(OfferSchema.safeParse({ ...offer, extra }).success).toBe(false);
    expect(OfferSchema.safeParse({ ...offer, brand: { kind: 'auto' } }).success).toBe(false);
  });
});

describe('NegotiationSchema', () => {
  it('accepts the default row', () => {
    expect(invalid(aNegotiation())).toBe(false);
  });

  it('refuses a countered row without the counter-offer or its expiry', () => {
    const row = aNegotiation();
    const expires = addDays(TEST_START_DATE, 7);
    expect(invalid({ ...row, status: 'countered', counterExpiresOn: expires })).toBe(true);
    expect(invalid({ ...row, status: 'countered', lastCounter: anOffer() })).toBe(true);
    expect(
      invalid({ ...row, status: 'countered', lastCounter: anOffer(), counterExpiresOn: expires }),
    ).toBe(false);
    expect(invalid({ ...row, lastCounter: anOffer() })).toBe(true);
  });

  it('refuses a closed row without closedOn, and an open row with one', () => {
    const row = aNegotiation();
    expect(invalid({ ...row, status: 'declined' })).toBe(true);
    expect(invalid({ ...row, status: 'declined', closedOn: TEST_START_DATE })).toBe(false);
    expect(invalid({ ...row, closedOn: TEST_START_DATE })).toBe(true);
  });

  it('refuses more than 12 history entries', () => {
    const entry: NegotiationRound = {
      round: 1,
      date: TEST_START_DATE,
      by: 'promotion',
      offer: anOffer(),
      reaction: null,
    };
    const history = (count: number): NegotiationRound[] =>
      Array.from({ length: count }, () => entry);
    expect(invalid({ ...aNegotiation(), history: history(NEGOTIATION_HISTORY_MAX) })).toBe(false);
    expect(invalid({ ...aNegotiation(), history: history(NEGOTIATION_HISTORY_MAX + 1) })).toBe(
      true,
    );
  });

  it('refuses more patience than the worker started with, and a review without a date', () => {
    expect(invalid({ ...aNegotiation(), patience: 6 })).toBe(true);
    expect(invalid({ ...aNegotiation(), status: 'awaitingReview' })).toBe(true);
  });
});

/** Where a test's negotiation rows can point. */
interface NegotiationTargets {
  readonly activeId: EmploymentId;
  readonly offeredId: EmploymentId;
}

/**
 * A promotion with 3 wrestlers, where the first also has an `offered` employment (a second deal
 * offered to a worker already under contract there), plus the rows `rows` asks for: by default
 * open signings of that worker pointing at the offered employment.
 */
function negotiationWorld(
  rows: (targets: NegotiationTargets) => DeepPartial<Negotiation>[],
): BuiltWorld {
  return worldBuilder()
    .withGeography('mini')
    .withPromotion({}, (promotion) => promotion.withRoster(3))
    .with('negotiations', (context) => {
      const promotionId = context.ids.promotions.A!;
      const activeId = context.ids.employments[0]!;
      const { personId } = context.tx.view.tables.employments.require(activeId);
      const offered = context.insert(
        'employments',
        anEmployment({ personId, promotionId, status: 'offered' }, context.sequence),
      );
      for (const overrides of rows({ activeId, offeredId: offered.id })) {
        context.insert(
          'negotiations',
          aNegotiation(
            { personId, promotionId, employmentId: offered.id, ...overrides },
            context.sequence,
          ),
        );
      }
    })
    .build();
}

function issueCodes(built: BuiltWorld): string[] {
  return checkWorld(built.world, TABLES, { validateRows: true }).issues.map((issue) => issue.code);
}

describe('negotiations table', () => {
  it('is registered under prefix neg with its indexes', () => {
    expect(TABLES.negotiations).toBe(negotiationsTable);
    expect(negotiationsTable.indexes.map((index) => index.name)).toEqual([
      'byPerson',
      'byPromotion',
      'byEmployment',
      'byStatus',
      'byPersonPromotion',
    ]);
    expect(aNegotiation().id).toMatch(/^neg_/);
  });

  it('accepts an open signing on an offered employment beside closed rows of the same pair', () => {
    const built = negotiationWorld(() => [
      {},
      { status: 'walkedAway', closedOn: TEST_START_DATE, cooldownUntil: TEST_START_DATE },
    ]);
    expect(issueCodes(built)).toEqual([]);
    const [row] = built.world.tables.negotiations.values();
    expect(
      built.world.tables.negotiations.lookup(
        'byPersonPromotion',
        personPromotionKey(row!.personId, row!.promotionId),
      ),
    ).toHaveLength(2);
  });

  it('catches two open rows for one worker and promotion', () => {
    const built = negotiationWorld(() => [{}, { status: 'countered', ...COUNTERED }]);
    expect(issueCodes(built)).toEqual(['negotiations.oneOpenPerPersonPromotion']);
  });

  it('catches a signing that points at an active employment', () => {
    const built = negotiationWorld(({ activeId }) => [{ employmentId: activeId }]);
    expect(issueCodes(built)).toEqual(['negotiations.signingEmploymentIsOffered']);
  });

  it('wants a renewal to point at the live contract', () => {
    expect(
      issueCodes(negotiationWorld(({ activeId }) => [{ kind: 'renewal', employmentId: activeId }])),
    ).toEqual([]);
    expect(issueCodes(negotiationWorld(() => [{ kind: 'renewal' }]))).toEqual([
      'negotiations.renewalEmploymentIsLive',
    ]);
  });
});

const COUNTERED = {
  lastCounter: anOffer({ terms: { monthlyWage: cents(700_000) } }),
  counterExpiresOn: addDays(TEST_START_DATE, 7),
} as const;

describe('saves', () => {
  it('written before the negotiations table load with an empty table', async () => {
    const report = await loadSave(new Uint8Array(readFileSync(BEFORE_NEGOTIATIONS)), TABLES);
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    expect(report.doc.state.world.tables.negotiations).toEqual([]);
    const world = documentToWorld(report.doc, TABLES);
    expect(checkWorld(world, TABLES, { validateRows: true }).issues).toEqual([]);
  });

  it('round-trip the tiny world’s countered negotiation', async () => {
    const { world } = tinyWorld();
    const [before] = world.tables.negotiations.values();
    expect(before?.status).toBe('countered');
    const report = await loadSave(await encodeSave(testSaveDocument(world)), TABLES);
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    expect(documentToWorld(report.doc, TABLES).tables.negotiations.values()).toEqual([before]);
  });
});

describe('the negotiation system', () => {
  it('is in defaultSystems after contracts, and its tunables are in ALL_TUNABLES', () => {
    const ids = defaultSystems.map((system) => system.id);
    expect(ids.indexOf('negotiation')).toBe(ids.indexOf('contracts') + 1);
    expect(ALL_TUNABLES['contracts.review.delayDays'].default).toBe(2);
    expect(ALL_TUNABLES['contracts.kind.writtenMinReach'].docRef).toBe(
      'negotiation.md#offer-kinds',
    );
  });
});

describe('offer kinds', () => {
  const restores: (() => void)[] = [];
  afterEach(() => {
    for (const restore of restores.splice(0).reverse()) {
      restore();
    }
  });

  it('lists the built-ins by order, then key, and refuses a key twice', () => {
    expect(listOfferKinds().map((kind) => kind.key)).toEqual(['written', 'perAppearance']);
    restores.push(clearOfferKindsForTests());
    const kind = { label: 'Kind', available: () => [] };
    restores.push(registerOfferKind({ ...kind, key: 'tour', order: 5 }));
    restores.push(registerOfferKind({ ...kind, key: 'written', order: 5 }));
    restores.push(registerOfferKind({ ...kind, key: 'development', order: 1 }));
    expect(listOfferKinds().map((entry) => entry.key)).toEqual(['development', 'tour', 'written']);
    expect(() => registerOfferKind({ ...kind, key: 'tour', order: 9 })).toThrow(RegistryError);
  });

  it('puts the built-ins back after a test clears them', () => {
    clearOfferKindsForTests()();
    expect(offerKind('written')).toBeDefined();
  });

  it('refuses a written contract below the reach threshold, with the numbers in plain words', () => {
    const built = worldBuilder()
      .withGeography('mini')
      .withPromotion({}, (promotion) => promotion.withRoster(1))
      .build();
    const promotionId = built.ids.promotions.A!;
    const personId = built.ids.people[0]!;
    const written = offerKind('written')!;
    const reasons = written.available(
      built.world,
      promotionId,
      personId,
      TEST_START_DATE,
      createEngineTunables(),
    );
    expect(reasons).toEqual([
      {
        code: REACH_TOO_LOW,
        message: 'Written contracts need a reach of 35; yours is 0',
        subject: { kind: 'promotion', id: promotionId },
      },
    ]);
    const open = createEngineTunables({ 'contracts.kind.writtenMinReach': 0 });
    expect(written.available(built.world, promotionId, personId, TEST_START_DATE, open)).toEqual(
      [],
    );
    expect(
      offerKind('perAppearance')!.available(
        built.world,
        promotionId,
        personId,
        TEST_START_DATE,
        createEngineTunables(),
      ),
    ).toEqual([]);
  });

  it('lets a promotion with a wide reach offer written contracts', () => {
    const built = worldBuilder().withGeography('mini').build();
    const regionalPop = Object.fromEntries(built.ids.regions.map((id) => [id, 100]));
    const wide = worldBuilder()
      .withGeography('mini')
      .withPromotion({ regionalPop }, (promotion) => promotion.withRoster(1))
      .build();
    expect(
      offerKind('written')!.available(
        wide.world,
        wide.ids.promotions.A!,
        wide.ids.people[0]!,
        TEST_START_DATE,
        createEngineTunables(),
      ),
    ).toEqual([]);
  });
});

describe('enforced terms', () => {
  it('lists the built-ins and refuses a term twice', () => {
    expect(listEnforcedTerms().map((spec) => spec.term)).toEqual([
      'perk.ironClad',
      'perk.travelCovered',
    ]);
    expect(isTermEnforced('perk.travelCovered')).toBe(true);
    expect(isTermEnforced('share.gateBp')).toBe(false);
    expect(() =>
      registerEnforcedTerm({ term: 'perk.ironClad', label: 'Again', enforcedBy: 'Nothing' }),
    ).toThrow(RegistryError);
    const restore = clearEnforcedTermsForTests();
    expect(listEnforcedTerms()).toEqual([]);
    restore();
    expect(listEnforcedTerms()).toHaveLength(2);
  });
});

describe('ask and patience modifiers', () => {
  const modifier = (id: string, order: number): NegotiationModifier => ({
    id,
    order,
    label: id,
    compute: () => null,
  });

  it('sort by order, then id, refuse a taken id and a malformed one', () => {
    const restore = clearAskModifiersForTests();
    try {
      registerAskModifier(modifier('social.zeta', 1));
      registerAskModifier(modifier('social.alpha', 1));
      registerAskModifier(modifier('social.first', 0));
      expect(listAskModifiers().map((entry) => entry.id)).toEqual([
        'social.first',
        'social.alpha',
        'social.zeta',
      ]);
      expect(() => registerAskModifier(modifier('social.alpha', 3))).toThrow(RegistryError);
      expect(() => registerAskModifier(modifier('Not An Id', 3))).toThrow(RegistryError);
    } finally {
      restore();
    }
    expect(listAskModifiers()).toEqual([]);
  });

  it('keep patience modifiers apart from ask modifiers', () => {
    const unregister = registerPatienceModifier(modifier('social.rapport', 1));
    try {
      expect(listPatienceModifiers().map((entry) => entry.id)).toEqual(['social.rapport']);
      expect(listAskModifiers()).toEqual([]);
    } finally {
      unregister();
    }
    expect(listPatienceModifiers()).toEqual([]);
  });
});
