/**
 * Materialising a World: merged pack records turned into entities in a fresh, valid World.
 *
 * `materialiseWorld` runs after `resolvePacks` and `mergeRecords`:
 *
 * 1. checks every reference (`checkReferences`); any error stops here;
 * 2. creates an empty World with the seeded ID minter (SIM-02's `createIdMinter` over an
 *    `RngRegistry` seeded with `opts.seed`) installed as its ID factory;
 * 3. inside one transaction, mints an ID for every record in canonical order
 *    (`CANONICAL_KIND_ORDER`, keys sorted within a kind), so IDs are a pure function of the seed
 *    and the merged content;
 * 4. turns each record into its entity (keys to IDs, whole money units to cents, defaults filled
 *    in, computer controllers on promotions and null controllers on brands), parses it with the
 *    entity schema and inserts it;
 * 5. creates season 1, stores `contentKeys` on the metadata, and runs `checkWorld`. The match and
 *    segment catalogs (match types, angle types, methods, finishes, beats and angle templates)
 *    are snapshotted into `meta.catalogs`, and so is the injury catalog (WRK6-01).
 *
 * Any error rolls the whole transaction back and comes back as `PackIssue`s; no half-built World
 * ever escapes.
 *
 * IDs are minted with the same minter `tx.create` uses, in the same canonical order, but before the
 * rows are inserted with `tx.insert`. Some records point forward in that order (a promotion's owner
 * is a person, regions list each other as neighbours), so every ID has to exist before the first
 * row is built. Minting first draws exactly the IDs that `tx.create` would have drawn row by row.
 *
 * Format doc: docs/design/data-packs.md, "Loading".
 */

import type { z } from 'zod';
import { addDays, compareDates, yearMonthOf, type GameDate } from '../../core/date';
import { InvalidArgumentError } from '../../core/errors';
import type { ContinentId, CountryId, EntityKind, IdOf, RegionId, VenueId } from '../../core/ids';
import { fromWhole } from '../../core/money';
import { createIdMinter, type IdMinter } from '../../core/rng/ids';
import { RngRegistry } from '../../core/rng/registry';
import type { Brand } from '../../model/entities/brand';
import type { Deal } from '../../model/entities/deal';
import type { Employment } from '../../model/entities/employment';
import type { EventDefinition } from '../../model/entities/event-definition';
import type { Continent, Country, Region } from '../../model/entities/geography';
import type { Network } from '../../model/entities/network';
import type { Person } from '../../model/entities/person';
import type { Promotion } from '../../model/entities/promotion';
import type { Team } from '../../model/entities/team';
import type { Title } from '../../model/entities/title';
import type { TitleReign } from '../../model/entities/title-reign';
import type { Venue } from '../../model/entities/venue';
import type { Catalogs } from '../../model/catalogs';
import { checkWorld } from '../../model/integrity';
import type { RowOf } from '../../model/table-def';
import { TABLES, type GameTables, type GameWorld } from '../../model/tables';
import type { TableKey, Tx } from '../../model/tx';
import { createWorld } from '../../model/world';
import {
  WorldMetaSchema,
  WorldSettingsSchema,
  type WorldMeta,
  type WorldSettings,
} from '../../model/world-meta';
import type { PackRecords } from './index';
import { hasErrors, packError, packWarning, type PackIssue, type Result } from './issues';
import { parseRef, type PackRef, type RecordKind } from './keys';
import type { MergedContent, MergedRecord, MergedRecords } from './merge';
import { catalogsFromRecords } from './records/catalogs';
import { injuryCatalogFromRecords } from './records/health';
import type { ContractTermsRecord, TitleReignRecord } from './records/people';
import { checkReferences, refKey } from './references';

/** Default season length: 52 weeks. */
export const DEFAULT_SEASON_LENGTH_DAYS = 364;

/**
 * The settings a loaded world gets for anything `opts.settings` leaves out: aging on, sandbox off,
 * generation `low`, level playing field off, 364-day seasons, no extra settings.
 */
export const DEFAULT_WORLD_SETTINGS: WorldSettings = Object.freeze({
  agingEnabled: true,
  sandbox: false,
  generationLevel: 'low',
  levelPlayingField: false,
  season: Object.freeze({ lengthDays: DEFAULT_SEASON_LENGTH_DAYS }),
  extra: Object.freeze({}),
});

/**
 * The order IDs are minted in: kinds in this order, records within a kind by key. Changing it
 * changes every ID a seed produces, so it is fixed; new kinds go at the end.
 */
export const CANONICAL_KIND_ORDER = [
  'continent',
  'country',
  'region',
  'promotion',
  'brand',
  'venue',
  'network',
  'title',
  'person',
  'employment',
  'team',
  'eventDefinition',
  'deal',
  'titleReign',
] as const satisfies readonly (RecordKind & EntityKind)[];

/** A record kind that becomes a World entity. The other kinds go into the content library. */
export type EntityRecordKind = (typeof CANONICAL_KIND_ORDER)[number];

/** The table each entity record kind is stored in. */
export const TABLE_OF_KIND = {
  continent: 'continents',
  country: 'countries',
  region: 'regions',
  promotion: 'promotions',
  brand: 'brands',
  venue: 'venues',
  network: 'networks',
  title: 'titles',
  person: 'people',
  employment: 'employments',
  team: 'teams',
  eventDefinition: 'eventDefinitions',
  deal: 'deals',
  titleReign: 'titleReigns',
} as const satisfies Record<EntityRecordKind, TableKey<GameTables>>;

/** `contentKeys` on the world metadata: record kind → record key → minted ID. */
export type ContentKeys = Partial<Record<RecordKind, Record<string, string>>>;

export interface MaterialiseOptions {
  /** The game seed every RNG stream, and so every minted ID, comes from. */
  readonly seed: string;
  /** The first day of the game. */
  readonly startDate: GameDate;
  /** New-game settings; anything left out takes `DEFAULT_WORLD_SETTINGS`. */
  readonly settings?: Partial<WorldSettings>;
  /** The world's name; defaults to the last world pack's name, then `New World`. */
  readonly worldName?: string;
}

/** A freshly loaded world and the RNG registry its IDs were minted from. */
export interface MaterialisedWorld {
  readonly world: GameWorld;
  /**
   * The registry the world's ID minter draws from. It carries on from the loader's draws, so it is
   * saved with the world (`rng.toState()`) and installed on the day pipeline.
   */
  readonly rng: RngRegistry;
}

type KeyToId = { [Kind in EntityRecordKind]: Map<string, IdOf<Kind>> };

/** Where a minted ID came from, for turning integrity issues back into pack issues. */
interface IdSource {
  readonly kind: EntityRecordKind;
  readonly key: string;
  readonly merged: MergedRecord<unknown>;
}

type IssuePath = (string | number)[];

function zodPath(path: readonly PropertyKey[]): IssuePath {
  return path.map((segment) => (typeof segment === 'number' ? segment : String(segment)));
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Thrown inside the load transaction to roll it back once issues have been collected. */
class LoadAborted extends Error {
  constructor() {
    super('World load aborted; see the collected pack issues');
    this.name = 'LoadAborted';
  }
}

/** The runtime catalogs to snapshot: the match and segment catalogs plus the injury catalog. */
function catalogsWithInjuries(records: MergedRecords): Catalogs {
  const injuries = injuryCatalogFromRecords(records);
  return { ...catalogsFromRecords(records), ...(injuries === undefined ? {} : { injuries }) };
}

/** Fills in default settings and checks the result. A bad option is a caller bug, so it throws. */
export function resolveSettings(settings: Partial<WorldSettings> = {}): WorldSettings {
  const merged = {
    ...DEFAULT_WORLD_SETTINGS,
    ...settings,
    season: { ...DEFAULT_WORLD_SETTINGS.season, ...settings.season },
    extra: { ...DEFAULT_WORLD_SETTINGS.extra, ...settings.extra },
  };
  const parsed = WorldSettingsSchema.safeParse(merged);
  if (!parsed.success) {
    throw new InvalidArgumentError(
      'materialiseWorld',
      'opts.settings',
      JSON.stringify(settings),
      `valid world settings (${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')})`,
    );
  }
  return parsed.data;
}

/** Turns keys into minted IDs. References were checked first, so a miss is a loader bug. */
class KeyResolver {
  constructor(private readonly keyToId: KeyToId) {}

  id<Kind extends EntityRecordKind>(kind: Kind, ref: PackRef): IdOf<Kind> {
    return this.byKey(kind, parseRef(ref).key);
  }

  /** The ID minted for the record of `kind` with this bare key. */
  byKey<Kind extends EntityRecordKind>(kind: Kind, key: string): IdOf<Kind> {
    const id = this.keyToId[kind].get(key);
    if (id === undefined) {
      throw new InvalidArgumentError('KeyResolver.byKey', 'key', key, `a loaded ${kind} key`);
    }
    return id;
  }

  optional<Kind extends EntityRecordKind>(
    kind: Kind,
    ref: PackRef | null | undefined,
  ): IdOf<Kind> | null {
    return ref === null || ref === undefined ? null : this.id(kind, ref);
  }

  list<Kind extends EntityRecordKind>(kind: Kind, refs: readonly PackRef[]): IdOf<Kind>[] {
    return refs.map((ref) => this.id(kind, ref));
  }

  /** Sparse regional popularity keyed by region ID, in the record's order. */
  regionalPop(popularity: Readonly<Record<string, number>>): Record<RegionId, number> {
    const result: Record<RegionId, number> = {};
    for (const [regionRef, value] of Object.entries(popularity)) {
      const regionKey = refKey(regionRef);
      const regionId = regionKey === null ? undefined : this.keyToId.region.get(regionKey);
      if (regionId === undefined) {
        throw new InvalidArgumentError(
          'KeyResolver.regionalPop',
          'region',
          regionRef,
          'a region key',
        );
      }
      result[regionId] = value;
    }
    return result;
  }
}

// ---------------------------------------------------------------------------------------------
// Record → entity transforms

/** Everything a transform needs besides its own record. */
interface TransformContext {
  readonly resolve: KeyResolver;
  readonly records: MergedRecords;
  /** Regions that list a region as a neighbour without it listing them back, by region key. */
  readonly backNeighbours: ReadonlyMap<string, readonly string[]>;
  /** The world's first day: a promotion's monthly popularity tally starts in its month. */
  readonly startDate: GameDate;
}

function contractTerms(terms: ContractTermsRecord): Employment['terms'] {
  return {
    ...terms,
    monthlyWage: fromWhole(terms.monthlyWage),
    perAppearanceFee: fromWhole(terms.perAppearanceFee),
    signingBonus: fromWhole(terms.signingBonus),
  };
}

function toContinent(record: PackRecords['continent'], id: ContinentId): Continent {
  return { id, name: record.name, code: record.code };
}

function toCountry(
  record: PackRecords['country'],
  id: CountryId,
  { resolve }: TransformContext,
): Country {
  return {
    id,
    continentId: resolve.id('continent', record.continentKey),
    name: record.name,
    code: record.code,
    population: record.population,
    wrestlingInterest: record.wrestlingInterest,
    economy: record.economy,
    preferredStyle: record.preferredStyle,
  };
}

function toRegion(
  record: PackRecords['region'],
  id: RegionId,
  { resolve, records, backNeighbours }: TransformContext,
): Region {
  const country = records.country.get(parseRef(record.countryKey).key)?.record;
  if (country === undefined) {
    throw new InvalidArgumentError('toRegion', 'countryKey', record.countryKey, 'a loaded country');
  }
  const neighbourRegionIds = resolve.list('region', record.neighbourKeys);
  for (const backKey of backNeighbours.get(record.key) ?? []) {
    neighbourRegionIds.push(resolve.byKey('region', backKey));
  }
  return {
    id,
    countryId: resolve.id('country', record.countryKey),
    name: record.name,
    population: record.population,
    wrestlingInterest: record.wrestlingInterest ?? country.wrestlingInterest,
    preferredStyle:
      record.preferredStyle === undefined ? country.preferredStyle : record.preferredStyle,
    neighbourRegionIds,
  };
}

function toPromotion(
  record: PackRecords['promotion'],
  id: IdOf<'promotion'>,
  { resolve, startDate }: TransformContext,
): Promotion {
  return {
    id,
    name: record.name,
    shortName: record.shortName,
    logoRef: record.logoRef ?? null,
    foundedOn: record.foundedOn,
    status: record.status,
    homeRegionId: resolve.id('region', record.homeRegionKey),
    regionalPop: resolve.regionalPop(record.regionalPop),
    popularityGains: { month: yearMonthOf(startDate), byRegion: {} },
    prestige: record.prestige,
    cash: fromWhole(record.cash),
    style: record.style,
    ownerPersonId: resolve.optional('person', record.ownerPersonKey),
    bookerPersonId: resolve.optional('person', record.bookerPersonKey),
    parentPromotionId: resolve.optional('promotion', record.parentPromotionKey),
    production: record.production,
    policies: record.policies,
    color: record.color,
    // Who runs a promotion is a new-game choice (WLD-10); every promotion starts computer-run.
    controller: { kind: 'computer' },
    ledgerMonths: [],
  };
}

function toBrand(
  record: PackRecords['brand'],
  id: IdOf<'brand'>,
  { resolve }: TransformContext,
): Brand {
  return {
    id,
    promotionId: resolve.id('promotion', record.promotionKey),
    name: record.name,
    logoRef: record.logoRef ?? null,
    priority: record.priority,
    active: record.active,
    // Null: run by the promotion's controller until brand wars (D-06) assign one.
    controller: null,
  };
}

function toVenue(record: PackRecords['venue'], id: VenueId, { resolve }: TransformContext): Venue {
  return {
    id,
    name: record.name,
    regionId: resolve.id('region', record.regionKey),
    capacity: record.capacity,
    kind: record.kind,
    openedOn: record.openedOn ?? null,
    closedOn: record.closedOn ?? null,
    exclusivePromotionId: resolve.optional('promotion', record.exclusivePromotionKey),
    imageRef: record.imageRef ?? null,
  };
}

function toNetwork(
  record: PackRecords['network'],
  id: IdOf<'network'>,
  { resolve }: TransformContext,
): Network {
  return {
    id,
    name: record.name,
    kind: record.kind,
    reachTier: record.reachTier,
    coverage: {
      continentIds: resolve.list('continent', record.coverage.continentKeys),
      countryIds: resolve.list('country', record.coverage.countryKeys),
      regionIds: resolve.list('region', record.coverage.regionKeys),
    },
    ownerPromotionId: resolve.optional('promotion', record.ownerPromotionKey),
    status: record.status ?? 'active',
    launchedOn: record.launchedOn,
    closedOn: record.closedOn ?? null,
    logoRef: record.logoRef ?? null,
  };
}

function toTitle(
  record: PackRecords['title'],
  id: IdOf<'title'>,
  { resolve }: TransformContext,
): Title {
  return {
    id,
    promotionId: resolve.id('promotion', record.promotionKey),
    brandId: resolve.optional('brand', record.brandKey),
    name: record.name,
    holderCount: record.holderCount,
    division: record.division,
    prestige: record.prestige,
    status: record.status,
    introducedOn: record.introducedOn,
    retiredOn: record.retiredOn ?? null,
    imageRef: record.imageRef ?? null,
    color: record.color,
  };
}

function toPerson(
  record: PackRecords['person'],
  id: IdOf<'person'>,
  { resolve }: TransformContext,
): Person {
  return {
    id,
    givenName: record.givenName,
    familyName: record.familyName,
    defaultRingName: record.defaultRingName,
    gender: record.gender,
    birthDate: record.birthDate,
    debutDate: record.debutDate,
    birthRegionId: resolve.id('region', record.birthRegionKey),
    basedInRegionId: resolve.id('region', record.basedInRegionKey),
    imageRef: record.imageRef ?? null,
    masked: record.masked ?? false,
    tags: record.tags ?? [],
    roles: record.roles,
    status: record.status ?? 'active',
    career: record.career ?? { canOwn: false, canBook: false },
    motivation: record.motivation,
    heightCm: record.heightCm,
    weightKg: record.weightKg,
    build: record.build,
    style: record.style,
    attributes: record.attributes,
    condition: record.condition,
    // Transient state is not pack data: everyone starts rested, uninjured and unrestricted.
    fatigue: 0,
    injury: null,
    restrictions: [],
    development: record.development,
    regionalPop: resolve.regionalPop(record.regionalPop),
    traits: record.traits,
    vices: record.vices,
  };
}

function toEmployment(
  record: PackRecords['employment'],
  id: IdOf<'employment'>,
  { resolve }: TransformContext,
): Employment {
  return {
    id,
    personId: resolve.id('person', record.personKey),
    promotionId: resolve.id('promotion', record.promotionKey),
    brandId: resolve.optional('brand', record.brandKey),
    managerPersonId: resolve.optional('person', record.managerPersonKey),
    // Every pack contract is running when the world starts, offered on the day it began.
    status: 'active',
    offeredOn: record.startsOn,
    startsOn: record.startsOn,
    endsOn: record.endsOn,
    endedOn: null,
    role: record.role,
    ringName: record.ringName,
    gimmickKey: record.gimmickKey ?? null,
    alignment: record.alignment,
    push: record.push,
    terms: contractTerms(record.terms),
    morale: record.morale ?? 0,
    momentum: null,
    appearancesThisYear: 0,
    lastAppearanceOn: null,
    leave: null,
  };
}

function toTeam(
  record: PackRecords['team'],
  id: IdOf<'team'>,
  { resolve }: TransformContext,
): Team {
  return {
    id,
    kind: record.kind,
    name: record.name,
    memberIds: resolve.list('person', record.memberKeys),
    experience: record.experience ?? 0,
    status: record.status ?? 'active',
    formedOn: record.formedOn,
    splitOn: record.splitOn ?? null,
  };
}

function toEventDefinition(
  record: PackRecords['eventDefinition'],
  id: IdOf<'eventDefinition'>,
  { resolve }: TransformContext,
): EventDefinition {
  return {
    id,
    promotionId: resolve.id('promotion', record.promotionKey),
    brandId: resolve.optional('brand', record.brandKey),
    name: record.name,
    importance: record.importance,
    recurrence: record.recurrence,
    format: record.format,
    televised: record.televised,
    preferredRegionId: resolve.optional('region', record.preferredRegionKey),
    preferredVenueId: resolve.optional('venue', record.preferredVenueKey),
    activeFrom: record.activeFrom,
    activeUntil: record.activeUntil ?? null,
    logoRef: record.logoRef ?? null,
  };
}

function toDeal(
  record: PackRecords['deal'],
  id: IdOf<'deal'>,
  { resolve }: TransformContext,
): Deal {
  return {
    id,
    networkId: resolve.id('network', record.networkKey),
    promotionId: resolve.id('promotion', record.promotionKey),
    eventDefinitionId: resolve.optional('eventDefinition', record.eventDefinitionKey),
    status: 'active',
    offeredOn: record.startsOn,
    startsOn: record.startsOn,
    endsOn: record.endsOn,
    timeslot: record.timeslot,
    weekday: record.weekday,
    live: record.live,
    terms: {
      feePerShow: fromWhole(record.terms.feePerShow),
      perThousandViewers: fromWhole(record.terms.perThousandViewers),
      costPerShow: fromWhole(record.terms.costPerShow),
    },
  };
}

/**
 * The ring name a holder used with the title's promotion when the reign began: the contract with
 * that promotion running on `wonOn` (or, failing that, the latest one that started by then, or the
 * first by key), else the person's default ring name.
 */
function holderNameAtTime(
  reign: TitleReignRecord,
  holderRef: PackRef,
  promotionKey: string,
  records: MergedRecords,
): string {
  const holderKey = parseRef(holderRef).key;
  const contracts = [...records.employment.values()]
    .map((merged) => merged.record)
    .filter(
      (employment) =>
        parseRef(employment.personKey).key === holderKey &&
        parseRef(employment.promotionKey).key === promotionKey,
    )
    .sort((left, right) => compareText(left.key, right.key));
  const startedBy = contracts.filter(
    (employment) => compareDates(employment.startsOn, reign.wonOn) <= 0,
  );
  const running = startedBy.find(
    (employment) => employment.endsOn === null || compareDates(employment.endsOn, reign.wonOn) > 0,
  );
  const latestStarted = [...startedBy].sort((left, right) =>
    compareDates(right.startsOn, left.startsOn),
  )[0];
  const contract = running ?? latestStarted ?? contracts[0];
  return contract?.ringName ?? records.person.get(holderKey)?.record.defaultRingName ?? holderKey;
}

function toTitleReign(
  record: PackRecords['titleReign'],
  id: IdOf<'titleReign'>,
  { resolve, records }: TransformContext,
): TitleReign {
  const title = records.title.get(parseRef(record.titleKey).key)?.record;
  if (title === undefined) {
    throw new InvalidArgumentError('toTitleReign', 'titleKey', record.titleKey, 'a loaded title');
  }
  const promotionKey = parseRef(title.promotionKey).key;
  return {
    id,
    titleId: resolve.id('title', record.titleKey),
    holderIds: resolve.list('person', record.holderPersonKeys),
    teamId: resolve.optional('team', record.teamKey),
    wonOn: record.wonOn,
    lostOn: record.lostOn,
    wonInSegmentId: null,
    endedInSegmentId: null,
    endReason: record.endReason,
    defences: record.defences,
    holderNamesAtTime: record.holderPersonKeys.map((holderRef) =>
      holderNameAtTime(record, holderRef, promotionKey, records),
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// Minting and writing

/**
 * Mints one ID per record of `kind`, in key order, exactly as `tx.create` would: the world's minter
 * draws from the kind's own `ids.<prefix>` stream and retries a candidate that is already taken.
 */
function mintKind<Kind extends EntityRecordKind>(
  kind: Kind,
  records: MergedRecords,
  minter: IdMinter,
  sources: Map<string, IdSource>,
): Map<string, IdOf<Kind>> {
  const byKey: ReadonlyMap<string, MergedRecord<unknown>> = records[kind];
  const ids = new Map<string, IdOf<Kind>>();
  const taken = new Set<string>();
  for (const key of [...byKey.keys()].sort(compareText)) {
    const merged = byKey.get(key);
    if (merged === undefined) {
      continue;
    }
    const id = minter.next(kind, (candidate) => taken.has(candidate));
    taken.add(id);
    ids.set(key, id);
    sources.set(id, { kind, key, merged });
  }
  return ids;
}

/** Mints every entity record's ID, kind by kind in `CANONICAL_KIND_ORDER`. */
function mintAll(
  records: MergedRecords,
  minter: IdMinter,
  sources: Map<string, IdSource>,
): KeyToId {
  // Each kind draws from its own stream, so the order across kinds never changes an ID; the list
  // follows CANONICAL_KIND_ORDER so it reads the same as the docs.
  return {
    continent: mintKind('continent', records, minter, sources),
    country: mintKind('country', records, minter, sources),
    region: mintKind('region', records, minter, sources),
    promotion: mintKind('promotion', records, minter, sources),
    brand: mintKind('brand', records, minter, sources),
    venue: mintKind('venue', records, minter, sources),
    network: mintKind('network', records, minter, sources),
    title: mintKind('title', records, minter, sources),
    person: mintKind('person', records, minter, sources),
    employment: mintKind('employment', records, minter, sources),
    team: mintKind('team', records, minter, sources),
    eventDefinition: mintKind('eventDefinition', records, minter, sources),
    deal: mintKind('deal', records, minter, sources),
    titleReign: mintKind('titleReign', records, minter, sources),
  };
}

/** Regions listed as a neighbour by a region they do not list back, keyed by the listed region. */
function missingBackNeighbours(records: MergedRecords): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const key of [...records.region.keys()].sort(compareText)) {
    const region = records.region.get(key)?.record;
    for (const neighbourRef of region?.neighbourKeys ?? []) {
      const neighbourKey = parseRef(neighbourRef).key;
      const neighbour = records.region.get(neighbourKey)?.record;
      if (neighbour === undefined) {
        continue;
      }
      const listsBack = neighbour.neighbourKeys.some((ref) => parseRef(ref).key === key);
      if (!listsBack) {
        result.set(neighbourKey, [...(result.get(neighbourKey) ?? []), key]);
      }
    }
  }
  return result;
}

interface WriteContext {
  readonly tx: Tx<GameTables>;
  readonly transform: TransformContext;
  readonly keyToId: KeyToId;
  readonly issues: PackIssue[];
}

/**
 * Builds, checks and inserts every entity of one kind, in key order. Every failure becomes an
 * `entity-schema` issue pointing at the source record.
 */
function writeKind<Kind extends EntityRecordKind, Name extends TableKey<GameTables>>(
  context: WriteContext,
  kind: Kind,
  table: Name,
  build: (
    record: PackRecords[Kind],
    id: IdOf<Kind>,
    transform: TransformContext,
  ) => RowOf<GameTables[Name]>,
): void {
  const { tx, transform, keyToId, issues } = context;
  const byKey: MergedRecords[Kind] = transform.records[kind];
  const schema: z.ZodType = TABLES[table].schema;
  for (const key of [...byKey.keys()].sort(compareText)) {
    const merged = byKey.get(key);
    const id = keyToId[kind].get(key);
    if (merged === undefined || id === undefined) {
      continue;
    }
    const at = {
      code: 'entity-schema' as const,
      packId: merged.sourcePackId,
      file: merged.file,
      kind,
      recordKey: key,
    };
    let row: RowOf<GameTables[Name]>;
    try {
      row = build(merged.record, id, transform);
    } catch (error) {
      issues.push(packError({ ...at, path: [kind, key], message: describeError(error) }));
      continue;
    }
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      for (const problem of parsed.error.issues) {
        issues.push(
          packError({
            ...at,
            path: [kind, key, ...zodPath(problem.path)],
            message: `As a ${kind} entity: ${problem.message}`,
          }),
        );
      }
      continue;
    }
    const inserted = tx.savepoint(`insert ${kind} ${key}`, (inner) => inner.insert(table, row));
    if (!inserted.ok) {
      issues.push(packError({ ...at, path: [kind, key], message: describeError(inserted.error) }));
    }
  }
}

/** Every kind's entities, written in canonical order. */
function writeEntities(context: WriteContext): void {
  writeKind(context, 'continent', TABLE_OF_KIND.continent, toContinent);
  writeKind(context, 'country', TABLE_OF_KIND.country, toCountry);
  writeKind(context, 'region', TABLE_OF_KIND.region, toRegion);
  writeKind(context, 'promotion', TABLE_OF_KIND.promotion, toPromotion);
  writeKind(context, 'brand', TABLE_OF_KIND.brand, toBrand);
  writeKind(context, 'venue', TABLE_OF_KIND.venue, toVenue);
  writeKind(context, 'network', TABLE_OF_KIND.network, toNetwork);
  writeKind(context, 'title', TABLE_OF_KIND.title, toTitle);
  writeKind(context, 'person', TABLE_OF_KIND.person, toPerson);
  writeKind(context, 'employment', TABLE_OF_KIND.employment, toEmployment);
  writeKind(context, 'team', TABLE_OF_KIND.team, toTeam);
  writeKind(context, 'eventDefinition', TABLE_OF_KIND.eventDefinition, toEventDefinition);
  writeKind(context, 'deal', TABLE_OF_KIND.deal, toDeal);
  writeKind(context, 'titleReign', TABLE_OF_KIND.titleReign, toTitleReign);
}

/** `contentKeys` for the metadata: every entity record's key and ID, kinds and keys sorted. */
function contentKeysOf(keyToId: KeyToId): ContentKeys {
  const contentKeys: ContentKeys = {};
  for (const kind of CANONICAL_KIND_ORDER) {
    const ids: ReadonlyMap<string, string> = keyToId[kind];
    if (ids.size === 0) {
      continue;
    }
    const byKey: Record<string, string> = {};
    for (const key of [...ids.keys()].sort(compareText)) {
      const id = ids.get(key);
      if (id !== undefined) {
        byKey[key] = id;
      }
    }
    contentKeys[kind] = byKey;
  }
  return contentKeys;
}

/** Turns `checkWorld`'s findings into pack issues that point back at the source records. */
function integrityIssues(
  tx: Tx<GameTables>,
  sources: ReadonlyMap<string, IdSource>,
  fallbackPackId: string,
): PackIssue[] {
  const report = checkWorld(tx.view, TABLES);
  return report.issues.map((issue) => {
    const source = issue.id === undefined ? undefined : sources.get(issue.id);
    const make = issue.severity === 'warning' ? packWarning : packError;
    if (source === undefined) {
      return make({
        code: 'entity-schema',
        packId: fallbackPackId,
        path: issue.path === undefined ? [issue.table] : [issue.table, issue.path],
        message: `${issue.code}: ${issue.message}`,
      });
    }
    return make({
      code: 'entity-schema',
      packId: source.merged.sourcePackId,
      file: source.merged.file,
      kind: source.kind,
      recordKey: source.key,
      path:
        issue.path === undefined
          ? [source.kind, source.key]
          : [source.kind, source.key, issue.path],
      message: `${issue.code}: ${issue.message}`,
    });
  });
}

/**
 * Builds a World from merged pack content. See the module comment for the steps. Returns the
 * world and its RNG registry, or every issue found; warnings come back either way.
 *
 * Throws `InvalidArgumentError` only for bad options (an unusable seed or settings), which are
 * the caller's bug rather than bad content.
 */
export function materialiseWorld(
  content: MergedContent,
  opts: MaterialiseOptions,
): Result<MaterialisedWorld> {
  const referenceIssues = checkReferences(content.records);
  if (hasErrors(referenceIssues)) {
    return { ok: false, issues: referenceIssues };
  }
  const settings = resolveSettings(opts.settings);
  const meta: WorldMeta = {
    worldName: opts.worldName ?? content.worldName ?? 'New World',
    startDate: opts.startDate,
    currentDate: opts.startDate,
    seed: opts.seed,
    settings,
    players: [],
    contentPacks: content.packs.map((pack) => ({ ...pack })),
    contentKeys: {},
    catalogs: catalogsWithInjuries(content.records),
    daysSimulated: 0,
  };
  const checkedMeta = WorldMetaSchema.safeParse(meta);
  if (!checkedMeta.success) {
    throw new InvalidArgumentError(
      'materialiseWorld',
      'opts',
      JSON.stringify({ seed: opts.seed, startDate: opts.startDate, worldName: meta.worldName }),
      `options that make valid world metadata (${checkedMeta.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')})`,
    );
  }

  const rng = new RngRegistry(opts.seed);
  const minter = createIdMinter(rng);
  const world = createWorld(TABLES, checkedMeta.data, { idFactory: minter });
  const issues: PackIssue[] = [...referenceIssues];
  const fallbackPackId = content.packs.at(-1)?.id ?? '';

  const outcome = world.transact('load world from packs', (tx) => {
    const sources = new Map<string, IdSource>();
    const keyToId = mintAll(content.records, minter, sources);
    const transform: TransformContext = {
      resolve: new KeyResolver(keyToId),
      records: content.records,
      backNeighbours: missingBackNeighbours(content.records),
      startDate: opts.startDate,
    };
    writeEntities({ tx, transform, keyToId, issues });
    if (hasErrors(issues)) {
      throw new LoadAborted();
    }

    tx.create('seasons', {
      number: 1,
      startDate: opts.startDate,
      endDate: addDays(opts.startDate, settings.season.lengthDays - 1),
      status: 'active',
    });
    tx.setMeta({ contentKeys: contentKeysOf(keyToId) });

    issues.push(...integrityIssues(tx, sources, fallbackPackId));
    if (hasErrors(issues)) {
      throw new LoadAborted();
    }
  });

  if (!outcome.ok) {
    if (outcome.error instanceof LoadAborted) {
      return { ok: false, issues };
    }
    throw outcome.error;
  }
  return { ok: true, value: { world, rng }, issues };
}
