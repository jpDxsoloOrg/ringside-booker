/**
 * Generating the people: the hand-authored headliners first, then every promotion's wrestlers and
 * staff in promotion-key order, then the free-agent pool.
 *
 * Everyone goes through the engine's people generator (`generatePerson`), so generated and authored
 * people are built the same way. A headliner's spec pins their stage, gender, home region, style,
 * talent and any attribute overrides, and the authored name, age and body then replace what the
 * generator rolled.
 */

import {
  addDays,
  addYears,
  ageInYears,
  chance,
  compareDates,
  legalDisplayName,
  PersonSchema,
  regionWeight,
  shuffle,
  weightedPick,
  type CareerStage,
  type CountryId,
  type GameDate,
  type GenerateSpec,
  type Gender,
  type Person,
  type RingStyle,
} from '@ringside/engine';
import { RosterBuildError, type BuildContext } from './context';
import type { RosterMember, RosterPromotion, RosterRole } from './model';
import {
  CARD_PUSHES,
  STAFF_ROLES,
  WRESTLING_STYLES,
  type Headliner,
  type PromotionSpec,
} from './specSchema';
import { compareText, countsFromShares, twoDigits } from './stats';

const GENDER_ORDER: readonly Gender[] = ['male', 'female', 'nonBinary'];
const STAGE_ORDER: readonly CareerStage[] = [
  'rookie',
  'prospect',
  'established',
  'veteran',
  'legend',
];

/** Youngest age at which someone's debut may fall. */
const MIN_DEBUT_AGE = 16;

/** The people generator's popularity value in the person's own home region. */
function homePopularityOf(person: Person): number {
  return person.regionalPop[person.birthRegionId] ?? 0;
}

function generate(context: BuildContext, spec: GenerateSpec): { person: Person; talent: number } {
  const result = context.generator.generate(spec, {
    personId: context.nextPersonId(),
    worldDate: context.startDate,
    rng: context.stream,
  });
  return result.value;
}

/** A ring name for a wrestler or manager from the name generator; staff keep their legal name. */
function ringNameFor(context: BuildContext, person: Person, role: RosterRole): string {
  if (role !== 'wrestler' && role !== 'manager') {
    return legalDisplayName(person.givenName, person.familyName);
  }
  return context.generator.names.ringName(context.stream('worldgen.names.ring'), {
    person: { id: person.id, givenName: person.givenName, familyName: person.familyName },
    style: person.style,
  }).value;
}

function memberOf(
  key: string,
  generated: { person: Person; talent: number },
  stage: CareerStage,
  role: RosterRole,
  promotionKey: string | null,
  headliner: Headliner | null,
  ringName: string,
): RosterMember {
  const person: Person = { ...generated.person, defaultRingName: ringName };
  return {
    key,
    person,
    talent: generated.talent,
    stage,
    role,
    promotionKey,
    headliner,
    ringName,
    homePopularity: homePopularityOf(generated.person),
    cardValue: 0,
    push: role === 'wrestler' ? 'midCard' : 'none',
    alignment: 'face',
    brandKey: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Headliners

/** Moves the birth and debut dates so the person is exactly `age` on the start date. */
function withAge(person: Person, age: number, startDate: GameDate): Person {
  const shiftYears = ageInYears(person.birthDate, startDate) - age;
  const birthDate = addYears(person.birthDate, shiftYears);
  if (ageInYears(birthDate, startDate) !== age) {
    throw new RosterBuildError(`Could not set ${person.givenName}'s age to ${String(age)}`);
  }
  let debutDate = person.debutDate === null ? null : addYears(person.debutDate, shiftYears);
  if (debutDate !== null) {
    const latest = addDays(startDate, -180);
    const earliest = addYears(birthDate, MIN_DEBUT_AGE);
    if (compareDates(debutDate, latest) > 0) {
      debutDate = latest;
    }
    if (compareDates(debutDate, earliest) < 0) {
      debutDate = earliest;
    }
  }
  return { ...person, birthDate, debutDate };
}

/**
 * Registers every headliner's legal and ring name before anyone is generated, so no generated
 * person can take one.
 */
export function reserveHeadlinerNames(
  context: BuildContext,
  headliners: readonly Headliner[],
): void {
  const registry = context.generator.names.registry;
  for (const headliner of headliners) {
    registry.add('legal', legalDisplayName(headliner.givenName, headliner.familyName));
    registry.add('ring', headliner.ringName);
  }
}

function generateHeadliner(context: BuildContext, headliner: Headliner): RosterMember {
  const promotion = context.promotions.get(headliner.employment.promotionKey);
  if (promotion === undefined) {
    throw new RosterBuildError(
      `Headliner ${headliner.key} works for ${headliner.employment.promotionKey}, which is not in the world`,
    );
  }
  const homeRegionId = context.regionId(headliner.homeRegionKey);
  const generated = generate(context, {
    role: 'wrestler',
    careerStage: headliner.careerStage,
    gender: headliner.gender,
    regionId: homeRegionId,
    style: headliner.style,
    ...(headliner.archetype === undefined ? {} : { archetype: headliner.archetype }),
    talent: headliner.talent,
    ...(headliner.attributeOverrides === undefined
      ? {}
      : { attributeOverrides: headliner.attributeOverrides }),
  });
  const aged = withAge(generated.person, headliner.age, context.startDate);
  const promotionCountry = context.geography.countryOf(
    context.regionId(promotion.homeRegionKey),
  ).id;
  const bornAbroad = context.geography.countryOf(homeRegionId).id !== promotionCountry;
  const person: Person = PersonSchema.parse({
    ...aged,
    givenName: headliner.givenName,
    familyName: headliner.familyName,
    defaultRingName: headliner.ringName,
    basedInRegionId: bornAbroad ? context.regionId(promotion.homeRegionKey) : homeRegionId,
    heightCm: headliner.heightCm ?? aged.heightCm,
    weightKg: headliner.weightKg ?? aged.weightKg,
    masked: headliner.masked ?? aged.masked,
    tags: ['headliner'],
  });
  const member = memberOf(
    headliner.key,
    { person, talent: generated.talent },
    headliner.careerStage,
    'wrestler',
    promotion.key,
    headliner,
    headliner.ringName,
  );
  member.push = headliner.employment.push;
  member.alignment = headliner.employment.alignment;
  member.brandKey = headliner.employment.brandKey ?? null;
  return member;
}

/** Every headliner, in key order. */
export function generateHeadliners(
  context: BuildContext,
  headliners: readonly Headliner[],
): RosterMember[] {
  return [...headliners]
    .sort((left, right) => compareText(left.key, right.key))
    .map((headliner) => generateHeadliner(context, headliner));
}

// ---------------------------------------------------------------------------------------------
// Where generated people come from

/** Countries with a region bordering `countryId`, or else the rest of its continent. */
function neighbourCountries(context: BuildContext, countryId: CountryId): CountryId[] {
  const { geography } = context;
  const bordering = new Set<CountryId>();
  for (const region of geography.regionsOf(countryId)) {
    for (const neighbourId of region.neighbourRegionIds) {
      const neighbourCountry = geography.countryOf(neighbourId).id;
      if (neighbourCountry !== countryId) {
        bordering.add(neighbourCountry);
      }
    }
  }
  if (bordering.size > 0) {
    return [...bordering].sort(compareText);
  }
  const continentId = geography.country(countryId).continentId;
  return geography
    .countriesOf(continentId)
    .map((country) => country.id)
    .filter((id) => id !== countryId)
    .sort(compareText);
}

function countryWeight(context: BuildContext, countryId: CountryId): number {
  return context.geography
    .regionsOf(countryId)
    .reduce((sum, region) => sum + regionWeight(region), 0);
}

/** The home country most of the time, a neighbouring country `neighbourCountryShare` of it. */
function birthCountryFor(context: BuildContext, promotion: RosterPromotion): CountryId {
  const homeCountry = context.geography.countryOf(context.regionId(promotion.homeRegionKey)).id;
  const stream = context.stream('worldgen.roster.people');
  const fromAbroad = chance(stream, context.spec.neighbourCountryShare);
  const neighbours = neighbourCountries(context, homeCountry).filter(
    (id) => countryWeight(context, id) > 0,
  );
  if (!fromAbroad || neighbours.length === 0) {
    return homeCountry;
  }
  return weightedPick(
    stream,
    neighbours.map((id) => ({ item: id, weight: countryWeight(context, id) })),
  );
}

function styleFor(
  context: BuildContext,
  promotionSpec: PromotionSpec | null,
): RingStyle | undefined {
  const weights = promotionSpec?.styleWeights;
  if (weights === undefined) {
    return undefined;
  }
  const entries = WRESTLING_STYLES.map((style) => ({ item: style, weight: weights[style] ?? 0 }));
  return weightedPick(context.stream('worldgen.roster.people'), entries);
}

/** An exact list of values from shares, in a shuffled order. */
function shuffledCounts<Value extends string>(
  context: BuildContext,
  shares: Readonly<Record<Value, number>>,
  order: readonly Value[],
  total: number,
  alreadyTaken: readonly Value[],
): Value[] {
  const counts = countsFromShares(shares, order, total);
  for (const taken of alreadyTaken) {
    counts.set(taken, (counts.get(taken) ?? 0) - 1);
  }
  const values: Value[] = [];
  for (const value of order) {
    for (let i = 0; i < Math.max(0, counts.get(value) ?? 0); i++) {
      values.push(value);
    }
  }
  // Too many taken by headliners in one group: fill the gap from the biggest share.
  const left = total - alreadyTaken.length;
  const fallback = [...order].sort((left, right) => shares[right] - shares[left])[0];
  while (values.length < left && fallback !== undefined) {
    values.push(fallback);
  }
  return shuffle(context.stream('worldgen.roster.people'), values.slice(0, Math.max(0, left)));
}

// ---------------------------------------------------------------------------------------------
// Promotions and free agents

/** Generates one promotion's wrestlers (after its headliners) and staff. */
export function generatePromotionPeople(
  context: BuildContext,
  promotion: RosterPromotion,
  headliners: readonly RosterMember[],
): RosterMember[] {
  const promotionSpec = context.spec.promotions[promotion.key];
  if (promotionSpec === undefined) {
    throw new RosterBuildError(`Promotion ${promotion.key} has no entry in the roster spec`);
  }
  const ownHeadliners = headliners.filter((member) => member.promotionKey === promotion.key);
  const generatedCount = promotionSpec.wrestlers - ownHeadliners.length;
  if (generatedCount < 0) {
    throw new RosterBuildError(
      `${promotion.key} has ${String(ownHeadliners.length)} headliners but only ${String(promotionSpec.wrestlers)} wrestlers`,
    );
  }
  const genders = shuffledCounts(
    context,
    promotionSpec.genderShares,
    GENDER_ORDER,
    promotionSpec.wrestlers,
    ownHeadliners.map((member) => member.person.gender),
  );
  const stages = shuffledCounts(
    context,
    promotionSpec.stageShares,
    STAGE_ORDER,
    promotionSpec.wrestlers,
    ownHeadliners.map((member) => member.stage),
  );
  const homeRegionId = context.regionId(promotion.homeRegionKey);
  const homeCountry = context.geography.countryOf(homeRegionId).id;
  const members: RosterMember[] = [];
  let number = 0;
  const nextKey = (): string => {
    number += 1;
    return `gen-${promotion.key}-${twoDigits(number)}`;
  };
  const place = (person: Person): Person =>
    context.geography.countryOf(person.birthRegionId).id === homeCountry
      ? person
      : { ...person, basedInRegionId: homeRegionId };

  for (let i = 0; i < generatedCount; i++) {
    const countryId = birthCountryFor(context, promotion);
    const style = styleFor(context, promotionSpec);
    const stage = stages[i] ?? 'established';
    const generated = generate(context, {
      role: 'wrestler',
      careerStage: stage,
      gender: genders[i] ?? 'male',
      countryId,
      ...(style === undefined ? {} : { style }),
    });
    const person = place(generated.person);
    members.push(
      memberOf(
        nextKey(),
        { person, talent: generated.talent },
        stage,
        'wrestler',
        promotion.key,
        null,
        ringNameFor(context, person, 'wrestler'),
      ),
    );
  }
  for (const role of STAFF_ROLES) {
    for (let i = 0; i < promotionSpec.staff[role]; i++) {
      const countryId = birthCountryFor(context, promotion);
      const generated = generate(context, { role, countryId });
      const person = place(generated.person);
      members.push(
        memberOf(
          nextKey(),
          { person, talent: generated.talent },
          stageOfGenerated(context, person),
          role,
          promotion.key,
          null,
          ringNameFor(context, person, role),
        ),
      );
    }
  }
  return members;
}

/**
 * The career stage a generated person's age fits best. Staff are generated without a set stage,
 * and the generator does not hand the stage back, so it is read from the age the same way the
 * reports read it.
 */
function stageOfGenerated(context: BuildContext, person: Person): CareerStage {
  const age = ageInYears(person.birthDate, context.startDate);
  const mainRole = person.roles[0];
  const role = Object.values(context.library.generationRoles).find(
    (record) => record.role === mainRole,
  );
  if (role === undefined) {
    return 'established';
  }
  let best: CareerStage = 'established';
  let bestScore = Number.POSITIVE_INFINITY;
  for (const stage of STAGE_ORDER) {
    const range = role.stageAges[stage];
    const middle = (range.min + range.max) / 2;
    const outside = age < range.min ? range.min - age : age > range.max ? age - range.max : 0;
    const score = outside * 1000 + Math.abs(age - middle);
    if (score < bestScore) {
      best = stage;
      bestScore = score;
    }
  }
  return best;
}

/** The free-agent pool: wrestlers of mixed stages and some unattached staff. */
export function generateFreeAgents(context: BuildContext): RosterMember[] {
  const { freeAgents } = context.spec;
  const genders = shuffledCounts(
    context,
    freeAgents.genderShares,
    GENDER_ORDER,
    freeAgents.wrestlers,
    [],
  );
  const stages = shuffledCounts(
    context,
    freeAgents.stageShares,
    STAGE_ORDER,
    freeAgents.wrestlers,
    [],
  );
  const continentEntries = Object.keys(freeAgents.continentWeights)
    .sort(compareText)
    .map((key) => ({
      item: context.continentId(key),
      weight: freeAgents.continentWeights[key] ?? 0,
    }))
    .filter((entry) => entry.weight > 0);
  const members: RosterMember[] = [];
  let number = 0;
  const nextKey = (): string => {
    number += 1;
    return `gen-fa-${twoDigits(number)}`;
  };
  const continent = (): ReturnType<BuildContext['continentId']> =>
    weightedPick(context.stream('worldgen.roster.people'), continentEntries);
  for (let i = 0; i < freeAgents.wrestlers; i++) {
    const stage = stages[i] ?? 'established';
    const generated = generate(context, {
      role: 'wrestler',
      careerStage: stage,
      gender: genders[i] ?? 'male',
      continentId: continent(),
    });
    members.push(
      memberOf(
        nextKey(),
        generated,
        stage,
        'wrestler',
        null,
        null,
        ringNameFor(context, generated.person, 'wrestler'),
      ),
    );
  }
  for (const role of STAFF_ROLES) {
    for (let i = 0; i < freeAgents.staff[role]; i++) {
      const generated = generate(context, { role, continentId: continent() });
      members.push(
        memberOf(
          nextKey(),
          generated,
          stageOfGenerated(context, generated.person),
          role,
          null,
          null,
          ringNameFor(context, generated.person, role),
        ),
      );
    }
  }
  return members;
}

/** The pushes in card order, for sorting. */
export const PUSH_RANK: Readonly<Record<string, number>> = Object.fromEntries(
  CARD_PUSHES.map((push, index) => [push, index]),
);
