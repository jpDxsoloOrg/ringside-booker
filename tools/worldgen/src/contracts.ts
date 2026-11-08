/**
 * Contracts: one running employment per employed person, with staggered expiry dates and
 * placeholder terms from the spec's tier × push table. ECO owns real wages; these amounts only
 * need the right order of magnitude.
 */

import {
  addDays,
  addMonths,
  addYears,
  compareDates,
  diffDays,
  intBetween,
  type GameDate,
} from '@ringside/engine';
import { RosterBuildError, type BuildContext } from './context';
import type { ContractTermsOut, EmploymentOut, RosterMember } from './model';

/** Youngest age at which a staff member's contract may have started. */
const MIN_STAFF_AGE = 18;

function laterOf(left: GameDate, right: GameDate): GameDate {
  return compareDates(left, right) >= 0 ? left : right;
}

function termsFor(
  context: BuildContext,
  member: RosterMember,
  promotionKey: string,
): ContractTermsOut {
  const promotion = context.promotions.get(promotionKey);
  if (promotion === undefined) {
    throw new RosterBuildError(`Unknown promotion ${promotionKey}`);
  }
  const tierTerms = context.spec.contracts.terms[promotion.tier];
  const pay = tierTerms.pay[member.push];
  const written = tierTerms.kind === 'written';
  return {
    kind: tierTerms.kind,
    exclusive: written,
    monthlyWage: written ? pay : 0,
    perAppearanceFee: written ? 0 : pay,
    signingBonus: 0,
    shares: { gateBp: 0, merchBp: 0, broadcastBp: 0 },
    appearanceCap: null,
    perks: {
      creativeControl: false,
      noHouseShows: false,
      ironClad: false,
      travelCovered: written,
    },
  };
}

/** The contract key for a person. */
export function employmentKeyOf(personKey: string): string {
  return `emp-${personKey}`;
}

/**
 * One contract per employed person, in key order. It started 0-4 years before the world start
 * (never before their debut, nor before a staff member turned 18) and runs out 2-30 months after
 * it, uniformly, so expiries are spread across the first years of a game.
 */
export function buildEmployments(
  context: BuildContext,
  members: readonly RosterMember[],
): EmploymentOut[] {
  const stream = context.stream('worldgen.roster.contracts');
  const start = context.startDate;
  const started = context.spec.contracts.startedYearsAgo;
  const employments: EmploymentOut[] = [];
  for (const member of members) {
    const promotionKey = member.promotionKey;
    if (promotionKey === null) {
      continue;
    }
    const promotionSpec = context.spec.promotions[promotionKey];
    if (promotionSpec === undefined) {
      throw new RosterBuildError(`Promotion ${promotionKey} has no entry in the roster spec`);
    }
    const earliestStart = addYears(start, -started.max);
    const latestStart = addYears(start, -started.min);
    let startsOn = addDays(
      latestStart,
      -intBetween(stream, 0, diffDays(earliestStart, latestStart)),
    );
    const { debutDate, birthDate } = member.person;
    if (debutDate !== null) {
      startsOn = laterOf(startsOn, debutDate);
    }
    startsOn = laterOf(startsOn, addYears(birthDate, MIN_STAFF_AGE));
    if (compareDates(startsOn, start) > 0) {
      startsOn = start;
    }
    const firstEnd = addMonths(start, promotionSpec.contractMonths.min);
    const lastEnd = addMonths(start, promotionSpec.contractMonths.max);
    const endsOn = addDays(firstEnd, intBetween(stream, 0, diffDays(firstEnd, lastEnd)));
    employments.push({
      key: employmentKeyOf(member.key),
      personKey: member.key,
      promotionKey,
      brandKey: member.brandKey,
      role: member.role,
      ringName: member.ringName,
      alignment: member.alignment,
      push: member.push,
      terms: termsFor(context, member, promotionKey),
      startsOn,
      endsOn,
    });
  }
  return employments;
}
