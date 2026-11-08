/**
 * The command log: the most recent commands, who issued them and what happened (design decision
 * D-07).
 *
 * Every command the engine is asked to run is logged, applied or not: rejected and failed commands
 * are kept too, so a bug report shows what a player tried as well as what worked. The log is
 * bounded by the `sim.commandLogSize` tunable (0 keeps nothing) and saved as the `commandLog` state
 * part. Entries carry their own sequence number, which keeps counting across save and load, so two
 * logs can be lined up even after old entries have been dropped.
 */

import { z } from 'zod';
import { isGameDate, type GameDate } from '../date';
import { InvalidArgumentError, InvalidStatePartError } from '../errors';
import { cloneJson, formatPath, zJsonValue, type JsonValue } from '../json';
import { ControllerSchema, type Controller } from './controller';

/** How a logged command ended. */
export type CommandOutcome = 'applied' | 'rejected' | 'failed';

/** The outcomes, in the order a command can reach them. */
export const COMMAND_OUTCOMES = ['applied', 'rejected', 'failed'] as const;

/** The most entries a saved log may hold: the top of the `sim.commandLogSize` range. */
export const COMMAND_LOG_MAX_ENTRIES = 100_000;

/** One logged command. Plain JSON. */
export interface CommandLogEntry {
  /** Log-wide order, from 1. Saved, so it carries on across save and load. */
  seq: number;
  /** The game date the command was issued on. */
  date: GameDate;
  issuedBy: Controller;
  /** The command name, such as `tunables.setOverride`. */
  name: string;
  /** The arguments as parsed, or as sent when they were refused (null if they were not JSON). */
  args: JsonValue;
  outcome: CommandOutcome;
  /** The codes of the reasons a rejected or failed command came back with. Empty when applied. */
  reasonCodes: string[];
}

/** The command log part of a save. `entries` is oldest first. */
export interface CommandLogState {
  version: 1;
  /** The last sequence number handed out; the next entry gets `seq + 1`. */
  seq: number;
  entries: CommandLogEntry[];
}

const gameDateSchema = z.custom<GameDate>(isGameDate, {
  error: 'must be a game date in the form YYYY-MM-DD',
});

const commandLogEntrySchema: z.ZodType<CommandLogEntry> = z.strictObject({
  seq: z.number().int().min(1),
  date: gameDateSchema,
  issuedBy: ControllerSchema,
  name: z.string().min(1, { error: 'must not be empty' }),
  args: zJsonValue,
  outcome: z.enum(COMMAND_OUTCOMES),
  reasonCodes: z.array(z.string().min(1)),
});

/** Zod schema for {@link CommandLogState}. Also checks that entry `seq` values are increasing. */
export const commandLogStateSchema: z.ZodType<CommandLogState> = z
  .strictObject({
    version: z.literal(1, { error: 'unsupported command log state version (expected 1)' }),
    seq: z.number().int().min(0),
    entries: z.array(commandLogEntrySchema).max(COMMAND_LOG_MAX_ENTRIES, {
      error: `the command log keeps at most ${String(COMMAND_LOG_MAX_ENTRIES)} entries`,
    }),
  })
  .superRefine((state, ctx) => {
    let previousSeq = 0;
    state.entries.forEach((entry, index) => {
      if (entry.seq <= previousSeq) {
        ctx.addIssue({
          code: 'custom',
          message: 'seq must be greater than the previous entry seq',
          path: ['entries', index, 'seq'],
        });
      }
      if (entry.seq > state.seq) {
        ctx.addIssue({
          code: 'custom',
          message: `seq must not be greater than the log seq (${String(state.seq)})`,
          path: ['entries', index, 'seq'],
        });
      }
      previousSeq = entry.seq;
    });
  });

/**
 * Validates an unknown value as a {@link CommandLogState}. Throws {@link InvalidStatePartError}
 * naming every bad field.
 */
export function parseCommandLogState(input: unknown): CommandLogState {
  const result = commandLogStateSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new InvalidStatePartError(
    'command log',
    result.error.issues.map((issue) => `${formatPath('$', issue.path)}: ${issue.message}`),
  );
}

/** A new, empty command log state. */
export function emptyCommandLogState(): CommandLogState {
  return { version: 1, seq: 0, entries: [] };
}

function copyEntry(entry: CommandLogEntry): CommandLogEntry {
  return {
    seq: entry.seq,
    date: entry.date,
    issuedBy: { ...entry.issuedBy },
    name: entry.name,
    args: cloneJson(entry.args),
    outcome: entry.outcome,
    reasonCodes: [...entry.reasonCodes],
  };
}

function assertCapacity(capacity: number): void {
  if (!Number.isSafeInteger(capacity) || capacity < 0) {
    throw new InvalidArgumentError(
      'CommandLog',
      'capacity',
      capacity,
      'a whole number of 0 or more',
    );
  }
}

/** A ring buffer of the newest commands. */
export class CommandLog {
  #capacity: number;
  /** The last sequence number handed out. Saved. */
  #seq = 0;
  /** Oldest first. Never longer than the capacity. */
  #entries: CommandLogEntry[] = [];

  /** An empty log keeping the newest `capacity` entries (`sim.commandLogSize`). */
  constructor(capacity: number) {
    assertCapacity(capacity);
    this.#capacity = capacity;
  }

  /**
   * Loads a log from a saved state (validated). When the state holds more entries than
   * `capacity`, the oldest are dropped.
   */
  static fromState(state: unknown, capacity: number): CommandLog {
    const valid = parseCommandLogState(state);
    const log = new CommandLog(capacity);
    log.#seq = valid.seq;
    log.#entries = valid.entries.map(copyEntry);
    log.#trim();
    return log;
  }

  /** How many entries the log keeps. */
  get capacity(): number {
    return this.#capacity;
  }

  /** The last sequence number handed out (0 before the first command). */
  get seq(): number {
    return this.#seq;
  }

  /** How many entries the log holds right now. */
  get size(): number {
    return this.#entries.length;
  }

  /** Changes how many entries the log keeps, dropping the oldest when it shrinks. */
  resize(capacity: number): void {
    assertCapacity(capacity);
    this.#capacity = capacity;
    this.#trim();
  }

  /**
   * Logs a command and returns the stored entry (a copy). The entry gets the next sequence number
   * even when the capacity is 0 and nothing is kept.
   */
  record(entry: Omit<CommandLogEntry, 'seq'>): CommandLogEntry {
    this.#seq += 1;
    const stored = copyEntry({ ...entry, seq: this.#seq });
    this.#entries.push(stored);
    this.#trim();
    return copyEntry(stored);
  }

  /** The entries, oldest first. With `limit`, only the newest that many. */
  recent(limit?: number): CommandLogEntry[] {
    if (limit === 0) {
      return [];
    }
    const entries = limit === undefined ? this.#entries : this.#entries.slice(-limit);
    return entries.map(copyEntry);
  }

  /** The log's save state. Plain JSON. */
  toState(): CommandLogState {
    return { version: 1, seq: this.#seq, entries: this.#entries.map(copyEntry) };
  }

  #trim(): void {
    if (this.#entries.length > this.#capacity) {
      this.#entries.splice(0, this.#entries.length - this.#capacity);
    }
  }
}
