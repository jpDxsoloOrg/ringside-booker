/**
 * Gates: the reasons a multi-day skip stops by itself.
 *
 * A gate is a cheap, read-only check that runs at the start of every day of a skip, before that
 * day is simulated: "the player's show today has no card", "a decision is waiting in the inbox".
 * When any gate hits, the skip stops and the UI shows the gates' player-facing reasons. Systems
 * register their gates once, when the engine is built, the same way they register phases.
 *
 * {@link evaluateGates} is the one function that runs them. The advance loop calls it before every
 * day and the status queries call it to say whether Next Day would stop right now, so the two can
 * never disagree. It only reads: it opens no transaction, draws no random numbers, publishes no
 * events and never moves the date.
 *
 * See the "Gates" section of docs/design/day-pipeline.md.
 */

import type { GameTables } from '../../model/tables';
import type { TableRegistry } from '../../model/table-def';
import type { WorldView } from '../../model/world';
import type { GameDate } from '../date';
import { describeValue, PipelineError, serializeError } from '../errors';
import type { EntityRef } from '../trace/types';
import type { SimRuntime } from './runtime';

/** A gate id: `system.camelName`, such as `events.showNeedsBooking`. */
export const GATE_ID_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

/** The system prefix of the engine's built-in gates (`sim.stopDate`, `sim.repeatedFailure`). */
export const RESERVED_GATE_SYSTEM = 'sim';

/** Why a gate stopped the skip. Plain JSON, so it crosses the worker boundary as it is. */
export interface GateHit {
  /** The id of the gate that hit. */
  gateId: string;
  /**
   * Written for the player, naming the thing that needs them:
   * "Your show 'Friday Fury' on 2031-03-14 has no card yet".
   */
  reason: string;
  /** The entity the hit is about, so the UI can link to it. */
  subject?: EntityRef;
  /** The screen route key the UI can link to, such as `booking`. */
  actionHint?: string;
}

/** What a system writes to define a gate. */
export interface GateSpec<R extends TableRegistry = GameTables> {
  /** `system.camelName`. Unique across the registry. */
  readonly id: string;
  /** A short name for settings and debug screens, such as "Show needs booking". */
  readonly label: string;
  /**
   * Returns a hit when the skip must stop before `date` is simulated, or null to let it run. It
   * must only read, and it runs every day of a skip, so it should use indexed lookups rather than
   * scanning whole tables. The returned `gateId` is always replaced with the gate's own id.
   */
  readonly check: (view: WorldView<R>, date: GameDate) => GateHit | null;
}

/** A checked, frozen gate definition, ready to register. */
export type GateDefinition<R extends TableRegistry = GameTables> = GateSpec<R>;

/**
 * Checks a gate spec and returns a frozen definition. Throws {@link PipelineError} on a malformed
 * id or an empty label.
 */
export function defineGate<R extends TableRegistry = GameTables>(
  spec: GateSpec<R>,
): GateDefinition<R> {
  if (!GATE_ID_PATTERN.test(spec.id)) {
    throw new PipelineError(
      `Gate id ${describeValue(spec.id)} must look like "system.camelName", for example "events.showNeedsBooking"`,
      { gateId: spec.id },
    );
  }
  if (typeof spec.label !== 'string' || spec.label.trim() === '') {
    throw new PipelineError(`Gate ${spec.id}: label must be a non-empty string`, {
      gateId: spec.id,
      label: describeValue(spec.label),
    });
  }
  if (typeof spec.check !== 'function') {
    throw new PipelineError(`Gate ${spec.id}: check must be a function`, { gateId: spec.id });
  }
  return Object.freeze({ id: spec.id, label: spec.label, check: spec.check });
}

/** Every registered gate, kept in registration order. */
export class GateRegistry<R extends TableRegistry = GameTables> {
  readonly #byId = new Map<string, GateDefinition<R>>();

  /**
   * Adds a gate after checking it with {@link defineGate}. Throws {@link PipelineError} when the id
   * is already registered or uses the reserved `sim.` prefix. Returns the registered definition.
   */
  register(gate: GateSpec<R>): GateDefinition<R> {
    const definition = defineGate(gate);
    if (definition.id.startsWith(`${RESERVED_GATE_SYSTEM}.`)) {
      throw new PipelineError(
        `Gate ${definition.id}: the "${RESERVED_GATE_SYSTEM}." prefix is reserved for the engine's own gates`,
        { gateId: definition.id },
      );
    }
    this.#add(definition);
    return definition;
  }

  /**
   * A new registry holding every gate of `base`, in its order, followed by the engine's own
   * `extra` gates. The advance loop uses it to add its per-skip gates (the stop date and repeated
   * failures) without changing the runtime's registry.
   */
  static extend<R extends TableRegistry>(
    base: GateRegistry<R>,
    extra: readonly GateSpec<R>[],
  ): GateRegistry<R> {
    const registry = new GateRegistry<R>();
    for (const gate of base.ordered()) {
      registry.#add(gate);
    }
    for (const gate of extra) {
      registry.#add(defineGate(gate));
    }
    return registry;
  }

  /** The gate with this id, if registered. */
  get(id: string): GateDefinition<R> | undefined {
    return this.#byId.get(id);
  }

  /** How many gates are registered. */
  get size(): number {
    return this.#byId.size;
  }

  /** Every gate, in registration order. */
  ordered(): readonly GateDefinition<R>[] {
    return [...this.#byId.values()];
  }

  #add(definition: GateDefinition<R>): void {
    if (this.#byId.has(definition.id)) {
      throw new PipelineError(`A gate with id ${definition.id} is already registered`, {
        gateId: definition.id,
      });
    }
    this.#byId.set(definition.id, definition);
  }
}

/** A plain JSON copy of a hit, attributed to the gate that returned it. */
function copyHit(gateId: string, hit: GateHit): GateHit {
  return {
    gateId,
    reason: hit.reason,
    ...(hit.subject === undefined
      ? {}
      : { subject: { kind: hit.subject.kind, id: hit.subject.id } }),
    ...(hit.actionHint === undefined ? {} : { actionHint: hit.actionHint }),
  };
}

/**
 * Runs every registered gate's check against the world for `date` and returns all hits, in
 * registration order. The first hit is the main reason to stop; the rest are shown with it.
 *
 * A check that throws counts as a hit whose reason names the gate and the error, so a broken gate
 * stops the skip visibly instead of letting it run past something the player needed to see.
 *
 * Read-only: no transaction, no random draws, no events, and the date does not move.
 */
export function evaluateGates<R extends TableRegistry>(
  state: Pick<SimRuntime<R>, 'world' | 'gates'>,
  date: GameDate,
): GateHit[] {
  const view: WorldView<R> = state.world;
  const hits: GateHit[] = [];
  for (const gate of state.gates.ordered()) {
    let hit: GateHit | null;
    try {
      hit = gate.check(view, date);
    } catch (error: unknown) {
      hits.push({
        gateId: gate.id,
        reason: `Couldn't check "${gate.label}", so the skip stopped to be safe: ${serializeError(error).message}`,
      });
      continue;
    }
    if (hit !== null) {
      hits.push(copyHit(gate.id, hit));
    }
  }
  return hits;
}
