/**
 * The save document: what a save *is*.
 *
 * One JSON document holds a format marker and version, the engine version that wrote it, when it
 * was saved, a small header for save-slot lists, and the engine state: the serialised World (its
 * metadata and every table as an array of rows) plus the simulation's own parts (RNG streams,
 * tunable overrides, recent traces, events, the pipeline failure log and the command log).
 *
 * The World part is owned and validated here. The simulation parts are named slots whose schemas
 * are injected by the caller (SIM-10 passes the real ones); a slot nobody fills in accepts any
 * plain JSON value. That keeps this module free of simulation imports, so the simulation can build
 * its engine state on top of it without a dependency cycle.
 *
 * See `docs/design/save-format.md`.
 */

import { z } from 'zod';
import { zJsonValue, type JsonValue } from '../core/json';
import { zCents, zGameDate, zNonNegativeInt } from '../model/primitives';
import { TABLES } from '../model/tables';
import { WorldMetaSchema } from '../model/world-meta';
import { CURRENT_FORMAT_VERSION } from './migrations/registry';

/** The value of every save document's `format` field. */
export const SAVE_FORMAT = 'ringside-booker/save';

/** The simulation's named parts of the engine state, next to the World. */
export const SIM_STATE_PARTS = [
  'rng',
  'tunableOverrides',
  'traces',
  'events',
  'failureLog',
  'commandLog',
] as const;

export type SimStatePart = (typeof SIM_STATE_PARTS)[number];

/** Schemas for some or all of the simulation parts. A part left out accepts any plain JSON. */
export type StatePartSchemas = Partial<Readonly<Record<SimStatePart, z.ZodType>>>;

/** Longest save label, as typed by the player or generated for an autosave. */
export const SAVE_LABEL_MAX_LENGTH = 60;

/** Semantic version, such as `0.1.0` or `1.2.0-beta.1`. Informational only. */
const ENGINE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;

/**
 * The header: what a save-slot list shows without decompressing the world. It repeats a few facts
 * from the world (its name, dates and the saving controller's promotion), so it is rebuilt from the
 * world on every save and never edited on its own.
 */
export const SaveHeaderSchema = z.strictObject({
  worldName: z.string().min(1).max(80),
  /**
   * The promotion of the controller that saved, or null in a sandbox or observer game. There is no
   * single "player promotion" in a world (D-07), so the saver names it.
   */
  promotionName: z.string().min(1).max(60).nullable(),
  promotionShortName: z.string().min(1).max(8).nullable(),
  /** The world's current date. */
  gameDate: zGameDate,
  startDate: zGameDate,
  daysSimulated: zNonNegativeInt,
  /** That promotion's cash, or null when there is no promotion in the header. */
  cash: zCents.nullable(),
  label: z.string().min(1).max(SAVE_LABEL_MAX_LENGTH),
});

export type SaveHeader = z.infer<typeof SaveHeaderSchema>;

/**
 * Every table of the game world as an array of rows, keyed by table name. Listed by hand so each
 * table keeps its row type; a test checks the keys match `TABLES`.
 */
const SerializedTablesSchema = z.strictObject({
  people: z.array(TABLES.people.schema),
  promotions: z.array(TABLES.promotions.schema),
  brands: z.array(TABLES.brands.schema),
  employments: z.array(TABLES.employments.schema),
  teams: z.array(TABLES.teams.schema),
  stables: z.array(TABLES.stables.schema),
  relationships: z.array(TABLES.relationships.schema),
  titles: z.array(TABLES.titles.schema),
  titleReigns: z.array(TABLES.titleReigns.schema),
  eventDefinitions: z.array(TABLES.eventDefinitions.schema),
  eventInstances: z.array(TABLES.eventInstances.schema),
  segments: z.array(TABLES.segments.schema),
  participants: z.array(TABLES.participants.schema),
  storylines: z.array(TABLES.storylines.schema),
  seasons: z.array(TABLES.seasons.schema),
  continents: z.array(TABLES.continents.schema),
  countries: z.array(TABLES.countries.schema),
  regions: z.array(TABLES.regions.schema),
  venues: z.array(TABLES.venues.schema),
  networks: z.array(TABLES.networks.schema),
  deals: z.array(TABLES.deals.schema),
  mail: z.array(TABLES.mail.schema),
  news: z.array(TABLES.news.schema),
  ledgerEntries: z.array(TABLES.ledgerEntries.schema),
});

/**
 * The serialised World: its metadata and every table as an array of rows in ascending ID order.
 * Indexes are derived data and are not saved; loading rebuilds them. The world seed is
 * `meta.seed`. SIM-10's `EngineState` uses this for its `world` part.
 */
export const SerializedWorldSchema = z.strictObject({
  meta: WorldMetaSchema,
  tables: SerializedTablesSchema,
});

export type SerializedWorld = z.infer<typeof SerializedWorldSchema>;
export type SerializedTables = SerializedWorld['tables'];

/**
 * The schema for one simulation part: the injected schema, whose output must also be plain JSON,
 * or any plain JSON value when nothing was injected.
 */
function statePartSchema(injected: z.ZodType | undefined): z.ZodType<JsonValue> {
  return injected === undefined ? zJsonValue : injected.pipe(zJsonValue);
}

/**
 * Builds the schema of a current-version (v1) save document. `stateParts` supplies the schemas of
 * the simulation parts; each part left out accepts any plain JSON value. Issues inside a part are
 * reported at their full path, such as `state.rng.streams.injuries`.
 */
export function createSaveDocumentSchema(stateParts: StatePartSchemas = {}) {
  return z.strictObject({
    format: z.literal(SAVE_FORMAT),
    formatVersion: z.literal(CURRENT_FORMAT_VERSION),
    /** The engine build that wrote the save. Informational: loading never branches on it. */
    engineVersion: z.string().regex(ENGINE_VERSION_PATTERN, 'Expected a version such as 0.1.0'),
    /** Real-world time of the save, as an ISO 8601 timestamp passed in by the caller. */
    savedAt: z.iso.datetime({ offset: true }),
    header: SaveHeaderSchema,
    state: z.strictObject({
      world: SerializedWorldSchema,
      rng: statePartSchema(stateParts.rng),
      tunableOverrides: statePartSchema(stateParts.tunableOverrides),
      traces: statePartSchema(stateParts.traces),
      events: statePartSchema(stateParts.events),
      failureLog: statePartSchema(stateParts.failureLog),
      commandLog: statePartSchema(stateParts.commandLog),
    }),
  });
}

/** A validated current-version save document. */
export type SaveDocument = z.infer<ReturnType<typeof createSaveDocumentSchema>>;

/** The engine state a save holds: the World plus every simulation part. */
export type SaveState = SaveDocument['state'];
