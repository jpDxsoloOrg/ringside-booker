/**
 * Public API of the Ringside Booker engine.
 *
 * Everything the web app, the tools and the tests are allowed to use is exported from here.
 */

/** Engine version, recorded in every save. Kept equal to `version` in this package's package.json. */
export const ENGINE_VERSION = '0.1.0';

export type {
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
/** The nominal-type helper, exported as `Branded` because `Brand` is the brand entity. */
export type { Brand as Branded } from './core/brand';
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

export type { ErrorDetails, SerializedError } from './core/errors';
export {
  AppendOnlyError,
  DuplicateIdError,
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
  InvalidOddsError,
  InvalidStatePartError,
  InvariantError,
  MigrationError,
  MoneyOverflowError,
  NotSerialisableError,
  PipelineError,
  RegistryError,
  SaveDocumentError,
  SchemaViolationError,
  TraceReplayError,
  TraceStoreMisuseError,
  TxStateError,
  UniqueIndexError,
  UnknownIndexError,
  serializeError,
  SERIALIZED_STACK_MAX_LENGTH,
} from './core/errors';

export type { JsonArray, JsonObject, JsonPrimitive, JsonProblem, JsonValue } from './core/json';
export {
  appendPathSegment,
  assertJsonValue,
  cloneJson,
  findJsonProblem,
  formatPath,
  isJsonArray,
  isJsonObject,
  isJsonValue,
  zJsonValue,
} from './core/json';

export * from './core/events';

export * from './core/trace';

// The day pipeline: phase definitions, the registry, reports and the failure log. The runners
// (createRuntime, runStep, runDay) stay internal: they need the writable World, and the engine API
// wraps them for the web app and the tools.
export {
  definePhase,
  ENGINE_ONLY_GROUPS,
  isEngineOnlyGroup,
  isPhaseGroup,
  MAX_PHASE_ORDER,
  parsePipelineFailureLogState,
  PHASE_GROUP_BASES,
  PHASE_GROUPS,
  PHASE_ID_PATTERN,
  phasePosition,
  PhaseRegistry,
  PIPELINE_FAILURE_LOG_CAPACITY,
  PipelineFailureLog,
  pipelineFailureLogStateSchema,
  deterministicDayReport,
  type DayReport,
  type DeterministicDayReport,
  type PhaseContext,
  type PhaseDefinition,
  type PhaseGroup,
  type PhaseSpec,
  type PipelineFailure,
  type PipelineFailureLogState,
  type ReactionContext,
  type ReactionFailureReport,
  type SimHost,
  type SimRuntime,
  type SkippedReason,
  type StepContext,
  type StepReport,
  type DeterministicStepReport,
  type StepStatus,
  type StepTiming,
  type SystemPhaseGroup,
} from './core/pipeline';

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

// The World store. MutableTable, createWorld and transact are deliberately not exported: only
// transactions write to the world, and systems get their Tx from the day pipeline. The UI never
// sees a Tx; it gets ChangeSets back from commands.
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
export type {
  AnyId,
  ChangeSet,
  RowPatch,
  RowUpdater,
  TableChanges,
  TableKey,
  TransactOptions,
  Tx,
  TxResult,
  ValidateMode,
} from './model/tx';
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

export * from './model/entities/person';
// Controllers (D-07): who runs a promotion or a brand.
export type {
  ComputerController,
  Controller,
  ControllerKind,
  HumanController,
} from './model/controller';
export {
  ComputerControllerSchema,
  ControllerSchema,
  HumanControllerSchema,
  PLAYER_ID_MAX_LENGTH,
} from './model/controller';

// Promotions, brands, employments and groups (FND-07).
export type { PromotionStyle } from './model/entities/promotion-style';
export { PROMOTION_STYLES, PromotionStyleSchema } from './model/entities/promotion-style';
export type {
  Policies,
  PolicyArea,
  Production,
  ProductionArea,
  Promotion,
  PromotionStatus,
} from './model/entities/promotion';
export {
  POLICY_AREAS,
  PRODUCTION_AREAS,
  PRODUCTION_LEVEL_MAX,
  PRODUCTION_LEVEL_MIN,
  PROMOTION_STATUSES,
  PromotionSchema,
} from './model/entities/promotion';
export type { Brand } from './model/entities/brand';
export { BrandSchema } from './model/entities/brand';
export type {
  Alignment,
  ContractKind,
  ContractPerks,
  ContractTerms,
  Employment,
  EmploymentRole,
  EmploymentStatus,
  Leave,
  LeaveKind,
  Push,
  RevenueShares,
} from './model/entities/employment';
export {
  ALIGNMENTS,
  canTransition,
  CONTRACT_KINDS,
  EMPLOYMENT_ROLES,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TRANSITIONS,
  EmploymentSchema,
  ENDED_EMPLOYMENT_STATUSES,
  isTerminalStatus,
  LEAVE_KINDS,
  promotionStatusKey,
  PUSH_LEVELS,
  STARTED_EMPLOYMENT_STATUSES,
} from './model/entities/employment';
export type { Team, TeamKind, TeamStatus } from './model/entities/team';
export { TEAM_KINDS, TEAM_SIZE, TEAM_STATUSES, TeamSchema } from './model/entities/team';
export type { Stable, StableStatus } from './model/entities/stable';
export {
  STABLE_MAX_MEMBERS,
  STABLE_MIN_MEMBERS,
  STABLE_STATUSES,
  StableSchema,
} from './model/entities/stable';
export type { Relationship, RelationshipBond } from './model/entities/relationship';
export {
  RELATIONSHIP_BONDS,
  RelationshipSchema,
  relationshipKey,
  ROMANTIC_BONDS,
} from './model/entities/relationship';
// Titles, events, segments, storylines and seasons (FND-08).
export type {
  DivisionGender,
  Title,
  TitleDivision,
  TitleHolderCount,
  TitleStatus,
} from './model/entities/title';
export {
  DIVISION_GENDERS,
  HEX_COLOR_PATTERN,
  TITLE_HOLDER_COUNTS,
  TITLE_STATUSES,
  TitleDivisionSchema,
  TitleSchema,
  titlesTable,
} from './model/entities/title';
export type { ReignEndReason, TitleReign } from './model/entities/title-reign';
export {
  MAX_REIGN_HOLDERS,
  REIGN_END_REASONS,
  TitleReignSchema,
  titleReignsTable,
} from './model/entities/title-reign';
export type {
  AnnualRecurrence,
  DatesRecurrence,
  EventDefinition,
  EventImportance,
  EveryNWeeksRecurrence,
  MonthlyRecurrence,
  Recurrence,
  RecurrenceKind,
  RecurrenceWeek,
  ShowFormat,
  WeeklyRecurrence,
} from './model/entities/event-definition';
export {
  AnnualRecurrenceSchema,
  DatesRecurrenceSchema,
  EVENT_IMPORTANCES,
  EVERY_N_WEEKS_MAX,
  EVERY_N_WEEKS_MIN,
  EventDefinitionSchema,
  eventDefinitionsTable,
  EveryNWeeksRecurrenceSchema,
  MAX_RECURRENCE_DATES,
  MonthlyRecurrenceSchema,
  PRE_SHOW_SLOTS_MAX,
  PRE_SHOW_SLOTS_MIN,
  RECURRENCE_WEEKS,
  RecurrenceSchema,
  SHOW_SLOTS_MAX,
  SHOW_SLOTS_MIN,
  ShowFormatSchema,
  WeeklyRecurrenceSchema,
} from './model/entities/event-definition';
export type { RecurrenceView } from './model/recurrence';
/**
 * Show recurrence helpers (`recurrence.occursOn`, `recurrence.nextOccurrence`) live under one
 * namespace because the calendar already exports a `nextOccurrence` for phase cadences.
 */
export * as recurrence from './model/recurrence';
export type {
  EventInstance,
  EventInstanceStatus,
  EventResult,
} from './model/entities/event-instance';
export {
  EVENT_INSTANCE_STATUSES,
  EventInstanceSchema,
  eventInstancesTable,
  EventResultSchema,
} from './model/entities/event-instance';
export type {
  AngleBeat,
  AngleDetails,
  AngleSegment,
  MatchDetails,
  MatchOutcome,
  MatchSegment,
  Segment,
  SegmentCrew,
  SegmentKind,
  SegmentRating,
} from './model/entities/segment';
export {
  AngleSegmentSchema,
  isAngle,
  isMatch,
  MatchOutcomeSchema,
  MatchSegmentSchema,
  MAX_ANGLE_BEATS,
  MAX_ANNOUNCERS,
  MAX_STARS,
  MIN_ANGLE_BEATS,
  SEGMENT_KINDS,
  SegmentSchema,
  segmentSlotKey,
  segmentsTable,
  STAR_STEP,
} from './model/entities/segment';
export type { Participant, ParticipantRole } from './model/entities/participant';
export {
  MAX_SIDE,
  PARTICIPANT_ROLES,
  ParticipantSchema,
  participantsTable,
} from './model/entities/participant';
export type {
  Storyline,
  StorylineMember,
  StorylineSide,
  StorylineStatus,
} from './model/entities/storyline';
export {
  MAX_STORYLINE_MEMBERS,
  MAX_STORYLINE_SUMMARY_LENGTH,
  MIN_STORYLINE_MEMBERS,
  STORYLINE_SIDES,
  STORYLINE_STATUSES,
  StorylineSchema,
  storylinesTable,
} from './model/entities/storyline';
export type { Season, SeasonStatus } from './model/entities/season';
export {
  ACTIVE_SEASON_KEY,
  SEASON_STATUSES,
  SeasonSchema,
  seasonsTable,
} from './model/entities/season';
// Entity schemas: geography, venues, media, mail, news and the ledger.
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

// Data packs: the authoring format for shipped and modded content (WLD-01). Every pack schema and
// helper lives under the `packs` namespace because names such as `keySchema` are generic; the main
// types and schemas are also exported directly.
export * as packs from './persistence/packs';
export type {
  PackId,
  PackKey,
  PackKind,
  PackManifest,
  PackRecordEntry,
  PackRecords,
  PackRef,
  RawPack,
  RecordKind,
} from './persistence/packs';
export {
  PACK_FORMAT_VERSION,
  packManifestSchema,
  RECORD_KINDS,
  recordFileSchema,
  recordSchemas,
} from './persistence/packs';

// Saves (FND-11): the save document, the codec, migrations and the load pipeline. See
// docs/design/save-format.md.
export type {
  SaveDocument,
  SaveHeader,
  SaveState,
  SerializedTables,
  SerializedWorld,
  SimStatePart,
  StatePartSchemas,
} from './persistence/save-document';
export {
  createSaveDocumentSchema,
  SAVE_FORMAT,
  SAVE_LABEL_MAX_LENGTH,
  SaveHeaderSchema,
  SerializedWorldSchema,
  SIM_STATE_PARTS,
} from './persistence/save-document';
export type {
  SaveableState,
  SaveExtras,
  SerialisableWorld,
  WorldDocument,
  WorldToDocumentExtras,
} from './persistence/world-document';
export {
  createSaveDocument,
  documentToWorld,
  serialiseWorld,
  worldToDocument,
} from './persistence/world-document';
export type { DecodeOptions } from './persistence/codec';
export { decodeSave, encodeSave, MAX_SAVE_BYTES, serialiseSaveDocument } from './persistence/codec';
export type { LoadFailure, LoadIssue, LoadResult, LoadStage } from './persistence/report';
export { LOAD_STAGES, MAX_LOAD_ISSUES } from './persistence/report';
export type {
  LoadOptions,
  LoadReport,
  LoadSuccess,
  ReadOptions,
  TraceCheck,
  TunableOverrideCheck,
} from './persistence/load';
export { loadSave } from './persistence/load';
export type { InspectReport, InspectSuccess } from './persistence/inspect';
export { inspectSave } from './persistence/inspect';
export type { Migration } from './persistence/migrations/registry';
export {
  assertMigrationChain,
  CURRENT_FORMAT_VERSION,
  MIGRATIONS,
} from './persistence/migrations/registry';
export type { AppliedMigration, MigrationRun } from './persistence/migrations/run';
export { runMigrations } from './persistence/migrations/run';
