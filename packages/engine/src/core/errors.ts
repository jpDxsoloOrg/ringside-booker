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
    super('ID_COLLISION', `Could not mint a new ${kind} ID after ${attempts} attempts`, {
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
    super('MONEY_OVERFLOW', `${operation} overflowed the safe integer range (got ${result})`, {
      operation,
      result,
    });
  }
}
