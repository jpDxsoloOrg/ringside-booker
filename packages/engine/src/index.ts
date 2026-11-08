/**
 * Public API of the Ringside Booker engine.
 *
 * Everything the web app, the tools and the tests are allowed to use is exported from here.
 */

/** Engine version, recorded in every save. Kept equal to `version` in this package's package.json. */
export const ENGINE_VERSION = '0.1.0';

export type {
  Brand,
  BrandId,
  ContinentId,
  CountryId,
  DealId,
  EmploymentId,
  EntityKind,
  EventDefinitionId,
  EventInstanceId,
  IdOf,
  IdPrefix,
  LedgerEntryId,
  MailId,
  NetworkId,
  NewsId,
  ParticipantId,
  PersonId,
  PromotionId,
  RegionId,
  RelationshipId,
  SeasonId,
  SegmentId,
  StableId,
  StorylineId,
  TeamId,
  TitleId,
  TitleReignId,
  VenueId,
} from './core/ids';
// createIdFactory is deliberately not exported: IDs are only minted inside world transactions.
export {
  ENTITY_KIND_LIST,
  ENTITY_KINDS,
  ID_PATTERN,
  isEntityKind,
  isId,
  kindOfId,
  parseId,
} from './core/ids';

export type { GameDate, Weekday, WeekdayOrdinal } from './core/date';
export {
  addDays,
  addMonths,
  addYears,
  ageInYears,
  compareDates,
  dayOfMonth,
  daysInMonth,
  diffDays,
  endOfMonth,
  fromEpochDay,
  isAfter,
  isBefore,
  isGameDate,
  isLastDayOfMonth,
  isLeapYear,
  isWeekday,
  makeGameDate,
  MAX_GAME_YEAR,
  MIN_GAME_YEAR,
  month,
  nthWeekdayOfMonth,
  parseGameDate,
  startOfMonth,
  toEpochDay,
  weekday,
  year,
} from './core/date';

export * from './core/calendar';

export type { Cents } from './core/money';
/** Money helpers live under one namespace because their names (`add`, `sum`, ...) are generic. */
export * as money from './core/money';
export { cents, isCents, ZERO_CENTS } from './core/money';

export type { ContentKey } from './core/content-key';
export { CONTENT_KEY_PATTERN, isContentKey, parseContentKey } from './core/content-key';

export type { ErrorDetails } from './core/errors';
export {
  DuplicateSubscriberError,
  EngineError,
  EntityNotFoundError,
  EventBusMisuseError,
  IdCollisionError,
  InvalidArgumentError,
  InvalidCadenceError,
  InvalidContentKeyError,
  InvalidDateError,
  InvalidIdError,
  InvalidStatePartError,
  MoneyOverflowError,
  NotSerialisableError,
  RegistryError,
  UniqueIndexError,
  UnknownIndexError,
} from './core/errors';

export type { JsonArray, JsonObject, JsonPrimitive, JsonProblem, JsonValue } from './core/json';
export {
  appendPathSegment,
  assertJsonValue,
  findJsonProblem,
  formatPath,
  isJsonValue,
  zJsonValue,
} from './core/json';

export * from './core/events';

export { hashString128, hashString32, type HashWords } from './core/hash';
export * from './core/rng';

export * from './core/tunables/index';
export {
  ALL_TUNABLES,
  createEngineTunables,
  loadEngineTunables,
  type EngineTunables,
  type TunableKey,
} from './systems/tunables';

// The World store. MutableTable and createWorld are deliberately not exported: only transactions
// write to the world.
export type {
  EntityRow,
  IndexSpec,
  Invariant,
  RefSpec,
  RefTarget,
  RowOf,
  TableDef,
  TableName,
  TableRegistry,
} from './model/table-def';
export type { ReadonlyTable } from './model/table';
export type { DeepReadonly, WorldView } from './model/world';
export { tableOf } from './model/world';
export type { GameTables, GameWorldView } from './model/tables';
export type {
  ContentPackRef,
  GenerationLevel,
  Player,
  WorldMeta,
  WorldSettings,
} from './model/world-meta';
export {
  GENERATION_LEVELS,
  SEASON_LENGTH_DAYS_MAX,
  SEASON_LENGTH_DAYS_MIN,
  WorldMetaSchema,
} from './model/world-meta';
export type {
  CheckWorldOptions,
  IntegrityCheck,
  IntegrityIssue,
  IntegrityReport,
  IntegritySeverity,
} from './model/integrity';
export { checkWorld, MAX_INTEGRITY_ISSUES } from './model/integrity';

// Entity schemas: geography, venues, media, mail, news and the ledger.
export type { PromotionStyle } from './model/entities/promotion-style';
export { PROMOTION_STYLES, PromotionStyleSchema } from './model/entities/promotion-style';
export type { Continent, Country, Region } from './model/entities/geography';
export {
  ContinentSchema,
  CountrySchema,
  LOCATION_CODE_PATTERN,
  RegionSchema,
} from './model/entities/geography';
export type { Venue, VenueKind } from './model/entities/venue';
export {
  isVenueOpenOn,
  VENUE_CAPACITY_MAX,
  VENUE_KINDS,
  VenueKindSchema,
  VenueSchema,
} from './model/entities/venue';
export type {
  CoverageHolder,
  Network,
  NetworkCoverage,
  NetworkKind,
  NetworkStatus,
} from './model/entities/network';
export {
  coveredRegionIds,
  NETWORK_KINDS,
  NETWORK_REACH_TIER_MAX,
  NETWORK_STATUSES,
  NetworkCoverageSchema,
  NetworkKindSchema,
  NetworkSchema,
  NetworkStatusSchema,
} from './model/entities/network';
export type { Deal, DealStatus, DealTerms, DealTimeslot } from './model/entities/deal';
export {
  DEAL_STATUSES,
  DEAL_TIMESLOTS,
  DealSchema,
  DealStatusSchema,
  DealTermsSchema,
  DealTimeslotSchema,
} from './model/entities/deal';
export type {
  Mail,
  MailCategory,
  MailDecision,
  MailDecisionOption,
  MailSender,
  MessageRefs,
} from './model/entities/mail';
export {
  DECISION_KEY_PATTERN,
  MAIL_CATEGORIES,
  MAIL_DECISION_OPTIONS_MAX,
  MAIL_DECISION_OPTIONS_MIN,
  MailCategorySchema,
  MailDecisionSchema,
  MailSchema,
  MailSenderSchema,
  MessageRefsSchema,
} from './model/entities/mail';
export type { News, NewsImportance, NewsKind } from './model/entities/news';
export { NEWS_KINDS, NewsKindSchema, NewsSchema } from './model/entities/news';
export type { LedgerCategory, LedgerEntry, LedgerRefs } from './model/entities/ledger-entry';
export {
  hasLedgerSign,
  LEDGER_CATEGORIES,
  LEDGER_CATEGORY_SIGN,
  LEDGER_COST_CATEGORIES,
  LEDGER_INCOME_CATEGORIES,
  LedgerCategorySchema,
  LedgerEntrySchema,
  ledgerMonthKey,
} from './model/entities/ledger-entry';
