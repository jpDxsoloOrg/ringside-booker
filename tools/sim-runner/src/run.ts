/**
 * One headless run: build or load the starting state, start an engine on it through the public
 * API, apply the `--tunable` overrides as commands, advance the days and summarise what happened.
 *
 * Runs longer than the engine's per-call cap (`MAX_ADVANCE_DAYS`, ten years) call `advanceDays`
 * again until the days run out or a gate stops the run.
 */

import { readFile } from 'node:fs/promises';
import {
  compareDates,
  createEngine,
  defaultSystems,
  engineStateParts,
  initialEngineState,
  MAX_ADVANCE_DAYS,
  OMNISCIENT_VIEWER,
  SerializedWorldSchema,
  worldHash,
  type AdvanceFailure,
  type AdvanceStop,
  type Controller,
  type EngineState,
  type StoredTraceEntry,
  type SystemBundle,
  type TraceRef,
} from '@ringside/engine';
import { resetTestIds, rosterWorld } from '@ringside/engine/testing/fixtures';
import type { ArgumentError, RunnerOptions, TunableSetting, WorldSource } from './args';
import {
  countFailuresByStep,
  daysPerSecond,
  FIRST_FAILURES_LIMIT,
  sortedCounts,
  type RunSummary,
} from './summary';

/** The player id the runner issues commands as when the world lists no players. */
export const CLI_PLAYER_ID = 'cli';

/** The starting state, or why it could not be built or read. */
export type StartStateResult =
  | { readonly ok: true; readonly state: EngineState }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * The roster fixture: `rosterWorld(people)` with fresh test IDs (so the same size always gives the
 * same IDs), the seed written into `meta.seed`, and no players, because a headless run has no
 * player promotion.
 */
export function fixtureState(people: number, seed: string): EngineState {
  resetTestIds();
  const { world } = rosterWorld(people);
  return initialEngineState({
    meta: { ...world.meta, seed, players: [] },
    tables: world.tables,
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One problem a schema found. */
interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** The shape of a schema's `safeParse` result that the runner reads. */
type SafeParseOutcome<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: { readonly issues: readonly SchemaIssue[] } };

/** How many problems are listed per state part. */
const ISSUES_PER_PART = 5;

/** Lists a zod-style issue as `part.path: message`. */
function issueText(part: string, issue: SchemaIssue): string {
  const path = [part, ...issue.path.map((segment) => String(segment))].join('.');
  return `${path}: ${issue.message}`;
}

/**
 * Checks parsed JSON is an engine state (what `engine.exportState()` returns) and returns it typed,
 * or every problem found, part by part.
 */
export function parseEngineState(raw: unknown): StartStateResult {
  if (!isRecord(raw)) {
    return { ok: false, errors: ['The file must hold a JSON object (an EngineState)'] };
  }
  const errors: string[] = [];
  const limitIssues = <T>(part: string, result: SafeParseOutcome<T>): T | null => {
    if (result.success) {
      return result.data;
    }
    errors.push(
      ...result.error.issues.slice(0, ISSUES_PER_PART).map((issue) => issueText(part, issue)),
    );
    return null;
  };
  const world = limitIssues('world', SerializedWorldSchema.safeParse(raw['world']));
  const rng = limitIssues('rng', engineStateParts.rng.safeParse(raw['rng']));
  const tunableOverrides = limitIssues(
    'tunableOverrides',
    engineStateParts.tunableOverrides.safeParse(raw['tunableOverrides']),
  );
  const traces = limitIssues('traces', engineStateParts.traces.safeParse(raw['traces']));
  const events = limitIssues('events', engineStateParts.events.safeParse(raw['events']));
  const failureLog = limitIssues(
    'failureLog',
    engineStateParts.failureLog.safeParse(raw['failureLog']),
  );
  const commandLog = limitIssues(
    'commandLog',
    engineStateParts.commandLog.safeParse(raw['commandLog']),
  );
  if (
    world === null ||
    rng === null ||
    tunableOverrides === null ||
    traces === null ||
    events === null ||
    failureLog === null ||
    commandLog === null
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    state: { world, rng, tunableOverrides, traces, events, failureLog, commandLog },
  };
}

/** Reads an engine state from a JSON file. */
export async function readStateFile(path: string): Promise<StartStateResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error: unknown) {
    return { ok: false, errors: [`Cannot read ${path}: ${describeError(error)}`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error: unknown) {
    return { ok: false, errors: [`${path} is not valid JSON: ${describeError(error)}`] };
  }
  const parsed = parseEngineState(raw);
  return parsed.ok
    ? parsed
    : { ok: false, errors: parsed.errors.map((error) => `${path}: ${error}`) };
}

/** Builds or reads the starting state a run begins from. */
export async function loadStartState(
  options: Pick<RunnerOptions, 'world' | 'people' | 'seed'>,
): Promise<StartStateResult> {
  const source: WorldSource = options.world;
  switch (source.kind) {
    case 'fixture':
      return { ok: true, state: fixtureState(options.people, options.seed) };
    case 'file':
      return readStateFile(source.path);
  }
}

/** What one run needs beyond its starting state. */
export interface RunSettings {
  readonly days: number;
  readonly tunables: readonly TunableSetting[];
  readonly trace: TraceRef | null;
  /** The system bundles to run with. Defaults to `defaultSystems`; tests pass their own. */
  readonly systems?: readonly SystemBundle[];
}

/** A finished run. */
export interface CompletedRun {
  readonly kind: 'completed';
  readonly summary: RunSummary;
  /** Every failed step, in the order they failed (the summary keeps only the first few). */
  readonly failures: readonly AdvanceFailure[];
  /** How many `advanceDays` calls the run made. */
  readonly advanceCalls: number;
  /** The state at the end of the run. */
  readonly finalState: EngineState;
  /** The `--trace` entry: null when nothing is stored under that ref, undefined when not asked. */
  readonly trace: StoredTraceEntry | null | undefined;
}

/** What {@link runSimulation} returns. */
export type RunOutcome =
  | CompletedRun
  | { readonly kind: 'argumentErrors'; readonly errors: readonly ArgumentError[] }
  | { readonly kind: 'loadError'; readonly errors: readonly string[] };

/**
 * The controller the runner issues commands as: a human called `cli` in a world with no players,
 * otherwise the first listed player, because only a player in the game may change its tunables.
 */
export function runnerController(state: EngineState): Controller {
  const [firstPlayer] = state.world.meta.players;
  return { kind: 'human', playerId: firstPlayer?.playerId ?? CLI_PLAYER_ID };
}

/**
 * Runs `settings.days` days from `start`. Never changes `start`, so the determinism check can run
 * twice from the same object.
 */
export async function runSimulation(
  start: EngineState,
  settings: RunSettings,
): Promise<RunOutcome> {
  let engine;
  try {
    engine = createEngine({
      state: structuredClone(start),
      systems: settings.systems ?? defaultSystems,
      host: { now: () => performance.now() },
    });
  } catch (error: unknown) {
    return { kind: 'loadError', errors: [`The engine could not start: ${describeError(error)}`] };
  }

  const issuedBy = runnerController(start);
  const tunableErrors: ArgumentError[] = [];
  for (const setting of settings.tunables) {
    const result = engine.command(
      'tunables.setOverride',
      { key: setting.key, value: setting.value },
      issuedBy,
    );
    if (!result.ok) {
      for (const reason of result.reasons) {
        tunableErrors.push({
          code: reason.code === 'notAllowed' ? 'notAllowed' : 'invalidTunable',
          message: `--tunable ${setting.key}=${String(setting.value)}: ${reason.message}`,
        });
      }
    }
  }
  if (tunableErrors.length > 0) {
    return { kind: 'argumentErrors', errors: tunableErrors };
  }

  const eventCounts = new Map<string, number>();
  const stopObserving = engine.onEvent((event) => {
    eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1);
  });

  const startDate = start.world.meta.currentDate;
  const failures: AdvanceFailure[] = [];
  let stoppedBy: AdvanceStop = { kind: 'completed' };
  let daysAdvanced = 0;
  let advanceCalls = 0;
  const startedAt = performance.now();
  try {
    while (daysAdvanced < settings.days) {
      const result = await engine.advanceDays({
        maxDays: Math.min(settings.days - daysAdvanced, MAX_ADVANCE_DAYS),
      });
      advanceCalls += 1;
      daysAdvanced += result.daysAdvanced;
      failures.push(...result.failures);
      if (result.stoppedBy.kind !== 'completed') {
        stoppedBy = result.stoppedBy;
        break;
      }
    }
  } finally {
    stopObserving();
  }
  // Rounded to a tenth of a millisecond: finer digits are noise in a printed report.
  const wallMs = Math.round((performance.now() - startedAt) * 10) / 10;

  const finalState = engine.exportState();
  let trace: StoredTraceEntry | null | undefined;
  if (settings.trace !== null) {
    const found = engine.query('trace.get', { ref: settings.trace }, OMNISCIENT_VIEWER);
    trace = found.ok ? found.data : null;
  }

  return {
    kind: 'completed',
    summary: {
      startDate,
      endDate: finalState.world.meta.currentDate,
      daysAdvanced,
      stoppedBy,
      wallMs,
      daysPerSecond: daysPerSecond(daysAdvanced, wallMs),
      failuresByStep: countFailuresByStep(failures),
      firstFailures: failures.slice(0, FIRST_FAILURES_LIMIT),
      eventsByType: sortedCounts(eventCounts),
      worldHash: worldHash(finalState),
      loadIssues: engine.loadIssues.map((issue) => issue.message),
    },
    failures,
    advanceCalls,
    finalState,
    trace,
  };
}

/**
 * The shows dated before the state's current date that are still open (`scheduled` or `booked`),
 * by id. Show night runs a show on its day and the calendar closes whatever it did not, so after a
 * clean run this is empty; `--strict` fails when it is not.
 */
export function openPastShows(state: EngineState): string[] {
  const today = state.world.meta.currentDate;
  return state.world.tables.eventInstances
    .filter(
      (show) =>
        (show.status === 'scheduled' || show.status === 'booked') &&
        compareDates(show.date, today) < 0,
    )
    .map((show) => show.id)
    .sort();
}
