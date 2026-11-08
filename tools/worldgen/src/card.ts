/**
 * Where everyone sits on the card: card value, push, alignment, brand, and popularity fitted to
 * the promotion's footprint.
 */

import { chance, floatBetween, type Person } from '@ringside/engine';
import { RosterBuildError, type BuildContext } from './context';
import type { RosterMember } from './model';
import { CARD_PUSHES, type CardPush } from './specSchema';
import { compareText, countsFromShares, roundToTenth } from './stats';

const PERFORMER_ATTRIBUTES_FALLBACK = [
  'ringwork',
  'psychology',
  'stamina',
  'safety',
  'athleticism',
  'mic',
  'charisma',
  'presence',
] as const;

/** The highest regional popularity a record can hold. */
const MAX_POPULARITY = 100;

function performerAttributesOf(context: BuildContext): readonly string[] {
  const wrestler = Object.values(context.library.generationRoles).find(
    (record) => record.role === 'wrestler',
  );
  return wrestler?.performerAttributes ?? PERFORMER_ATTRIBUTES_FALLBACK;
}

/** Mean of the wrestler profile's performer attributes plus the weighted home popularity. */
export function cardValueOf(
  person: Person,
  homePopularity: number,
  performerAttributes: readonly string[],
  homePopularityWeight: number,
): number {
  const attributes: Readonly<Record<string, number>> = person.attributes;
  const total = performerAttributes.reduce((sum, key) => sum + (attributes[key] ?? 0), 0);
  const mean = performerAttributes.length === 0 ? 0 : total / performerAttributes.length;
  return mean + homePopularityWeight * homePopularity;
}

/** Fills in every wrestler's card value. */
export function assignCardValues(context: BuildContext, members: readonly RosterMember[]): void {
  const performerAttributes = performerAttributesOf(context);
  const weight = context.spec.cardValue.homePopularityWeight;
  for (const member of members) {
    if (member.role === 'wrestler') {
      member.cardValue = cardValueOf(
        member.person,
        member.homePopularity,
        performerAttributes,
        weight,
      );
    }
  }
}

/** Highest card value first; ties by key. */
export function byCardValue(left: RosterMember, right: RosterMember): number {
  return right.cardValue - left.cardValue || compareText(left.key, right.key);
}

const PUSH_ORDER: Readonly<Record<CardPush, number>> = {
  mainEvent: 0,
  upperCard: 1,
  midCard: 2,
  lowerCard: 3,
  enhancement: 4,
};

/** A wrestler's push as a card rank: 0 for the main event down to 4 for enhancement talent. */
export function pushRank(member: RosterMember): number {
  const push = member.push;
  return push === 'none' ? CARD_PUSHES.length : PUSH_ORDER[push];
}

/** The order down a card: push first, then card value. */
export function byCardPosition(left: RosterMember, right: RosterMember): number {
  return pushRank(left) - pushRank(right) || byCardValue(left, right);
}

/**
 * Gives a promotion's generated wrestlers their push from the spec's mix, best card value first.
 * Headliners keep their authored push; the slots they fill come off the mix first.
 */
function assignPushes(
  context: BuildContext,
  promotionKey: string,
  wrestlers: RosterMember[],
): void {
  const promotionSpec = context.spec.promotions[promotionKey];
  if (promotionSpec === undefined) {
    throw new RosterBuildError(`Promotion ${promotionKey} has no entry in the roster spec`);
  }
  const counts = countsFromShares(promotionSpec.pushShares, CARD_PUSHES, wrestlers.length);
  const generated: RosterMember[] = [];
  for (const wrestler of wrestlers) {
    if (wrestler.headliner === null) {
      generated.push(wrestler);
      continue;
    }
    const push = wrestler.headliner.employment.push;
    counts.set(push, (counts.get(push) ?? 0) - 1);
  }
  // A push the headliners over-filled takes its overflow from the next push down the card.
  let overflow = 0;
  for (const push of CARD_PUSHES) {
    const count = (counts.get(push) ?? 0) - overflow;
    overflow = Math.max(0, -count);
    counts.set(push, Math.max(0, count));
  }
  const slots: CardPush[] = CARD_PUSHES.flatMap((push) =>
    Array.from({ length: counts.get(push) ?? 0 }, () => push),
  );
  generated.sort(byCardValue).forEach((wrestler, index) => {
    wrestler.push = slots[index] ?? 'enhancement';
  });
}

/**
 * Alternates face and heel down the generated wrestlers' card order; each face/heel pair is
 * swapped with the spec's chance, so every tier comes out roughly balanced without a fixed pattern.
 */
function assignAlignments(context: BuildContext, wrestlers: readonly RosterMember[]): void {
  const stream = context.stream('worldgen.roster.alignment');
  const generated = wrestlers
    .filter((wrestler) => wrestler.headliner === null)
    .sort(byCardPosition);
  for (let i = 0; i < generated.length; i += 2) {
    const swap = chance(stream, context.spec.alignment.swapChance);
    const first = generated[i];
    const second = generated[i + 1];
    if (first !== undefined) {
      first.alignment = swap ? 'heel' : 'face';
    }
    if (second !== undefined) {
      second.alignment = swap ? 'face' : 'heel';
    }
  }
}

/**
 * Splits generated wrestlers between the promotion's brands by the spec's shares, down the card
 * order, so each brand gets its share of every tier.
 */
function assignBrands(
  context: BuildContext,
  promotionKey: string,
  wrestlers: readonly RosterMember[],
): void {
  const shares = context.spec.promotions[promotionKey]?.brandShares;
  if (shares === undefined) {
    return;
  }
  const brandKeys = Object.keys(shares).sort(compareText);
  const assigned = new Map<string, number>(brandKeys.map((key) => [key, 0]));
  const generated = wrestlers
    .filter((wrestler) => wrestler.headliner === null)
    .sort(byCardPosition);
  generated.forEach((wrestler, index) => {
    // The brand furthest behind its share after this pick gets the wrestler.
    let best = brandKeys[0] ?? null;
    let bestDeficit = Number.NEGATIVE_INFINITY;
    for (const key of brandKeys) {
      const deficit = (shares[key] ?? 0) * (index + 1) - (assigned.get(key) ?? 0);
      if (deficit > bestDeficit) {
        best = key;
        bestDeficit = deficit;
      }
    }
    if (best !== null) {
      wrestler.brandKey = best;
      assigned.set(best, (assigned.get(best) ?? 0) + 1);
    }
  });
}

/** Staff alignment: managers alternate heel and face; everyone else is a neutral face. */
function assignStaff(members: readonly RosterMember[]): void {
  let managers = 0;
  for (const member of members) {
    if (member.role === 'manager') {
      member.alignment = managers % 2 === 0 ? 'heel' : 'face';
      managers += 1;
    } else if (member.role !== 'wrestler') {
      member.alignment = 'face';
    }
  }
}

/** Card values, pushes, alignments and brands for every promotion, in promotion-key order. */
export function placeOnCards(context: BuildContext, members: readonly RosterMember[]): void {
  assignCardValues(context, members);
  for (const promotionKey of [...context.promotions.keys()].sort(compareText)) {
    const staff = members.filter(
      (member) => member.promotionKey === promotionKey && member.role !== 'wrestler',
    );
    const wrestlers = members.filter(
      (member) => member.promotionKey === promotionKey && member.role === 'wrestler',
    );
    assignPushes(context, promotionKey, wrestlers);
    assignAlignments(context, wrestlers);
    assignBrands(context, promotionKey, wrestlers);
    assignStaff(staff);
  }
}

/**
 * Popularity fitting: in every region where the promotion's popularity is at least the spec's
 * minimum, a wrestler's popularity is raised to at least `promotionPop × pushFactor`, with ±noise.
 * Values are never lowered. The market leader's stars end up known across its whole footprint.
 */
export function fitPopularity(context: BuildContext, members: readonly RosterMember[]): void {
  const { popularity } = context.spec;
  const stream = context.stream('worldgen.roster.popularity');
  for (const member of members) {
    if (member.role !== 'wrestler' || member.promotionKey === null || member.push === 'none') {
      continue;
    }
    const promotion = context.promotions.get(member.promotionKey);
    if (promotion === undefined) {
      continue;
    }
    const factor = popularity.pushFactors[member.push];
    const regionalPop: Record<string, number> = { ...member.person.regionalPop };
    for (const regionKey of Object.keys(promotion.regionalPop).sort(compareText)) {
      const promotionPop = promotion.regionalPop[regionKey] ?? 0;
      if (promotionPop < popularity.minPromotionPopularity) {
        continue;
      }
      const noise = floatBetween(stream, -popularity.noise, popularity.noise);
      const target = Math.min(MAX_POPULARITY, roundToTenth(promotionPop * factor * (1 + noise)));
      const regionId = context.regionId(regionKey);
      const current = regionalPop[regionId] ?? 0;
      if (target > current) {
        regionalPop[regionId] = target;
      }
    }
    member.person = { ...member.person, regionalPop };
  }
}
