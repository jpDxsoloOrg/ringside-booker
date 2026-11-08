/**
 * The phase registry: every phase the day runs, in a fixed order.
 *
 * Systems register their phases once, when the engine is built. The order the day runs them in
 * comes only from each phase's group and order, never from registration order, so two builds that
 * register the same phases in a different sequence still simulate identical days.
 */

import type { GameTables } from '../../model/tables';
import type { TableRegistry } from '../../model/table-def';
import { PipelineError } from '../errors';
import { isEngineOnlyGroup, phasePosition } from './groups';
import { definePhase, type PhaseDefinition, type PhaseSpec } from './phase';

/** The system prefix of the engine's own steps (`pipeline.open`, `pipeline.close`). */
export const RESERVED_PHASE_SYSTEM = 'pipeline';

export class PhaseRegistry<R extends TableRegistry = GameTables> {
  readonly #byId = new Map<string, PhaseDefinition<R>>();
  /** The phase holding each position (group base + order). */
  readonly #byPosition = new Map<number, PhaseDefinition<R>>();
  #ordered: readonly PhaseDefinition<R>[] | null = null;

  /**
   * Adds a phase. The spec is checked with {@link definePhase} first. Throws
   * {@link PipelineError} when the id is taken or reserved, when another phase already holds the
   * same group and order, or when the group is one of the engine-only groups (`open`, `close`).
   * Returns the registered definition.
   */
  register(phase: PhaseSpec<R>): PhaseDefinition<R> {
    const definition = definePhase(phase);
    if (isEngineOnlyGroup(definition.group)) {
      throw new PipelineError(
        `Phase ${definition.id}: group "${definition.group}" is reserved for the engine's own steps`,
        { phaseId: definition.id, group: definition.group },
      );
    }
    if (definition.id.startsWith(`${RESERVED_PHASE_SYSTEM}.`)) {
      throw new PipelineError(
        `Phase ${definition.id}: the "${RESERVED_PHASE_SYSTEM}." prefix is reserved for the engine's own steps`,
        { phaseId: definition.id },
      );
    }
    if (this.#byId.has(definition.id)) {
      throw new PipelineError(`A phase with id ${definition.id} is already registered`, {
        phaseId: definition.id,
      });
    }
    const position = phasePosition(definition.group, definition.order);
    const occupant = this.#byPosition.get(position);
    if (occupant !== undefined) {
      throw new PipelineError(
        `Phase ${definition.id} and phase ${occupant.id} both use group "${definition.group}" order ${String(definition.order)}`,
        {
          phaseId: definition.id,
          otherPhaseId: occupant.id,
          group: definition.group,
          order: definition.order,
        },
      );
    }
    this.#byId.set(definition.id, definition);
    this.#byPosition.set(position, definition);
    this.#ordered = null;
    return definition;
  }

  /** The phase with this id, if registered. */
  get(id: string): PhaseDefinition<R> | undefined {
    return this.#byId.get(id);
  }

  /** How many phases are registered. */
  get size(): number {
    return this.#byId.size;
  }

  /** Every phase in day order: by group base, then by order within the group. */
  ordered(): readonly PhaseDefinition<R>[] {
    this.#ordered ??= Object.freeze(
      [...this.#byPosition.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, definition]) => definition),
    );
    return this.#ordered;
  }
}
