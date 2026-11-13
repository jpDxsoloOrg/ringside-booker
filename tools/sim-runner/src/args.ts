/**
 * Command-line arguments of the headless runner.
 *
 * {@link parseRunnerArgs} turns `process.argv` into a typed {@link RunnerOptions}, or into every
 * argument error it found, so one bad call lists all of its problems at once. Tunable overrides are
 * parsed by the kind of the tunable they name and checked against its definition here, so a bad
 * `--tunable` fails before any world is built.
 *
 * There is deliberately no option to bypass a gate: headless runs on fixtures have no player
 * promotion, so a gate stopping the run means something is wrong with the world.
 */

import { parseArgs } from 'node:util';
import {
  ALL_TUNABLES,
  TRACE_REF_KIND_PATTERN,
  validateOverride,
  type TraceRef,
  type TunableDefinitions,
  type TunableRawValue,
} from '@ringside/engine';

/** Most days one run may simulate: a hundred years. */
export const MAX_RUN_DAYS = 36500;
/** Largest roster `--people` builds for the fixture world. */
export const MAX_FIXTURE_PEOPLE = 5000;
export const DEFAULT_SEED = '1';
export const DEFAULT_FIXTURE_PEOPLE = 300;
/** The `--world` value for the roster fixture. */
export const ROSTER_FIXTURE = 'fixture:roster';

export const USAGE = `Usage: npm run sim -- --days <n> [options]

Runs the simulation headless and prints a summary: dates, days per second, step failures,
events by type and a world hash.

  --days <n>              days to simulate, 1 to ${String(MAX_RUN_DAYS)} (required)
  --world <source>        ${ROSTER_FIXTURE} (default) or a path to an EngineState JSON file
                          (what engine.exportState() returns)
  --seed <text>           the seed for a fixture world (default "${DEFAULT_SEED}")
  --people <n>            roster size of the fixture world, 1 to ${String(MAX_FIXTURE_PEOPLE)} (default ${String(DEFAULT_FIXTURE_PEOPLE)})
  --tunable <key=value>   override a tunable for this run (repeatable)
  --json                  print the summary as JSON
  --check-determinism     run twice from the same start and fail if the runs differ
  --strict                fail when any step fails, a past show is still open, a
                          promotion's cash change is not the sum of its new ledger rows,
                          or the promotion history keeps more rows than its retention allows
  --trace <kind:id>       print one stored trace at the end, for example
                          condition.fatigueRecovery:per_...
  -h, --help              show this help

Exit codes: 0 success, 1 determinism mismatch or a step failure with --strict,
2 bad arguments or an unreadable world, 3 stopped by a gate.
`;

/** Where the starting world comes from. */
export type WorldSource =
  | { readonly kind: 'fixture'; readonly fixture: 'roster' }
  | { readonly kind: 'file'; readonly path: string };

/** One `--tunable key=value`, parsed by the tunable's kind and already checked. */
export interface TunableSetting {
  readonly key: string;
  readonly value: TunableRawValue;
}

/** Everything one run needs, typed and checked. */
export interface RunnerOptions {
  readonly days: number;
  readonly seed: string;
  readonly world: WorldSource;
  readonly people: number;
  readonly tunables: readonly TunableSetting[];
  readonly json: boolean;
  readonly checkDeterminism: boolean;
  readonly strict: boolean;
  readonly trace: TraceRef | null;
}

/** Codes for argument errors, so tests and callers can tell them apart without reading prose. */
export type ArgumentErrorCode =
  | 'unknownOption'
  | 'missingDays'
  | 'invalidDays'
  | 'invalidPeople'
  | 'invalidSeed'
  | 'invalidWorld'
  | 'invalidTunable'
  | 'unknownKey'
  | 'wrongType'
  | 'belowMin'
  | 'aboveMax'
  | 'notInteger'
  | 'notFinite'
  | 'notAnOption'
  | 'notAllowed'
  | 'invalidTrace';

/** One problem with the arguments. */
export interface ArgumentError {
  readonly code: ArgumentErrorCode;
  readonly message: string;
}

/** What {@link parseRunnerArgs} returns. */
export type ParsedArgs =
  | { readonly kind: 'options'; readonly options: RunnerOptions }
  | { readonly kind: 'help' }
  | { readonly kind: 'errors'; readonly errors: readonly ArgumentError[] };

const TUNABLE_DEFINITIONS: TunableDefinitions = ALL_TUNABLES;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parses a whole number in `[min, max]`, or returns null. */
function parseWholeNumber(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

/** Reads a number the way a person types one: decimal, optional sign and exponent. */
function parseNumberText(text: string): number {
  return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text.trim())
    ? Number(text.trim())
    : Number.NaN;
}

/**
 * Parses one `key=value`: the value is read by the kind of the tunable `key` names (a number for
 * number and integer tunables, `true`/`false` for switches, the text itself for a choice) and then
 * checked against the tunable's range or options.
 */
export function parseTunableSetting(text: string): TunableSetting | ArgumentError {
  const separator = text.indexOf('=');
  if (separator <= 0) {
    return {
      code: 'invalidTunable',
      message: `--tunable must look like key=value, not "${text}"`,
    };
  }
  const key = text.slice(0, separator);
  const valueText = text.slice(separator + 1);
  const definition = Object.hasOwn(TUNABLE_DEFINITIONS, key) ? TUNABLE_DEFINITIONS[key] : undefined;
  if (definition === undefined) {
    return {
      code: 'unknownKey',
      message: `--tunable ${text}: there is no tunable called "${key}"`,
    };
  }
  let value: TunableRawValue;
  switch (definition.kind) {
    case 'number':
    case 'integer':
      value = parseNumberText(valueText);
      if (Number.isNaN(value)) {
        return {
          code: 'wrongType',
          message: `--tunable ${text}: "${key}" takes a number, not "${valueText}"`,
        };
      }
      break;
    case 'boolean':
      if (valueText !== 'true' && valueText !== 'false') {
        return {
          code: 'wrongType',
          message: `--tunable ${text}: "${key}" is a switch, so its value must be true or false`,
        };
      }
      value = valueText === 'true';
      break;
    case 'enum':
      value = valueText;
      break;
  }
  const issue = validateOverride(TUNABLE_DEFINITIONS, key, value);
  if (issue !== null) {
    return { code: issue.problem, message: `--tunable ${text}: ${issue.message}` };
  }
  return { key, value };
}

function isArgumentError(value: TunableSetting | ArgumentError): value is ArgumentError {
  return 'code' in value;
}

/** Parses `kind:id` into a trace ref. */
function parseTraceRef(text: string): TraceRef | null {
  const separator = text.indexOf(':');
  if (separator <= 0 || separator === text.length - 1) {
    return null;
  }
  const kind = text.slice(0, separator);
  return TRACE_REF_KIND_PATTERN.test(kind) ? { kind, id: text.slice(separator + 1) } : null;
}

function parseWorldSource(text: string): WorldSource | null {
  if (text === ROSTER_FIXTURE) {
    return { kind: 'fixture', fixture: 'roster' };
  }
  if (text.startsWith('fixture:') || text.trim() === '') {
    return null;
  }
  return { kind: 'file', path: text };
}

/** Parses the runner's arguments (without the `node script` prefix). */
export function parseRunnerArgs(argv: readonly string[]): ParsedArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: {
        days: { type: 'string' },
        seed: { type: 'string' },
        world: { type: 'string' },
        people: { type: 'string' },
        tunable: { type: 'string', multiple: true },
        json: { type: 'boolean', default: false },
        'check-determinism': { type: 'boolean', default: false },
        strict: { type: 'boolean', default: false },
        trace: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error: unknown) {
    return { kind: 'errors', errors: [{ code: 'unknownOption', message: describeError(error) }] };
  }
  const { values } = parsed;
  if (values.help) {
    return { kind: 'help' };
  }

  const errors: ArgumentError[] = [];

  let days = 0;
  if (values.days === undefined) {
    errors.push({ code: 'missingDays', message: '--days is required' });
  } else {
    const parsedDays = parseWholeNumber(values.days, 1, MAX_RUN_DAYS);
    if (parsedDays === null) {
      errors.push({
        code: 'invalidDays',
        message: `--days must be a whole number from 1 to ${String(MAX_RUN_DAYS)}, not ${values.days}`,
      });
    } else {
      days = parsedDays;
    }
  }

  let people = DEFAULT_FIXTURE_PEOPLE;
  if (values.people !== undefined) {
    const parsedPeople = parseWholeNumber(values.people, 1, MAX_FIXTURE_PEOPLE);
    if (parsedPeople === null) {
      errors.push({
        code: 'invalidPeople',
        message: `--people must be a whole number from 1 to ${String(MAX_FIXTURE_PEOPLE)}, not ${values.people}`,
      });
    } else {
      people = parsedPeople;
    }
  }

  const seed = values.seed ?? DEFAULT_SEED;
  if (seed.length === 0 || seed.length > 64) {
    errors.push({ code: 'invalidSeed', message: '--seed must be 1 to 64 characters long' });
  }

  const worldText = values.world ?? ROSTER_FIXTURE;
  const world = parseWorldSource(worldText);
  if (world === null) {
    errors.push({
      code: 'invalidWorld',
      message: `--world must be ${ROSTER_FIXTURE} or a path to an EngineState JSON file, not "${worldText}"`,
    });
  }

  const tunables: TunableSetting[] = [];
  for (const text of values.tunable ?? []) {
    const setting = parseTunableSetting(text);
    if (isArgumentError(setting)) {
      errors.push(setting);
    } else {
      tunables.push(setting);
    }
  }

  let trace: TraceRef | null = null;
  if (values.trace !== undefined) {
    trace = parseTraceRef(values.trace);
    if (trace === null) {
      errors.push({
        code: 'invalidTrace',
        message: `--trace must look like kind:id, such as condition.fatigueRecovery:per_..., not "${values.trace}"`,
      });
    }
  }

  if (errors.length > 0 || world === null) {
    return { kind: 'errors', errors };
  }
  return {
    kind: 'options',
    options: {
      days,
      seed,
      world,
      people,
      tunables,
      json: values.json,
      checkDeterminism: values['check-determinism'],
      strict: values.strict,
      trace,
    },
  };
}
