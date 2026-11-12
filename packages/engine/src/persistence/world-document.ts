/**
 * Between a live World and a save document.
 *
 * - `serialiseWorld` writes the world's metadata and every table as an array of rows in canonical
 *   (ascending ID) order.
 * - `createSaveDocument` wraps an engine state (the serialised world plus the simulation parts) in
 *   a save document and builds its header. It is the one entry point for building a save from
 *   engine state.
 * - `worldToDocument` does both for a world and a set of simulation parts.
 * - `documentToWorld` builds a fresh World from a document: rows go straight into the tables
 *   through the bulk path (no transaction journal) and every index is rebuilt as they go in.
 *   It does not check the world; `loadSave` validates the document first and runs `checkWorld`
 *   before anyone sees the world.
 */

import { EntityNotFoundError, SaveDocumentError, UniqueIndexError } from '../core/errors';
import type { PromotionId } from '../core/ids';
import { appendPathSegment, type JsonValue } from '../core/json';
import { hasIdOfTable, type MutableTable, type ReadonlyTable } from '../model/table';
import type { EntityRow, RowOf, TableName, TableRegistry } from '../model/table-def';
import type { GameTables } from '../model/tables';
import { createWorld, type CreateWorldOptions, type World } from '../model/world';
import type { WorldMeta } from '../model/world-meta';
import { CURRENT_FORMAT_VERSION } from './migrations/registry';
import {
  SAVE_FORMAT,
  type SaveDocument,
  type SaveHeader,
  type SaveState,
  type SerializedTables,
  type SerializedWorld,
  type SimStatePart,
} from './save-document';

/** What the caller adds to a save besides the engine state. */
export interface SaveExtras {
  /**
   * The promotion shown in the header: the saving controller's promotion, or null in a sandbox or
   * observer game.
   */
  readonly headerPromotionId: PromotionId | null;
  /** Real-world ISO 8601 time of the save. The engine never reads the clock, so it is passed in. */
  readonly savedAt: string;
  /** The save's label, 1-60 characters. */
  readonly label: string;
  /** The engine build writing the save, normally `ENGINE_VERSION`. */
  readonly engineVersion: string;
  /**
   * The writing build's save schema fingerprint (`engineSaveSchemaFingerprint()`), stamped in the
   * header. Left out, the header has none.
   */
  readonly schemaFingerprint?: string;
}

export interface WorldToDocumentExtras extends SaveExtras {
  /** The simulation parts to store. A part left out is stored as `null`. */
  readonly simState: Partial<Readonly<Record<SimStatePart, JsonValue>>>;
}

/** The engine state `createSaveDocument` takes: the shape of SIM-10's `EngineState`. */
export type SaveableState = { readonly world: SerializedWorld } & Readonly<
  Record<SimStatePart, JsonValue>
>;

/** A game world as `serialiseWorld` reads it: its metadata and read access to every table. */
export interface SerialisableWorld {
  readonly meta: WorldMeta;
  readonly tables: { readonly [Name in keyof GameTables]: ReadonlyTable<RowOf<GameTables[Name]>> };
}

/** The part of a save document `documentToWorld` reads. */
export interface WorldDocument {
  readonly state: {
    readonly world: {
      readonly meta: WorldMeta;
      readonly tables: Readonly<Record<TableName, readonly EntityRow[]>>;
    };
  };
}

/** Every table's rows in ascending ID order, keyed by table name. */
function serialiseTables(tables: SerialisableWorld['tables']): SerializedTables {
  return {
    people: [...tables.people.values()],
    promotions: [...tables.promotions.values()],
    brands: [...tables.brands.values()],
    employments: [...tables.employments.values()],
    teams: [...tables.teams.values()],
    stables: [...tables.stables.values()],
    relationships: [...tables.relationships.values()],
    titles: [...tables.titles.values()],
    titleReigns: [...tables.titleReigns.values()],
    eventDefinitions: [...tables.eventDefinitions.values()],
    eventInstances: [...tables.eventInstances.values()],
    segments: [...tables.segments.values()],
    participants: [...tables.participants.values()],
    storylines: [...tables.storylines.values()],
    seasons: [...tables.seasons.values()],
    continents: [...tables.continents.values()],
    countries: [...tables.countries.values()],
    regions: [...tables.regions.values()],
    venues: [...tables.venues.values()],
    networks: [...tables.networks.values()],
    deals: [...tables.deals.values()],
    mail: [...tables.mail.values()],
    news: [...tables.news.values()],
    ledgerEntries: [...tables.ledgerEntries.values()],
    aftermaths: [...tables.aftermaths.values()],
  };
}

/**
 * The world's metadata and every table as an array of rows in ascending ID order. Rows are shared
 * with the world, not copied: rows are never edited in place (a transaction replaces them), so
 * sharing is safe and saves a deep copy of every table.
 */
export function serialiseWorld(world: SerialisableWorld): SerializedWorld {
  return { meta: world.meta, tables: serialiseTables(world.tables) };
}

function buildHeader(world: SerializedWorld, extras: SaveExtras): SaveHeader {
  const { meta } = world;
  const promotion =
    extras.headerPromotionId === null
      ? null
      : world.tables.promotions.find((row) => row.id === extras.headerPromotionId);
  if (promotion === undefined) {
    throw new EntityNotFoundError('promotion', extras.headerPromotionId ?? '');
  }
  return {
    worldName: meta.worldName,
    promotionName: promotion?.name ?? null,
    promotionShortName: promotion?.shortName ?? null,
    gameDate: meta.currentDate,
    startDate: meta.startDate,
    daysSimulated: meta.daysSimulated,
    cash: promotion?.cash ?? null,
    label: extras.label,
    ...(extras.schemaFingerprint === undefined
      ? {}
      : { schemaFingerprint: extras.schemaFingerprint }),
  };
}

/**
 * Wraps an engine state in a current-version save document and builds its header from
 * `state.world.meta` and the `headerPromotionId` row. Throws `EntityNotFoundError` when
 * `headerPromotionId` names a promotion the world does not have. The state is stored as given;
 * `encodeSave` checks that it is plain JSON and `loadSave` validates it.
 */
export function createSaveDocument(state: SaveableState, extras: SaveExtras): SaveDocument {
  const documentState: SaveState = {
    world: state.world,
    rng: state.rng,
    tunableOverrides: state.tunableOverrides,
    traces: state.traces,
    events: state.events,
    failureLog: state.failureLog,
    commandLog: state.commandLog,
  };
  return {
    format: SAVE_FORMAT,
    formatVersion: CURRENT_FORMAT_VERSION,
    engineVersion: extras.engineVersion,
    savedAt: extras.savedAt,
    header: buildHeader(state.world, extras),
    state: documentState,
  };
}

/** Every simulation part, taken from `simState` or `null` where it has none. */
function fillSimParts(
  simState: WorldToDocumentExtras['simState'],
): Readonly<Record<SimStatePart, JsonValue>> {
  return {
    rng: simState.rng ?? null,
    tunableOverrides: simState.tunableOverrides ?? null,
    traces: simState.traces ?? null,
    events: simState.events ?? null,
    failureLog: simState.failureLog ?? null,
    commandLog: simState.commandLog ?? null,
  };
}

/**
 * A save document for `world` and the given simulation parts: `serialiseWorld` followed by
 * `createSaveDocument`. Throws `EntityNotFoundError` for an unknown `headerPromotionId`.
 */
export function worldToDocument(
  world: SerialisableWorld,
  extras: WorldToDocumentExtras,
): SaveDocument {
  return createSaveDocument(
    { world: serialiseWorld(world), ...fillSimParts(extras.simState) },
    extras,
  );
}

function putRow(table: MutableTable<EntityRow>, row: EntityRow, path: string): void {
  if (!hasIdOfTable(table, row)) {
    throw new SaveDocumentError(path, `id is not a ${table.kind} ID`);
  }
  if (table.has(row.id)) {
    throw new SaveDocumentError(path, `repeats the ID ${row.id}, which an earlier row already has`);
  }
  try {
    table._put(row);
  } catch (error: unknown) {
    if (error instanceof UniqueIndexError) {
      throw new SaveDocumentError(path, error.message);
    }
    throw error;
  }
}

/**
 * Builds a new World from a save document. Rows are inserted straight into the tables (no
 * transaction, no journal) and every index is rebuilt as they go in. The rows and metadata are
 * shared with the document, not copied.
 *
 * Throws `SaveDocumentError` with the path of the bad row for a table the registry does not know,
 * a row whose ID is not of its table's kind, a repeated ID or a unique-index clash. It does not
 * validate rows or references: `loadSave` validates the document before and checks the world
 * after.
 */
export function documentToWorld<R extends TableRegistry>(
  doc: WorldDocument,
  registry: R,
  options: CreateWorldOptions = {},
): World<R> {
  const source = doc.state.world;
  const tablesPath = 'state.world.tables';
  for (const name of Object.keys(source.tables)) {
    if (!Object.hasOwn(registry, name)) {
      throw new SaveDocumentError(
        appendPathSegment(tablesPath, name),
        'is not a table of this game',
      );
    }
  }
  const world = createWorld(registry, source.meta, options);
  const tables: Readonly<Record<TableName, MutableTable<EntityRow>>> = world.tables;
  for (const [name, table] of Object.entries(tables)) {
    const rows = source.tables[name] ?? [];
    const tablePath = appendPathSegment(tablesPath, name);
    rows.forEach((row, index) => {
      putRow(table, row, appendPathSegment(tablePath, index));
    });
  }
  return world;
}
