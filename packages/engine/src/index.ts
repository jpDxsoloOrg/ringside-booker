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
  GenerationContentError,
  IdCollisionError,
  InvalidArgumentError,
  InvalidCadenceError,
  InvalidContentKeyError,
  InvalidDateError,
  InvalidGeneratedPersonError,
  InvalidIdError,
  InvalidOddsError,
  InvalidStatePartError,
  InvariantError,
  MigrationError,
  MoneyOverflowError,
  NameSpaceExhaustedError,
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

// The day pipeline: phase and gate definitions, the registries, reports, advance results and the
// failure log. The runners (createRuntime, runStep, runDay, advanceDays) stay internal: they need
// the runtime, and the engine API wraps them for the web app and the tools. `evaluateGates` is
// exported because it only reads; the engine's `sim.pendingGates` query is how the UI calls it.
export {
  defineGate,
  evaluateGates,
  GATE_ID_PATTERN,
  GateRegistry,
  MAX_ADVANCE_DAYS,
  REPEATED_FAILURE_GATE_ID,
  RESERVED_GATE_SYSTEM,
  STOP_DATE_GATE_ID,
  type AdvanceFailure,
  type AdvanceOptions,
  type AdvanceProgress,
  type AdvanceResult,
  type AdvanceStop,
  type CancelSignal,
  type GateDefinition,
  type GateHit,
  type GateSpec,
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

export {
  hashString128,
  hashString32,
  hashWordsToHex,
  stableStringify,
  type HashWords,
} from './core/hash';
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
// The game's table registry, which `loadSave` takes to rebuild a World from a save.
export { TABLES } from './model/tables';
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

// Runtime catalogs (MTCH1): the match types, angle types and win methods snapshotted into
// `WorldMeta.catalogs` at new game, and the only readers phases, queries and commands use.
export type {
  AngleTypeDef,
  CatalogListOptions,
  CatalogName,
  CatalogReader,
  Catalogs,
  DurationShift,
  MatchTypeDef,
  MethodDef,
} from './model/catalogs';
export {
  angleTypeOf,
  angleTypesOf,
  AngleTypeDefSchema,
  CatalogsSchema,
  DURATION_SHIFTS,
  hasCatalog,
  matchTypeOf,
  matchTypesOf,
  MatchTypeDefSchema,
  methodOf,
  methodsOf,
  MethodDefSchema,
} from './model/catalogs';
export {
  checkSegmentContentKeys,
  SEGMENT_KEY_ISSUE_CODES,
} from './systems/match/catalog/checkSegmentKeys';

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
  SHORT_NAME_PATTERN,
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
  CancellationReason,
  EventCancellation,
  EventInstance,
  EventInstanceStatus,
  EventResult,
} from './model/entities/event-instance';
export {
  CANCELLATION_REASONS,
  EventCancellationSchema,
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
// Geography queries (WLD-04): hierarchy lookups, population-weighted roll-ups and weighted picks.
export type { AggregateOptions, Geography, GeographySource } from './systems/world/geography';
export { createGeography, geographyOf, pickRegion, regionWeight } from './systems/world/geography';
// Workers (WRK1-01): age, availability, title eligibility, weight class, grades, employer and
// main-role helpers every system and screen shares. See docs/design/workers.md.
export type {
  ApplyMomentumChangeArgs,
  ApplyMoraleChangeArgs,
  ApplyPopularityChangeArgs,
  Availability,
  AvailabilityStatus,
  DoorContext,
  DoorReason,
  DoorResult,
  DoorSource,
  Grade,
  GradeBand,
  GradeResult,
  PopularityAnchorInputs,
  PopularityChangeInputs,
  PopularityDoorResult,
  PopularitySubject,
  PopularitySubjectKind,
  RatingRole,
  ExpectedPushInputs,
  FanBase,
  FanBaseRegion,
  FootprintPopularityInputs,
  FootprintRegion,
  FootprintRegionalPop,
  PushStanding,
  RatingWeightKey,
  RoleRatingInputs,
  SetAlignmentArgs,
  SetPushArgs,
  SetRoleArgs,
  SetRoleProblemCode,
  TitleEligibilityCode,
  WeightClass,
  WeightClassInputs,
} from './systems/workers/index';
// The doors (WRK1-04) are the only way to change push, alignment, role, regional popularity,
// momentum and morale after world creation. See docs/design/workers.md#doors.
export {
  activeEmploymentsOf,
  ageOn,
  applyMomentumChange,
  applyMoraleChange,
  applyPopularityChange,
  AVAILABILITY_STATUSES,
  availabilityOf,
  DEBUT_ROLES,
  DOOR_TRACE_KINDS,
  DOORS_DOC_REF,
  experienceYears,
  GRADE_BANDS,
  GRADE_BANDS_REASON,
  gradeFloorOf,
  gradeOf,
  GRADES,
  isEligibleForTitle,
  isFreeAgent,
  mainRoleOf,
  POPULARITY_DOC_REF,
  popularityAnchor,
  popularityChange,
  primaryEmploymentOf,
  RATING_ROLES,
  ratingRoleOfPersonRole,
  ROLE_CHANGED_REASON_KEY,
  SET_ROLE_PROBLEM_CODES,
  setAlignment,
  setPush,
  setRole,
  setRoleProblems,
  TITLE_ELIGIBILITY_CODES,
  WEIGHT_CLASS_DOC_REF,
  WEIGHT_CLASS_LABELS,
  WEIGHT_CLASSES,
  weightClass,
  workersSystem,
  workersTunables,
} from './systems/workers/index';
// Role ratings and expected push (WRK1-02): the rating per role, popularity among a promotion's
// fans and the card position a worker would expect there. See docs/design/workers.md.
export {
  CREW_NOT_PUSHED_RULE,
  CREW_ROLES,
  DEFAULT_RATING_WEIGHTS,
  EXPECTED_PUSH_DOC_REF,
  expectedPush,
  expectedPushAt,
  fanBaseOf,
  footprintPopularity,
  footprintPopularityAt,
  footprintPopularityValue,
  NO_FANS_NOTE,
  NO_WEIGHTS_NOTE,
  OCCASIONAL_WRESTLER_NOTE,
  overallByRole,
  overallOf,
  PUSH_LABELS,
  pushStanding,
  RATING_ROLE_LABELS,
  ratingWeightKey,
  ratingWeightTunables,
  ROLE_RATINGS_DOC_REF,
  roleRating,
  STAR_REASON,
} from './systems/workers/index';
// The worker profile (WRK1-05): the `workers.profile` query's result and the words it uses.
export type {
  ViceKind,
  WorkerProfile,
  WorkerProfileAttribute,
  WorkerProfileContract,
  WorkerProfileEmployer,
  WorkerProfileExpectedPush,
  WorkerProfileHeader,
  WorkerProfileHiddenField,
  WorkerProfilePartner,
  WorkerProfilePlace,
  WorkerProfilePopularity,
  WorkerProfileReign,
  WorkerProfileRoleRating,
  WorkerProfileTeam,
  WorkerProfileTrait,
  WorkerProfileVice,
} from './systems/workers/index';
export {
  ATTRIBUTE_GROUP_LABELS,
  TRAIT_LABELS,
  VICE_KINDS,
  VICE_LABELS,
  WORKER_NOT_FOUND,
  WORKER_PROFILE_HIDDEN_FIELDS,
  workerProfileOf,
} from './systems/workers/index';
export { ATTRIBUTE_LABELS, GENDER_LABELS, STYLE_LABELS } from './systems/world/people/labels';
// The workers list (WRK1-06): the `workers.list` rows, filters and sort keys, and the on-demand
// "Why?" behind a row's numbers. See docs/design/workers.md#workers-list.
export type {
  WorkerAttributeMinimum,
  WorkerEmployerFilter,
  WorkerExplainArgs,
  WorkerExplainMetric,
  WorkerExplanation,
  WorkerList,
  WorkerListArgs,
  WorkerListContinentFacet,
  WorkerListCountryFacet,
  WorkerListFacets,
  WorkerListFilters,
  WorkerListSort,
  WorkerRow,
  WorkerRowAvailability,
  WorkerRowEmployer,
  WorkerRowTopPopularity,
  WorkerSortDirection,
  WorkerSortKey,
} from './systems/workers/index';
export {
  DEFAULT_WORKER_SORT,
  WORKER_EXPLAIN_METRICS,
  WORKER_SORT_DIRECTIONS,
  WORKER_SORT_FIELDS,
  WORKER_SORT_KEYS,
  workerExplanationOf,
  workerListOf,
} from './systems/workers/index';
// Calendar (EVT1): who controls a show, the one definition every booking command, gate and screen
// shares, and the cancellation record. See docs/design/calendar.md#lifecycle.
export type { CancelShowReasonCode, ShowOwnership } from './systems/calendar/index';
// The calendar's read side (EVT1-03): the one row every calendar query returns, and the wording of
// a recurrence. See docs/design/calendar.md#queries.
export type {
  CalendarProjectedView,
  CalendarRangeView,
  CalendarScope,
  CalendarShow,
  CalendarShowDetail,
  CalendarShowStatus,
  CalendarWindowArgs,
  NextShowView,
} from './systems/calendar/index';
export {
  CALENDAR_RANGE_MESSAGES,
  CALENDAR_SCOPES,
  MAX_CALENDAR_RANGE_DAYS,
  recurrenceText,
  toCalendarShow,
} from './systems/calendar/index';
export {
  CANCEL_SHOW_REASON_CODES,
  controlsShow,
  sameController,
  showControllerOf,
  viewerControlsShow,
} from './systems/calendar/index';
// The D-03 popularity roll-up (WRK1-03): world, continents and countries from per-region values.
export type {
  PopularityContinentView,
  PopularityCountryView,
  PopularityRegionView,
  PopularityRoller,
  PopularityRollup,
  PopularityRollupOptions,
  PopularityRollupView,
  PopularityValues,
  RegionalPopularity,
  TopContinentPopularity,
  TopCountryPopularity,
} from './systems/world/formulas/popularityRollup';
export {
  createPopularityRoller,
  popularityRollup,
  popularityRollupView,
} from './systems/world/formulas/popularityRollup';
// Name generation (WLD-05): weighted name tables, the name registry and the name generator.
export type {
  NameGeneratorOptions,
  PersonName,
  PersonNameRequest,
  RingNamePerson,
  RingNameRequest,
} from './systems/world/names/generator';
export { NameGenerator } from './systems/world/names/generator';
export type { NameKind } from './systems/world/names/registry';
export { legalDisplayName, NameRegistry, normaliseName } from './systems/world/names/registry';
export type { TablePick, WeightedTable } from './systems/world/names/weighted';
export { buildWeightedTable, pickFromTable, pickTableEntry } from './systems/world/names/weighted';
export { worldTunables } from './systems/world/tunables';
// People generation (WLD-06): a new person from a short spec, correlated attributes, seed hooks.
export type {
  ArchetypeKey,
  CareerStage,
  GenerateContext,
  GenerateSpec,
  GeneratedPerson,
  PersonSeedHook,
  PersonSeedHooks,
  PersonSeedInput,
  StreamSource,
} from './systems/world/people/spec';
export { CAREER_STAGES } from './systems/world/people/spec';
export type {
  PersonGenerateRequest,
  PersonGeneratorOptions,
} from './systems/world/people/generate';
export { generatePerson, PersonGenerator } from './systems/world/people/generate';
// Potential, traits, vices and popularity seeding (WLD-07).
export type { HeadroomCurve, SeedPotentialOptions } from './systems/world/people/potential';
export {
  ceilingKeysFor,
  expectedHeadroom,
  expectedHeadroomOf,
  HEADROOM_START_AGE,
  headroomCurveOf,
  LATE_BLOOMER_MAX_AGE,
  LATE_BLOOMER_MIN_AGE,
  seedPotential,
} from './systems/world/people/potential';
export type { SeedTraitsOptions } from './systems/world/people/traits';
export { seedTraits, traitChance, traitLabel, traitRecordsOf } from './systems/world/people/traits';
export type { SeedVicesOptions } from './systems/world/people/vices';
export { seedVices, viceChance } from './systems/world/people/vices';
export type { RegionRelation, SeedPopularityOptions } from './systems/world/people/popularity';
export {
  homeReputation,
  REPUTATION_MAX,
  regionRelation,
  seedPopularity,
} from './systems/world/people/popularity';
export {
  DEFAULT_SEED_HOOKS,
  popularitySeedHook,
  potentialSeedHook,
  traitsSeedHook,
  vicesSeedHook,
} from './systems/world/people/seeds';
export type { ReseededPerson, ReseedFilter, ReseedOptions } from './systems/world/people/reseed';
export { estimateTalent, reseedPotential, stageForAge } from './systems/world/people/reseed';
export { exactAge, experienceYearsAt } from './systems/world/people/dates';
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

// The pack loader (WLD-02): parsed pack JSON in, a validated World (or structured issues) out.
export type {
  ContentLibrary,
  LoadedWorld,
  LoadWorldOptions,
  MergedContent,
  PackIssue,
  PackIssueCode,
  PackIssueSeverity,
} from './persistence/packs';
export {
  DEFAULT_WORLD_SETTINGS,
  formatPackIssue,
  loadWorldFromPacks,
  PACK_ISSUE_CODES,
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
export type { CompatGuardedStage, LoadFailureFacts, SaveCompat } from './persistence/compat';
export { classifyLoadFailure, COMPAT_GUARDED_STAGES } from './persistence/compat';
export {
  engineSaveSchemaFingerprint,
  fingerprintOf,
  SAVE_SCHEMA_FINGERPRINT_PATTERN,
} from './core/api/saveFingerprint';
export type { Migration } from './persistence/migrations/registry';
export {
  assertMigrationChain,
  CURRENT_FORMAT_VERSION,
  MIGRATIONS,
} from './persistence/migrations/registry';
export type { AppliedMigration, MigrationRun } from './persistence/migrations/run';
export { runMigrations } from './persistence/migrations/run';

// The engine API (SIM-10): createEngine, system bundles, typed queries and commands, controllers
// and viewers (D-07), the command log, the engine state and its save-format registration. See
// docs/design/engine-api.md.
export * from './core/api/index';
export { defaultSystems } from './systems/index';

// New game (WLD-10): the world preview for the wizard, `createNewGame`, and the settings and
// setup-step registries later systems add their options to. See docs/design/new-game.md.
export * from './systems/newgame/index';

// The match system (MTCH1-02): slot role, duration class and slot weight from a slot's position
// (D-10, never stored), the match tunables, and the `match.catalog` and `match.slotRoles` queries.
// See docs/design/match-rating.md#slots.
export type {
  AngleTypeOption,
  CountRange,
  DurationClass,
  DurationClassInputs,
  MatchCatalog,
  MatchTypeOption,
  MethodOption,
  SlotDeps,
  SlotInfo,
  SlotInfoArgs,
  SlotPosition,
  SlotRole,
  SlotRoleRow,
  SlotRolesArgs,
  SlotWeightInputs,
} from './systems/match/index';
export {
  DURATION_CLASS_LABELS,
  DURATION_CLASSES,
  durationClassOf,
  matchSystem,
  matchTunables,
  SLOT_ROLE_LABELS,
  SLOT_ROLES,
  SLOT_ROLES_MAX_PRE_SHOW_SLOTS,
  SLOT_ROLES_MAX_SLOTS,
  SLOT_ROLES_MIN_SLOTS,
  SLOTS_DOC_REF,
  slotRoleOf,
  slotWeightOf,
} from './systems/match/index';

// The in-ring rating formulas (MTCH1-03): worker performance, side aggregation and work rate.
// See docs/design/match-rating.md#worker-performance.
export type {
  MatchLeader,
  PerformanceAttributeKey,
  PerformanceAxis,
  SideAggregateInputs,
  SideAggregateMember,
  SideDecayKey,
  TalkWeights,
  WorkerPerformanceInputs,
  WorkRateInputs,
  WorkRateSide,
  WorkRateWorker,
} from './systems/match/index';
export {
  aggregateWeights,
  MATCH_RATING_STREAM,
  matchLeaderOf,
  PERFORMANCE_AXES,
  PERFORMANCE_AXIS_LABELS,
  sideAggregate,
  workerPerformance,
  workRate,
} from './systems/match/index';

// The crowd and scoring formulas (MTCH1-04): star power, crowd expectation and score, soft
// compression, segment score, star rating and speaker score. See docs/design/match-rating.md#star-power.
export type {
  CrowdExpectationInputs,
  CrowdScoreInputs,
  SegmentScoreInputs,
  SoftCompressionInputs,
  SpeakerScoreInputs,
  SpeakerScoreSide,
  SpeakerScoreSpeaker,
  StarPowerInputs,
  StarPowerMember,
  StarRatingInputs,
} from './systems/match/index';
export {
  crowdExpectation,
  crowdScore,
  DEFAULT_POLICY_LABEL,
  EVENT_IMPORTANCE_LABELS,
  PROMOTION_STYLE_LABELS,
  SEGMENT_PERFORMANCE_LABELS,
  segmentScore,
  softCompression,
  speakerScore,
  starPower,
  starRating,
} from './systems/match/index';

// Finishes (MTCH2-01): the finish catalog (structured category, outcome kind, effects, title flag,
// gains and auto-pick weight), its readers and check, the allowed-finish rule with its filter seam
// for MTCH7, the segment finish check and the `match.finishes` query.
// See docs/design/match-finishes.md.
export type { FinishCategory, FinishDef, FinishEntry, FinishOutcomeKind } from './model/catalogs';
export {
  FINISH_CATEGORIES,
  FINISH_OUTCOME_KINDS,
  FinishDefSchema,
  FinishEntrySchema,
  finishOf,
  finishesOf,
} from './model/catalogs';
export type {
  AllowedFinishesArgs,
  FinishCatalogIssue,
  FinishFilter,
  FinishFilterContext,
  FinishMethodOption,
  FinishOption,
  FinishesArgs,
  ReadonlyFinishEntry,
} from './systems/match/index';
export {
  allowedFinishes,
  checkFinishCatalog,
  checkSegmentFinishes,
  FINISH_CATALOG_ISSUE_CODES,
  finishAdmitsMatchType,
  FINISHES_REASON_CODES,
  finishSideCount,
  registerFinishFilter,
  SEGMENT_FINISH_ISSUE_CODES,
} from './systems/match/index';

// The rating pipeline (MTCH1-05): `rateSegment`, the rater registry, rating modifiers and their
// stages, the rating policy door (D-01, neutral by default), segment warnings and the
// stored-segment adapter. See docs/design/match-rating.md#pipeline-and-seams.
export type {
  RateSegmentOptions,
  RatingContext,
  RatingMode,
  RatingModifier,
  RatingPolicy,
  RatingPolicyProvider,
  RatingPolicySummary,
  RatingStage,
  RatingSubject,
  SegmentRater,
  SegmentRatingEvent,
  SegmentRatingInput,
  SegmentRatingResult,
  SegmentRatingSide,
  SegmentRatingSlot,
  SegmentWarning,
  SegmentWarningCode,
  SideSubject,
  SlotDerivation,
  StaminaCheck,
  WorkerLine,
  WorkerStaminaLine,
  WorkerSubject,
} from './systems/match/index';
export {
  ANGLE_CROWD_FACTOR,
  NEUTRAL_RATING_POLICY,
  NEUTRAL_RATING_POLICY_LABEL,
  NOT_UNDER_CONTRACT_NOTE,
  RATE_SEGMENT_REASON_CODES,
  RATING_ORDER,
  RATING_STAGE_LABELS,
  RATING_STAGES,
  SEGMENT_WARNING_CODES,
  rateSegment,
  ratingInputFromSegment,
  ratingModifiersFor,
  ratingPolicyFor,
  registerRatingModifier,
  registerRatingPolicyProvider,
  registerSegmentRater,
  resetMatchRegistriesForTests,
  segmentRaterFor,
  segmentWarnings,
  skippedDetailNote,
  staminaCheckOf,
} from './systems/match/index';

// The Match lab's previews (MTCH1-06): `match.preview` and `match.previewBatch` rate a segment on a
// detached stream (`detachedStream`, exported with the RNG) without writing or touching the world's
// RNG; `match.labOptions` and `match.labWorkers` give the lab its setup and picker.
// See docs/design/match-rating.md#previews.
export type {
  HistogramBin,
  LabDefaults,
  LabImportance,
  LabOptions,
  LabPromotion,
  LabRegion,
  LabWorkerRow,
  LabWorkerScope,
  LabWorkers,
  LabWorkersArgs,
  PreviewArgs,
  PreviewBatchArgs,
  PreviewBatchResult,
  PreviewResult,
  QuarterCount,
  StarStats,
  Stats,
} from './systems/match/index';
export {
  LAB_WORKER_SCOPES,
  LAB_WORKERS_DEFAULT_LIMIT,
  LAB_WORKERS_MAX_LIMIT,
  LAB_WORKERS_MAX_SEARCH,
  MATCH_PREVIEW_STREAM,
  PREVIEW_BATCH_MAX_RUNS,
  PREVIEW_MAX_SIDE_SIZE,
  PREVIEW_REASON_CODES,
  PREVIEW_SEED_MAX,
  PreviewArgsSchema,
  PreviewBatchArgsSchema,
  SCORE_HISTOGRAM_BINS,
  SCORE_HISTOGRAM_WIDTH,
} from './systems/match/index';

// Finish effects as rating modifiers, the finish decided on the night, the method and the title
// rule (MTCH2-02): `MatchResolution` (the shape the rater, `match.simulate` and EVT3 share),
// `finishEffect`, `autoFinish`, `chooseMethod` and `titleCanChange`. `allowedFinishes` is exported
// with MTCH2-01 above. See docs/design/match-finishes.md#finish-effects.
export type {
  AutoFinishCandidate,
  AutoFinishDeps,
  AutoFinishInputs,
  ChooseMethodInputs,
  FinishEffectInputs,
  FinishEffectTarget,
  MatchResolution,
  TitleCanChangeInputs,
} from './systems/match/index';
export {
  MATCH_FINISH_STREAM,
  MatchResolutionSchema,
  autoFinish,
  chooseMethod,
  finishEffect,
  finishEffectLabel,
  registerFinishModifiers,
  titleCanChange,
  winnerAlignmentOf,
} from './systems/match/index';

// The auto-winner, resolveMatchOutcome and the Random winners new-game setting (MTCH2-03):
// `resolveMatchOutcome` is the one entry point `match.simulate` and the show night call;
// `randomWinnersActive` tells EVT2 and EVT3 whether a show's results are decided on the night.
// See docs/design/match-finishes.md#resolving-a-match.
export type {
  AutoWinnerCompetitor,
  AutoWinnerInputs,
  AutoWinnerInputsArgs,
  AutoWinnerMode,
  AutoWinnerScoreInputs,
  AutoWinnerSide,
  AutoWinnerSideIds,
  AutoWinnerSideScore,
  MatchPlan,
  PlannedWinner,
  RandomWinnersArgs,
  ResolveMatchOutcomeDeps,
  ResolveMatchOutcomeInput,
  ResolveMatchOutcomeResult,
  ResolveMatchReasonCode,
  ResolveStreamName,
} from './systems/match/index';
export {
  MATCH_AUTO_WINNER_STREAM,
  RANDOM_WINNERS_MESSAGE,
  RANDOM_WINNERS_SETTING,
  RESOLVE_MATCH_REASON_CODES,
  autoWinner,
  autoWinnerInputsOf,
  autoWinnerScore,
  competitorSidesOf,
  randomWinnersActive,
  resolveMatchOutcome,
} from './systems/match/index';

// The Match lab's Simulate (MTCH2-04): `match.simulate` resolves a plan and rates the match with
// its finish on detached streams; `match.simulateBatch` (MTCH2-07) plays it out many times and
// counts the outcomes; `match.resultMode` says whether Random winners decides the viewer's
// results. See docs/design/match-finishes.md#simulate.
export type {
  FinishCount,
  ResultMode,
  SideWinCount,
  SimulateArgs,
  SimulateBatchArgs,
  SimulateBatchResult,
  SimulateResult,
  SimulatedFinish,
} from './systems/match/index';
export {
  SIMULATE_REASON_CODES,
  SimulateArgsSchema,
  SimulateBatchArgsSchema,
} from './systems/match/index';
