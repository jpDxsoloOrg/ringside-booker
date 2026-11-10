/** Public surface of the engine API. See docs/design/engine-api.md. */

export type {
  CommandArgs,
  CommandData,
  CommandMap,
  CommandName,
  QueryArgs,
  QueryData,
  QueryMap,
  QueryName,
} from './maps';
export {
  controllerViewer,
  OMNISCIENT_VIEWER,
  viewerPromotionIds,
  ViewerSchema,
  type Viewer,
} from './controller';
export {
  API_NAME_PATTERN,
  defineQuery,
  type EventLogReader,
  type QueryContext,
  type QueryDefinition,
  type QuerySpec,
  type TraceReader,
} from './query';
export {
  defineCommand,
  type CommandContext,
  type CommandDefinition,
  type CommandSpec,
  type TunableOverrideWriter,
} from './command';
export {
  INTERNAL,
  INVALID_ARGS,
  QueryRefusal,
  refuseQuery,
  type CommandEvent,
  type CommandResult,
  type QueryResult,
  type Reason,
} from './result';
export {
  COMMAND_LOG_MAX_ENTRIES,
  COMMAND_OUTCOMES,
  CommandLog,
  commandLogStateSchema,
  emptyCommandLogState,
  parseCommandLogState,
  type CommandLogEntry,
  type CommandLogState,
  type CommandOutcome,
} from './commandLog';
export { assertSerialisable } from './serialisable';
export {
  defineSubscription,
  defineSystem,
  SYSTEM_ID_PATTERN,
  type SubscriptionSpec,
  type SystemBundle,
  type SystemSpec,
} from './system';
export { initialEngineState, type EngineState } from './state';
export { worldHash } from './stateHash';
export {
  createEngineSaveDocumentSchema,
  engineLoadOptions,
  engineSaveState,
  engineStateFromSave,
  engineStateParts,
  type EngineLoadExtras,
} from './saveParts';
export {
  commandStepId,
  createEngine,
  type CreateEngineOptions,
  type Engine,
  type EngineHost,
} from './engine';
export {
  MAX_LIST_LIMIT,
  simSystem,
  type ClockView,
  type NoArgs,
  type PendingGates,
  type PromotionStatus,
  type SimStatus,
  type TunableChange,
} from './builtins';
