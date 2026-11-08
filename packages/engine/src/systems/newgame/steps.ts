/**
 * New-game setup steps: an ordered registry run through the day pipeline's step machinery.
 *
 * Each option that changes the freshly loaded world is a step with an explicit `order`. Steps run
 * in ascending order, each through SIM-08's `runStep` with its own transaction, RNG snapshot and
 * report. Unlike a day, the first step that fails stops new game: the caller gets that step's
 * report and no world, because a half-configured world must never be saved.
 *
 * Built-in orders are spaced by 100 so other systems can slot steps between them; ECO's pricing,
 * production and network steps belong at 900 and above, after the equal start reset, so the reset
 * never discards their work. See docs/design/new-game.md#setup-steps.
 */

import type { Reason } from '../../core/api/result';
import type { GameDate } from '../../core/date';
import { RegistryError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import { PHASE_ID_PATTERN } from '../../core/pipeline/phase';
import { skippedStepReport, type StepReport } from '../../core/pipeline/report';
import { runStep } from '../../core/pipeline/runStep';
import type { SimRuntime } from '../../core/pipeline/runtime';
import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';
import type { ContentLibrary } from '../../persistence/packs/library';
import type { EngineTunables } from '../tunables';
import type { NewGameInput } from './input';
import type { ResolvedNewGameSettings } from './settings';

/** Shared, changeable state of one new-game run, handed from step to step. */
export interface NewGameSession {
  /**
   * The promotion the human controller will run: the chosen one in `existing` mode, set by
   * `wld.foundPromotion` in `found` mode.
   */
  humanPromotionId: PromotionId | null;
  /**
   * The tunables every later step reads. `wld.applyTunableOverrides` replaces them with the input's
   * overrides applied; they also become the new game's saved overrides.
   */
  tunables: EngineTunables;
}

/** What a setup step's `run` receives besides its transaction. */
export interface SetupContext extends PhaseContext {
  /** The parsed wizard input. */
  readonly input: NewGameInput;
  /** Every registered setting's value, defaults filled in. */
  readonly settings: ResolvedNewGameSettings;
  /** The first day of the game. Equal to `date`. */
  readonly startDate: GameDate;
  /** The length of season 1 (and of later seasons until the player changes it), in days. */
  readonly seasonLengthDays: number;
  /** The pack content that is not part of the World (name tables, generation records). */
  readonly library: ContentLibrary;
  readonly session: NewGameSession;
}

/** What a system writes to add a setup step. */
export interface SetupStepSpec {
  /** `system.camelName`, like a phase id, for example `eco.autoContractPricing`. */
  readonly id: string;
  /** Position in the setup; lower runs first. Whole number, unique across steps. */
  readonly order: number;
  /** Runs the step only when this returns true. Left out: always runs. */
  readonly when?: (settings: ResolvedNewGameSettings, input: NewGameInput) => boolean;
  /** Changes the world through `tx`. Throwing rolls the step back and stops new game. */
  readonly run: (tx: Tx<GameTables>, ctx: SetupContext) => void;
}

/** A registered step, as listed by {@link setupSteps}. */
export interface SetupStepInfo {
  readonly id: string;
  readonly order: number;
}

/** Largest allowed step order. */
export const MAX_SETUP_STEP_ORDER = 1_000_000;

const registry = new Map<string, SetupStepSpec>();

/**
 * Adds a setup step. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError for a malformed id or order, or an id or order that is already taken.
 */
export function registerSetupStep(spec: SetupStepSpec): () => void {
  const fail = (message: string): never => {
    throw new RegistryError(`Setup step "${spec.id}": ${message}`, { stepId: spec.id });
  };
  if (!PHASE_ID_PATTERN.test(spec.id)) {
    fail('the id must look like "system.camelName", for example "eco.autoContractPricing"');
  }
  if (!Number.isInteger(spec.order) || spec.order < 1 || spec.order > MAX_SETUP_STEP_ORDER) {
    fail(`the order must be a whole number from 1 to ${String(MAX_SETUP_STEP_ORDER)}`);
  }
  if (registry.has(spec.id)) {
    fail('a step with this id is already registered');
  }
  for (const other of registry.values()) {
    if (other.order === spec.order) {
      fail(`order ${String(spec.order)} is already taken by "${other.id}"`);
    }
  }
  const stored: SetupStepSpec = { ...spec };
  registry.set(spec.id, stored);
  return () => {
    if (registry.get(spec.id) === stored) {
      registry.delete(spec.id);
    }
  };
}

function orderedSteps(): SetupStepSpec[] {
  return [...registry.values()].sort((left, right) => left.order - right.order);
}

/** Every registered step, in the order they run. */
export function setupSteps(): SetupStepInfo[] {
  return orderedSteps().map((step) => ({ id: step.id, order: step.order }));
}

/** Everything a setup run needs besides the runtime and the per-step context. */
export interface SetupRun {
  readonly input: NewGameInput;
  readonly settings: ResolvedNewGameSettings;
  readonly startDate: GameDate;
  readonly seasonLengthDays: number;
  readonly library: ContentLibrary;
  readonly session: NewGameSession;
}

/** How a setup run ended. */
export type SetupOutcome =
  | { ok: true; reports: StepReport[] }
  | { ok: false; reasons: Reason[]; report: StepReport; reports: StepReport[] };

/** The reason code a failed setup step comes back with. */
export const SETUP_STEP_FAILED = 'setupStepFailed';

/**
 * Runs every registered step in order through `runStep`. Stops at the first failure and returns
 * its report with a `setupStepFailed` reason.
 */
export function runSetupSteps(runtime: SimRuntime, run: SetupRun): SetupOutcome {
  const reports: StepReport[] = [];
  for (const step of orderedSteps()) {
    if (step.when !== undefined && !step.when(run.settings, run.input)) {
      reports.push(skippedStepReport(step.id, null, 'condition'));
      continue;
    }
    const report = runStep(
      runtime,
      step.id,
      { kind: 'phase', id: step.id },
      (phase) => {
        step.run(phase.tx, { ...phase, ...run });
      },
      { date: run.startDate, announceFailure: false },
    );
    reports.push(report);
    if (report.status === 'failed') {
      return {
        ok: false,
        reasons: [
          {
            code: SETUP_STEP_FAILED,
            message: `Setting up the new game failed at step "${step.id}": ${report.error?.message ?? 'unknown error'}`,
          },
        ],
        report,
        reports,
      };
    }
  }
  return { ok: true, reports };
}
