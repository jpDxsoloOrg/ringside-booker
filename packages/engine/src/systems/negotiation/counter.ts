/**
 * The worker's counter-offer (ECO5-03): your offer, moved toward their ask.
 *
 * - the monthly wage, the fee per appearance and the signing bonus each move part of the way to
 *   the ask (`formulas/counterWage.ts`), all by the one rolled concession;
 * - every perk they ask for that the offer leaves out is added (they only ask for perks the game
 *   honours);
 * - a card position below the one they expect is raised to it;
 * - a length more than `contracts.counter.lengthTolerance` months off the one they prefer becomes
 *   the one they prefer;
 * - everything else (kind, exclusivity, brand, role, start, shares, cap, extra) stays as offered.
 *
 * Draws exactly once from the stream it is given (`contracts.counter`), whatever the offer.
 *
 * Design: docs/design/negotiation.md#counter.
 */

import { cents, type Cents } from '../../core/money';
import type { RngStream } from '../../core/rng/registry';
import { startDecision } from '../../core/trace/decision';
import type { TraceNode } from '../../core/trace/types';
import {
  PUSH_LEVELS,
  type ContractPerks,
  type ContractTerms,
} from '../../model/entities/employment';
import type { EngineTunables } from '../tunables';
import { PUSH_LABELS } from '../workers/formulas/expectedPush';
import type { AskingTerms } from './asking';
import { counterConcession, counterWage, meetsYouLabel } from './formulas/counterWage';
import { COUNTER_DOC_REF, moneyText } from './formulas/shared';
import type { Offer } from './offer';
import type { EnforceableTerm } from './registries';

/** The money of an ask as contract terms: a written ask is a wage, a per-appearance ask a fee. */
export function askedMoney(ask: AskingTerms): {
  monthlyWage: Cents;
  perAppearanceFee: Cents;
  signingBonus: Cents;
} {
  if (ask.kind === 'perAppearance') {
    return {
      monthlyWage: cents(0),
      perAppearanceFee: cents(ask.perAppearanceFee.value),
      signingBonus: cents(0),
    };
  }
  return {
    monthlyWage: cents(ask.monthlyWage.value),
    perAppearanceFee: cents(0),
    signingBonus: cents(ask.signingBonus.value),
  };
}

const PERK_OF_TERM: Partial<Record<EnforceableTerm, keyof ContractPerks>> = {
  'perk.ironClad': 'ironClad',
  'perk.travelCovered': 'travelCovered',
  'perk.noHouseShows': 'noHouseShows',
  'perk.creativeControl': 'creativeControl',
};

/** The perk flag an enforceable term sets, or null for a revenue share. */
export function perkOfTerm(term: EnforceableTerm): keyof ContractPerks | null {
  return PERK_OF_TERM[term] ?? null;
}

const MONEY_FIELDS: readonly {
  readonly field: 'monthlyWage' | 'perAppearanceFee' | 'signingBonus';
  readonly label: string;
  readonly quotedIn: 'hundreds' | 'tens';
}[] = [
  { field: 'monthlyWage', label: 'Monthly wage', quotedIn: 'hundreds' },
  { field: 'perAppearanceFee', label: 'Fee per appearance', quotedIn: 'tens' },
  { field: 'signingBonus', label: 'Signing bonus', quotedIn: 'hundreds' },
];

/** The counter-offer to `offer` in round `round`, and how it was built. */
export function counterTermsFor(
  offer: Offer,
  ask: AskingTerms,
  round: number,
  tunables: EngineTunables,
  rng: RngStream,
): { offer: Offer; trace: TraceNode } {
  const decision = startDecision<'counter'>('Their counter-offer', { docRef: COUNTER_DOC_REF });
  const concession = counterConcession(round, { tunables, rng });
  decision.include(concession.trace.label, concession);

  const asked = askedMoney(ask);
  const terms: ContractTerms = {
    ...offer.terms,
    shares: { ...offer.terms.shares },
    perks: { ...offer.terms.perks },
  };
  for (const entry of MONEY_FIELDS) {
    const offered = offer.terms[entry.field];
    const wanted = asked[entry.field];
    if (offered >= wanted) {
      decision.rule(`${entry.label}: ${moneyText(offered)} already meets their ask`, true);
      continue;
    }
    const amount = counterWage(
      { offered, asked: wanted, round, label: entry.label, quotedIn: entry.quotedIn, concession },
      { tunables, rng },
    );
    decision.include(`${entry.label}: ${moneyText(amount.value)}`, amount);
    terms[entry.field] = cents(amount.value);
  }

  for (const perk of ask.perks) {
    const flag = perkOfTerm(perk.term);
    if (flag === null) {
      continue;
    }
    const missing = !terms.perks[flag];
    decision.rule(`Wants ${perk.label}: ${perk.reason}`, missing);
    terms.perks[flag] = true;
  }

  let push = offer.push;
  const expected = ask.expectedPush.value;
  if (expected !== 'none' && PUSH_LEVELS.indexOf(offer.push) > PUSH_LEVELS.indexOf(expected)) {
    decision.rule(
      `Wants the ${PUSH_LABELS[expected]} they expect, not ${PUSH_LABELS[offer.push]}`,
      true,
    );
    push = expected;
  }

  let lengthMonths = offer.lengthMonths;
  const preferred = ask.preferredLengthMonths.value;
  const tolerance = decision.tunable(tunables, 'contracts.counter.lengthTolerance');
  const tooFar = Math.abs(offer.lengthMonths - preferred) > tolerance;
  decision.rule(
    `${String(offer.lengthMonths)} months is more than ${String(tolerance)} months off the ${String(preferred)} they prefer`,
    tooFar,
  );
  if (tooFar) {
    lengthMonths = preferred;
  }

  const traced = decision.choose('counter', meetsYouLabel(concession.value));
  return {
    offer: { ...offer, terms, push, lengthMonths, extra: { ...offer.extra } },
    trace: traced.trace,
  };
}
