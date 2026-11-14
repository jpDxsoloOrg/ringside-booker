/**
 * Canned negotiation answers for the sheet's tests and gallery entries (ECO5-06): their ask (a
 * written deal you may not offer exclusively), a preview in each band, and talks with a counter on
 * the table. Shaped exactly like the engine's `contracts.*` answers.
 */
import { cents, parseGameDate, parseId } from '@ringside/engine';
import type {
  AskingTermsView,
  NegotiationHistoryView,
  Offer,
  OfferBand,
  OfferPreview,
  TraceNode,
} from '@ringside/engine';
import { offerFromAsk } from './useNegotiationDraft';
import type { NegotiationDraft } from './useNegotiationDraft';

export const NEGOTIATION_PERSON = parseId('person', 'per_0000000951');
export const NEGOTIATION_PROMOTION = parseId('promotion', 'pro_0000000951');
export const NEGOTIATION_ID = parseId('negotiation', 'neg_0000000951');

function input(
  label: string,
  value: number,
  unit: 'money' | 'months' | 'count' = 'money',
): TraceNode {
  return { kind: 'input', label, value, unit };
}

/** Rhea Vance's ask: $41,300 a month on a written deal; exclusive not allowed (reach 12). */
export function anAsk(overrides: Partial<AskingTermsView> = {}): AskingTermsView {
  return {
    personId: NEGOTIATION_PERSON,
    promotionId: NEGOTIATION_PROMOTION,
    role: 'wrestler',
    kind: 'written',
    exclusive: false,
    renewalOf: null,
    marketValue: { value: 5_200_000, trace: input('Market value', 5_200_000) },
    monthlyWage: { value: 4_130_000, trace: input('Monthly wage they ask', 4_130_000) },
    perAppearanceFee: { value: 950_000, trace: input('Fee they ask', 950_000) },
    signingBonus: { value: 4_130_000, trace: input('Signing bonus they ask', 4_130_000) },
    perks: [{ term: 'perk.travelCovered', label: 'Travel covered', reason: 'Lives abroad' }],
    appearanceCap: null,
    preferredLengthMonths: { value: 24, trace: input('Preferred length', 24, 'months') },
    expectedPush: {
      value: 'upperCard',
      trace: { kind: 'input', label: 'Expected push', value: 'Upper card' },
    },
    allowedKinds: [
      { kind: 'written', label: 'Written contract', allowed: true, reasons: [] },
      { kind: 'perAppearance', label: 'Per-appearance deal', allowed: true, reasons: [] },
    ],
    bestKind: 'written',
    exclusiveAllowed: false,
    exclusiveReasons: [
      {
        code: 'contracts.reachTooLow',
        message: 'Exclusive contracts need a reach of 35; yours is 12',
      },
    ],
    startPatience: { value: 3, trace: input('Patience', 3, 'count') },
    refusal: null,
    renewalDecision: null,
    eligibility: {
      situation: 'freeAgent',
      earliestStart: parseGameDate('2027-01-04'),
      otherPromotionIds: [],
      reasons: [],
    },
    brandOptions: [],
    ...overrides,
  };
}

const LABELS: Readonly<Record<OfferBand, string>> = {
  likely: 'Likely to accept',
  counter: 'Will counter',
  reject: 'Will reject',
  walkAway: 'Will walk away',
  refuse: "Won't sign",
};

const REACTIONS = {
  likely: 'accept',
  counter: 'counter',
  reject: 'reject',
  walkAway: 'walkAway',
  refuse: 'refuse',
} as const;

/** A preview in one band, at `ratio` of their ask. */
export function aPreview(band: OfferBand, ratio: number): OfferPreview {
  return {
    offerValue: Math.round(5_000_000 * ratio),
    askValue: 5_000_000,
    ratio,
    reaction: REACTIONS[band],
    band,
    label: LABELS[band],
    patienceLeft: 2,
    startPatience: 3,
    reactionTrace: {
      kind: 'input',
      label: `How they take it: ${LABELS[band]}`,
      value: ratio,
      children: [input('Offer as a share of their ask', ratio, 'count')],
    },
    valueTrace: input('Offer value', 5_000_000),
    askValueTrace: input('Ask value', 5_000_000),
    notes: band === 'counter' ? ['They will meet you part of the way'] : [],
    thresholds: { walkAway: 0.45, counter: 0.55, accept: 0.95 },
  };
}

/** Their ask as an offer, with a lower wage. */
export function anOffer(monthlyWage = 2_400_000): Offer {
  const offer = offerFromAsk(anAsk(), 60);
  return {
    ...offer,
    terms: { ...offer.terms, monthlyWage: cents(monthlyWage), signingBonus: cents(0) },
  };
}

/** Two rounds: your $24,000 offer, countered at $34,200 with Upper card. */
export function aHistory(): NegotiationHistoryView[] {
  const ours = anOffer(2_400_000);
  const theirs = anOffer(3_420_000);
  return [
    {
      round: 1,
      date: parseGameDate('2027-01-05'),
      by: 'promotion',
      offer: ours,
      reaction: 'counter',
      summary: '$24,000 a month, 24 months',
      reactionLabel: 'Countered',
    },
    {
      round: 1,
      date: parseGameDate('2027-01-06'),
      by: 'worker',
      offer: theirs,
      reaction: null,
      summary: '$34,200 a month, 24 months',
      reactionLabel: 'Their counter-offer',
    },
  ];
}

/** A draft that never changes, for the gallery and the form's tests: setters do nothing. */
export function aStaticDraft(
  overrides: Partial<NegotiationDraft> & { readonly offer?: Offer } = {},
): NegotiationDraft {
  const noop = (): void => undefined;
  return {
    offer: anOffer(),
    ask: anAsk(),
    askError: false,
    preview: aPreview('counter', 0.62),
    previewPending: false,
    version: 0,
    fieldErrors: {},
    useTheirAsk: noop,
    reset: noop,
    setKind: noop,
    setExclusive: noop,
    setMoney: noop,
    setLength: noop,
    setStartsOn: noop,
    setBrand: noop,
    setRole: noop,
    setPush: noop,
    setPerk: noop,
    setAppearanceCap: noop,
    showRefusal: (reasons) => [...reasons],
    ...overrides,
  };
}
