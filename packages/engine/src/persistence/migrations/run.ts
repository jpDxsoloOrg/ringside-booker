/**
 * The migration runner: upgrades a save document one format version at a time.
 *
 * Steps run in order from the document's own version up to the current one, each exactly once.
 * Every step gets a deep copy of the document, so a failing step leaves nothing half-changed, and
 * the runner stamps the step's `to` version on what it returns.
 */

import { InvalidArgumentError, MigrationError } from '../../core/errors';
import {
  cloneJson,
  findJsonProblem,
  isJsonObject,
  isJsonValue,
  type JsonObject,
} from '../../core/json';
import type { Migration } from './registry';

/** One step that ran, for the load report. */
export interface AppliedMigration {
  readonly from: number;
  readonly to: number;
  readonly title: string;
}

export interface MigrationRun {
  /** The upgraded document, or the input itself when it was already current. */
  readonly doc: JsonObject;
  /** The steps that ran, in order. */
  readonly applied: readonly AppliedMigration[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Upgrades `doc` from its `formatVersion` to `current` with the steps in `migrations`, which must
 * form a contiguous chain (see `assertMigrationChain`). Throws `MigrationError` naming the step
 * when a step throws, returns something that is not a plain JSON object, or is missing from the
 * chain. Throws `InvalidArgumentError` when `doc` has no whole-number `formatVersion` or it is
 * newer than `current`.
 */
export function runMigrations(
  doc: JsonObject,
  migrations: readonly Migration[],
  current: number,
): MigrationRun {
  const startVersion = doc['formatVersion'];
  if (typeof startVersion !== 'number' || !Number.isInteger(startVersion) || startVersion < 1) {
    throw new InvalidArgumentError(
      'runMigrations',
      'doc.formatVersion',
      startVersion,
      'a whole number of 1 or more',
    );
  }
  if (startVersion > current) {
    throw new InvalidArgumentError(
      'runMigrations',
      'doc.formatVersion',
      startVersion,
      `at most the current format version ${String(current)}`,
    );
  }

  let working = doc;
  const applied: AppliedMigration[] = [];
  for (let version = startVersion; version < current; version += 1) {
    const step = migrations.find((migration) => migration.from === version);
    if (step === undefined) {
      throw new MigrationError(version, version + 1, '(missing)', 'no migration is registered');
    }
    working = runStep(step, working);
    applied.push({ from: step.from, to: step.to, title: step.title });
  }
  return { doc: working, applied };
}

function runStep(step: Migration, doc: JsonObject): JsonObject {
  let result: unknown;
  try {
    result = step.up(cloneJson(doc));
  } catch (error: unknown) {
    throw new MigrationError(step.from, step.to, step.title, describeError(error));
  }
  const problem = findJsonProblem(result);
  if (problem !== null) {
    throw new MigrationError(
      step.from,
      step.to,
      step.title,
      `it returned a value that is not plain JSON (${problem.path} is ${problem.reason})`,
    );
  }
  if (!isJsonValue(result) || !isJsonObject(result)) {
    throw new MigrationError(step.from, step.to, step.title, 'it did not return an object');
  }
  return { ...result, formatVersion: step.to };
}
