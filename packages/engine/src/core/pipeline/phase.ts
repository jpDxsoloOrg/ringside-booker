/**
 * Phase definitions.
 *
 * A phase is one named job of the day: "age everyone on their birthday", "pay wages on Fridays".
 * It says which group it belongs to, where it sits inside that group, how often it runs (a
 * cadence) and, optionally, a condition read from the world, such as "only when aging is on".
 *
 * See the "Registering a phase" section of docs/design/day-pipeline.md.
 */

import type { GameTables } from '../../model/tables';
import type { TableRegistry } from '../../model/table-def';
import type { WorldView } from '../../model/world';
import { defineCadence, type Cadence } from '../calendar/cadence';
import { describeValue, PipelineError } from '../errors';
import type { PhaseContext } from './context';
import { isPhaseGroup, MAX_PHASE_ORDER, type PhaseGroup } from './groups';

/** A phase id: `system.camelName`, such as `money.payroll` or `workers.aging`. */
export const PHASE_ID_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

/** What a system writes to define a phase. */
export interface PhaseSpec<R extends TableRegistry = GameTables> {
  /** `system.camelName`. Unique across the registry. */
  readonly id: string;
  readonly group: PhaseGroup;
  /** A whole number from 0 to 99: the phase's place within its group. */
  readonly order: number;
  /** How often the phase runs. Checked with `defineCadence`. */
  readonly cadence: Cadence;
  /**
   * An extra condition read from the world before the phase runs, for settings such as "aging
   * disabled". Returning false skips the phase for the day. It must only read.
   */
  readonly when?: (view: WorldView<R>) => boolean;
  /** The phase's work. Synchronous: no promises, no awaiting. */
  readonly run: (ctx: PhaseContext<R>) => void;
}

/** A checked, frozen phase definition, ready to register. */
export type PhaseDefinition<R extends TableRegistry = GameTables> = PhaseSpec<R>;

/**
 * Checks a phase spec and returns a frozen definition. Throws {@link PipelineError} on a malformed
 * id, an unknown group, or an order outside 0–99, and `InvalidCadenceError` on a
 * bad cadence. Whether the group is open to systems is checked when the phase is registered.
 */
export function definePhase<R extends TableRegistry = GameTables>(
  spec: PhaseSpec<R>,
): PhaseDefinition<R> {
  if (!PHASE_ID_PATTERN.test(spec.id)) {
    throw new PipelineError(
      `Phase id ${describeValue(spec.id)} must look like "system.camelName", for example "money.payroll"`,
      { phaseId: spec.id },
    );
  }
  if (!isPhaseGroup(spec.group)) {
    throw new PipelineError(`Phase ${spec.id}: unknown group ${describeValue(spec.group)}`, {
      phaseId: spec.id,
      group: describeValue(spec.group),
    });
  }
  if (!Number.isInteger(spec.order) || spec.order < 0 || spec.order > MAX_PHASE_ORDER) {
    throw new PipelineError(
      `Phase ${spec.id}: order must be a whole number from 0 to ${String(MAX_PHASE_ORDER)}, got ${describeValue(spec.order)}`,
      { phaseId: spec.id, order: describeValue(spec.order) },
    );
  }
  const definition: PhaseDefinition<R> = {
    id: spec.id,
    group: spec.group,
    order: spec.order,
    cadence: defineCadence(spec.cadence),
    run: spec.run,
    ...(spec.when === undefined ? {} : { when: spec.when }),
  };
  return Object.freeze(definition);
}
