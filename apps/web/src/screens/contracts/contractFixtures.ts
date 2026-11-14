/**
 * Canned contract answers for the Contracts screen's tests and gallery entries: a contract row,
 * one of your own details with a release request, and both answers' preview. Shaped exactly like
 * the engine's `contracts.*` answers.
 */
import { parseGameDate, parseId } from '@ringside/engine';
import type {
  AnswerPreview,
  ContractRow,
  OwnContractDetail,
  PrivateContractDetail,
  TraceNode,
} from '@ringside/engine';

export const FIXTURE_EMPLOYMENT = parseId('employment', 'emp_0000000901');
export const FIXTURE_PERSON = parseId('person', 'per_0000000901');
export const FIXTURE_PROMOTION = parseId('promotion', 'pro_0000000901');

function money(label: string, value: number): TraceNode {
  return { kind: 'input', label, value, unit: 'money' };
}

/** "Mara Quill", a mid-card wrestler on a written contract ending in 59 days. */
export function aContractRow(overrides: Partial<ContractRow> = {}): ContractRow {
  return {
    employmentId: FIXTURE_EMPLOYMENT,
    personId: FIXTURE_PERSON,
    promotionId: FIXTURE_PROMOTION,
    ringName: 'Mara Quill',
    role: 'wrestler',
    push: 'midCard',
    brandId: null,
    status: 'active',
    kind: 'written',
    monthlyWage: 800_000,
    perAppearanceFee: 0,
    perks: [],
    exclusive: true,
    startsOn: parseGameDate('2025-03-04'),
    endsOn: parseGameDate('2027-03-04'),
    daysLeft: 59,
    endedOn: null,
    endReason: null,
    severancePaid: null,
    severanceTraceRef: null,
    titles: [],
    notice: null,
    imageRef: null,
    unhappy: null,
    request: null,
    walkout: null,
    ...overrides,
  };
}

/** Mara Quill's own contract, with an open request to leave and nine unhappy days behind it. */
export function anOwnDetail(overrides: Partial<OwnContractDetail> = {}): OwnContractDetail {
  return {
    employmentId: FIXTURE_EMPLOYMENT,
    personId: FIXTURE_PERSON,
    promotionId: FIXTURE_PROMOTION,
    promotionName: 'Test Promotion A',
    ringName: 'Mara Quill',
    role: 'wrestler',
    push: 'midCard',
    brandId: null,
    status: 'active',
    kind: 'written',
    exclusive: true,
    perks: [],
    startsOn: parseGameDate('2025-03-04'),
    endsOn: parseGameDate('2027-03-04'),
    daysLeft: 59,
    endedOn: null,
    titles: [],
    imageRef: null,
    termsPrivate: false,
    monthlyWage: 800_000,
    perAppearanceFee: 0,
    signingBonus: 0,
    shares: { gateBp: 0, merchBp: 500, broadcastBp: 0 },
    appearanceCap: null,
    leave: null,
    morale: -45,
    notice: null,
    severance: { value: 4_320_300, trace: money('Severance', 4_320_300) },
    unhappy: { days: 14, of: 14, paused: false, traceRef: null },
    request: {
      status: 'open',
      raisedOn: parseGameDate('2027-01-03'),
      answerBy: parseGameDate('2027-01-10'),
    },
    walkout: null,
    ...overrides,
  };
}

/** A rival's contract: no money, no morale. */
export function aPrivateDetail(
  overrides: Partial<PrivateContractDetail> = {},
): PrivateContractDetail {
  return {
    employmentId: FIXTURE_EMPLOYMENT,
    personId: FIXTURE_PERSON,
    promotionId: FIXTURE_PROMOTION,
    promotionName: 'Test Promotion B',
    ringName: 'Rook Calder',
    role: 'wrestler',
    push: 'upperCard',
    brandId: null,
    status: 'active',
    kind: 'written',
    exclusive: true,
    perks: [],
    startsOn: parseGameDate('2025-03-04'),
    endsOn: parseGameDate('2027-03-04'),
    daysLeft: 59,
    endedOn: null,
    titles: [],
    imageRef: null,
    termsPrivate: true,
    ...overrides,
  };
}

/** Grant pays half the severance; Refuse costs 10 morale and a 2.5% daily walk-out chance. */
export function anAnswerPreview(ironClad = false): AnswerPreview {
  return {
    kind: 'ok',
    grantSeverance: { value: 2_160_100, trace: money('Severance if granted', 2_160_100) },
    cashBefore: 4_000_000_000,
    refuseMoraleDelta: -10,
    walkoutChanceAfterRefusal: {
      value: ironClad ? 0 : 0.025,
      trace: {
        kind: 'input',
        label: 'Walk-out chance',
        value: ironClad ? 0 : 0.025,
        unit: 'probability',
      },
    },
    ironClad,
  };
}
