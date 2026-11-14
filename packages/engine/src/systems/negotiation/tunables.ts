/**
 * The negotiation system's balance numbers (ECO5-01): the pace of a negotiation (review delay,
 * counter-offer expiry, walk-away cooldown), how long and how early an offer may run, the reach a
 * promotion needs for written and exclusive deals, and how long closed negotiations are kept.
 *
 * The keys keep the `contracts.` area the catalog fixed, beside ECO4's contracts tunables, and sit
 * in the same `Contracts` category. Documented in docs/design/negotiation.md.
 */

import { defineTunables, mergeTunables } from '../../core/tunables/define';
import { CONTRACTS_TUNABLE_CATEGORY } from '../contracts/tunables';

export const NEGOTIATION_DOC = 'negotiation.md';
const REVIEW_DOC = `${NEGOTIATION_DOC}#review`;
const COUNTER_DOC = `${NEGOTIATION_DOC}#counter`;
const STATUSES_DOC = `${NEGOTIATION_DOC}#statuses`;
const OFFER_DOC = `${NEGOTIATION_DOC}#the-offer`;
const RENEWALS_DOC = `${NEGOTIATION_DOC}#renewals`;
const OFFER_KINDS_DOC = `${NEGOTIATION_DOC}#offer-kinds`;
const MARKET_VALUE_DOC = `${NEGOTIATION_DOC}#market-value`;
const ASKING_TERMS_DOC = `${NEGOTIATION_DOC}#asking-terms`;
const PATIENCE_DOC = `${NEGOTIATION_DOC}#patience`;

function days(defaultValue: number, min: number, max: number, description: string, docRef: string) {
  return {
    kind: 'integer',
    default: defaultValue,
    min,
    max,
    unit: 'days',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description,
    docRef,
  } as const;
}

function minReach(description: string) {
  return {
    kind: 'integer',
    default: 35,
    min: 0,
    max: 100,
    unit: 'points',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description,
    docRef: OFFER_KINDS_DOC,
  } as const;
}

function factor(
  defaultValue: number,
  max: number,
  unit: 'ratio' | 'multiplier',
  description: string,
  docRef: string,
) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max,
    step: 0.01,
    unit,
    category: CONTRACTS_TUNABLE_CATEGORY,
    description,
    docRef,
  } as const;
}

function monthlyMoney(defaultCents: number, maxCents: number, description: string, docRef: string) {
  return {
    kind: 'integer',
    default: defaultCents,
    min: 0,
    max: maxCents,
    unit: 'money/month',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description,
    docRef,
  } as const;
}

function money(defaultCents: number, maxCents: number, description: string) {
  return {
    kind: 'integer',
    default: defaultCents,
    min: 0,
    max: maxCents,
    unit: 'money',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description,
    docRef: ASKING_TERMS_DOC,
  } as const;
}

function exponent(defaultValue: number, description: string) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max: 6,
    step: 0.1,
    unit: 'multiplier',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description,
    docRef: MARKET_VALUE_DOC,
  } as const;
}

function lengthMonths(defaultValue: number, description: string) {
  return {
    kind: 'integer',
    default: defaultValue,
    min: 1,
    max: 120,
    unit: 'months',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description,
    docRef: ASKING_TERMS_DOC,
  } as const;
}

function patience(defaultValue: number, description: string) {
  return {
    kind: 'integer',
    default: defaultValue,
    min: 0,
    max: 10,
    unit: 'count',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description,
    docRef: PATIENCE_DOC,
  } as const;
}

function morale(defaultValue: number, description: string) {
  return {
    kind: 'integer',
    default: defaultValue,
    min: -100,
    max: 100,
    unit: 'points',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description,
    docRef: RENEWALS_DOC,
  } as const;
}

/** $1 in cents, to keep the money defaults below readable. */
const DOLLAR = 100;

/**
 * Market value, asking terms and patience (ECO5-02): what a worker is worth and what they ask a
 * promotion for. Every money value is whole cents; 0 means 0 (a 0 `popScale` removes the
 * popularity part, a 0 `premiumCap` removes the ego premiums).
 */
const askTunables = defineTunables({
  'contracts.value.breadthWeight': factor(
    0.3,
    1,
    'ratio',
    'How much world-wide popularity counts against the best country in market value',
    MARKET_VALUE_DOC,
  ),
  'contracts.value.popScale': monthlyMoney(
    300_000 * DOLLAR,
    10_000_000 * DOLLAR,
    'Monthly value of a worker with 100 popularity everywhere (before the curve)',
    MARKET_VALUE_DOC,
  ),
  'contracts.value.popExponent': exponent(
    2,
    'How steeply market value rises with popularity (1 = a straight line)',
  ),
  'contracts.value.skillScale': monthlyMoney(
    15_000 * DOLLAR,
    10_000_000 * DOLLAR,
    'Monthly value of a worker rated 100 in their role (before the curve)',
    MARKET_VALUE_DOC,
  ),
  'contracts.value.skillExponent': exponent(
    2,
    'How steeply market value rises with skill (1 = a straight line)',
  ),
  'contracts.value.merchShare': factor(
    0.25,
    1,
    'ratio',
    "Share of a star's monthly merchandise sales added to their market value",
    MARKET_VALUE_DOC,
  ),
  'contracts.value.floor': monthlyMoney(
    1_000 * DOLLAR,
    1_000_000 * DOLLAR,
    'Base monthly value every worker has',
    MARKET_VALUE_DOC,
  ),
  'contracts.value.roleFactor.wrestler': factor(
    1,
    5,
    'multiplier',
    'Market value of a wrestler',
    MARKET_VALUE_DOC,
  ),
  'contracts.value.roleFactor.booker': factor(
    0.8,
    5,
    'multiplier',
    'Market value of a booker',
    MARKET_VALUE_DOC,
  ),
  'contracts.value.roleFactor.manager': factor(
    0.6,
    5,
    'multiplier',
    'Market value of a manager',
    MARKET_VALUE_DOC,
  ),
  'contracts.value.roleFactor.presenter': factor(
    0.6,
    5,
    'multiplier',
    'Market value of a presenter',
    MARKET_VALUE_DOC,
  ),
  'contracts.value.roleFactor.announcer': factor(
    0.5,
    5,
    'multiplier',
    'Market value of an announcer',
    MARKET_VALUE_DOC,
  ),
  'contracts.value.roleFactor.producer': factor(
    0.5,
    5,
    'multiplier',
    'Market value of a producer',
    MARKET_VALUE_DOC,
  ),
  'contracts.value.roleFactor.referee': factor(
    0.35,
    5,
    'multiplier',
    'Market value of a referee',
    MARKET_VALUE_DOC,
  ),

  'contracts.ask.reachFloor': factor(
    0.25,
    1,
    'ratio',
    'Share of their value a worker asks from a promotion nobody has heard of (reach 0)',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.prestigeDiscount': factor(
    0.15,
    1,
    'ratio',
    'How much less a worker asks to join a promotion with a public image of 100',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.legacyPrestigeMultiplier': factor(
    2,
    5,
    'multiplier',
    'How much more the public image discount counts for a worker who cares about their legacy',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.egotistPremium': factor(
    0.1,
    2,
    'ratio',
    'Extra an egotist asks for',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.moneyPremium': factor(
    0.1,
    2,
    'ratio',
    'Extra a worker who is in it for the money asks for',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.starPresence': {
    kind: 'integer',
    default: 80,
    min: 0,
    max: 100,
    unit: 'attribute',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Charisma or presence from which a worker knows they are a star and asks more',
    docRef: ASKING_TERMS_DOC,
  },
  'contracts.ask.starPremium': factor(
    0.1,
    2,
    'ratio',
    'Extra a worker with star presence asks for',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.selflessDiscount': factor(
    0.05,
    1,
    'ratio',
    'How much less a selfless worker asks for',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.premiumCap': factor(
    0.3,
    2,
    'ratio',
    'Most the ego premiums can add together (0 = no ego premiums)',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.exclusivePremium': factor(
    0.1,
    2,
    'ratio',
    'Extra a worker asks for an exclusive contract',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.underContractPremium': factor(
    0.1,
    2,
    'ratio',
    'Extra a worker asks while they still have a contract elsewhere',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.loyalRenewalDiscount': factor(
    0.1,
    1,
    'ratio',
    'How much less a loyal worker asks to stay',
    RENEWALS_DOC,
  ),
  'contracts.ask.cap.wrestler': monthlyMoney(
    400_000 * DOLLAR,
    10_000_000 * DOLLAR,
    'Most a wrestler asks for a month',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.cap.booker': monthlyMoney(
    80_000 * DOLLAR,
    10_000_000 * DOLLAR,
    'Most a booker asks for a month',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.cap.manager': monthlyMoney(
    60_000 * DOLLAR,
    10_000_000 * DOLLAR,
    'Most a manager asks for a month',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.cap.presenter': monthlyMoney(
    60_000 * DOLLAR,
    10_000_000 * DOLLAR,
    'Most a presenter asks for a month',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.cap.announcer': monthlyMoney(
    60_000 * DOLLAR,
    10_000_000 * DOLLAR,
    'Most an announcer asks for a month',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.cap.producer': monthlyMoney(
    40_000 * DOLLAR,
    10_000_000 * DOLLAR,
    'Most a producer asks for a month',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.cap.referee': monthlyMoney(
    20_000 * DOLLAR,
    10_000_000 * DOLLAR,
    'Most a referee asks for a month',
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.perAppearanceShare': factor(
    0.3,
    2,
    'ratio',
    "Share of a worker's monthly ask they want for each appearance on a per-appearance deal",
    ASKING_TERMS_DOC,
  ),
  'contracts.ask.minFee': money(
    50 * DOLLAR,
    1_000_000 * DOLLAR,
    'Least a worker asks for an appearance',
  ),
  'contracts.ask.maxFee': money(
    20_000 * DOLLAR,
    1_000_000 * DOLLAR,
    'Most a worker asks for an appearance',
  ),
  'contracts.ask.signingBonusMonths': {
    kind: 'number',
    default: 1,
    min: 0,
    max: 12,
    step: 0.5,
    unit: 'months',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Signing bonus a worker asks for a written contract, in months of their wage',
    docRef: ASKING_TERMS_DOC,
  },
  'contracts.ask.noHouseShowsAge': {
    kind: 'integer',
    default: 45,
    min: 0,
    max: 100,
    unit: 'years',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Age from which a worker asks not to work house shows (when the game honours it)',
    docRef: ASKING_TERMS_DOC,
  },
  'contracts.ask.veteranAge': {
    kind: 'integer',
    default: 45,
    min: 0,
    max: 100,
    unit: 'years',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Age from which a popular veteran asks for a cap on appearances',
    docRef: ASKING_TERMS_DOC,
  },
  'contracts.ask.veteranPeakPop': {
    kind: 'integer',
    default: 80,
    min: 0,
    max: 100,
    unit: 'points',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Popularity (best country) from which a veteran asks for a cap on appearances',
    docRef: ASKING_TERMS_DOC,
  },
  'contracts.ask.veteranAppearanceCap': {
    kind: 'integer',
    default: 24,
    min: 0,
    max: 365,
    unit: 'count',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Most appearances a year a popular veteran agrees to (0 = no cap asked)',
    docRef: ASKING_TERMS_DOC,
  },
  'contracts.ask.lengthMonths': lengthMonths(24, 'Contract length most workers prefer'),
  'contracts.ask.lengthMonths.journeyman': lengthMonths(12, 'Contract length a journeyman prefers'),
  'contracts.ask.lengthMonths.loyal': lengthMonths(36, 'Contract length a loyal worker prefers'),

  'contracts.renewal.unhappyMorale': morale(
    -20,
    'Below this morale a worker asks more to stay (and has less patience)',
  ),
  'contracts.renewal.unhappyPremiumPerPoint': {
    kind: 'number',
    default: 0.01,
    min: 0,
    max: 0.1,
    step: 0.001,
    unit: 'ratio',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Extra a worker asks to stay for each morale point below the unhappy line',
    docRef: RENEWALS_DOC,
  },
  'contracts.renewal.refuseMorale': morale(
    -60,
    'At or below this morale a worker will not renew at all',
  ),

  'contracts.patience.base': patience(3, 'Offers a worker sits through that do not please them'),
  'contracts.patience.egotist': patience(1, 'Patience an egotist lacks'),
  'contracts.patience.professional': patience(1, 'Extra patience a professional has'),
  'contracts.patience.unhappyPenalty': patience(
    1,
    'Patience an unhappy worker lacks when renewing',
  ),
  'contracts.patience.max': patience(5, 'Most patience any worker starts with'),
});

const paceTunables = defineTunables({
  'contracts.review.delayDays': days(
    2,
    0,
    30,
    'Days a worker takes to decide once an offer is good enough (0 = the same day)',
    REVIEW_DOC,
  ),
  'contracts.walkAway.cooldownDays': days(
    30,
    0,
    365,
    'Days a worker who walked away refuses to talk to that promotion again (0 = no wait)',
    STATUSES_DOC,
  ),
  'contracts.counter.expiryDays': days(
    7,
    1,
    60,
    "Days a worker's counter-offer stays open before it lapses",
    COUNTER_DOC,
  ),
  'contracts.counter.stopSkip': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: "Skips stop when a worker's counter-offer is waiting for you",
    docRef: COUNTER_DOC,
  },
  'contracts.offer.maxLengthMonths': {
    kind: 'integer',
    default: 60,
    min: 1,
    max: 120,
    unit: 'months',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Longest contract an offer may run',
    docRef: OFFER_DOC,
  },
  'contracts.offer.approachWindowDays': days(
    30,
    0,
    365,
    'How close to the end of an exclusive deal elsewhere a worker will talk to you',
    OFFER_DOC,
  ),
  'contracts.renewal.windowDays': days(
    180,
    0,
    730,
    'How early before a contract ends a renewal can be offered',
    RENEWALS_DOC,
  ),
  'contracts.kind.writtenMinReach': minReach(
    'Reach a promotion needs to offer written contracts (0 = anyone)',
  ),
  'contracts.kind.exclusiveMinReach': minReach(
    'Reach a promotion needs to offer exclusive contracts (0 = anyone)',
  ),
  'contracts.history.closedKeepDays': days(
    365,
    0,
    3650,
    'Days a closed negotiation is kept (past its cooldown) before it is cleared away',
    STATUSES_DOC,
  ),
});

export const negotiationTunables = mergeTunables(paceTunables, askTunables);
