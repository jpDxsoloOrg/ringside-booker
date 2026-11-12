/**
 * The engine: the one way into a running game for the web app, the headless runner and mods.
 *
 * `createEngine({ state, systems })` rebuilds a game from its {@link EngineState}, registers every
 * system bundle, and returns an {@link Engine}. Nothing outside the engine touches the World: screens
 * read through typed queries, players and the computer change things through typed commands, and
 * time moves through `advanceDays`. Every result that crosses the boundary is plain JSON.
 *
 * Nothing assumes a single player (design decision D-07). Every command names the controller that
 * issued it and is written to the command log; every query runs for a viewer.
 *
 * See docs/design/engine-api.md.
 */

import { TABLES } from '../../model/tables';
import { documentToWorld, serialiseWorld } from '../../persistence/world-document';
import { loadEngineTunables, type EngineTunables } from '../../systems/tunables';
import { InvalidArgumentError, PipelineError, RegistryError, serializeError } from '../errors';
import { EventBus, type EventObserver, type PublishEvent } from '../events/bus';
import { cloneJson, isJsonValue, type JsonValue } from '../json';
import type { AdvanceOptions, AdvanceResult } from '../pipeline/advance';
import { advanceDays } from '../pipeline/advance';
import type { ReactionContext } from '../pipeline/context';
import { PipelineFailureLog } from '../pipeline/failureLog';
import { evaluateGates } from '../pipeline/gates';
import { runStep } from '../pipeline/runStep';
import { createRuntime, type SimRuntime } from '../pipeline/runtime';
import { RngRegistry } from '../rng/registry';
import { TraceStore, traceStoreLimitsFrom } from '../trace/store';
import { withOverride, withoutOverride } from '../tunables/resolver';
import type { TunableIssue } from '../tunables/validate';
import type { CommandContext, CommandDefinition, TunableOverrideWriter } from './command';
import { CommandLog, type CommandOutcome } from './commandLog';
import { ControllerSchema, ViewerSchema, type Controller, type Viewer } from './controller';
import type {
  CommandArgs,
  CommandData,
  CommandName,
  QueryArgs,
  QueryData,
  QueryName,
} from './maps';
import type { QueryContext, QueryDefinition } from './query';
import {
  INTERNAL,
  internalReason,
  invalidArgsReasons,
  QueryRefusal,
  type CommandEvent,
  type CommandResult,
  type QueryResult,
  type Reason,
} from './result';
import { assertSerialisable } from './serialisable';
import type { EngineState } from './state';
import type { SystemBundle } from './system';

/** What the host running the engine provides. Both are optional. */
export interface EngineHost {
  /** Milliseconds from any fixed point, for step timings only. Defaults to `() => 0`. */
  readonly now?: () => number;
  /**
   * Awaited after every day of a multi-day advance, so a Web Worker can take a Cancel message
   * between days. An `advanceDays` call can pass its own instead.
   */
  readonly yieldToHost?: () => Promise<void>;
}

/** What `createEngine` takes. */
export interface CreateEngineOptions {
  /** The game to run: `initialEngineState(world)` for a new game, or a loaded save's state. */
  readonly state: EngineState;
  /** Every system bundle, such as `defaultSystems`. Registered in this order. */
  readonly systems: readonly SystemBundle[];
  readonly host?: EngineHost;
  /**
   * Check every query and command result, and every event payload, is plain JSON, and fail with
   * the bad path when one is not. Defaults to true. The production web build passes false, because
   * the checks cost time on every call; tests and CI keep them on.
   */
  readonly debugChecks?: boolean;
}

/** The step id a command's failures are logged under: `command:<name>`. */
export function commandStepId(name: string): string {
  return `command:${name}`;
}

/** The running game. */
export interface Engine {
  /** Tunable overrides in the state that were dropped because they no longer fit their tunable. */
  readonly loadIssues: readonly TunableIssue[];
  /** Whether results are checked to be plain JSON. */
  readonly debugChecks: boolean;
  /** Runs a query for `viewer`. Never throws: bad arguments or a failing query come back as reasons. */
  query<N extends QueryName>(
    name: N,
    args: QueryArgs<N>,
    viewer: Viewer,
  ): QueryResult<QueryData<N>>;
  /**
   * Runs a command issued by `issuedBy`, all or nothing, and logs it. Never throws: refused or
   * failing commands come back as reasons and leave the world as it was.
   */
  command<N extends CommandName>(
    name: N,
    args: CommandArgs<N>,
    issuedBy: Controller,
  ): CommandResult<CommandData<N>>;
  /**
   * {@link Engine.query} for a call whose parts arrive untyped, such as a message from the main
   * thread. The viewer is checked too.
   */
  queryRaw(name: string, args: unknown, viewer: unknown): QueryResult<unknown>;
  /** {@link Engine.command} for a call whose parts arrive untyped. The controller is checked too. */
  commandRaw(name: string, args: unknown, issuedBy: unknown): CommandResult<unknown>;
  /**
   * Simulates up to `maxDays` days, stopping early at a gate, the stop date or a cancel (SIM-09's
   * `advanceDays`). Commands are refused while it runs; queries still work. Rejects when another
   * advance is already running, or for options the loop cannot run with.
   */
  advanceDays(options: AdvanceOptions): Promise<AdvanceResult>;
  /** Registers a read-only listener for every committed event. Returns a function that removes it. */
  onEvent(listener: EventObserver): () => void;
  /** The whole game as plain JSON, for saving or for `createEngine`. */
  exportState(): EngineState;
}

/** The kinds of things a bundle registers, for duplicate checks and messages. */
type RegistrationKind = 'phase' | 'gate' | 'subscription' | 'query' | 'command';

/** Remembers which system registered each id, so a duplicate names both systems. */
class Registrations {
  readonly #owners = new Map<string, string>();

  claim(kind: RegistrationKind, id: string, systemId: string): void {
    const key = `${kind}:${id}`;
    const owner = this.#owners.get(key);
    if (owner !== undefined) {
      const by = owner === systemId ? 'the same system' : `system "${owner}"`;
      throw new RegistryError(
        `System "${systemId}": ${kind} "${id}" is already registered by ${by}`,
        { system: systemId, kind, id, otherSystem: owner },
      );
    }
    this.#owners.set(key, systemId);
  }
}

/** Runs one registration and puts the system id in front of any error it throws. */
function registerFor(systemId: string, register: () => void): void {
  try {
    register();
  } catch (error: unknown) {
    throw new RegistryError(`System "${systemId}": ${serializeError(error).message}`, {
      system: systemId,
    });
  }
}

/** Arguments for the command log: as given when they are plain JSON, otherwise null. */
function loggableArgs(args: unknown): JsonValue {
  return isJsonValue(args) ? cloneJson(args) : null;
}

/** Builds the runtime from the state. Throws when the RNG seed is not the world's seed. */
function buildRuntime(
  state: EngineState,
  tunables: EngineTunables,
  host: EngineHost,
  debugChecks: boolean,
): SimRuntime {
  if (state.rng.seed !== state.world.meta.seed) {
    throw new PipelineError(
      `The RNG seed ${JSON.stringify(state.rng.seed)} does not match the world seed ${JSON.stringify(state.world.meta.seed)}`,
      { rngSeed: state.rng.seed, worldSeed: state.world.meta.seed },
    );
  }
  const world = documentToWorld({ state: { world: state.world } }, TABLES);
  return createRuntime({
    world,
    rng: RngRegistry.fromState(state.rng),
    tunables,
    bus: new EventBus<ReactionContext>({
      logSize: tunables.get('sim.eventLogSize'),
      maxCascadeDepth: tunables.get('sim.maxEventCascadeDepth'),
      debugChecks,
      state: state.events,
    }),
    traces: TraceStore.fromState(state.traces, traceStoreLimitsFrom(tunables)),
    failureLog: PipelineFailureLog.fromState(state.failureLog),
    ...(host.now === undefined ? {} : { host: { now: host.now } }),
  });
}

/**
 * Builds a running game from `state` and registers every system bundle.
 *
 * Throws {@link PipelineError} when `state.rng.seed` is not the world's `meta.seed`,
 * {@link RegistryError} (naming the system) for a duplicate or malformed phase, gate, subscription,
 * query or command, and `InvalidStatePartError` for a malformed state part. Tunable overrides that
 * no longer fit their tunable are dropped and listed in `engine.loadIssues`.
 */
export function createEngine(options: CreateEngineOptions): Engine {
  const { state, systems } = options;
  const host = options.host ?? {};
  const debugChecks = options.debugChecks ?? true;

  const loadedTunables = loadEngineTunables(state.tunableOverrides);
  let tunables: EngineTunables = loadedTunables.reader;
  const base = buildRuntime(state, tunables, host, debugChecks);
  const commandLog = CommandLog.fromState(state.commandLog, tunables.get('sim.commandLogSize'));
  // The runtime reads the tunables through a getter, so a tunable command takes effect for every
  // step that runs after it (including the reactions to its own events).
  const runtime: SimRuntime = {
    world: base.world,
    rng: base.rng,
    get tunables() {
      return tunables;
    },
    bus: base.bus,
    traces: base.traces,
    phases: base.phases,
    gates: base.gates,
    failureLog: base.failureLog,
    host: base.host,
    lastDayReport: null,
  };

  const queries = new Map<string, QueryDefinition>();
  const commands = new Map<string, CommandDefinition>();
  const registrations = new Registrations();
  const systemIds = new Set<string>();
  for (const system of systems) {
    if (systemIds.has(system.id)) {
      throw new RegistryError(`System "${system.id}" is registered twice`, { system: system.id });
    }
    systemIds.add(system.id);
    for (const phase of system.phases) {
      registrations.claim('phase', phase.id, system.id);
      registerFor(system.id, () => runtime.phases.register(phase));
    }
    for (const gate of system.gates) {
      registrations.claim('gate', gate.id, system.id);
      registerFor(system.id, () => runtime.gates.register(gate));
    }
    for (const subscription of system.subscriptions) {
      registrations.claim('subscription', subscription.id, system.id);
      registerFor(system.id, () => {
        runtime.bus.subscribe(
          subscription.type,
          (event, ctx) => {
            subscription.handler(event, ctx);
          },
          {
            id: subscription.id,
            ...(subscription.priority === undefined ? {} : { priority: subscription.priority }),
          },
        );
      });
    }
    for (const query of system.queries) {
      registrations.claim('query', query.name, system.id);
      queries.set(query.name, query);
    }
    for (const command of system.commands) {
      registrations.claim('command', command.name, system.id);
      commands.set(command.name, command);
    }
  }

  let advancing = false;

  /** Applies the tunables that size the engine's own stores after an override changed. */
  function applyStoreLimits(): void {
    runtime.traces.setLimits(traceStoreLimitsFrom(tunables));
    commandLog.resize(tunables.get('sim.commandLogSize'));
  }

  function queryContext(viewer: Viewer): QueryContext {
    return {
      read: runtime.world,
      viewer,
      tunables,
      traces: runtime.traces,
      events: runtime.bus,
      gates: (date) => evaluateGates(runtime, date),
      date: runtime.world.meta.currentDate,
      lastDayReport: runtime.lastDayReport,
      failures: (limit) => runtime.failureLog.recent(limit),
      commands: (limit) => commandLog.recent(limit),
    };
  }

  function queryRaw(name: string, rawArgs: unknown, rawViewer: unknown): QueryResult<unknown> {
    const viewer = ViewerSchema.safeParse(rawViewer);
    if (!viewer.success) {
      return { ok: false, reasons: invalidArgsReasons(viewer.error, 'viewer') };
    }
    const definition = queries.get(name);
    if (definition === undefined) {
      return {
        ok: false,
        reasons: [{ code: 'unknownQuery', message: `There is no query called "${name}".` }],
      };
    }
    const args = definition.args.safeParse(rawArgs);
    if (!args.success) {
      return { ok: false, reasons: invalidArgsReasons(args.error) };
    }
    try {
      const data = definition.run(queryContext(viewer.data), args.data);
      if (debugChecks) {
        assertSerialisable(data, `queries["${name}"]`);
      }
      return { ok: true, data };
    } catch (error: unknown) {
      if (error instanceof QueryRefusal) {
        // The query said no on purpose: its own reasons, and nothing for the failure log.
        return { ok: false, reasons: error.reasons.map((reason) => ({ ...reason })) };
      }
      return { ok: false, reasons: [internalReason(error)] };
    }
  }

  function commandRaw(
    name: string,
    rawArgs: unknown,
    rawIssuedBy: unknown,
  ): CommandResult<unknown> {
    const issuer = ControllerSchema.safeParse(rawIssuedBy);
    if (!issuer.success) {
      // Not logged: the log names who issued each command, and nobody valid did.
      return { ok: false, reasons: invalidArgsReasons(issuer.error, 'issuedBy') };
    }
    const issuedBy = issuer.data;
    const date = runtime.world.meta.currentDate;
    const log = (outcome: CommandOutcome, args: unknown, reasons: readonly Reason[]): void => {
      commandLog.record({
        date,
        issuedBy,
        name,
        args: loggableArgs(args),
        outcome,
        reasonCodes: reasons.map((reason) => reason.code),
      });
    };
    const refuse = (
      outcome: Exclude<CommandOutcome, 'applied'>,
      args: unknown,
      reasons: Reason[],
    ): CommandResult<unknown> => {
      log(outcome, args, reasons);
      return { ok: false, reasons };
    };

    if (advancing) {
      return refuse('rejected', rawArgs, [
        { code: 'busy', message: 'The game is moving forward. Try again when it stops.' },
      ]);
    }
    const definition = commands.get(name);
    if (definition === undefined) {
      return refuse('rejected', rawArgs, [
        { code: 'unknownCommand', message: `There is no command called "${name}".` },
      ]);
    }
    const parsed = definition.args.safeParse(rawArgs);
    if (!parsed.success) {
      return refuse('rejected', rawArgs, invalidArgsReasons(parsed.error));
    }
    const args = parsed.data;
    const stepId = commandStepId(name);

    let reasons: Reason[];
    try {
      reasons = definition.validate(runtime.world, args, issuedBy, { tunables });
      if (debugChecks) {
        assertSerialisable(reasons, `commands["${name}"].reasons`);
      }
    } catch (error: unknown) {
      runtime.failureLog.record({ date, stepId, error: serializeError(error) });
      return refuse('failed', args, [internalReason(error)]);
    }
    if (reasons.length > 0) {
      return refuse('rejected', args, reasons);
    }

    const tunablesBefore = tunables;
    const tunableOverrides: TunableOverrideWriter = {
      set: (key, value) => {
        const change = withOverride(tunables, key, value);
        if (!change.ok) {
          throw new InvalidArgumentError(
            'tunableOverrides.set',
            key,
            value,
            `a value the tunable allows (${change.issue.message})`,
          );
        }
        tunables = change.reader;
      },
      clear: (key) => {
        tunables = withoutOverride(tunables, key);
      },
    };

    const published: string[] = [];
    const seqBefore = runtime.bus.seq;
    let data: unknown = null;
    const report = runStep(
      runtime,
      stepId,
      { kind: 'command', id: name },
      (ctx) => {
        const publish: PublishEvent = (type, payload) => {
          ctx.publish(type, payload);
          published.push(type);
        };
        const commandContext: CommandContext = { ...ctx, publish, issuedBy, tunableOverrides };
        const result = definition.apply(commandContext, args, issuedBy);
        if (debugChecks) {
          assertSerialisable(result, `commands["${name}"].result`);
        }
        data = result;
        // Handed back so the transaction can refuse a result that is a promise.
        return result;
      },
      { announceFailure: false },
    );

    if (report.status !== 'ok') {
      tunables = tunablesBefore;
      return refuse('failed', args, [
        {
          code: INTERNAL,
          message: `Something went wrong inside the game: ${report.error?.message ?? 'unknown error'}`,
        },
      ]);
    }
    if (tunables !== tunablesBefore) {
      applyStoreLimits();
    }
    log('applied', args, []);
    // Committed events get consecutive sequence numbers in publish order.
    const events: CommandEvent[] = published.map((type, index) => ({
      type,
      seq: seqBefore + index + 1,
    }));
    return { ok: true, data, events };
  }

  const engine: Engine = {
    loadIssues: Object.freeze([...loadedTunables.issues]),
    debugChecks,
    query<N extends QueryName>(
      name: N,
      args: QueryArgs<N>,
      viewer: Viewer,
    ): QueryResult<QueryData<N>> {
      // The query registered under `name` was built by defineQuery<N>, so its data is QueryData<N>.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return queryRaw(name, args, viewer) as QueryResult<QueryData<N>>;
    },
    command<N extends CommandName>(
      name: N,
      args: CommandArgs<N>,
      issuedBy: Controller,
    ): CommandResult<CommandData<N>> {
      // The command registered under `name` was built by defineCommand<N>, so its data is
      // CommandData<N>.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return commandRaw(name, args, issuedBy) as CommandResult<CommandData<N>>;
    },
    queryRaw,
    commandRaw,
    async advanceDays(advanceOptions: AdvanceOptions): Promise<AdvanceResult> {
      if (advancing) {
        throw new PipelineError('advanceDays was called while another advance was still running');
      }
      advancing = true;
      try {
        const yieldToHost = advanceOptions.yieldToHost ?? host.yieldToHost;
        const result = await advanceDays(
          runtime,
          yieldToHost === undefined ? advanceOptions : { ...advanceOptions, yieldToHost },
        );
        if (debugChecks) {
          // The advance result crosses the worker boundary like any query or command result.
          assertSerialisable(result, 'advanceDays');
        }
        return result;
      } finally {
        advancing = false;
      }
    },
    onEvent(listener: EventObserver): () => void {
      return runtime.bus.observe(listener);
    },
    exportState(): EngineState {
      return {
        world: serialiseWorld(runtime.world),
        rng: runtime.rng.toState(),
        tunableOverrides: { ...tunables.overrides },
        traces: runtime.traces.toState(),
        events: runtime.bus.toState(),
        failureLog: runtime.failureLog.toState(),
        commandLog: commandLog.toState(),
      };
    },
  };
  return Object.freeze(engine);
}
