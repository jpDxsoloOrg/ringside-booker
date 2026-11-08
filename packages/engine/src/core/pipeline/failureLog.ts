/**
 * The pipeline failure log: the most recent step and reaction failures, kept in the save.
 *
 * A day report goes away once the UI has shown it. This log keeps the last
 * {@link PIPELINE_FAILURE_LOG_CAPACITY} failures across days, so a player's bug report can
 * include what broke, on which date and in which step. Oldest entries are dropped first.
 *
 * Saved as the `failureLog` state part (registered with the save format by the engine API).
 */

import { z } from 'zod';
import { isGameDate, type GameDate } from '../date';
import { InvalidArgumentError, InvalidStatePartError, type SerializedError } from '../errors';
import { formatPath } from '../json';

/** How many failures the log keeps. */
export const PIPELINE_FAILURE_LOG_CAPACITY = 100;

/** One recorded failure. Reaction failures use the step id `reaction:<subscriberId>`. */
export interface PipelineFailure {
  date: GameDate;
  stepId: string;
  error: SerializedError;
}

/** The failure log part of a save. `entries` is oldest first. */
export interface PipelineFailureLogState {
  version: 1;
  entries: PipelineFailure[];
}

// Core date checks are spelled out here rather than imported from model/.
const gameDateSchema = z.custom<GameDate>(isGameDate, {
  error: 'must be a game date in the form YYYY-MM-DD',
});

const serializedErrorSchema: z.ZodType<SerializedError> = z.strictObject({
  name: z.string(),
  message: z.string(),
  code: z.string().exactOptional(),
  stack: z.string().exactOptional(),
});

const pipelineFailureSchema: z.ZodType<PipelineFailure> = z.strictObject({
  date: gameDateSchema,
  stepId: z.string().min(1, { error: 'must not be empty' }),
  error: serializedErrorSchema,
});

/** Zod schema for {@link PipelineFailureLogState}. */
export const pipelineFailureLogStateSchema: z.ZodType<PipelineFailureLogState> = z.strictObject({
  version: z.literal(1, { error: 'unsupported failure log state version (expected 1)' }),
  entries: z.array(pipelineFailureSchema).max(PIPELINE_FAILURE_LOG_CAPACITY, {
    error: `the failure log keeps at most ${String(PIPELINE_FAILURE_LOG_CAPACITY)} entries`,
  }),
});

/**
 * Validates an unknown value as a {@link PipelineFailureLogState}. Throws
 * {@link InvalidStatePartError} naming every bad field.
 */
export function parsePipelineFailureLogState(input: unknown): PipelineFailureLogState {
  const result = pipelineFailureLogStateSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new InvalidStatePartError(
    'pipeline failure log',
    result.error.issues.map((issue) => `${formatPath('$', issue.path)}: ${issue.message}`),
  );
}

/** A ring buffer of the latest pipeline failures. */
export class PipelineFailureLog {
  readonly capacity: number;
  /** Oldest first. Never longer than `capacity`. */
  #entries: PipelineFailure[] = [];

  constructor(capacity: number = PIPELINE_FAILURE_LOG_CAPACITY) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      throw new InvalidArgumentError(
        'PipelineFailureLog',
        'capacity',
        capacity,
        'a whole number of 0 or more',
      );
    }
    this.capacity = capacity;
  }

  /** Loads a log from a saved state (validated). */
  static fromState(state: unknown): PipelineFailureLog {
    const valid = parsePipelineFailureLogState(state);
    const log = new PipelineFailureLog();
    for (const entry of valid.entries) {
      log.record(entry);
    }
    return log;
  }

  /** How many failures the log holds. */
  get size(): number {
    return this.#entries.length;
  }

  /** Adds a failure, dropping the oldest when the log is full. The entry is copied. */
  record(failure: PipelineFailure): void {
    if (this.capacity === 0) {
      return;
    }
    this.#entries.push(copyFailure(failure));
    if (this.#entries.length > this.capacity) {
      this.#entries.splice(0, this.#entries.length - this.capacity);
    }
  }

  /** The failures, oldest first. With `limit`, only the newest that many. */
  recent(limit?: number): PipelineFailure[] {
    const entries = limit === undefined ? this.#entries : this.#entries.slice(-limit);
    return limit === 0 ? [] : entries.map(copyFailure);
  }

  /** The log's save state. Plain JSON. */
  toState(): PipelineFailureLogState {
    return { version: 1, entries: this.#entries.map(copyFailure) };
  }
}

function copyFailure(failure: PipelineFailure): PipelineFailure {
  return { date: failure.date, stepId: failure.stepId, error: { ...failure.error } };
}
