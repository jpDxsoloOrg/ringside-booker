/**
 * Builders for promotions, brands, employments, teams, stables and relationships.
 *
 * References default to the first row of each kind (`pro_0000000001`, `per_0000000001`, ...), so
 * a row built on its own points at the first row a test world would hold. Defaults:
 *
 * - promotion `Test Promotion A` (`TPA`), `B`, ...: active, computer-run, mainstream, prestige 50,
 *   10 million in cash, every production level 5, every policy tier 1, based in `reg_0000000001`;
 * - brand `Test Brand 001`, ...: the flagship (priority 0), active, run by its promotion;
 * - employment: an active, exclusive, open-ended written contract for a midcard face wrestler,
 *   offered and started on `TEST_START_DATE`, 5,000 a month, no shares or perks;
 * - contract concern (ECO4-01): for `emp_0000000001` of `per_0000000001` at `pro_0000000001`, with
 *   only an `ending` (expired on its end date, no severance) so the row is not empty;
 * - team `Test Team 001`: an active tag team of people 1 and 2, experience 50;
 * - stable `Test Stable 001`: an active stable of people 1 to 3 with no leader;
 * - relationship: friends, affinity 0. The pair is put in canonical order for you.
 * - promotion snapshot (DAY2-01): a `week` row for `pro_0000000001` on `TEST_START_DATE` with the
 *   default promotion's cash and prestige, no popularity, an empty roster and no extra fields;
 * - rival desk profile (AIP1-01): the whole of `pro_0000000001` (no brand), created on
 *   `TEST_START_DATE`, with no taste, no featured workers and no turn yet;
 * - rival decision (AIP1-01): a routine (importance 0) `rosterReview` by `pro_0000000001` on
 *   `TEST_START_DATE`, revealed the same day, with no refs and no trace.
 */

import { yearMonthOf } from '../../../src/core/date';
import { parseContentKey } from '../../../src/core/content-key';
import { cents } from '../../../src/core/money';
import { AiDecisionSchema, type AiDecision } from '../../../src/model/entities/ai-decision';
import { AiProfileSchema, type AiProfile } from '../../../src/model/entities/ai-profile';
import { BrandSchema, type Brand } from '../../../src/model/entities/brand';
import {
  ContractConcernSchema,
  type ContractConcern,
} from '../../../src/model/entities/contract-concern';
import { EmploymentSchema, type Employment } from '../../../src/model/entities/employment';
import { PromotionSchema, type Promotion } from '../../../src/model/entities/promotion';
import {
  PromotionSnapshotSchema,
  type PromotionSnapshot,
} from '../../../src/model/entities/promotion-snapshot';
import { RelationshipSchema, type Relationship } from '../../../src/model/entities/relationship';
import { StableSchema, type Stable } from '../../../src/model/entities/stable';
import { TeamSchema, type Team } from '../../../src/model/entities/team';
import { TestIds, testId, type TestIdSequence } from '../ids';
import {
  buildRow,
  placeholderLetters,
  placeholderName,
  TEST_FOUNDING_DATE,
  TEST_START_DATE,
  type DeepPartial,
} from './build-row';

/** Default cash: 10 million in cents. */
export const DEFAULT_PROMOTION_CASH = cents(1_000_000_000);
/** Default monthly wage: 5,000 in cents. */
export const DEFAULT_MONTHLY_WAGE = cents(500_000);
const DEFAULT_PRODUCTION_LEVEL = 5;

export function aPromotion(
  overrides: DeepPartial<Promotion> = {},
  sequence: TestIdSequence = TestIds,
): Promotion {
  const needsName = overrides.name === undefined || overrides.shortName === undefined;
  const letters = placeholderLetters(needsName ? sequence.nextNumber('promotion') : 1);
  const defaults: Promotion = {
    id: overrides.id ?? sequence.id('promotion'),
    name: `Test Promotion ${letters}`,
    shortName: `TP${letters}`,
    logoRef: null,
    foundedOn: TEST_FOUNDING_DATE,
    status: 'active',
    homeRegionId: testId('region'),
    regionalPop: {},
    popularityGains: { month: yearMonthOf(TEST_START_DATE), byRegion: {} },
    prestige: 50,
    cash: DEFAULT_PROMOTION_CASH,
    style: 'mainstream',
    ownerPersonId: null,
    bookerPersonId: null,
    parentPromotionId: null,
    production: {
      stage: DEFAULT_PRODUCTION_LEVEL,
      camera: DEFAULT_PRODUCTION_LEVEL,
      editing: DEFAULT_PRODUCTION_LEVEL,
      pyro: DEFAULT_PRODUCTION_LEVEL,
      music: DEFAULT_PRODUCTION_LEVEL,
      writing: DEFAULT_PRODUCTION_LEVEL,
      marketing: DEFAULT_PRODUCTION_LEVEL,
      backOffice: DEFAULT_PRODUCTION_LEVEL,
    },
    policies: { catering: 1, travel: 1, medical: 1 },
    color: '#336699',
    controller: { kind: 'computer' },
    ledgerMonths: [],
  };
  return buildRow(PromotionSchema, 'aPromotion', defaults, overrides);
}

export function aBrand(
  overrides: DeepPartial<Brand> = {},
  sequence: TestIdSequence = TestIds,
): Brand {
  const defaults: Brand = {
    id: overrides.id ?? sequence.id('brand'),
    promotionId: testId('promotion'),
    name: overrides.name ?? placeholderName('Brand', sequence.nextNumber('brand')),
    logoRef: null,
    priority: 0,
    active: true,
    controller: null,
  };
  return buildRow(BrandSchema, 'aBrand', defaults, overrides);
}

export function anEmployment(
  overrides: DeepPartial<Employment> = {},
  sequence: TestIdSequence = TestIds,
): Employment {
  const defaults: Employment = {
    id: overrides.id ?? sequence.id('employment'),
    personId: testId('person'),
    promotionId: testId('promotion'),
    brandId: null,
    managerPersonId: null,
    status: 'active',
    offeredOn: TEST_START_DATE,
    startsOn: overrides.offeredOn ?? TEST_START_DATE,
    endsOn: null,
    endedOn: null,
    role: 'wrestler',
    ringName: overrides.ringName ?? placeholderName('Ring Name', sequence.nextNumber('ringName')),
    gimmickKey: null,
    alignment: 'face',
    push: 'midCard',
    terms: {
      kind: 'written',
      exclusive: true,
      monthlyWage: DEFAULT_MONTHLY_WAGE,
      perAppearanceFee: cents(0),
      signingBonus: cents(0),
      shares: { gateBp: 0, merchBp: 0, broadcastBp: 0 },
      appearanceCap: null,
      perks: { creativeControl: false, noHouseShows: false, ironClad: false, travelCovered: false },
    },
    morale: 0,
    momentum: null,
    appearancesThisYear: 0,
    lastAppearanceOn: null,
    leave: null,
  };
  return buildRow(EmploymentSchema, 'anEmployment', defaults, overrides);
}

export function aContractConcern(
  overrides: DeepPartial<ContractConcern> = {},
  sequence: TestIdSequence = TestIds,
): ContractConcern {
  const defaults: ContractConcern = {
    id: overrides.id ?? sequence.id('contractConcern'),
    employmentId: testId('employment'),
    personId: testId('person'),
    promotionId: testId('promotion'),
    expiryNotice: null,
    unhappy: null,
    request: null,
    ending: { how: 'expired', severance: cents(0), traceRef: null },
  };
  return buildRow(ContractConcernSchema, 'aContractConcern', defaults, overrides);
}

export function aTeam(overrides: DeepPartial<Team> = {}, sequence: TestIdSequence = TestIds): Team {
  const defaults: Team = {
    id: overrides.id ?? sequence.id('team'),
    kind: 'tag',
    name: overrides.name ?? placeholderName('Team', sequence.nextNumber('team')),
    memberIds: [testId('person', 1), testId('person', 2)],
    experience: 50,
    status: 'active',
    formedOn: TEST_START_DATE,
    splitOn: null,
  };
  return buildRow(TeamSchema, 'aTeam', defaults, overrides);
}

export function aStable(
  overrides: DeepPartial<Stable> = {},
  sequence: TestIdSequence = TestIds,
): Stable {
  const defaults: Stable = {
    id: overrides.id ?? sequence.id('stable'),
    promotionId: testId('promotion'),
    name: overrides.name ?? placeholderName('Stable', sequence.nextNumber('stable')),
    memberIds: [testId('person', 1), testId('person', 2), testId('person', 3)],
    leaderId: null,
    status: 'active',
    formedOn: TEST_START_DATE,
    disbandedOn: null,
    imageRef: null,
  };
  return buildRow(StableSchema, 'aStable', defaults, overrides);
}

export function aRelationship(
  overrides: DeepPartial<Relationship> = {},
  sequence: TestIdSequence = TestIds,
): Relationship {
  const firstId = overrides.personAId ?? testId('person', 1);
  const secondId = overrides.personBId ?? testId('person', 2);
  const [personAId, personBId] = firstId < secondId ? [firstId, secondId] : [secondId, firstId];
  const defaults: Relationship = {
    id: overrides.id ?? sequence.id('relationship'),
    personAId,
    personBId,
    affinity: 0,
    bonds: ['friends'],
    mentorId: null,
    since: TEST_START_DATE,
    lastChangedOn: overrides.since ?? TEST_START_DATE,
  };
  return buildRow(RelationshipSchema, 'aRelationship', defaults, {
    ...overrides,
    personAId,
    personBId,
  });
}

export function aPromotionSnapshot(
  overrides: DeepPartial<PromotionSnapshot> = {},
  sequence: TestIdSequence = TestIds,
): PromotionSnapshot {
  const defaults: PromotionSnapshot = {
    id: overrides.id ?? sequence.id('promotionSnapshot'),
    promotionId: testId('promotion'),
    date: TEST_START_DATE,
    granularity: 'week',
    cash: DEFAULT_PROMOTION_CASH,
    prestige: 50,
    popularity: { headline: 0, world: 0, homeRegionValue: 0, byContinent: {} },
    rosterSize: 0,
    averageMorale: null,
    extra: {},
  };
  return buildRow(PromotionSnapshotSchema, 'aPromotionSnapshot', defaults, overrides);
}

export function anAiProfile(
  overrides: DeepPartial<AiProfile> = {},
  sequence: TestIdSequence = TestIds,
): AiProfile {
  const defaults: AiProfile = {
    id: overrides.id ?? sequence.id('aiProfile'),
    promotionId: testId('promotion'),
    brandId: null,
    taste: null,
    featured: null,
    createdOn: TEST_START_DATE,
    lastTurnOn: null,
  };
  return buildRow(AiProfileSchema, 'anAiProfile', defaults, overrides);
}

/** The summary key the default decision uses. */
export const DEFAULT_AI_DECISION_SUMMARY_KEY = parseContentKey('aip.decision.roster-review');

export function anAiDecision(
  overrides: DeepPartial<AiDecision> = {},
  sequence: TestIdSequence = TestIds,
): AiDecision {
  const date = overrides.date ?? TEST_START_DATE;
  const defaults: AiDecision = {
    id: overrides.id ?? sequence.id('aiDecision'),
    promotionId: testId('promotion'),
    brandId: null,
    date,
    kind: 'rosterReview',
    summary: { key: DEFAULT_AI_DECISION_SUMMARY_KEY, params: {} },
    refs: {
      personIds: [],
      employmentIds: [],
      titleIds: [],
      promotionIds: [],
      eventInstanceId: null,
    },
    traceRef: null,
    revealOn: overrides.revealOn ?? date,
    importance: 0,
  };
  return buildRow(AiDecisionSchema, 'anAiDecision', defaults, overrides);
}
