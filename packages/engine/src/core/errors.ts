/**
 * Base error types for the engine.
 *
 * Every error the engine throws on purpose extends `EngineError`, so callers can tell an expected
 * failure (bad input, broken save, rule violation) from a plain bug. Each error carries a stable
 * `code` for the UI and logs, and optional flat `details` that are safe to serialise into a save's
 * error report. Systems add their own subclasses here as they need them.
 */

/** Flat, serialisable context attached to an error. */
export type ErrorDetails = Readonly<Record<string, string | number | boolean | null>>;

export abstract class EngineError extends Error {
  /** Stable machine-readable code, for example `INVALID_ID`. */
  readonly code: string;
  /** Extra context about what went wrong, kept flat so it serialises cleanly. */
  readonly details: ErrorDetails | undefined;

  protected constructor(code: string, message: string, details?: ErrorDetails) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** Describes any value in a short string for error messages and details. */
export function describeValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  return `a value of type ${typeof value}`;
}

/** A function was called with an argument outside what it accepts. Always a caller bug. */
export class InvalidArgumentError extends EngineError {
  constructor(functionName: string, argumentName: string, value: unknown, expected: string) {
    super(
      'INVALID_ARGUMENT',
      `${functionName}: ${argumentName} must be ${expected}, got ${describeValue(value)}`,
      { functionName, argumentName, value: describeValue(value), expected },
    );
  }
}

/**
 * An odds or sampling helper (`chance`, `intBetween`, `weightedPick`, ...) was given arguments that
 * do not describe valid odds: a probability outside [0, 1], reversed or non-whole bounds, an empty
 * list, a bad weight. Always a caller bug; the message names the helper and the bad value.
 */
export class InvalidOddsError extends EngineError {
  constructor(functionName: string, problem: string, details?: ErrorDetails) {
    super('INVALID_ODDS', `${functionName}: ${problem}`, { functionName, ...details });
  }
}

/** A value is not a well-formed ID of the expected entity kind. */
export class InvalidIdError extends EngineError {
  constructor(expectedKind: string, value: unknown) {
    super('INVALID_ID', `Expected a ${expectedKind} ID, got ${describeValue(value)}`, {
      expectedKind,
      value: describeValue(value),
    });
  }
}

/** The ID factory kept drawing IDs that already exist. */
export class IdCollisionError extends EngineError {
  constructor(kind: string, attempts: number) {
    super('ID_COLLISION', `Could not mint a new ${kind} ID after ${String(attempts)} attempts`, {
      kind,
      attempts,
    });
  }
}

/** A value is not a valid game date, or date arithmetic left the supported range. */
export class InvalidDateError extends EngineError {
  constructor(value: unknown, reason: string) {
    super('INVALID_DATE', `Invalid game date ${describeValue(value)}: ${reason}`, {
      value: describeValue(value),
      reason,
    });
  }
}

/** A value is not a well-formed content key. */
export class InvalidContentKeyError extends EngineError {
  constructor(value: unknown) {
    super('INVALID_CONTENT_KEY', `Expected a content key, got ${describeValue(value)}`, {
      value: describeValue(value),
    });
  }
}

/** A money calculation produced a value outside the safe integer range. */
export class MoneyOverflowError extends EngineError {
  constructor(operation: string, result: number) {
    super(
      'MONEY_OVERFLOW',
      `${operation} overflowed the safe integer range (got ${String(result)})`,
      {
        operation,
        result,
      },
    );
  }
}

/** A row was asked for by ID but its table has no row with that ID. */
export class EntityNotFoundError extends EngineError {
  constructor(kind: string, id: string) {
    super('ENTITY_NOT_FOUND', `No ${kind} with ID ${JSON.stringify(id)}`, { kind, id });
  }
}

/** A second row tried to take a key that a unique index already holds for another row. */
export class UniqueIndexError extends EngineError {
  constructor(table: string, index: string, key: string) {
    super(
      'UNIQUE_INDEX',
      `Table ${table}: unique index ${index} already holds key ${JSON.stringify(key)}`,
      { table, index, key },
    );
  }
}

/** A lookup named an index the table does not declare, or used it the wrong way. */
export class UnknownIndexError extends EngineError {
  constructor(table: string, index: string, reason = 'is not declared') {
    super('UNKNOWN_INDEX', `Table ${table}: index ${index} ${reason}`, { table, index, reason });
  }
}

/** A table registry is malformed: duplicate names or kinds, or a key that differs from its table. */
export class RegistryError extends EngineError {
  constructor(message: string, details?: ErrorDetails) {
    super('REGISTRY', message, details);
  }
}

/**
 * A phase cadence is ambiguous or out of range, such as a monthly job on the 31st (which would
 * silently skip every shorter month) or a yearly job on 29 February. `field` names the bad part,
 * for example `monthly.day`.
 */
export class InvalidCadenceError extends EngineError {
  constructor(field: string, value: unknown, reason: string) {
    super('INVALID_CADENCE', `Invalid cadence: ${field} ${reason}, got ${describeValue(value)}`, {
      field,
      value: describeValue(value),
      reason,
    });
  }
}

/** A value that must be plain JSON (a save part, an event payload, a trace input) is not. */
export class NotSerialisableError extends EngineError {
  /** Where the bad value sits, for example `$.a[2].b` or `events.title.changed.holderId`. */
  readonly path: string;

  constructor(path: string, reason: string) {
    super('NOT_SERIALISABLE', `${path} is not serialisable: it is ${reason}`, { path, reason });
    this.path = path;
  }
}

/** Two event subscribers were registered with the same id. */
export class DuplicateSubscriberError extends EngineError {
  constructor(subscriberId: string) {
    super(
      'DUPLICATE_SUBSCRIBER',
      `An event subscriber with id ${JSON.stringify(subscriberId)} is already registered`,
      { subscriberId },
    );
  }
}

/** The event bus was used in a way it does not allow, such as publishing after a commit. */
export class EventBusMisuseError extends EngineError {
  constructor(reason: string) {
    super('EVENT_BUS_MISUSE', `Event bus misuse: ${reason}`, { reason });
  }
}

/** The trace store was used in a way it does not allow, such as recording after a commit. */
export class TraceStoreMisuseError extends EngineError {
  constructor(reason: string) {
    super('TRACE_STORE_MISUSE', `Trace store misuse: ${reason}`, { reason });
  }
}

/** A saved state part (RNG, events, ...) failed validation on load. */
export class InvalidStatePartError extends EngineError {
  /** One line per problem, each starting with the path of the bad field. */
  readonly problems: readonly string[];

  constructor(part: string, problems: readonly string[]) {
    super('INVALID_STATE_PART', `Invalid ${part} state: ${problems.join('; ')}`, {
      part,
      problemCount: problems.length,
    });
    this.problems = problems;
  }
}

/** A transaction tried to insert a row whose ID its table already holds. */
export class DuplicateIdError extends EngineError {
  constructor(table: string, id: string) {
    super('DUPLICATE_ID', `Table ${table} already has a row with ID ${JSON.stringify(id)}`, {
      table,
      id,
    });
  }
}

/** A transaction tried to update or delete a row of a table that only ever grows. */
export class AppendOnlyError extends EngineError {
  constructor(table: string, operation: 'update' | 'delete', id: string) {
    super(
      'APPEND_ONLY',
      `Table ${table} is append-only: cannot ${operation} row ${JSON.stringify(id)}`,
      { table, operation, id },
    );
  }
}

/**
 * A transaction was used in a way it does not allow: opened inside another one, given an async
 * body, used after it ended, or asked to mint an ID with no ID factory installed.
 */
export class TxStateError extends EngineError {
  constructor(reason: string) {
    super('TX_STATE', `Transaction misuse: ${reason}`, { reason });
  }
}

/**
 * A write failed its schema while write validation was on. `paths` lists the bad fields (for
 * example `$.settings.season.lengthDays`); `problems` has one `path: message` line per issue.
 */
export class SchemaViolationError extends EngineError {
  readonly paths: readonly string[];
  readonly problems: readonly string[];

  constructor(target: string, problems: readonly { path: string; message: string }[]) {
    const lines = problems.map((problem) => `${problem.path}: ${problem.message}`);
    super('SCHEMA_VIOLATION', `Invalid write to ${target}: ${lines.join('; ')}`, {
      target,
      problemCount: problems.length,
    });
    this.paths = problems.map((problem) => problem.path);
    this.problems = lines;
  }
}

/**
 * A calculation trace does not reproduce its own value: replaying its steps gives a different
 * number, a recorded step disagrees with the running value, or the trace cannot be replayed at all.
 */
export class TraceReplayError extends EngineError {
  /** One line per problem, each naming the step it was found at. */
  readonly problems: readonly string[];

  constructor(label: string, problems: readonly string[]) {
    super('TRACE_REPLAY', `Trace "${label}" does not replay: ${problems.join('; ')}`, {
      label,
      problemCount: problems.length,
    });
    this.problems = problems;
  }
}

/**
 * A save migration step failed. `title` names the step; the message carries the step's own error,
 * so a load report can say exactly which upgrade broke and why.
 */
export class MigrationError extends EngineError {
  readonly from: number;
  readonly to: number;
  readonly title: string;

  constructor(from: number, to: number, title: string, reason: string) {
    super(
      'MIGRATION',
      `Save migration v${String(from)} → v${String(to)} "${title}" failed: ${reason}`,
      { from, to, title, reason },
    );
    this.from = from;
    this.to = to;
    this.title = title;
  }
}

/**
 * A save document cannot be turned into a world: a row with the wrong kind of ID, two rows with
 * the same ID, a unique index clash or a table the game does not know. `path` points at the bad
 * row, for example `state.world.tables.people[3]`.
 */
export class SaveDocumentError extends EngineError {
  readonly path: string;
  /** What is wrong at `path`, without the path. */
  readonly problem: string;

  constructor(path: string, problem: string) {
    super('SAVE_DOCUMENT', `${path}: ${problem}`, { path, problem });
    this.path = path;
    this.problem = problem;
  }
}

/**
 * The day pipeline was set up or used in a way it does not allow: a malformed phase definition, a
 * duplicate phase id, two phases in the same slot, or a phase registered in an engine-only group.
 * Always a programming error in the system that registered the phase.
 */
export class PipelineError extends EngineError {
  constructor(message: string, details?: ErrorDetails) {
    super('PIPELINE', message, details);
  }
}

/**
 * Something the engine relies on stopped being true, such as the day's closing step failing to
 * move the clock forward. Never caused by player input; always an engine bug.
 */
export class InvariantError extends EngineError {
  constructor(message: string, details?: ErrorDetails) {
    super('INVARIANT', message, details);
  }
}

/**
 * An error flattened to plain JSON, for day reports, the pipeline failure log and bug reports.
 * `code` is set for engine errors (and any other error that carries a string `code`).
 */
export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  stack?: string;
}

/** Longest stack kept by {@link serializeError}, so a failure log entry stays small. */
export const SERIALIZED_STACK_MAX_LENGTH = 4000;

/**
 * Flattens anything that was thrown into a {@link SerializedError}. Errors keep their name,
 * message, string `code` and (trimmed) stack. Anything else that was thrown becomes
 * `{ name: 'NonErrorThrown', message: String(value) }`.
 */
export function serializeError(err: unknown): SerializedError {
  if (!(err instanceof Error)) {
    return { name: 'NonErrorThrown', message: describeThrown(err) };
  }
  const serialized: SerializedError = {
    name: typeof err.name === 'string' && err.name !== '' ? err.name : 'Error',
    message: typeof err.message === 'string' ? err.message : describeThrown(err.message),
  };
  const code: unknown = Reflect.get(err, 'code');
  if (typeof code === 'string') {
    serialized.code = code;
  }
  if (typeof err.stack === 'string') {
    serialized.stack = err.stack.slice(0, SERIALIZED_STACK_MAX_LENGTH);
  }
  return serialized;
}

/** `String(value)`, falling back to {@link describeValue} for values that refuse to convert. */
function describeThrown(value: unknown): string {
  try {
    return String(value);
  } catch {
    return describeValue(value);
  }
}
