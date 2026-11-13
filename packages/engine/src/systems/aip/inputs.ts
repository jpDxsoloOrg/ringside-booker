/**
 * What the rival desk's formulas read from the world: one roster rule, and the inputs of card
 * value and roster needs.
 *
 * Everything here is read-only and walks rows in ID order, so two calls on the same world give the
 * same answer. `unitRoster` is the one definition of "a unit's roster": the weekly roster review,
 * the Promotions screens and the later rival features (AIP3 pushes, AIP4 cards, AIP6 storylines,
 * AIP8 business reviews) all ask it, so a human-run brand is left out the same way everywhere.
 *
 * Needs read only public facts (roster, card positions, alignment, availability, titles and
 * contract end dates); a later input that is private (cash, morale) must go through
 * `privateInputOf`. Design: docs/design/rival-desk.md#needs.
 */

import { isAfter, isBefore, type GameDate } from '../../core/date';
import type { BrandId, PersonId, PromotionId } from '../../core/ids';
import { promotionStatusKey, type Employment } from '../../model/entities/employment';
import type { TitleReign } from '../../model/entities/title-reign';
import type { Title } from '../../model/entities/title';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';
import { geographyOf } from '../world/geography';
import type { FootprintRegion } from '../workers/formulas/footprintPopularity';
import { ageOn } from '../workers/helpers/age';
import { availabilityOf } from '../workers/helpers/availability';
import type { CardValueInputs } from './formulas/cardValue';
import type { TracedTaste } from './formulas/defaultTaste';
import {
  NEED_CREW_ROLES,
  type DivisionGender,
  type NeedCrewRole,
  type NeedsChampion,
  type NeedsInputs,
  type NeedsWrestler,
} from './formulas/needs';
import { tasteOf } from './taste';
import { unitCovers, type AiUnit } from './units';

/** The unit fields the roster rule reads. */
export type RosterUnit = Pick<AiUnit, 'promotionId' | 'brandId' | 'excludedBrandIds'>;

function coversRow(unit: RosterUnit, promotionId: PromotionId, brandId: BrandId | null): boolean {
  return unitCovers({ ...unit, key: '' }, promotionId, brandId);
}

/**
 * The unit's roster on `date`, in employment ID order: the promotion's active contracts that have
 * started (WRK1's `activeEmploymentsOf` rule), only the unit's brand for a brand unit, and without
 * the brands in `unit.excludedBrandIds` for a promotion unit.
 */
export function unitRoster(
  read: GameWorldView,
  unit: RosterUnit,
  date: GameDate,
): DeepReadonly<Employment>[] {
  return read.tables.employments
    .lookup('byPromotionStatus', promotionStatusKey(unit.promotionId, 'active'))
    .filter(
      (employment) =>
        !isAfter(employment.startsOn, date) &&
        coversRow(unit, employment.promotionId, employment.brandId),
    )
    .sort((left, right) => compareIds(left.id, right.id));
}

/**
 * The brand whose taste decides about a worker on this contract: a computer GM brand inside a
 * promotion the computer does not run has its own profile; every other contract follows its
 * promotion.
 */
export function deciderBrandOf(
  read: GameWorldView,
  employment: Pick<Employment, 'promotionId' | 'brandId'>,
): BrandId | null {
  if (employment.brandId === null) {
    return null;
  }
  const promotion = read.tables.promotions.get(employment.promotionId);
  const brand = read.tables.brands.get(employment.brandId);
  return promotion?.controller.kind !== 'computer' && brand?.controller?.kind === 'computer'
    ? brand.id
    : null;
}

/** What many card values in one pass may share, so the map and the taste are read once. */
export interface CardValueShared {
  /** Must be `geographyOf(read).regions`. */
  readonly regions?: readonly FootprintRegion[];
  /** Must be the taste {@link cardValueInputsFor} would pick for this contract. */
  readonly taste?: TracedTaste;
}

/**
 * The card value inputs of the worker on `employment`, valued by that contract's promotion.
 *
 * @throws EntityNotFoundError when the person or promotion is missing.
 */
export function cardValueInputsFor(
  read: GameWorldView,
  tunables: EngineTunables,
  employment: DeepReadonly<Employment>,
  date: GameDate,
  shared: CardValueShared = {},
): CardValueInputs {
  const person = read.tables.people.require(employment.personId);
  const promotion = read.tables.promotions.require(employment.promotionId);
  return {
    workerName: employment.ringName,
    promotionName: promotion.name,
    workerPop: person.regionalPop,
    promotionPop: promotion.regionalPop,
    regions: shared.regions ?? geographyOf(read).regions,
    attributes: person.attributes,
    momentum: employment.momentum,
    age: ageOn(person, date),
    taste:
      shared.taste ??
      tasteOf(read, tunables, employment.promotionId, deciderBrandOf(read, employment)),
  };
}

function isCrewRole(role: string): role is NeedCrewRole {
  return (NEED_CREW_ROLES as readonly string[]).includes(role);
}

/** True when an event definition or title runs on `date`. */
function activeOn(from: GameDate, until: GameDate | null, date: GameDate): boolean {
  return !isAfter(from, date) && (until === null || !isBefore(until, date));
}

/** The unit's titles in use, in ID order. */
export function unitTitles(read: GameWorldView, unit: RosterUnit): DeepReadonly<Title>[] {
  return read.tables.titles
    .lookup('byPromotion', unit.promotionId)
    .filter(
      (title) => title.status === 'active' && coversRow(unit, title.promotionId, title.brandId),
    )
    .sort((left, right) => compareIds(left.id, right.id));
}

/** The title's current reign, or null when it is vacant. */
export function openReignOf(
  read: GameWorldView,
  titleId: Title['id'],
): DeepReadonly<TitleReign> | null {
  return read.tables.titleReigns.lookup('openByTitle', titleId)[0] ?? null;
}

/** The person's started, active contract with `promotionId`, or null (lowest ID when several). */
export function employmentAt(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
  date: GameDate,
): DeepReadonly<Employment> | null {
  const found = read.tables.employments
    .lookup('byPerson', personId)
    .filter(
      (employment) =>
        employment.promotionId === promotionId &&
        employment.status === 'active' &&
        !isAfter(employment.startsOn, date),
    )
    .sort((left, right) => compareIds(left.id, right.id));
  return found[0] ?? null;
}

/**
 * The names of a reign's holders as fans know them now: each holder's ring name at the promotion,
 * else the name they won it under.
 */
export function holderNamesOf(
  read: GameWorldView,
  reign: DeepReadonly<TitleReign>,
  promotionId: PromotionId,
  date: GameDate,
): string[] {
  return reign.holderIds.map(
    (personId, index) =>
      employmentAt(read, personId, promotionId, date)?.ringName ??
      reign.holderNamesAtTime[index] ??
      '',
  );
}

function championOf(
  read: GameWorldView,
  unit: RosterUnit,
  title: DeepReadonly<Title>,
  reign: DeepReadonly<TitleReign>,
  date: GameDate,
): NeedsChampion {
  let employed = true;
  let unfitReason: string | null = null;
  let contractEndsOn: GameDate | null = null;
  for (const personId of reign.holderIds) {
    const employment = employmentAt(read, personId, unit.promotionId, date);
    if (employment === null) {
      employed = false;
      continue;
    }
    const person = read.tables.people.require(personId);
    const availability = availabilityOf(person, employment, date);
    if (unfitReason === null && availability.status !== 'available') {
      unfitReason = availability.reason;
    }
    if (
      employment.endsOn !== null &&
      (contractEndsOn === null || isBefore(employment.endsOn, contractEndsOn))
    ) {
      contractEndsOn = employment.endsOn;
    }
  }
  return {
    titleId: title.id,
    titleName: title.name,
    personIds: [...reign.holderIds],
    names: holderNamesOf(read, reign, unit.promotionId, date),
    unfitReason,
    contractEndsOn,
    employed,
  };
}

/** The name a needs list is titled with: the brand's for a brand unit, else the promotion's. */
export function unitNameOf(read: GameWorldView, unit: RosterUnit): string {
  if (unit.brandId !== null) {
    const brand = read.tables.brands.get(unit.brandId);
    if (brand !== undefined) {
      return brand.name;
    }
  }
  return read.tables.promotions.require(unit.promotionId).name;
}

/**
 * The roster needs inputs of `unit` on `date`:
 *
 * - `largestShowSlots`: the most `format.slots` of the unit's event definitions running on the date;
 * - wrestlers: the unit's wrestler contracts, `available` when WRK1's availability says so;
 * - gender divisions: the male and female divisions of the unit's titles in use;
 * - champions: the current holders of those titles. A holder with no contract at the promotion
 *   makes the champion `employed: false` (for a team, any one holder); the first holder who cannot
 *   work gives `unfitReason`, and the earliest contract end among the holders `contractEndsOn`;
 * - crew counts: referees, announcers and producers under contract.
 *
 * `tunables` is not read yet; it is in the signature so a later input (AIP2's booker taste) needs
 * no change to the callers.
 */
export function needsInputsFor(
  read: GameWorldView,
  _tunables: EngineTunables,
  unit: RosterUnit,
  date: GameDate,
): NeedsInputs {
  let largestShowSlots: number | null = null;
  for (const definition of read.tables.eventDefinitions.lookup('byPromotion', unit.promotionId)) {
    if (
      coversRow(unit, definition.promotionId, definition.brandId) &&
      activeOn(definition.activeFrom, definition.activeUntil, date) &&
      (largestShowSlots === null || definition.format.slots > largestShowSlots)
    ) {
      largestShowSlots = definition.format.slots;
    }
  }

  const wrestlers: NeedsWrestler[] = [];
  const crewCounts: Record<NeedCrewRole, number> = { referee: 0, announcer: 0, producer: 0 };
  for (const employment of unitRoster(read, unit, date)) {
    const role = employment.role;
    if (isCrewRole(role)) {
      crewCounts[role] += 1;
      continue;
    }
    if (role !== 'wrestler') {
      continue;
    }
    const person = read.tables.people.require(employment.personId);
    wrestlers.push({
      personId: person.id,
      name: employment.ringName,
      gender: person.gender,
      push: employment.push,
      alignment: employment.alignment,
      available: availabilityOf(person, employment, date).status === 'available',
    });
  }

  const titles = unitTitles(read, unit);
  const genderDivisions: DivisionGender[] = [];
  const champions: NeedsChampion[] = [];
  for (const title of titles) {
    const gender = title.division.gender;
    if ((gender === 'male' || gender === 'female') && !genderDivisions.includes(gender)) {
      genderDivisions.push(gender);
    }
    const reign = openReignOf(read, title.id);
    if (reign !== null) {
      champions.push(championOf(read, unit, title, reign, date));
    }
  }

  return {
    unitName: unitNameOf(read, unit),
    largestShowSlots,
    wrestlers,
    genderDivisions: genderDivisions.sort(),
    champions,
    crewCounts,
    today: date,
  };
}
