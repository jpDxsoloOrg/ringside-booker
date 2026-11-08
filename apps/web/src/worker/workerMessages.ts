/**
 * The two raw messages that travel next to Comlink's own on the engine worker's port. Comlink
 * ignores both: it skips messages without its request id on the main thread and unknown message
 * types in the worker.
 */

/** Posted by the worker just before it dies of an uncaught error or an unhandled rejection. */
export interface EngineFatalMessage {
  readonly type: 'engine.fatal';
  readonly message: string;
  readonly stack: string | null;
}

/** Posted by the main thread in dev and e2e builds to make the worker throw, for the crash screen. */
export interface EngineCrashRequest {
  readonly type: 'engine.crashForTesting';
}

export const ENGINE_FATAL_MESSAGE_TYPE = 'engine.fatal';
export const ENGINE_CRASH_REQUEST_TYPE = 'engine.crashForTesting';

/** The error the worker throws when asked to crash, so tests can recognise it. */
export const CRASH_FOR_TESTING_MESSAGE = 'Engine crash requested for testing';

function hasType(value: unknown, type: string): value is { type: string } {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'type') === type;
}

export function isEngineFatalMessage(value: unknown): value is EngineFatalMessage {
  if (!hasType(value, ENGINE_FATAL_MESSAGE_TYPE)) return false;
  const stack: unknown = Reflect.get(value, 'stack');
  return (
    typeof Reflect.get(value, 'message') === 'string' &&
    (stack === null || typeof stack === 'string')
  );
}

export function isEngineCrashRequest(value: unknown): value is EngineCrashRequest {
  return hasType(value, ENGINE_CRASH_REQUEST_TYPE);
}

/** A readable message and stack from anything thrown. */
export function describeThrown(thrown: unknown): { message: string; stack: string | null } {
  if (thrown instanceof Error) {
    return { message: thrown.message, stack: thrown.stack ?? null };
  }
  if (typeof thrown === 'string') return { message: thrown, stack: null };
  try {
    // JSON.stringify gives undefined (despite its type) for undefined or a function.
    const text = JSON.stringify(thrown) as string | undefined;
    return { message: text ?? String(thrown), stack: null };
  } catch {
    return { message: String(thrown), stack: null };
  }
}
