/**
 * Registers the simulation's state parts with the save format (FND-11).
 *
 * The save document gives each simulation part a named slot and takes its schema from the caller,
 * so `persistence/` never imports simulation code. This file is the one place that knows all six
 * schemas. The app and the headless runner get real validation of every part by building saves
 * with {@link createEngineSaveDocumentSchema} and loading them with {@link engineLoadOptions}.
 */

import type { z } from 'zod';
import { assertJsonValue, type JsonValue } from '../json';
import { rngStateSchema } from '../rng/registry';
import { eventBusStateSchema } from '../events/schema';
import { pipelineFailureLogStateSchema } from '../pipeline/failureLog';
import { traceStoreStateSchema } from '../trace/store';
import { tunableOverridesSchema } from '../tunables/overrides';
import { validateOverrides } from '../tunables/validate';
import { ALL_TUNABLES } from '../../systems/tunables';
import type { LoadOptions } from '../../persistence/load';
import {
  createSaveDocumentSchema,
  type SaveDocument,
  type SimStatePart,
} from '../../persistence/save-document';
import type { SaveableState } from '../../persistence/world-document';
import { commandLogStateSchema } from './commandLog';
import type { EngineState } from './state';

/** The schema of every simulation part of the engine state. */
export const engineStateParts = {
  rng: rngStateSchema,
  tunableOverrides: tunableOverridesSchema,
  traces: traceStoreStateSchema,
  events: eventBusStateSchema,
  failureLog: pipelineFailureLogStateSchema,
  commandLog: commandLogStateSchema,
} as const satisfies Readonly<Record<SimStatePart, z.ZodType>>;

/** The save document schema with every simulation part checked by its real schema. */
export function createEngineSaveDocumentSchema() {
  return createSaveDocumentSchema(engineStateParts);
}

/** What `engineLoadOptions` leaves to the caller. */
export type EngineLoadExtras = Omit<LoadOptions, 'stateParts' | 'validateTunableOverrides'>;

/**
 * `loadSave` options for an engine save: every simulation part validated by its schema, and the
 * tunable overrides checked against every tunable the engine knows. An override with an unknown
 * key or a value out of range is dropped and listed as a warning, so a removed tunable never makes
 * an old save unloadable. `extra` adds the other load options (size limit, trace check, world
 * options).
 */
export function engineLoadOptions(extra: EngineLoadExtras = {}): LoadOptions {
  return {
    ...extra,
    stateParts: engineStateParts,
    validateTunableOverrides: (overrides) => {
      const { accepted, issues } = validateOverrides(ALL_TUNABLES, overrides);
      return {
        kept: accepted,
        dropped: issues.map((issue) => ({ key: issue.key, message: issue.message })),
      };
    },
  };
}

/** One part of the engine state as JSON. Throws `NotSerialisableError` naming the bad path. */
function jsonPart(value: unknown, path: string): JsonValue {
  assertJsonValue(value, path);
  return value;
}

/**
 * The engine state in the shape `createSaveDocument` takes. Checks that every part is plain JSON
 * on the way (the parts are typed objects, which TypeScript cannot match to `JsonValue` itself).
 */
export function engineSaveState(state: EngineState): SaveableState {
  return {
    world: state.world,
    rng: jsonPart(state.rng, 'state.rng'),
    tunableOverrides: jsonPart(state.tunableOverrides, 'state.tunableOverrides'),
    traces: jsonPart(state.traces, 'state.traces'),
    events: jsonPart(state.events, 'state.events'),
    failureLog: jsonPart(state.failureLog, 'state.failureLog'),
    commandLog: jsonPart(state.commandLog, 'state.commandLog'),
  };
}

/**
 * The engine state stored in a loaded save, ready for `createEngine`. Each part is parsed with its
 * schema again to get its type back; `loadSave` with {@link engineLoadOptions} has already checked
 * them, so this only fails for a document that was not loaded that way.
 */
export function engineStateFromSave(doc: SaveDocument): EngineState {
  const { state } = doc;
  return {
    world: state.world,
    rng: engineStateParts.rng.parse(state.rng),
    tunableOverrides: engineStateParts.tunableOverrides.parse(state.tunableOverrides),
    traces: engineStateParts.traces.parse(state.traces),
    events: engineStateParts.events.parse(state.events),
    failureLog: engineStateParts.failureLog.parse(state.failureLog),
    commandLog: engineStateParts.commandLog.parse(state.commandLog),
  };
}
