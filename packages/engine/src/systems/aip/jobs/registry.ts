/**
 * The rival desk's job registry: every piece of rival behaviour is a job the turn runner runs.
 *
 * A feature adds rival behaviour with one `registerAiJob` call in its own system module, never a
 * phase of its own: the single phase `aip.runTurns` (`phases.ts`) walks the computer units in key
 * order and runs each due job in id order, each inside its own savepoint. Module-level like
 * `registerSetupStep` (`systems/newgame/steps.ts`). See docs/design/rival-desk.md#jobs.
 */

import { API_NAME_PATTERN } from '../../../core/api/query';
import { RegistryError } from '../../../core/errors';
import type { AiJobContext } from './context';

/**
 * How often a job runs for a unit:
 *
 * - `daily`: every day;
 * - `weekly`: once a week, on the unit's own weekday (`unitOffset(key, 7)`);
 * - `monthly`: once a month, on the unit's own day of the month (`1 + unitOffset(key, 28)`);
 * - `beforeShow`: on each day the unit has an open show, before the shows phase runs it.
 */
export type AiJobCadence = 'daily' | 'weekly' | 'monthly' | 'beforeShow';

export const AI_JOB_CADENCES: readonly AiJobCadence[] = Object.freeze([
  'daily',
  'weekly',
  'monthly',
  'beforeShow',
]);

/** Which units a job runs for: whole promotions (`brandId` null), computer GM brands, or both. */
export type AiJobUnits = 'promotions' | 'brands' | 'all';

/** What a feature writes to add a rival job. */
export interface AiJobSpec {
  /** `system.camelName` or longer, like an API name, for example `aip.rosterReview`. */
  readonly id: string;
  readonly cadence: AiJobCadence;
  /** Left out: `all`. */
  readonly units?: AiJobUnits;
  /** The job's work for one unit on one day. Throwing rolls back only this job for this unit. */
  readonly run: (job: AiJobContext) => void;
}

/** A registered job, as {@link aiJobs} lists it. */
export interface AiJob {
  readonly id: string;
  readonly cadence: AiJobCadence;
  readonly units: AiJobUnits;
  readonly run: (job: AiJobContext) => void;
}

const registry = new Map<string, AiJob>();

/**
 * Adds a rival job. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError for a malformed id or cadence, or an id that is already registered.
 */
export function registerAiJob(spec: AiJobSpec): () => void {
  if (!API_NAME_PATTERN.test(spec.id)) {
    throw new RegistryError(
      `AI job "${spec.id}": the id must look like "system.camelName", for example "aip.rosterReview"`,
      { jobId: spec.id },
    );
  }
  if (!AI_JOB_CADENCES.includes(spec.cadence)) {
    throw new RegistryError(`AI job "${spec.id}": unknown cadence "${spec.cadence}"`, {
      jobId: spec.id,
    });
  }
  const existing = registry.get(spec.id);
  if (existing !== undefined) {
    throw new RegistryError(
      `AI job "${spec.id}" (${spec.cadence}) is already registered as "${existing.id}" (${existing.cadence})`,
      { jobId: spec.id },
    );
  }
  const stored: AiJob = Object.freeze({
    id: spec.id,
    cadence: spec.cadence,
    units: spec.units ?? 'all',
    run: spec.run,
  });
  registry.set(spec.id, stored);
  return () => {
    if (registry.get(spec.id) === stored) {
      registry.delete(spec.id);
    }
  };
}

/** Every registered job, sorted by id: the order the runner runs them in for each unit. */
export function aiJobs(): AiJob[] {
  return [...registry.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

/** True when `job` runs for a unit with this `brandId` (null = a whole promotion). */
export function jobRunsFor(job: Pick<AiJob, 'units'>, brandId: string | null): boolean {
  switch (job.units) {
    case 'all':
      return true;
    case 'promotions':
      return brandId === null;
    case 'brands':
      return brandId !== null;
  }
}
