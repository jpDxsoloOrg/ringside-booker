/**
 * The negotiation system's balance numbers (ECO5-01): the pace of a negotiation (review delay,
 * counter-offer expiry, walk-away cooldown), how long and how early an offer may run, the reach a
 * promotion needs for written and exclusive deals, and how long closed negotiations are kept.
 *
 * The keys keep the `contracts.` area the catalog fixed, beside ECO4's contracts tunables, and sit
 * in the same `Contracts` category. Documented in docs/design/negotiation.md.
 */

import { defineTunables } from '../../core/tunables/define';
import { CONTRACTS_TUNABLE_CATEGORY } from '../contracts/tunables';

export const NEGOTIATION_DOC = 'negotiation.md';
const REVIEW_DOC = `${NEGOTIATION_DOC}#review`;
const COUNTER_DOC = `${NEGOTIATION_DOC}#counter`;
const STATUSES_DOC = `${NEGOTIATION_DOC}#statuses`;
const OFFER_DOC = `${NEGOTIATION_DOC}#the-offer`;
const RENEWALS_DOC = `${NEGOTIATION_DOC}#renewals`;
const OFFER_KINDS_DOC = `${NEGOTIATION_DOC}#offer-kinds`;

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

export const negotiationTunables = defineTunables({
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
