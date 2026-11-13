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
  AftermathId,
  PromotionSnapshotId,
  AiProfileId,
  AiDecisionId,
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

export type { GameDate, Weekday, WeekdayOrdinal, YearMonth } from './core/date';
export {
  addDays,
  addMonths,
  addYearMonths,
  addYears,
  ageInYears,
  compareDates,
  dayOfMonth,
  daysInMonth,
  diffDays,
  endOfMonth,
  firstDayOfYearMonth,
  fromEpochDay,
  isAfter,
  isBefore,
  isGameDate,
  isLastDayOfMonth,
  isLeapYear,
  isWeekday,
  isYearMonth,
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
  YEAR_MONTH_PATTERN,
  yearMonthOf,
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
// MTCH2-09: the auto-winner's match terms and upset note.
export type { AutoWinnerStorylineHeat } from './systems/match/index';
export { NO_STORYLINE_HEAT_NOTE, upsetNote } from './systems/match/index';
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

// MTCH2's booking check (EVT2-07): planned finishes fit their matches, and Random winners shows
// plan nothing. See docs/design/booking.md#integration.
export { FINISH_BOOKING_CHECK_ID, FINISH_BOOKING_CODES } from './systems/match/index';

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

// The booking system (EVT2-01): the card rules, the segment draft and the card writer every
// booking command and the rival booker write cards through. See docs/design/booking.md.
export type {
  AngleDraft,
  CardPosition,
  CardShow,
  CardTarget,
  EditBlockCode,
  MatchDraft,
  ParticipantDraft,
  SegmentDraft,
  SegmentDraftInput,
  StructuralCheck,
  StructuralProblemCode,
  WriteSegmentArgs,
} from './systems/booking/index';
export {
  AngleDetailsDraftSchema,
  AngleDraftSchema,
  canReadCard,
  cardSegments,
  clearCard,
  draftFromSegment,
  EDIT_BLOCK_CODES,
  editBlockOf,
  emptyCrew,
  hasCard,
  MatchDetailsDraftSchema,
  MatchDraftSchema,
  moveSegment,
  PARK_SLOT,
  ParticipantDraftSchema,
  removeSegment,
  SegmentDraftSchema,
  setPlannedOutcome,
  STRUCTURAL_PROBLEM_CODES,
  structuralProblems,
  writeSegment,
} from './systems/booking/index';
export { CardWriteError } from './core/errors';
// The booking commands (EVT2-02): add, update, remove, move, set result and clear, each checked
// against who runs the show and whether its card can still change. See
// docs/design/booking.md#commands.
export type {
  AddSegmentArgs,
  BookingCommandReasonCode,
  CardChange,
  MoveSegmentArgs,
  SetResultArgs,
  UpdateSegmentArgs,
} from './systems/booking/index';
export { BOOKING_COMMAND_REASON_CODES, CARD_CHANGES } from './systems/booking/index';

// The booking screen's reads (EVT2-03): the shows to book, a card with its derived slot roles, the
// workers who can go on it with their availability chips. See docs/design/booking.md#queries. The
// show-day gate is the shows system's `shows.tonight` (EVT2-09, below).
export type {
  AvailabilityView,
  AvailableTeamRow,
  AvailableWorkerRow,
  AvailableWorkersView,
  BookingCard,
  BookingPersonView,
  BookingResultView,
  BookingSectionView,
  BookingSegmentView,
  BookingShowRow,
  BookingShowsView,
  BookingShowView,
  BookingSideView,
  BookingSlotView,
  BookingTitleOption,
  BookingTitleView,
  WorkerPickKind,
} from './systems/booking/index';
export {
  AVAILABILITY_LABELS,
  availabilityLabel,
  BOOKING_UNAVAILABLE_REASON,
  DEFAULT_BOOKING_SHOWS,
  MAX_BOOKING_SHOWS,
  MAX_WORKER_SEARCH,
  slotLabel,
  WORKER_PICK_KINDS,
} from './systems/booking/index';

// The booking checks (EVT2-04): `validateCard`, the one answer the booking screen, `shows.runTonight`
// and the rival booker (AIP4) share, the check registry other features plug their rules into, and
// the minimum-filled formula. See docs/design/booking.md#validation.
export type {
  BookingCheck,
  BookingCheckInput,
  BookingIssue,
  BookingIssueDraft,
  BookingSeverity,
  BookingValidation,
  ChecklistItem,
  MinFilledMainSlotsInputs,
  ValidateCardDeps,
} from './systems/booking/index';
export {
  CHECK_FAILED_CODE,
  minFilledMainSlots,
  registerBookingCheck,
  registeredBookingChecks,
  validateCard,
} from './systems/booking/index';

// The shows system (EVT3-01): show night's domain events (`segment.completed`, `show.completed`,
// `title.changed`, `title.defended`), trace kinds and refs, random stream and tunables. The phase
// and queries arrive with EVT3-03..05. See docs/design/show-night.md.
export {
  RIVAL_SEGMENT_SCORE_TRACE_KIND,
  SEGMENT_SCORE_TRACE_KIND,
  SHOW_SCORE_TRACE_KIND,
  SHOWS_OFFSCREEN_STREAM,
  SHOWS_TRACE_KINDS,
  TITLE_OUTCOME_TRACE_KIND,
  segmentScoreTraceRef,
  showScoreTraceRef,
  showsSystem,
  showsTunables,
  titleOutcomeTraceRef,
  traceRefFromKey,
} from './systems/shows/index';

// The show score (EVT3-02): the slot-weighted show score, the off-screen score of a rival show
// nobody booked, the show's stars, and the modifier seam later features (EVT4, CRTV, BRW) add show
// score lines through. See docs/design/show-night.md#show-score and #seams.
export {
  OFFSCREEN_SHOW_SCORE_DOC_REF,
  SHOW_SCORE_DOC_REF,
  SHOW_SCORE_MAX,
  SHOW_SCORE_MIN,
  SHOW_SCORE_MODIFIER_STAGES,
  SHOW_STARS_MAX,
  SHOW_STARS_MIN,
  listShowScoreModifiers,
  offscreenShowScore,
  registerShowScoreModifier,
  showScore,
  showStars,
  sortShowScoreModifiers,
  unregisterShowScoreModifier,
  type OffscreenShowScoreInputs,
  type ShowScoreDeps,
  type ShowScoreInputs,
  type ShowScoreModifier,
  type ShowScoreModifierStage,
  type ShowScoreResult,
  type ShowSlotInput,
  type ShowStarsInputs,
} from './systems/shows/index';

// Show night (EVT3-03): the `shows.runShows` phase that runs every show dated today, rates each
// segment and writes results, plus the seams later features plug into: segment result appliers
// and the match outcome resolver. See docs/design/show-night.md#phase and #seams.
export {
  BOOKED_RESULT_REASON,
  NO_PLAN_NO_CONTEST_REASON,
  OUTCOME_DECISION_LABEL,
  hasShowsToday,
  isSegmentRun,
  listSegmentResultAppliers,
  matchOutcomeResolver,
  plannedOrNoContest,
  registerMatchOutcomeResolver,
  registerSegmentResultApplier,
  runShowsPhase,
  showsPhases,
  unregisterMatchOutcomeResolver,
  unregisterSegmentResultApplier,
  type MatchOutcomeDeps,
  type MatchOutcomeInput,
  type MatchOutcomeResolution,
  type MatchOutcomeResolver,
  type MatchOutcomeSide,
  type SegmentResult,
  type SegmentResultApplier,
  type SegmentResultSide,
} from './systems/shows/index';

// Title outcomes and appearances (EVT3-04): the built-in `shows.titleOutcome` applier that moves
// or keeps each title on the line, and the per-show appearance counts with their 1 January reset.
// See docs/design/show-night.md#title-outcomes and #appearances.
export {
  TITLE_OUTCOME_APPLIER_ID,
  countAppearances,
  countsAsDefence,
  resetAppearancesPhase,
  showWorkers,
  titleOutcomeApplier,
  titleOutcomeDecision,
  type TitleOutcome,
  type TitleOutcomeDeps,
  type TitleOutcomeInputs,
} from './systems/shows/index';

// Results queries (EVT3-05): `shows.results` (one show's results page), `shows.lastCompleted` and
// `shows.completedSince` (compact lines for the Office panel and the "See results" links), and the
// view types screens import. See docs/design/show-night.md#results-queries.
export {
  DEFAULT_COMPLETED_SINCE,
  MAX_COMPLETED_SINCE,
  MAX_RESULTS_RANGE_DAYS,
  RESULTS_RANGE_MESSAGES,
  RESULTS_SCOPES,
  SHOW_NOT_FOUND_MESSAGE,
  type CompletedSinceArgs,
  type ResultsScope,
  type SegmentMemberView,
  type SegmentOutcomeView,
  type SegmentRatingView,
  type SegmentResultView,
  type SegmentSideView,
  type SegmentTitleView,
  type ShowResultView,
  type ShowResultsView,
  type ShowSummaryView,
  type TitleResultOutcome,
} from './systems/shows/index';

// The show report (EVT3-09): the show score breakdown and each segment's top reasons, both read
// from the stored traces. See docs/design/show-night.md#show-report.
export {
  SEGMENT_REASON_BASELINE,
  SEGMENT_REASON_LIMIT,
  segmentReasons,
  showScoreBreakdown,
  type BreakdownSegment,
  type SegmentReasonView,
  type ShowScoreBreakdownView,
  type ShowScoreRowKind,
  type ShowScoreRowView,
} from './systems/shows/index';

// MTCH2 on show night (EVT3-07): the match outcome resolver the match bundle registers with show
// night, and the match result trace behind the results page's winner Why?. See
// docs/design/show-night.md#integration.
export {
  BOOKED_NO_CONTEST_REASON,
  MATCH_OUTCOME_RESOLVER_ID,
  RANDOM_WINNERS_SET_ASIDE_NOTE,
  bookedResultFallbackNote,
  planSetAsideNote,
  resolveOnShowNight,
  showNightOutcomeResolver,
} from './systems/match/index';
export {
  MATCH_RESULT_TRACE_KIND,
  RIVAL_MATCH_RESULT_TRACE_KIND,
  matchResultTraceRef,
} from './systems/shows/index';
export {
  popularityGain,
  type PopularityFinish,
  type PopularityGainInputs,
  type PopularityOpponent,
  type PopularityOutcome,
} from './systems/match/index';

// Momentum from a match result and a worker's earlier matches (MTCH3-02): the pure momentum
// formula, the prior-match history behind win streaks and Recent form, and the door's starting
// momentum so the aftermath's "before" matches the door's. See
// docs/design/match-aftermath.md#momentum-gain and #prior-matches.
export type {
  MatchPosition,
  MatchResultForSide,
  MomentumGainInputs,
  MomentumOpponent,
  PriorMatch,
  WinStreak,
} from './systems/match/index';
export {
  MOMENTUM_GAIN_DOC_REF,
  NO_CONTEST_MOMENTUM_NOTE,
  NO_CONTRACT_MOMENTUM_REASON,
  momentumGain,
  noContractMomentum,
  priorMatchesOf,
  resultOf,
  winStreakBefore,
} from './systems/match/index';
export { initialMomentum } from './systems/workers/index';

// Momentum cools off each week (MTCH3-07): the pure drift formula and the reason key its door
// changes carry. See docs/design/match-aftermath.md#momentum-drift.
export type { MomentumDriftInputs } from './systems/match/index';
export {
  MOMENTUM_DRIFT_DOC_REF,
  MOMENTUM_DRIFT_REASON_KEY,
  momentumDrift,
} from './systems/match/index';

// Promotion popularity after shows (EVT5-01): show reach, region expectation and the popularity
// change formulas. See docs/design/promotion-popularity.md.
export * from './systems/promoPop/index';

// The finance system (ECO1-01): `postMoney`, the only way cash moves during play, the player-facing
// ledger category labels, the finance trace kinds and events. See docs/design/finances.md.
export {
  CASH_TRACE_KIND,
  FINANCE_TRACE_KINDS,
  FINANCE_TUNABLE_CATEGORY,
  LEDGER_CATEGORY_LABELS,
  LEDGER_ENTRY_TRACE_KIND,
  POST_MONEY_MEMO_MAX,
  RIVAL_LEDGER_ENTRY_TRACE_KIND,
  cashTraceRef,
  financeSystem,
  financeTunables,
  ledgerCategoryKind,
  ledgerEntryTraceRef,
  postMoney,
  type LedgerCategoryKind,
  type PostMoneyInput,
} from './systems/finance/index';

// Promotion reach and size (ECO1-02): the one answer to "how big is this company?". Formulas read
// reach, never the size label. See docs/design/finances.md#reach-and-size.
export {
  PROMOTION_SIZE_LABELS,
  PROMOTION_SIZES,
  promotionReach,
  promotionSize,
  reachOf,
  type CompanyNextSize,
  type CompanyView,
  type PromotionReach,
  type PromotionReachInputs,
  type PromotionSize,
} from './systems/finance/index';

// Payroll, medical, the cash Why? and the books queries (ECO1-03). See docs/design/finances.md.
export {
  canSeeBooks,
  DEFAULT_LEDGER_LIMIT,
  DEFAULT_MONTHLY_MONTHS,
  MAX_LEDGER_LIMIT,
  MAX_MONTHLY_MONTHS,
  MEDICAL_LEVEL_LABELS,
  MONTH_END_CASH_MONTHS,
  NOT_YOUR_BOOKS,
  payrollLinesOf,
  type FinanceLedgerArgs,
  type FinanceLedgerPage,
  type FinanceLedgerRow,
  type FinanceMonth,
  type FinanceMonthly,
  type FinanceMonthlyArgs,
  type FinanceOverview,
  type MedicalLevel,
  type MonthTotals,
  type PayrollLine,
  type PayrollReason,
} from './systems/finance/index';

// The aftermath engine (MTCH3-03): where a match's popularity change spreads (show region,
// neighbours, registered reach), the aftermath of one match for the lab and show night, the applier
// MTCH3-05 registers, the `aftermaths` table and `match.aftermath`. See
// docs/design/match-aftermath.md#regional-spread.
export {
  AFTERMATH_OUTCOMES,
  AftermathSchema,
  aftermathsTable,
  type Aftermath,
  type AftermathOutcome,
  type AftermathRegion,
} from './model/entities/aftermath';
export {
  AFTERMATH_DOC_REF,
  AFTERMATH_NOT_FOUND_MESSAGES,
  AFTERMATH_TRACE_KINDS,
  SHOW_REGION_REASON,
  aftermathsToPrune,
  applySegmentAftermath,
  computeSegmentAftermath,
  hasMomentum,
  listPopularityReach,
  momentumGainTraceRef,
  popularityGainTraceRef,
  pruneAftermathsPhase,
  registerPopularityReach,
  resetPopularityReachForTests,
  segmentRegionWeights,
  type AftermathInput,
  type AftermathMomentum,
  type AftermathNoMomentum,
  type AftermathPopularity,
  type AftermathQueryArgs,
  type AftermathRegionRow,
  type AftermathRegionView,
  type AftermathResult,
  type AftermathRollupRow,
  type AftermathSegmentView,
  type AftermathWorker,
  type AftermathWorkerView,
  type AppliedAftermath,
  type PopularityReachProvider,
  type ReachContext,
  type ReachRegion,
  type RegionWeightLine,
  type SegmentAftermath,
  type SegmentRegionWeights,
  type SimulatedAftermathInput,
} from './systems/match/index';
export {
  previewMomentumChange,
  previewPopularityChange,
  type MomentumPreview,
  type PopularityPreview,
  type PopularityPreviewRegion,
} from './systems/workers/index';

// Show costs, the staff policies, `finance.setPolicy` and the policy previews (ECO1-04). See
// docs/design/finances.md#show-costs and #policies.
export {
  AWAY_SHOWS_NOTE,
  ESTIMATED_CARD_NOTE,
  estimateShowCosts,
  isPolicyLevel,
  listPolicyEffects,
  POLICY_AREA_DESCRIPTIONS,
  POLICY_AREA_LABELS,
  POLICY_LEVEL_LABELS,
  POLICY_LEVELS,
  POLICY_PREVIEW_DAYS,
  postShowCosts,
  registerPolicyEffect,
  SET_POLICY_REASON_CODES,
  setPolicyIn,
  SHOW_COST_CATEGORIES,
  showCosts,
  showCostsOf,
  showWorkersOf,
  type FinancePolicies,
  type FinancePolicyPreview,
  type PolicyEffect,
  type PolicyEffectLine,
  type PolicyEffectTone,
  type PolicyLevel,
  type PolicyLevelPreview,
  type PolicyView,
  type SetPolicyArgs,
  type SetPolicyReasonCode,
  type SetPolicyResult,
  type ShowCostCategory,
  type ShowCosts,
  type ShowDistance,
  type ShowEstimate,
  type ShowWorker,
} from './systems/finance/index';

export {
  RECENT_FORM_DEFAULT_LIMIT,
  RECENT_FORM_MAX_LIMIT,
  RECENT_FORM_NOT_FOUND_MESSAGE,
  type RecentFormArgs,
  type RecentFormOpponent,
  type RecentFormResult,
  type RecentFormRow,
} from './systems/match/index';

export * from './systems/boxOffice/index';
// Promotion history (DAY2-01): the `promotionSnapshots` table, the weekly Monday rows, the
// new-game baseline, the thinning of old weeks and the registry other features use to add a
// number to every row. See docs/design/office.md#history.
export {
  PROMOTION_SNAPSHOT_GRANULARITIES,
  PromotionSnapshotGranularitySchema,
  PromotionSnapshotPopularitySchema,
  PromotionSnapshotSchema,
  promotionSnapshotKey,
  promotionSnapshotTable,
  SNAPSHOT_FIELD_KEY_PATTERN,
  SnapshotFieldKeySchema,
  type PromotionSnapshot,
  type PromotionSnapshotGranularity,
  type PromotionSnapshotPopularity,
  type SnapshotFieldKey,
} from './model/entities/promotion-snapshot';
export {
  BUILT_IN_SNAPSHOT_COLUMNS,
  buildPromotionSnapshot,
  compactPromotionSnapshots,
  createSnapshotRoller,
  fullDetailCutoff,
  OFFICE_BASELINE_SNAPSHOT_STEP,
  officeSystem,
  officeTunables,
  planCompaction,
  promotionSnapshotFields,
  registerPromotionSnapshotField,
  WEEKLY_SNAPSHOT_PHASE_ID,
  WEEKLY_SNAPSHOT_PHASE_ORDER,
  weeklySnapshotPhase,
  writePromotionSnapshots,
  type CompactionPlan,
  type CompactionRow,
  type PromotionSnapshotColumns,
  type PromotionSnapshotFieldSpec,
  type SnapshotFieldKpi,
  type SnapshotFieldUnit,
  type SnapshotFieldVisibility,
  type SnapshotRoller,
} from './systems/office/index';
// The player's show night (EVT2-09): no Lock card. The `shows.tonight` gate stops the day on every
// open show of theirs; `shows.runTonight` runs it from the show screen through the same code the
// shows phase uses; before-a-show-runs hooks let a feature act just before any show runs (EVT6-03's
// venue). See docs/design/show-night.md#the-players-shows.
export type {
  BeforeShowRunsHook,
  BeforeShowRunsInput,
  RunTonightReasonCode,
} from './systems/shows/index';
export {
  listBeforeShowRuns,
  MAX_RUN_REASONS,
  myShowsOn,
  registerBeforeShowRuns,
  RUN_TONIGHT_REASON_CODES,
  SHOW_NIGHT_ACTION_HINT,
  SHOWS_TONIGHT_GATE_ID,
  unregisterBeforeShowRuns,
} from './systems/shows/index';

// Headline popularity (DAY2-02): the one roll-up level the Office and the top bar lead with, its
// stored Why? (`office.popularity`), the trace sections seam other features add lines through and
// `office.fanBase`. Use `headlinePopularityValue` for "a promotion's popularity" as one number.
// See docs/design/office.md#headline-popularity.
export {
  createOfficeRoller,
  fanBaseQuery,
  formatPopularity,
  HEADLINE_POPULARITY_DOC_REF,
  HEADLINE_SCOPE_CHANGED_SUBSCRIPTION_ID,
  HEADLINE_SCOPES,
  HEADLINE_TRAIL_NODES,
  headlinePopularity,
  headlinePopularityOf,
  headlinePopularityValue,
  NO_PROMOTION,
  officeQueries,
  POPULARITY_CHANGED_SUBSCRIPTION_ID,
  POPULARITY_TRACE_KIND,
  popularityTraceRef,
  popularityTraceSectionLines,
  popularityTraceSections,
  recordAllHeadlinePopularity,
  recordHeadlinePopularity,
  registerPopularityTraceSection,
  type FanBaseView,
  type HeadlinePlace,
  type HeadlinePopularityInputs,
  type HeadlineScope,
  type OfficeRoller,
  type PopularityTraceSectionSpec,
} from './systems/office/index';

// The Office's numbers (DAY2-03): KPI cards with deltas and sparklines, the world clock, the world
// overview for a seat with no promotion, and the `office.dashboard` and `office.series` queries.
// See docs/design/office.md#kpis-and-deltas and #queries.
export {
  averageMorale,
  BAD_RANGE,
  buildKpis,
  BUILT_IN_OFFICE_METRICS,
  dashboardQuery,
  HIDDEN,
  kpiDelta,
  MAX_SERIES_POINTS,
  officeClock,
  officeMetric,
  previousSnapshot,
  RANGE_TOO_LONG,
  rosterSize,
  seriesQuery,
  trendSeries,
  UNKNOWN_METRIC,
  worldOverview,
  type OfficeClock,
  type OfficeClockSeason,
  type OfficeDashboard,
  type OfficeKpi,
  type OfficeKpiDelta,
  type OfficeMetric,
  type OfficeSeries,
  type OfficeSeriesArgs,
  type TrendSeries,
  type WorldOverview,
  type WorldOverviewPromotion,
} from './systems/office/index';
// The roster (WRK2-01): the `roster.rows` query, its rows and the push gap. See
// docs/design/roster.md.
export {
  buildRosterRows,
  computePushGap,
  computePushVerdict,
  PUSH_GAP_DOC_REF,
  PUSH_VERDICT_DOC_REF,
  PUSH_VERDICTS,
  pushIndexOf,
  roleHasPush,
  ROSTER_NO_PROMOTION,
  ROSTER_NOT_YOURS,
  ROSTER_ROLE_GROUPS,
  ROSTER_UNKNOWN_PROMOTION,
  rosterRoleGroupOf,
  rosterRowsQuery,
  rosterSystem,
  rosterTunables,
  type PushGapInputs,
  type PushVerdict,
  type RosterBrand,
  type RosterFilter,
  type RosterPromotion,
  type RosterPushGap,
  type RosterRoleGroup,
  type RosterRow,
  type RosterRowAvailability,
  type RosterRowsArgs,
  type RosterView,
} from './systems/roster/index';

// The rival desk (AIP1-01): the `aiProfiles` and `aiDecisions` tables, which promotions and brands
// the computer runs, and the new-game profile step. See docs/design/rival-desk.md.
export {
  AI_DECISION_KIND_PATTERN,
  AI_DECISION_MAX_REFS,
  AiDecisionKindSchema,
  AiDecisionRefsSchema,
  AiDecisionSchema,
  aiDecisionDateKey,
  aiDecisionsTable,
  type AiDecision,
  type AiDecisionRefs,
} from './model/entities/ai-decision';
export {
  AiProfileSchema,
  aiProfilesTable,
  aiUnitKey,
  FeaturedSchema,
  FeaturedSlotSchema,
  type AiProfile,
  type Featured,
  type FeaturedSlot,
} from './model/entities/ai-profile';
export {
  AIP_CREATE_PROFILES_STEP,
  aipSystem,
  computerUnits,
  decisionLogPruneThrough,
  ensureProfile,
  isDecisionExpired,
  profileOf,
  pruneDecisionLog,
  TASTE_AXES,
  TASTE_AXIS_LABELS,
  TasteSchema,
  unitControllerOf,
  unitCovers,
  type AiUnit,
  type Taste,
  type TasteAxis,
} from './systems/aip/index';
// The roster's counts and on-demand Why? (WRK2-02): `roster.summary` and `roster.explain`. See
// docs/design/roster.md#roster-summary and #roster-explain.
export {
  ROSTER_EXPLAIN_METRICS,
  ROSTER_PUSHES,
  ROSTER_SHARED_BRAND_NAME,
  ROSTER_TOP_COUNT,
  rosterExplainQuery,
  rosterSummaryQuery,
  type RosterBrandCount,
  type RosterExplainArgs,
  type RosterExplainMetric,
  type RosterExplanation,
  type RosterPush,
  type RosterSummary,
  type RosterSummaryArgs,
} from './systems/roster/index';

// The roster's push command (WRK2-03): `roster.setPush`, one or many rows, all or nothing. See
// docs/design/roster.md#set-push.
export {
  applySetPush,
  DUPLICATE_EMPLOYMENT_MESSAGE,
  SET_PUSH_MAX_ROWS,
  SET_PUSH_REASON_CODES,
  SET_PUSH_REASON_KEY,
  setPushCommand,
  setPushRefusals,
  type RosterSetPushArgs,
  type SetPushDoor,
  type SetPushReasonCode,
} from './systems/roster/index';
// Rival rules (AIP1-02): the `ai.*` shortcut tunables read through `aiShortcut` (D-01), the
// `aip.rules` query and the viewer redaction helpers. MTCH1-08 detects AIP1 by the `aiShortcut`
// export.
export {
  AI_SHORTCUT_KEYS,
  AI_SHORTCUT_RULES,
  AI_SHORTCUTS,
  aiShortcut,
  aiShortcutConsumers,
  aiShortcutOn,
  aiShortcutsFor,
  CASH_DISPLAY_BANDS,
  CASH_DISPLAY_BANDS_REASON,
  canSeePrivate,
  isAiShortcutFlag,
  privateInputOf,
  redactForViewer,
  registerAiShortcutConsumer,
  visibilityOf,
  type AipRulesView,
  type AiShortcutConsumer,
  type AiShortcutFlagKey,
  type AiShortcutInfo,
  type AiShortcutKey,
  type AiShortcutRuleView,
  type AiShortcutSet,
  type AiShortcutValue,
  type Band,
  type Redacted,
  type Visibility,
} from './systems/aip/index';

export {
  AI_JOB_CADENCES,
  AIP_PRUNE_DECISION_LOG_PHASE_ID,
  AIP_RUN_TURNS_PHASE_ID,
  aiJobs,
  decisionKindOf,
  decisionKinds,
  decisionTraceRef,
  isDue,
  MAX_DECISION_IMPORTANCE,
  monthlyDayOf,
  MONTHLY_SPREAD_DAYS,
  nextDueOn,
  pruneDecisionLogOn,
  registerAiJob,
  registerDecisionKind,
  ROSTER_REVIEW_DECISION_KIND,
  unitOffset,
  unitShowsOn,
  WEEKLY_SPREAD_DAYS,
  writeAiDecision,
  type AiJob,
  type AiJobCadence,
  type AiJobContext,
  type AiJobSpec,
  type AiJobUnits,
  type DecisionKind,
  type DecisionKindSpec,
  type DecisionWriteContext,
  type RecordDecisionSpec,
} from './systems/aip/index';

// Rival desk taste, card value and roster needs (AIP1-04).
export {
  cardValue,
  defaultTaste,
  needSummaryText,
  rosterNeeds,
  rosterReviewDecision,
  slotsDemanded,
  storedTaste,
  tasteOf,
  type CardValueInputs,
  type DefaultTasteInputs,
  type Need,
  type NeedKind,
  type NeedRefs,
  type NeedsChampion,
  type NeedsInputs,
  type NeedsWrestler,
  type TracedTaste,
} from './systems/aip/index';

// Rival desk roster review and the Promotions queries (AIP1-05): one roster rule (`unitRoster`),
// the formula inputs, the reveal rule and `promotions.list` / `.profile` / `.roster`, `aip.needs`
// and `aip.decisionLog`. See docs/design/rival-desk.md#promotions-queries.
export {
  aipDecisionLogQuery,
  aipNeedsQuery,
  BRAND_NOT_FOUND,
  cardValueInputsFor,
  DECISION_NOT_FOUND,
  decisionSummaryText,
  DEFAULT_DECISION_LOG_LIMIT,
  deciderBrandOf,
  employmentAt,
  holderNamesOf,
  isRevealedTo,
  MAX_DECISION_LOG_LIMIT,
  needsInputsFor,
  openReignOf,
  PROMOTION_NOT_FOUND,
  promotionProfileQuery,
  promotionRosterQuery,
  promotionsListQuery,
  ROSTER_REVIEW_JOB_ID,
  ROSTER_REVIEW_SUMMARY_KEY,
  rosterReviewSummary,
  rosterReviewSummaryText,
  SHOWS_PER_MONTH_DAYS,
  showDatesAhead,
  unitNameOf,
  unitOf,
  unitRoster,
  unitTitles,
  type AipDecisionLog,
  type AipDecisionLogArgs,
  type AipDecisionLogEntry,
  type AipDecisionLogKind,
  type AipNeeds,
  type AipNeedsArgs,
  type AipNeedView,
  type CardValueShared,
  type ChampionLine,
  type ControlledBy,
  type PlaceRef,
  type PromotionChampion,
  type PromotionListRow,
  type PromotionProfile,
  type PromotionProfileArgs,
  type PromotionProfileBrand,
  type PromotionProfileShortcut,
  type PromotionProfileShow,
  type PromotionRoster,
  type PromotionRosterArgs,
  type PromotionRosterRow,
  type PromotionRosterTasteAxis,
  type RosterUnit,
} from './systems/aip/index';

// AIP1-07: the rival desk wired into partners on main: the rating policy provider behind MTCH1's
// door (registers itself on import) and the Match lab's "Rate as" options.
export {
  FULL_RULES_POLICY_LABEL,
  NO_RIVAL_BONUS_LINE,
  RIVAL_POLICY_LABEL,
  RIVAL_RATING_POLICY_ID,
  rivalRatingPolicy,
  rivalShortcutLine,
} from './systems/aip/index';
export type { LabRateAsOption } from './systems/match';
export {
  companySizeOf,
  eco1CompanySize,
  setCompanySizeSource,
  type CompanySize,
  type CompanySizeSource,
} from './systems/aip/index';

// AIP4-01: the card planner's groundwork: the `Rival booking` tunables, the `aip.card` and
// `aip.autofill` streams, the card pool and the card-shape formulas. See
// docs/design/rival-booking.md.
export {
  aipCardTunables,
  appearanceCapReason,
  AUTOFILL_STREAM,
  buildCardPool,
  CARD_EMPLOYMENT_ROLES,
  CARD_PLAN_STREAM,
  MAIN_EVENT_RULE,
  mainEventMustBeMatch,
  NO_BACK_TO_BACK_REASON,
  NO_HOUSE_SHOWS_REASON,
  RIVAL_BOOKING_CATEGORY,
  talkSlotsFor,
  talkValueOf,
  tiredReason,
  titleMatchCapFor,
  type CardCandidate,
  type CardExclusion,
  type CardPool,
  type CardPoolArgs,
  type CardPoolShow,
  type CardTeam,
  type CardTitle,
  type ContractBlock,
  type TalkSlotsInputs,
  type TitleMatchCapInputs,
} from './systems/aip/index';

// AIP4-02: the title picture: which titles a rival defends tonight, who challenges and in what
// match type. See docs/design/rival-booking.md#title-picture.
export {
  decideTitlePicture,
  pickChallengers,
  titleUrgency,
  type ChallengerPick,
  type PlannedSide,
  type PlannedTitleMatch,
  type SkippedTitle,
  type TitlePicture,
} from './systems/aip/index';

// AIP4-03: filling the rest of the card: storyline segments, weighted match types, real teams, the
// fallback chain and talking segments. See docs/design/rival-booking.md#filling-the-card.
export {
  buildTalkSegment,
  fillCard,
  findWorker,
  matchTypeWeight,
  type CardBookings,
  type CardFill,
  type FillCardArgs,
  type OpenCardSlot,
  type PlannedSegment,
  type PlannedSegmentSource,
} from './systems/aip/index';

// AIP4-04: card scores, the running order and planCard, the read-only entry point that plans a
// whole show. See docs/design/rival-booking.md#planning-a-card.
export {
  cardScore,
  orderCard,
  planCard,
  type CardPlan,
  type PlanCardArgs,
  type PlanCardMode,
  type PlannedPlacement,
  type PlanOpenSlot,
} from './systems/aip/index';

// AIP4-05: rivals book their shows on show day (`aip.bookShow`), the booked-card steps later
// features plug into, and the card decision's summary texts. See
// docs/design/rival-booking.md#show-day.
export {
  BOOK_SHOW_JOB_ID,
  CARD_BOOKED_SUMMARY_KEY,
  CARD_DECISION_KIND,
  CARD_PLAN_TRACE_KIND,
  CARD_SLOT_TRACE_KIND,
  cardBookedText,
  registerBookedCardStep,
  SHOW_CANCELLED_SUMMARY_KEY,
  showCancelledText,
  type BookedCardInput,
  type BookedCardStepSpec,
  type ShowBookingContext,
} from './systems/aip/index';

// AIP4-06: Auto-fill for the player's own card (`aip.autoFillCard`) and a promotion's shows with
// their cards (`aip.showCards`, rival cards revealed when they air). See
// docs/design/rival-booking.md#auto-fill and #show-cards.
export {
  AUTO_FILL_REASON_CODES,
  CARD_FULL_MESSAGE,
  CARD_HIDDEN_TEXT,
  SHOW_CARD_STATUS_LABELS,
  type AutoFillCardArgs,
  type AutoFilledSlot,
  type AutoFillOpenSlot,
  type AutoFillReasonCode,
  type AutoFillResult,
  type ShowCardPerson,
  type ShowCardRow,
  type ShowCards,
  type ShowCardsArgs,
  type ShowCardSegment,
  type ShowCardSide,
  type ShowCardSlot,
  type ShowCardStatusLabel,
} from './systems/aip/index';

// AIP5-01: rival results groundwork: tunables, streams, trace and decision kinds, the
// computer-only guard and the input gatherer. See docs/design/rival-booking.md#winners.
export {
  aipResultsTunables,
  isComputerBooked,
  marketPopularity,
  NO_POPULARITY_HISTORY_NOTE,
  popularityHistoryOf,
  registerPopularityHistorySource,
  rivalSegmentInputsOf,
  TITLE_DECISION_KIND,
  TITLE_TRACE_KIND,
  titleTraceRef,
  TITLES_STREAM,
  WINNER_DECISION_KIND,
  WINNER_TRACE_KIND,
  winnerTraceRef,
  WINNERS_STREAM,
  type PopularityHistorySource,
  type PopularityReading,
  type RivalChallengerSide,
  type RivalOpenReign,
  type RivalSegmentInputs,
  type RivalSide,
  type RivalStorylineContext,
  type RivalTitleContext,
} from './systems/aip/index';

// AIP5-02: who a rival booker puts over in a match, as a traced decision (reused by BRW6).
// See docs/design/rival-booking.md#winners.
export {
  DRAW_PLAN,
  matchWinner,
  NO_GUT_FEELING_NOTE,
  parseWinnerPlan,
  rivalSideValue,
  winnerReasonText,
  winPlanKey,
  type MatchWinnerDeps,
  type MatchWinnerInputs,
  type MatchWinnerResult,
  type MatchWinnerSide,
  type MatchWinnerStoryline,
  type RivalSideValueDeps,
  type RivalSideValueInputs,
  type WinnerPlan,
  type WinnerReasonKey,
  type WinnerReasonNames,
} from './systems/aip/index';

// AIP5-03: whether a rival booker moves a title, and to whom, as traced pieces (reused by BRW6
// and MP). See docs/design/rival-booking.md#title-changes.
export {
  challengerPool,
  RETAIN_PLAN,
  titleChange,
  titleChangeChance,
  titleReasonText,
  type ChallengerPool,
  type ChallengerPoolDeps,
  type ChallengerPoolInputs,
  type ChallengerPoolKind,
  type ChallengerPoolSide,
  type PopularityPoint,
  type TitleChangeChanceDeps,
  type TitleChangeChanceInputs,
  type TitleChangeDeps,
  type TitleChangeInputs,
  type TitleChangeResult,
  type TitleReasonKey,
  type TitleReasonNames,
  type TitleTasteSource,
} from './systems/aip/index';
// POL4-08: rolling history. The last `history.keepDetailDays` days are kept in detail; older shows
// keep a summary (`EventResult.history`), older money monthly totals (`Promotion.ledgerMonths`).
// See docs/design/save-format.md#history-retention.
export {
  detailKeptFrom,
  detailKeptNote,
  detailKeptNoteFor,
  HISTORY_ROLL_UP_PHASE_ID,
  historySystem,
  keepDetailPeriodText,
  rollUpHistory,
  segmentsToKeep,
  type RollUpCounts,
} from './systems/history/index';
export { mainEventSummaryOf, type ShowHistoryView } from './systems/shows/index';
export type { ShowChangePrunedView } from './systems/promoPop/index';
export { monthBreakdownOf, rolledUpMonth } from './systems/finance/index';
export type { ShowHistory, ShowHistoryMainEvent } from './model/entities/event-instance';
export type { LedgerMonth } from './model/entities/ledger-entry';

// AIP5-04: rival results go live: the booked-card step, the method roll, the read view and the
// two queries. See docs/design/rival-booking.md#how-a-rival-shows-results-are-decided.
export {
  decideResults,
  DECIDE_RESULTS_STEP_ID,
  NO_DECISION_MESSAGE,
  NOT_REVEALED_MESSAGE,
  pickRivalMethod,
  REASON_NOT_KEPT,
  resultsSummaryText,
  segmentDecisionView,
  TITLE_CHANGE_SUMMARY_KEY,
  TITLE_CROWN_SUMMARY_KEY,
  TITLE_RETAIN_SUMMARY_KEY,
  TITLE_VACANT_SUMMARY_KEY,
  WINNERS_BOOKED_SUMMARY_KEY,
  type AipRecentTitleChanges,
  type AipRecentTitleChangesArgs,
  type AipSegmentDecisionArgs,
  type AipShowDecisions,
  type AipShowDecisionsArgs,
  type AipTitleChange,
  type RivalMethodArgs,
  type SegmentDecisionTitle,
  type SegmentDecisionView,
  type SegmentDecisionWinner,
  type SegmentTitleActual,
  type SegmentTitlePlan,
  type TitlePlanKind,
} from './systems/aip/index';

// Injury catalog (WRK6-01): the injury kinds snapshotted into `WorldMeta.catalogs.injuries` at new
// game, and the readers phases, queries and commands use. See docs/design/data-packs.md, "Health".
export type { InjuryKind, InjurySeverity } from './model/catalogs';
export {
  INJURY_DAYS_MAX,
  INJURY_DAYS_MIN,
  INJURY_KEY_PREFIX,
  INJURY_SEVERITIES,
  InjuryCatalogSchema,
  injuryCatalogOf,
  InjuryKindSchema,
  injuryKindOf,
} from './model/catalogs';
export {
  INJURY_CONTENT_PREFIX,
  injuryContentKey,
  injuryKindRecord,
  type InjuryKindRecord,
} from './persistence/packs';
