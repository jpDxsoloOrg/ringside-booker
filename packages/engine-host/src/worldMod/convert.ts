/**
 * Converts a workshop world mod (its SQLite tables, read by the game and passed in as JSON rows)
 * into a `world` data pack the engine loads like any bundled world.
 *
 * The pack depends on the bundled `base` pack for everything a mod does not describe (name lists,
 * generation numbers, match and segment catalogs, the map it extends). Records get stable keys from
 * the source ids (`wm-w118` for worker 118), so importing the same mod again gives the same keys.
 * Pictures are only referenced (see `imageRef.ts`); the roster-only option leaves them out.
 *
 * Nothing here filters names: an imported world may use any names. Skins are never read.
 * The mapping is written up in game/docs/world-mod-import.md; every enum and scale is in
 * `mapping.ts`.
 */

import {
  addDays,
  addYears,
  BODY_PARTS,
  ageInYears,
  compareDates,
  EXCLUSIVE_TRAIT_PAIRS,
  isGameDate,
  MAX_RECURRENCE_DATES,
  MAX_TRAITS,
  MIN_DEBUT_AGE,
  packManifestSchema,
} from '@ringside/engine';
import type {
  GameDate,
  PackManifest,
  PersonRole,
  RawPack,
  RecordKind,
  TraitKey,
} from '@ringside/engine';
import { Geography } from './geography';
import type { BaseGeography } from './geography';
import { encodeWorldModImageRef } from './imageRef';
import {
  ALIGNMENTS,
  BUILDS,
  CONTINENT_POP_COLUMNS,
  DEFAULT_HEIGHT_CM,
  DEFAULT_WEIGHT_KG,
  EVENT_IMPORTANCES,
  FALLBACK_MOTIVATIONS,
  FEMALE_HEIGHT_OFFSET_CM,
  FEMALE_WEIGHT_FACTOR,
  GENDERS,
  HEIGHTS_CM,
  lookup,
  MOTIVATIONS,
  NETWORK_KINDS,
  PALETTE,
  PERSON_COLUMNS_NOT_IMPORTED,
  PERSON_ROLES,
  PERSON_STATUSES,
  POLICY_TIERS,
  PROMOTION_STYLES,
  PUSHES,
  RING_STYLES,
  SHOW_FORMATS,
  STATE_TABLES,
  TABLES_NOT_IMPORTED,
  TIMESLOTS,
  TITLE_WEIGHT_LIMITS_KG,
  TRAIT_FLAGS,
  venueKind,
  WEEKDAY_COLUMNS,
  WEEKDAYS,
  WEIGHTS_KG,
} from './mapping';
import { ReportBuilder } from './report';
import type { ConversionWarning, Counts } from './report';
import { clamp, cut, date, flag, hasTable, id, int, num, round1, tableRows, text } from './rows';
import type { ModRow, ModTables } from './rows';

/** The tables the converter reads. The game reads exactly these (plus any of `STATE_TABLES`). */
export const WORLD_MOD_TABLES: readonly string[] = [
  'gameworld',
  'workers',
  'workerpictures',
  'promotions',
  'brands',
  'contracts',
  'titles',
  'titlehistory',
  'tagteams',
  'promotiontagteams',
  'venues',
  'events',
  'eventDates',
  'networks',
  'networkDeals',
  'networkAvailability',
  'countries',
  'regions',
];

/** Tables without which there is no world to build. */
const REQUIRED_TABLES: readonly string[] = ['gameworld', 'workers', 'promotions', 'countries'];

/** Continent popularities below this are left out (the engine stores popularity 1-100). */
const MIN_REGIONAL_POP = 1;

export interface WorldModOptions {
  /** Leave every picture reference out (nothing in the picture folder will be read). */
  readonly rosterOnly?: boolean;
  /** The pack id to use; default `wm-` plus the world name, slugged. */
  readonly packId?: string;
}

export interface WorldModReport {
  readonly world: {
    readonly name: string;
    readonly startDate: string | null;
    readonly imageFolder: string | null;
    readonly databaseVersion: number | null;
  };
  /** Rows read per source table. */
  readonly sourceCounts: Counts;
  /** Records written per pack record kind. */
  readonly counts: Counts;
  /** Records with a picture reference, by folder (all zero for a roster-only import). */
  readonly pictures: Counts;
  readonly picturesSkipped: boolean;
  readonly warnings: readonly ConversionWarning[];
  /** Source fields and tables with no home in the engine, listed once each. */
  readonly notImported: readonly string[];
}

export type WorldModConversion =
  | { readonly ok: true; readonly pack: RawPack; readonly report: WorldModReport }
  | { readonly ok: false; readonly errors: readonly string[]; readonly report: WorldModReport };

type Rec = Record<string, unknown>;

interface PersonInfo {
  readonly key: string;
  readonly ringName: string;
  readonly roles: readonly PersonRole[];
  readonly debutDate: GameDate | null;
  readonly record: Rec;
  readonly continentPop: Readonly<Record<string, number>>;
}

interface PromotionInfo {
  readonly key: string;
  readonly foundedOn: GameDate;
  readonly record: Rec;
  readonly continentPop: Readonly<Record<string, number>>;
}

const FILE_NAMES: Readonly<Partial<Record<RecordKind, string>>> = {
  country: 'countries.json',
  region: 'regions.json',
  person: 'people.json',
  promotion: 'promotions.json',
  brand: 'brands.json',
  title: 'titles.json',
  venue: 'venues.json',
  network: 'networks.json',
  eventDefinition: 'events.json',
  deal: 'deals.json',
  employment: 'employments.json',
  team: 'teams.json',
  titleReign: 'reigns.json',
};

/** `wm-` plus the name in lowercase letters, digits and hyphens, at most 40 characters. */
export function worldModPackId(worldName: string): string {
  const slug = worldName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 37)
    .replace(/-+$/g, '');
  return slug === '' ? 'wm-world' : `wm-${slug}`;
}

function rows(tables: ModTables, name: string): readonly ModRow[] {
  return tableRows(tables, name);
}

function laterOf(left: GameDate, right: GameDate): GameDate {
  return compareDates(left, right) >= 0 ? left : right;
}

function earlierOf(left: GameDate, right: GameDate): GameDate {
  return compareDates(left, right) <= 0 ? left : right;
}

function isAfter(left: GameDate, right: GameDate): boolean {
  return compareDates(left, right) > 0;
}

/** Converts the mod. Never throws for bad data: problems come back as errors and warnings. */
export function convertWorldMod(
  tables: ModTables,
  base: BaseGeography & { readonly baseVersion: string },
  options: WorldModOptions = {},
): WorldModConversion {
  const report = new ReportBuilder();
  const rosterOnly = options.rosterOnly === true;
  const sourceCounts: Counts = {};
  for (const name of WORLD_MOD_TABLES) sourceCounts[name] = rows(tables, name).length;
  const counts: Counts = {};
  const pictures: Counts = {};

  const gameworld = rows(tables, 'gameworld')[0];
  const worldName =
    (gameworld === undefined ? null : text(gameworld, 'worldName')) ?? 'Imported world';
  const imageFolder = gameworld === undefined ? null : text(gameworld, 'imageFolder');
  const databaseVersion = gameworld === undefined ? null : int(gameworld, 'databaseVersion');
  const startDate =
    gameworld === undefined
      ? null
      : (date(gameworld, 'startDate') ?? date(gameworld, 'currentDate'));

  const buildReport = (): WorldModReport => ({
    world: { name: worldName, startDate, imageFolder, databaseVersion },
    sourceCounts,
    counts,
    pictures,
    picturesSkipped: rosterOnly,
    warnings: report.warnings(),
    notImported: report.notImported,
  });

  for (const name of REQUIRED_TABLES) {
    if (!hasTable(tables, name)) report.error(`The database has no ${name} table`);
  }
  if (gameworld === undefined && hasTable(tables, 'gameworld')) {
    report.error('The gameworld table is empty');
  }
  if (gameworld !== undefined && startDate === null) {
    report.error('gameworld.startDate is not a date in the form YYYY-MM-DD');
  }
  if (report.errors.length > 0 || startDate === null) {
    return { ok: false, errors: report.errors, report: buildReport() };
  }
  const start: GameDate = startDate;

  const picture = (folder: string, file: string | null): Rec => {
    if (rosterOnly || file === null) return {};
    const ref = encodeWorldModImageRef(folder, file);
    if (ref === null) return {};
    pictures[folder] = (pictures[folder] ?? 0) + 1;
    return { ref };
  };
  const withPicture = (field: string, folder: string, file: string | null): Rec => {
    const found = picture(folder, file);
    return found['ref'] === undefined ? {} : { [field]: found['ref'] };
  };

  const geography = new Geography(base, tables, report);
  const fallbackRegion = geography.worldFallbackRegion();
  const regionFor = (
    row: ModRow,
    regionColumn: string,
    countryColumn: string,
    continentColumn: string | null,
    example: string,
  ): string => {
    const found = geography.resolveRegion(
      id(row, regionColumn),
      id(row, countryColumn),
      continentColumn === null ? null : text(row, continentColumn),
    );
    if (found !== null) return found;
    report.warn(
      'no-location',
      'A record has no usable location; it was placed in the most populous region',
      example,
    );
    return fallbackRegion;
  };
  const unknown = (
    field: string,
    value: string | null,
    fallback: string,
    example: string,
  ): void => {
    report.warn(
      `unknown-${field}`,
      `An unknown ${field} value ("${value ?? ''}") was mapped to ${fallback}`,
      example,
    );
  };

  // -------------------------------------------------------------------------------------------
  // People

  const pictureByWorker = new Map<number, string>();
  const alternates = [...rows(tables, 'workerpictures')]
    .filter((row) => {
      const trigger = date(row, 'triggerDate');
      return trigger !== null && !isAfter(trigger, start) && text(row, 'picture') !== null;
    })
    .sort((left, right) =>
      compareDates(date(left, 'triggerDate') ?? start, date(right, 'triggerDate') ?? start),
    );
  for (const row of alternates) {
    const workerId = id(row, 'workerID');
    const file = text(row, 'picture');
    if (workerId !== null && file !== null) pictureByWorker.set(workerId, file);
  }

  const people = new Map<number, PersonInfo>();
  let futureDebuts = 0;
  for (const row of rows(tables, 'workers')) {
    const workerId = id(row, 'workerID');
    const name = text(row, 'name');
    if (workerId === null || name === null) continue;
    const example = `workers#${String(workerId)}`;
    let birthDate = date(row, 'birthDate');
    if (birthDate === null) {
      report.warn(
        'no-birth-date',
        'A person has no birth date; they were made 30 at the start',
        example,
      );
      birthDate = addYears(start, -30);
    }
    if (isAfter(birthDate, start)) {
      report.warn('not-born-yet', 'A person born after the start date was left out', example);
      continue;
    }
    const age = ageInYears(birthDate, start);
    // A debut after the start date is kept: the engine holds such people back until that day.
    let debutDate = date(row, 'debutDate');
    const earliestDebut = addYears(birthDate, MIN_DEBUT_AGE);
    if (debutDate !== null && compareDates(debutDate, earliestDebut) < 0) {
      report.warn(
        'early-debut',
        `A debut before age ${String(MIN_DEBUT_AGE)} was moved to that birthday`,
        example,
      );
      debutDate = earliestDebut;
    }
    if (debutDate !== null && isAfter(debutDate, start)) {
      futureDebuts += 1;
    }

    const genderText = text(row, 'gender');
    let gender = lookup(GENDERS, genderText ?? '');
    if (gender === undefined) {
      unknown('gender', genderText, 'male', example);
      gender = 'male';
    }
    const typeText = text(row, 'type');
    let role = lookup(PERSON_ROLES, typeText ?? '');
    if (role === undefined) {
      unknown('person-type', typeText, 'wrestler', example);
      role = 'wrestler';
    }
    const wrestles = role === 'wrestler' || role === 'occasionalWrestler';
    const styleText = text(row, 'style');
    let style = lookup(RING_STYLES, styleText ?? '');
    if (style === undefined) {
      unknown('style', styleText, 'allRounder', example);
      style = 'allRounder';
    }
    if (wrestles && style === 'nonWrestler') {
      report.warn(
        'wrestler-without-style',
        'A wrestler with the non-wrestler style was given the all-rounder style',
        example,
      );
      style = 'allRounder';
    }
    if (!wrestles) style = 'nonWrestler';

    const statusText = text(row, 'status');
    let status = lookup(PERSON_STATUSES, statusText ?? '');
    if (status === undefined) {
      unknown('status', statusText, 'active', example);
      status = 'active';
    }
    const buildText = text(row, 'build');
    let build = lookup(BUILDS, buildText ?? '');
    if (build === undefined) {
      unknown('build', buildText, 'average', example);
      build = 'average';
    }
    const female = gender === 'female';
    const heightText = text(row, 'height');
    let height = lookup(HEIGHTS_CM, heightText ?? '');
    if (height === undefined) {
      unknown('height', heightText, `${String(DEFAULT_HEIGHT_CM)} cm`, example);
      height = DEFAULT_HEIGHT_CM;
    }
    const weightText = text(row, 'weight');
    let weight = lookup(WEIGHTS_KG, weightText ?? '');
    if (weight === undefined) {
      unknown('weight', weightText, `${String(DEFAULT_WEIGHT_KG)} kg`, example);
      weight = DEFAULT_WEIGHT_KG;
    }
    const heightCm = clamp(female ? height - FEMALE_HEIGHT_OFFSET_CM : height, 140, 230);
    const weightKg = clamp(Math.round(female ? weight * FEMALE_WEIGHT_FACTOR : weight), 40, 250);

    const stat = (column: string): number => round1(clamp(num(row, column) ?? 0, 0, 100));
    const ringwork = stat('wrestlingSkill');
    const stamina = stat('stamina');
    const attributes = {
      ringwork,
      psychology: stat('psychology'),
      stamina,
      safety: stat('safety'),
      athleticism: round1((ringwork + stamina) / 2),
      mic: stat('entertainment'),
      charisma: stat('starPower'),
      presence: Math.max(stat('intimidation'), stat('sexAppeal')),
      officiating: stat('refereeing'),
      broadcasting: stat('commentary'),
      producing: stat('agent'),
      booking: round1(Math.max(stat('agent'), stat('psychology')) * 0.8),
    };
    const headroom = clamp((30 - age) * 2.5, 0, 25);
    const ceilings: Record<string, number> = {};
    for (const key of [
      'ringwork',
      'psychology',
      'stamina',
      'safety',
      'athleticism',
      'mic',
      'charisma',
      'presence',
    ] as const) {
      ceilings[key] = round1(clamp(attributes[key] + headroom, attributes[key], 100));
    }
    const condition = {
      head: stat('headCondition'),
      neck: stat('neckCondition'),
      back: stat('backCondition'),
      arms: stat('armsCondition'),
      torso: stat('bodyCondition'),
      legs: stat('legsCondition'),
    };
    // A mod that leaves a condition empty or at 0 means "not set", not "crippled".
    for (const part of BODY_PARTS) {
      if (condition[part] < 1) condition[part] = 100;
    }

    const traits: TraitKey[] = [];
    for (const [column, trait] of TRAIT_FLAGS) {
      if (traits.length >= MAX_TRAITS || !flag(row, column) || traits.includes(trait)) continue;
      const clashes = EXCLUSIVE_TRAIT_PAIRS.some(
        ([first, second]) =>
          (first === trait && traits.includes(second)) ||
          (second === trait && traits.includes(first)),
      );
      if (!clashes) traits.push(trait);
    }
    const viceState = (value: number): 'none' | 'hidden' | 'known' | 'recovering' =>
      value <= 0 ? 'none' : value === 1 ? 'hidden' : value === 2 ? 'known' : 'recovering';
    const substances = Math.max(
      int(row, 'hardDrugs') ?? 0,
      int(row, 'softDrugs') ?? 0,
      int(row, 'steroids') ?? 0,
    );
    const driveText = text(row, 'drive');
    const motivation =
      lookup(MOTIVATIONS, driveText ?? '') ??
      FALLBACK_MOTIVATIONS[workerId % FALLBACK_MOTIVATIONS.length] ??
      'enjoyment';

    const [givenPart, ...familyParts] = name.split(/\s+/);
    const givenName = cut(givenPart ?? name, 40);
    const familyName = cut(familyParts.join(' '), 40);
    const ringName = cut(name, 60);
    const continentPop: Record<string, number> = {};
    for (const [continentKey, column] of CONTINENT_POP_COLUMNS) {
      continentPop[continentKey] = clamp(num(row, column) ?? 0, 0, 100);
    }
    const key = `wm-w${String(workerId)}`;
    const record: Rec = {
      key,
      givenName,
      familyName,
      defaultRingName: ringName,
      gender,
      birthDate,
      debutDate,
      birthRegionKey: regionFor(
        row,
        'birthPlaceRegion',
        'birthPlaceCountry',
        'birthPlace',
        example,
      ),
      basedInRegionKey: regionFor(row, 'basedInRegion', 'basedInCountry', 'basedIn', example),
      ...withPicture('imageRef', 'people', pictureByWorker.get(workerId) ?? text(row, 'picture')),
      masked: flag(row, 'isMasked'),
      tags: ['imported'],
      roles: [role],
      status,
      career: { canOwn: flag(row, 'canBeOwner'), canBook: flag(row, 'canBeBooker') },
      motivation,
      heightCm,
      weightKg,
      build,
      style,
      attributes,
      condition,
      development: {
        potential: clamp(Math.round((32 - age) * 60), -1000, 1000),
        ceilings,
      },
      regionalPop: {},
      traits,
      vices: { alcohol: viceState(int(row, 'alcoholic') ?? 0), substances: viceState(substances) },
    };
    people.set(workerId, { key, ringName, roles: [role], debutDate, record, continentPop });
  }
  for (const column of PERSON_COLUMNS_NOT_IMPORTED) report.notImportedField(`workers.${column}`);

  // -------------------------------------------------------------------------------------------
  // Promotions and brands

  const promotions = new Map<number, PromotionInfo>();
  const shortNames = new Set<string>();
  for (const row of rows(tables, 'promotions')) {
    const promotionId = id(row, 'promotionID');
    const fullName = text(row, 'fullName');
    if (promotionId === null || fullName === null) continue;
    const example = `promotions#${String(promotionId)}`;
    const debut = date(row, 'debutDate');
    const foundedYear = int(row, 'founded');
    const foundedFromYear =
      foundedYear === null ? null : `${String(foundedYear).padStart(4, '0')}-01-01`;
    const statusText = (text(row, 'status') ?? 'Active').toLowerCase();
    let status: 'active' | 'closed';
    if (statusText === 'active') {
      status = 'active';
    } else if (statusText === 'inactive') {
      if (debut !== null && isAfter(debut, start)) {
        report.warn(
          'future-promotion',
          'A promotion that only opens after the start date was left out',
          example,
        );
        continue;
      }
      status = 'closed';
    } else {
      unknown('promotion-status', statusText, 'active', example);
      status = 'active';
    }
    let foundedOn: GameDate =
      debut ?? (foundedFromYear !== null && isGameDate(foundedFromYear) ? foundedFromYear : start);
    if (isAfter(foundedOn, start)) foundedOn = start;

    let shortName = (text(row, 'shortName') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (shortName.length < 2) {
      shortName = fullName
        .split(/\s+/)
        .map((word) => word.charAt(0))
        .join('')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
    }
    shortName = shortName.padEnd(2, 'X').slice(0, 8);
    for (let suffix = 2; shortNames.has(shortName); suffix += 1) {
      shortName = `${shortName.slice(0, 7 - String(suffix).length)}${String(suffix)}`.slice(0, 8);
    }
    shortNames.add(shortName);

    const styleText = text(row, 'style');
    let style = lookup(PROMOTION_STYLES, styleText ?? '');
    if (style === undefined) {
      unknown('promotion-style', styleText, 'mainstream', example);
      style = 'mainstream';
    }
    const prestige = round1(clamp(num(row, 'prestige') ?? 0, 0, 100));
    const levelColumns = {
      stage: 'prodStageQuality',
      camera: 'prodCamera',
      editing: 'prodEditing',
      pyro: 'prodPyro',
      music: 'prodMusic',
      writing: 'prodWriting',
      marketing: 'prodMarketing',
      backOffice: 'prodBackOffice',
    } as const;
    const production: Record<string, number> = {};
    let anyLevel = false;
    for (const [area, column] of Object.entries(levelColumns)) {
      const level = clamp(int(row, column) ?? 0, 0, 10);
      production[area] = level;
      if (level > 0) anyLevel = true;
    }
    if (!anyLevel) {
      // Mods usually leave production at 0 ("not set"): derive it from prestige instead.
      for (const area of Object.keys(levelColumns))
        production[area] = clamp(Math.round(prestige / 10), 0, 10);
    }
    const policyText = (column: string): number | undefined =>
      lookup(POLICY_TIERS, text(row, column) ?? 'none');
    const catering = policyText('catering');
    const travel = policyText('travelExpenses');
    const medical = policyText('medicalExpenses');
    const derivedTier = prestige >= 70 ? 2 : prestige >= 40 ? 1 : 0;
    const allUnset = (catering ?? 0) === 0 && (travel ?? 0) === 0 && (medical ?? 0) === 0;
    const policies = allUnset
      ? { catering: derivedTier, travel: derivedTier, medical: derivedTier }
      : { catering: catering ?? 0, travel: travel ?? 0, medical: medical ?? 0 };

    const continentPop: Record<string, number> = {};
    for (const [continentKey, column] of CONTINENT_POP_COLUMNS) {
      continentPop[continentKey] = clamp(num(row, column) ?? 0, 0, 100);
    }
    const key = `wm-p${String(promotionId)}`;
    const record: Rec = {
      key,
      name: cut(fullName, 60),
      shortName,
      ...withPicture('logoRef', 'logos', text(row, 'logo')),
      foundedOn,
      status,
      homeRegionKey: regionFor(row, 'basedInRegion', 'basedInCountry', 'basedIn', example),
      regionalPop: {},
      prestige,
      cash: clamp(int(row, 'money') ?? 0, -1_000_000_000, 1_000_000_000),
      style,
      ownerPersonKey: null,
      bookerPersonKey: null,
      parentPromotionKey: null,
      production,
      policies,
      color: PALETTE[promotionId % PALETTE.length] ?? '#1d4ed8',
    };
    promotions.set(promotionId, { key, foundedOn, record, continentPop });
  }
  // Owners, bookers and parents, once every promotion and person is known.
  for (const row of rows(tables, 'promotions')) {
    const promotionId = id(row, 'promotionID');
    const info = promotionId === null ? undefined : promotions.get(promotionId);
    if (promotionId === null || info === undefined) continue;
    const owner = people.get(id(row, 'owner') ?? -1);
    if (owner !== undefined) info.record['ownerPersonKey'] = owner.key;
    const booker = people.get(id(row, 'booker') ?? -1);
    if (booker !== undefined) info.record['bookerPersonKey'] = booker.key;
    const parentId = id(row, 'parentPromotion');
    const parent =
      parentId === null || parentId === promotionId ? undefined : promotions.get(parentId);
    if (parent !== undefined) info.record['parentPromotionKey'] = parent.key;
  }
  report.notImportedField(
    'promotions: description, risk, announcers, drug testing, era and product settings, ratios, touring, ace and prospects',
  );

  const brands = new Map<number, string>();
  const brandRecords: Rec[] = [];
  const brandOrder = new Map<string, number>();
  for (const row of rows(tables, 'brands')) {
    const brandId = id(row, 'brandID');
    const brandName = text(row, 'brandName');
    const promotion = promotions.get(id(row, 'promotionID') ?? -1);
    if (brandId === null || brandName === null) continue;
    if (promotion === undefined) {
      report.warn(
        'brand-without-promotion',
        'A brand of a promotion that was not imported was left out',
        `brands#${String(brandId)}`,
      );
      continue;
    }
    const used = brandOrder.get(promotion.key) ?? 0;
    brandOrder.set(promotion.key, used + 1);
    const key = `wm-b${String(brandId)}`;
    brands.set(brandId, key);
    brandRecords.push({
      key,
      promotionKey: promotion.key,
      name: cut(brandName, 40),
      ...withPicture('logoRef', 'logos', text(row, 'brandLogo')),
      priority: used,
      active: true,
    });
  }
  const brandKey = (row: ModRow, column: string): string | null =>
    brands.get(id(row, column) ?? -1) ?? null;

  // -------------------------------------------------------------------------------------------
  // Titles and their reigns

  const historyByTitle = new Map<number, ModRow[]>();
  for (const row of rows(tables, 'titlehistory')) {
    const titleId = id(row, 'titleID');
    if (titleId === null) continue;
    const list = historyByTitle.get(titleId) ?? [];
    list.push(row);
    historyByTitle.set(titleId, list);
  }
  const titleRecords: Rec[] = [];
  const reignRecords: Rec[] = [];
  for (const row of rows(tables, 'titles')) {
    const titleId = id(row, 'titleID');
    const name = text(row, 'name');
    if (titleId === null || name === null) continue;
    const example = `titles#${String(titleId)}`;
    const promotion = promotions.get(id(row, 'promotionID') ?? -1);
    if (promotion === undefined) {
      report.warn(
        'title-without-promotion',
        'A title of a promotion that was not imported was left out',
        example,
      );
      continue;
    }
    const history = [...(historyByTitle.get(titleId) ?? [])]
      .filter((entry) => date(entry, 'won') !== null)
      .sort(
        (left, right) =>
          compareDates(date(left, 'won') ?? start, date(right, 'won') ?? start) ||
          (id(left, 'titleHistoryID') ?? 0) - (id(right, 'titleHistoryID') ?? 0),
      );
    let introducedOn = date(row, 'created');
    const firstWon = history[0] === undefined ? null : date(history[0], 'won');
    if (firstWon !== null)
      introducedOn = introducedOn === null ? firstWon : earlierOf(introducedOn, firstWon);
    introducedOn ??= promotion.foundedOn;
    if (isAfter(introducedOn, start)) {
      report.warn('future-title', 'A title introduced after the start date was left out', example);
      continue;
    }
    const typeText = (text(row, 'type') ?? 'Singles').toLowerCase();
    let holderCount: 1 | 2 | 3;
    if (typeText === 'singles') holderCount = 1;
    else if (typeText === 'tag') holderCount = 2;
    else if (typeText === 'trios') holderCount = 3;
    else {
      unknown('title-type', typeText, 'singles', example);
      holderCount = 1;
    }
    const genderText = (text(row, 'genderLimits') ?? '').toLowerCase();
    const divisionGender =
      genderText === 'men' || genderText === 'male'
        ? 'male'
        : genderText === 'women' || genderText === 'female'
          ? 'female'
          : 'open';
    const maxWeight = lookup(TITLE_WEIGHT_LIMITS_KG, text(row, 'weightLimits') ?? '') ?? null;
    const minWeight = lookup(TITLE_WEIGHT_LIMITS_KG, text(row, 'minWeightLimit') ?? '') ?? null;
    const retired = flag(row, 'inactive');

    const key = `wm-t${String(titleId)}`;
    const reigns: Rec[] = [];
    let lastLost: GameDate | null = null;
    for (const entry of history) {
      const historyId = id(entry, 'titleHistoryID');
      const entryExample = `titlehistory#${String(historyId ?? 0)}`;
      const wonOn = date(entry, 'won');
      let lostOn = date(entry, 'lost');
      if (wonOn === null || isAfter(wonOn, start)) continue;
      if (lostOn === null || isAfter(lostOn, start)) lostOn = start;
      if (compareDates(lostOn, wonOn) < 0) {
        report.warn(
          'reign-ends-before-start',
          'A reign that ends before it starts was left out',
          entryExample,
        );
        continue;
      }
      if (lastLost !== null && compareDates(wonOn, lastLost) < 0) {
        report.warn(
          'overlapping-reign',
          'A reign that overlaps the one before it was left out',
          entryExample,
        );
        continue;
      }
      const holders = ['workerID1', 'workerID2', 'workerID3']
        .map((column) => id(entry, column))
        .filter((workerId): workerId is number => workerId !== null);
      const holderKeys = [...new Set(holders.map((workerId) => people.get(workerId)?.key))];
      if (holderKeys.some((holderKey) => holderKey === undefined) || holderKeys.length === 0) {
        report.warn(
          'reign-holder-missing',
          'A reign whose holder was not imported was left out',
          entryExample,
        );
        continue;
      }
      if (holderKeys.length !== holderCount) {
        report.warn(
          'reign-holder-count',
          'A reign with the wrong number of holders for its title was left out',
          entryExample,
        );
        continue;
      }
      reigns.push({
        key: `wm-th${String(historyId ?? reigns.length)}`,
        titleKey: key,
        holderPersonKeys: holderKeys,
        teamKey: null,
        wonOn,
        lostOn,
        endReason: 'lost',
        defences: Math.max(0, int(entry, 'defences') ?? 0),
      });
      lastLost = lostOn;
    }
    let retiredOn: GameDate | null = null;
    if (retired) {
      retiredOn = lastLost === null ? introducedOn : laterOf(lastLost, introducedOn);
    } else {
      const champions = ['currentChampion', 'currentChampion2', 'currentChampion3']
        .map((column) => id(row, column))
        .filter((workerId): workerId is number => workerId !== null);
      if (champions.length > 0) {
        const holderKeys = [...new Set(champions.map((workerId) => people.get(workerId)?.key))];
        let wonOn = date(row, 'won') ?? lastLost ?? introducedOn;
        if (lastLost !== null && compareDates(wonOn, lastLost) < 0) wonOn = lastLost;
        if (isAfter(wonOn, start)) wonOn = start;
        if (holderKeys.some((holderKey) => holderKey === undefined)) {
          report.warn(
            'champion-missing',
            'A current champion who was not imported was left out; the title starts vacant',
            example,
          );
        } else if (holderKeys.length !== holderCount) {
          report.warn(
            'reign-holder-count',
            'A reign with the wrong number of holders for its title was left out',
            example,
          );
        } else {
          reigns.push({
            key: `${key}-current`,
            titleKey: key,
            holderPersonKeys: holderKeys,
            teamKey: null,
            wonOn,
            lostOn: null,
            endReason: null,
            defences: Math.max(0, int(row, 'defences') ?? 0),
          });
        }
      }
    }
    titleRecords.push({
      key,
      promotionKey: promotion.key,
      brandKey: brandKey(row, 'brand'),
      name: cut(name, 60),
      holderCount,
      division: { gender: divisionGender, minWeightKg: minWeight, maxWeightKg: maxWeight },
      prestige: round1(clamp(num(row, 'prestige') ?? 0, 0, 100)),
      status: retired ? 'retired' : 'active',
      introducedOn,
      retiredOn,
      ...withPicture('imageRef', 'titles', text(row, 'titleImage')),
      color: PALETTE[(titleId * 7) % PALETTE.length] ?? '#a16207',
    });
    for (const reign of reigns) {
      reign['endReason'] = reign['lostOn'] === null ? null : 'lost';
      reignRecords.push(reign);
    }
  }
  report.notImportedField(
    'titles: defendable, alwaysDefend, minPush/maxPush; titlehistory.namesAtTheTime (rebuilt from ring names)',
  );

  // -------------------------------------------------------------------------------------------
  // Teams

  const teamNames = new Map<number, string>();
  for (const row of rows(tables, 'promotiontagteams')) {
    const tagId = id(row, 'tagID');
    const tagName = text(row, 'tagName');
    if (tagId !== null && tagName !== null && !teamNames.has(tagId)) teamNames.set(tagId, tagName);
  }
  const teamRecords: Rec[] = [];
  for (const row of rows(tables, 'tagteams')) {
    const tagId = id(row, 'tagID');
    if (tagId === null) continue;
    const example = `tagteams#${String(tagId)}`;
    const first = people.get(id(row, 'worker1') ?? -1);
    const second = people.get(id(row, 'worker2') ?? -1);
    if (first === undefined || second === undefined || first.key === second.key) {
      report.warn(
        'team-member-missing',
        'A tag team with a member who was not imported was left out',
        example,
      );
      continue;
    }
    const debuts = [first.debutDate, second.debutDate].filter(
      (value): value is GameDate => value !== null && !isAfter(value, start),
    );
    const formedOn = debuts.length === 0 ? start : debuts.reduce(laterOf);
    let status: 'active' | 'inactive' = (int(row, 'tagStatus') ?? 1) === 1 ? 'active' : 'inactive';
    if (
      status === 'active' &&
      (first.record['status'] === 'deceased' || second.record['status'] === 'deceased')
    ) {
      // The engine keeps no active team with a member who has died.
      report.warn(
        'team-member-deceased',
        'An active tag team with a member who has died was imported as inactive',
        example,
      );
      status = 'inactive';
    }
    teamRecords.push({
      key: `wm-tt${String(tagId)}`,
      kind: 'tag',
      name: cut(
        text(row, 'defaultName') ??
          teamNames.get(tagId) ??
          `${first.ringName} & ${second.ringName}`,
        60,
      ),
      memberKeys: [first.key, second.key],
      formedOn,
      experience: round1(clamp(num(row, 'tagExperience') ?? 0, 0, 100)),
      status,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Venues

  const venues = new Map<number, string>();
  const venueRecords: Rec[] = [];
  for (const row of rows(tables, 'venues')) {
    const venueId = id(row, 'venueID');
    const name = text(row, 'venueName');
    if (venueId === null || name === null) continue;
    const example = `venues#${String(venueId)}`;
    const openedOn = date(row, 'openDate');
    const closedOn = date(row, 'closeDate');
    if (openedOn !== null && isAfter(openedOn, start)) {
      report.warn('future-venue', 'A venue that opens after the start date was left out', example);
      continue;
    }
    if (closedOn !== null && !isAfter(closedOn, start)) {
      report.warn('closed-venue', 'A venue closed before the start date was left out', example);
      continue;
    }
    const capacity = clamp(int(row, 'capacity') ?? 1000, 1, 200_000);
    const key = `wm-v${String(venueId)}`;
    venues.set(venueId, key);
    venueRecords.push({
      key,
      regionKey: regionFor(row, 'region', 'country', 'continent', example),
      name: cut(name, 80),
      capacity,
      kind: venueKind(text(row, 'type'), capacity),
      openedOn,
      closedOn:
        closedOn !== null && openedOn !== null && compareDates(closedOn, openedOn) <= 0
          ? null
          : closedOn,
      exclusivePromotionKey: promotions.get(id(row, 'promotionExclusivity') ?? -1)?.key ?? null,
      ...withPicture('imageRef', 'venues', text(row, 'venueImage')),
    });
  }
  report.notImportedField('venues: description, wrestlingPopularity, preferredStyle');

  // -------------------------------------------------------------------------------------------
  // Networks (before events, which need to know which shows have a TV deal)

  const coverageRows = new Map<number, ModRow[]>();
  for (const row of rows(tables, 'networkAvailability')) {
    const networkId = id(row, 'networkID');
    if (networkId === null) continue;
    const list = coverageRows.get(networkId) ?? [];
    list.push(row);
    coverageRows.set(networkId, list);
  }
  const networks = new Map<number, { key: string; active: boolean; row: ModRow }>();
  for (const row of rows(tables, 'networks')) {
    const networkId = id(row, 'networkID');
    const name = text(row, 'name');
    if (networkId === null || name === null) continue;
    const launchedOn = date(row, 'openDate');
    if (launchedOn !== null && isAfter(launchedOn, start)) {
      report.warn(
        'future-network',
        'A network that launches after the start date was left out',
        `networks#${String(networkId)}`,
      );
      continue;
    }
    networks.set(networkId, {
      key: `wm-n${String(networkId)}`,
      active: (int(row, 'status') ?? 1) !== 0,
      row,
    });
  }

  const liveDeals: ModRow[] = [];
  const televisedEvents = new Set<number>();
  for (const row of rows(tables, 'networkDeals')) {
    const dealId = id(row, 'dealID') ?? 0;
    const example = `networkDeals#${String(dealId)}`;
    const network = networks.get(id(row, 'networkID') ?? -1);
    const promotion = promotions.get(id(row, 'promotionID') ?? -1);
    const endsOn = date(row, 'expirationDate');
    if (network === undefined || !network.active || promotion === undefined) {
      report.warn(
        'deal-party-missing',
        'A TV deal whose network or promotion is not in the world was left out',
        example,
      );
      continue;
    }
    if (endsOn === null || !isAfter(endsOn, start)) {
      report.warn(
        'expired-deal',
        'A TV deal that ended before the start date was left out',
        example,
      );
      continue;
    }
    if ((int(row, 'status') ?? 1) === 0) {
      report.warn('inactive-deal', 'An inactive TV deal was left out', example);
      continue;
    }
    liveDeals.push(row);
    const eventId = id(row, 'eventID');
    if (eventId !== null) televisedEvents.add(eventId);
  }

  // -------------------------------------------------------------------------------------------
  // Event definitions

  const datesByEvent = new Map<number, GameDate[]>();
  for (const row of rows(tables, 'eventDates')) {
    const eventId = id(row, 'eventID');
    const day = date(row, 'date');
    if (eventId === null || day === null || compareDates(day, start) < 0) continue;
    const list = datesByEvent.get(eventId) ?? [];
    list.push(day);
    datesByEvent.set(eventId, list);
  }
  const events = new Map<number, string>();
  const eventRecords: Rec[] = [];
  for (const row of rows(tables, 'events')) {
    const eventId = id(row, 'eventID');
    const name = text(row, 'eventName');
    if (eventId === null || name === null) continue;
    const example = `events#${String(eventId)}`;
    const promotion = promotions.get(id(row, 'promotionID') ?? -1);
    if (promotion === undefined) {
      report.warn(
        'event-without-promotion',
        'A show of a promotion that was not imported was left out',
        example,
      );
      continue;
    }
    if (flag(row, 'inactive')) {
      report.warn('inactive-event', 'An inactive show was left out', example);
      continue;
    }
    const importanceText = text(row, 'importance');
    let importance = lookup(EVENT_IMPORTANCES, importanceText ?? '');
    if (importance === undefined) {
      unknown('event-importance', importanceText, 'regular', example);
      importance = 'regular';
    }
    const weekdays = WEEKDAY_COLUMNS.flatMap((column, index) => (flag(row, column) ? [index] : []));
    const firstWeekday = weekdays[0] ?? 5;
    const weekNumber = int(row, 'recurrenceWeek') ?? 1;
    const week = weekNumber >= 5 ? 'last' : clamp(weekNumber, 1, 4);
    const recurrenceText = (text(row, 'recurrenceType') ?? '').toLowerCase();
    let recurrence: Rec;
    if (recurrenceText === 'weekly') {
      if (weekdays.length === 0) {
        report.warn(
          'weekly-without-day',
          'A weekly show with no weekday set runs on Saturdays',
          example,
        );
      }
      recurrence = { kind: 'weekly', weekdays: weekdays.length === 0 ? [5] : weekdays };
    } else if (recurrenceText === 'monthly') {
      recurrence = { kind: 'monthly', week, weekday: firstWeekday };
    } else if (recurrenceText === 'annual') {
      recurrence = {
        kind: 'annual',
        month: clamp(int(row, 'recurrenceMonth') ?? 1, 1, 12),
        week,
        weekday: firstWeekday,
      };
    } else if (recurrenceText === 'specific' || recurrenceText === 'tour') {
      const dates = [...new Set(datesByEvent.get(eventId) ?? [])]
        .sort(compareDates)
        .slice(0, MAX_RECURRENCE_DATES);
      if (dates.length === 0) {
        report.warn(
          'no-future-dates',
          'A one-off show or tour with no dates on or after the start date was left out',
          example,
        );
        continue;
      }
      recurrence = { kind: 'dates', dates };
    } else {
      report.warn(
        'unknown-recurrence',
        `A show with an unknown schedule ("${recurrenceText}") was left out`,
        example,
      );
      continue;
    }
    const hasPreferred =
      id(row, 'preferredRegion') !== null ||
      id(row, 'preferredCountry') !== null ||
      text(row, 'preferredContinent') !== null;
    const key = `wm-e${String(eventId)}`;
    events.set(eventId, key);
    eventRecords.push({
      key,
      promotionKey: promotion.key,
      brandKey: brandKey(row, 'brand'),
      name: cut(name, 60),
      importance,
      recurrence,
      format: SHOW_FORMATS[importance],
      televised: televisedEvents.has(eventId),
      preferredRegionKey: hasPreferred
        ? geography.resolveRegion(
            id(row, 'preferredRegion'),
            id(row, 'preferredCountry'),
            text(row, 'preferredContinent'),
          )
        : null,
      preferredVenueKey: venues.get(id(row, 'preferredVenue') ?? -1) ?? null,
      activeFrom: promotion.foundedOn,
      activeUntil: null,
      ...withPicture('logoRef', 'events', text(row, 'logo')),
    });
  }
  report.notImportedField(
    'events: prestige, required match types and titles, announcers, regional distribution and timeslots, length, AI logic',
  );

  // Networks are written now: their coverage may name countries other records brought in.
  const networkRecords: Rec[] = [];
  for (const [networkId, network] of [...networks.entries()].sort(
    ([left], [right]) => left - right,
  )) {
    const { row } = network;
    const example = `networks#${String(networkId)}`;
    const continentKeys = new Set<string>();
    const countryKeys = new Set<string>();
    const regionKeys = new Set<string>();
    for (const coverage of coverageRows.get(networkId) ?? []) {
      const continentKey = geography.continentKey(text(coverage, 'continent'));
      if (continentKey !== null) continentKeys.add(continentKey);
      const countryId = id(coverage, 'countryID');
      const countryKey = countryId === null ? null : geography.coverageCountry(countryId);
      if (countryKey !== null) countryKeys.add(countryKey);
      const regionId = id(coverage, 'regionID');
      const regionKey = regionId === null ? null : geography.coverageRegion(regionId);
      if (regionKey !== null) regionKeys.add(regionKey);
    }
    if (continentKeys.size + countryKeys.size + regionKeys.size === 0) {
      report.warn(
        'network-without-coverage',
        'A network covering nowhere in the world was given worldwide coverage',
        example,
      );
      for (const [continentKey] of CONTINENT_POP_COLUMNS) continentKeys.add(continentKey);
    }
    const kindText = text(row, 'type');
    let kind = lookup(NETWORK_KINDS, kindText ?? '');
    if (kind === undefined) {
      unknown('network-type', kindText, 'tv', example);
      kind = 'tv';
    }
    networkRecords.push({
      key: network.key,
      name: cut(text(row, 'name') ?? 'Network', 60),
      kind,
      reachTier: clamp(int(row, 'size') ?? 1, 0, 4),
      coverage: {
        continentKeys: [...continentKeys].sort(),
        countryKeys: [...countryKeys].sort(),
        regionKeys: [...regionKeys].sort(),
      },
      ownerPromotionKey: null,
      status: network.active ? 'active' : 'closed',
      launchedOn: date(row, 'openDate') ?? addYears(start, -10),
      ...withPicture('logoRef', 'network', text(row, 'logo')),
    });
  }
  report.notImportedField('networks: model, payment, library');

  const dealRecords: Rec[] = [];
  for (const row of liveDeals) {
    const dealId = id(row, 'dealID') ?? dealRecords.length;
    const network = networks.get(id(row, 'networkID') ?? -1);
    const promotion = promotions.get(id(row, 'promotionID') ?? -1);
    const endsOn = date(row, 'expirationDate');
    if (network === undefined || promotion === undefined || endsOn === null) continue;
    let startsOn = date(row, 'startDate') ?? start;
    if (isAfter(startsOn, start)) startsOn = start;
    const timeslotText = text(row, 'timeslot');
    let timeslot = lookup(TIMESLOTS, timeslotText ?? '');
    if (timeslot === undefined) {
      unknown('timeslot', timeslotText, 'evening', `networkDeals#${String(dealId)}`);
      timeslot = 'evening';
    }
    dealRecords.push({
      key: `wm-d${String(dealId)}`,
      promotionKey: promotion.key,
      networkKey: network.key,
      eventDefinitionKey: events.get(id(row, 'eventID') ?? -1) ?? null,
      startsOn,
      endsOn,
      timeslot,
      weekday: lookup(WEEKDAYS, text(row, 'airday') ?? '') ?? null,
      live: flag(row, 'isLive'),
      terms: {
        feePerShow: Math.max(0, int(row, 'incomePerShow') ?? 0),
        perThousandViewers: Math.max(0, int(row, 'incomePerViewer') ?? 0),
        costPerShow: Math.max(0, int(row, 'costPerShow') ?? 0),
      },
    });
  }

  // -------------------------------------------------------------------------------------------
  // Employments

  const employmentRecords: Rec[] = [];
  const personPromotionPairs = new Set<string>();
  const contractRows = [...rows(tables, 'contracts')].sort(
    (left, right) => (id(left, 'contractID') ?? 0) - (id(right, 'contractID') ?? 0),
  );
  for (const row of contractRows) {
    const contractId = id(row, 'contractID');
    if (contractId === null) continue;
    const example = `contracts#${String(contractId)}`;
    const person = people.get(id(row, 'workerID') ?? -1);
    const promotion = promotions.get(id(row, 'promotionID') ?? -1);
    if (person === undefined || promotion === undefined) {
      report.warn(
        'contract-party-missing',
        'A contract whose person or promotion was not imported was left out',
        example,
      );
      continue;
    }
    if (promotion.record['status'] !== 'active') {
      report.warn(
        'contract-closed-promotion',
        'A contract with a closed promotion was left out',
        example,
      );
      continue;
    }
    const personRole = person.roles[0] ?? 'wrestler';
    const role = personRole === 'occasionalWrestler' ? 'wrestler' : personRole;
    const alignment = lookup(ALIGNMENTS, text(row, 'role') ?? '') ?? 'tweener';
    const pushText = text(row, 'push');
    let push = lookup(PUSHES, pushText ?? '');
    if (push === undefined) {
      unknown('push', pushText, 'midCard', example);
      push = 'midCard';
    }
    if (role !== 'wrestler') push = 'none';
    else if (push === 'none') push = 'lowerCard';

    const kind = flag(row, 'isDevelopment')
      ? 'development'
      : flag(row, 'isTourContract')
        ? 'tour'
        : (text(row, 'contractType') ?? '').toUpperCase() === 'PPA'
          ? 'perAppearance'
          : 'written';
    // The engine allows one live contract per person and promotion: the first one wins.
    const pairKey = `${person.key}|${promotion.key}`;
    if (personPromotionPairs.has(pairKey)) {
      report.warn(
        'duplicate-contract',
        'A second contract between the same person and promotion was left out',
        example,
      );
      continue;
    }
    personPromotionPairs.add(pairKey);
    const exclusive = flag(row, 'exclusive');
    let startsOn = date(row, 'contractStartDate') ?? start;
    if (isAfter(startsOn, start)) startsOn = start;
    const expiryText = text(row, 'expiryDate');
    let endsOn = date(row, 'expiryDate');
    if (endsOn === null && expiryText !== null && expiryText.toLowerCase() !== 'no expiry') {
      unknown('expiry-date', expiryText, 'no expiry', example);
    }
    if (endsOn !== null && !isAfter(endsOn, start)) {
      report.warn(
        'expired-contract-extended',
        'A contract that had already run out was extended by four weeks',
        example,
      );
      endsOn = addDays(start, 28);
    }
    const share = (column: string): number =>
      clamp(Math.round((num(row, column) ?? 0) * 100), 0, 10_000);
    const cap = int(row, 'maxAppearancesPerYear');
    const manager = people.get(id(row, 'manager') ?? -1);
    const moraleValue = int(row, 'morale');
    employmentRecords.push({
      key: `wm-k${String(contractId)}`,
      personKey: person.key,
      promotionKey: promotion.key,
      brandKey: brandKey(row, 'brand'),
      managerPersonKey: manager !== undefined && manager.key !== person.key ? manager.key : null,
      role,
      ringName: cut(
        text(row, 'contractName') ?? text(row, 'gimmickNameOverride') ?? person.ringName,
        60,
      ),
      alignment,
      push,
      terms: {
        kind,
        exclusive,
        monthlyWage: kind === 'perAppearance' ? 0 : Math.max(0, int(row, 'wagePerMonth') ?? 0),
        perAppearanceFee: Math.max(0, int(row, 'wagePerAppearance') ?? 0),
        signingBonus: Math.max(0, int(row, 'signingBonus') ?? 0),
        shares: {
          gateBp: share('gatePercentPerAppearance'),
          merchBp: share('merchPercentPerAppearance'),
          broadcastBp: share('ppvPercentPerAppearance'),
        },
        appearanceCap: cap !== null && cap > 0 ? cap : null,
        perks: {
          creativeControl: flag(row, 'creativeControl'),
          noHouseShows: flag(row, 'noHouseShows'),
          ironClad: flag(row, 'ironCladContract'),
          travelCovered: flag(row, 'travelExpenses'),
        },
      },
      startsOn,
      endsOn,
      ...(moraleValue !== null && moraleValue !== 0
        ? { morale: clamp((moraleValue - 50) * 2, -100, 100) }
        : {}),
    });
  }
  // An exclusive contract must be its person's only contract. A person the mod gives an exclusive
  // contract and other contracts keeps all of them, made non-exclusive.
  const contractsPerPerson = new Map<unknown, number>();
  for (const record of employmentRecords) {
    contractsPerPerson.set(
      record['personKey'],
      (contractsPerPerson.get(record['personKey']) ?? 0) + 1,
    );
  }
  for (const record of employmentRecords) {
    const terms: unknown = record['terms'];
    if (
      typeof terms !== 'object' ||
      terms === null ||
      Reflect.get(terms, 'exclusive') !== true ||
      (contractsPerPerson.get(record['personKey']) ?? 0) < 2
    ) {
      continue;
    }
    Reflect.set(terms, 'exclusive', false);
    report.warn(
      'exclusive-alongside-other-contracts',
      'An exclusive contract held alongside other contracts was made non-exclusive',
      `contracts#${String(record['key']).slice('wm-k'.length)}`,
    );
  }
  report.notImportedField(
    'contracts: gimmick, hasMask, hiringVeto, wageMatching, planned turns and gimmicks, momentum, entrance, indy bookings',
  );

  // -------------------------------------------------------------------------------------------
  // Geography and popularity

  const geographyRecords = geography.finish();
  const mapRegions = geography.mapRegions();
  const spread = (continentPop: Readonly<Record<string, number>>): Record<string, number> => {
    const popularity: Record<string, number> = {};
    for (const region of mapRegions) {
      const value = round1(continentPop[region.continentKey] ?? 0);
      if (value >= MIN_REGIONAL_POP) popularity[region.key] = value;
    }
    return popularity;
  };
  const personRecords = [...people.values()].map((person) => ({
    ...person.record,
    regionalPop: spread(person.continentPop),
  }));
  const promotionRecords = [...promotions.values()].map((promotion) => ({
    ...promotion.record,
    regionalPop: spread(promotion.continentPop),
  }));

  for (const name of STATE_TABLES) {
    const count = rows(tables, name).length;
    if (count > 0) report.notImportedField(`${name}: ${String(count)} rows of saved-game state`);
  }
  for (const name of TABLES_NOT_IMPORTED) {
    const count = rows(tables, name).length;
    if (count > 0)
      report.notImportedField(`${name}: ${String(count)} rows (no engine equivalent yet)`);
  }

  const records: readonly (readonly [RecordKind, Rec[]])[] = [
    ['country', geographyRecords.countries],
    ['region', geographyRecords.regions],
    ['person', personRecords],
    ['promotion', promotionRecords],
    ['brand', brandRecords],
    ['title', titleRecords],
    ['venue', venueRecords],
    ['network', networkRecords],
    ['eventDefinition', eventRecords],
    ['deal', dealRecords],
    ['employment', employmentRecords],
    ['team', teamRecords],
    ['titleReign', reignRecords],
  ];
  const files: Partial<Record<RecordKind, string>> = {};
  const packFiles: Partial<Record<RecordKind, unknown>> = {};
  counts['personDebutsLater'] = futureDebuts;
  for (const [kind, list] of records) {
    counts[kind] = list.length;
    if (list.length === 0) continue;
    const fileName = FILE_NAMES[kind];
    if (fileName === undefined) continue;
    files[kind] = fileName;
    packFiles[kind] = list;
  }
  if (people.size === 0) report.error('The mod has no people the game could import');
  if (promotions.size === 0) report.error('The mod has no promotions the game could import');
  if (report.errors.length > 0) return { ok: false, errors: report.errors, report: buildReport() };

  const description =
    (gameworld === undefined
      ? null
      : (text(gameworld, 'description') ?? text(gameworld, 'title'))) ?? '';
  const manifestInput = {
    formatVersion: 1,
    id: options.packId ?? worldModPackId(worldName),
    name: cut(worldName, 80),
    version: `${String(Math.max(0, databaseVersion ?? 0))}.0.0`,
    kind: 'world',
    description: cut(description, 2000),
    author: 'Workshop world mod',
    dependsOn: [{ id: 'base', version: `^${base.baseVersion}` }],
    startDate: start,
    files,
  };
  const parsed = packManifestSchema.safeParse(manifestInput);
  if (!parsed.success) {
    const [first] = parsed.error.issues;
    report.error(
      `The pack manifest is not valid: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
    );
    return { ok: false, errors: report.errors, report: buildReport() };
  }
  const manifest: PackManifest = parsed.data;
  return { ok: true, pack: { manifest, files: packFiles }, report: buildReport() };
}
