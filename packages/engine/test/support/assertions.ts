/**
 * Assertion helpers for tests that build or change worlds.
 */

import { expect } from 'vitest';
import { checkWorld } from '../../src/model/integrity';
import { compareIds } from '../../src/model/table';
import type { TableRegistry } from '../../src/model/table-def';
import { TABLES } from '../../src/model/tables';
import type { TxResult } from '../../src/model/tx';
import type { WorldView } from '../../src/model/world';

/** How many issues `expectValidWorld` prints when a world is broken. */
export const PRINTED_ISSUE_LIMIT = 10;

/**
 * Asserts that every row of `world` parses with its table's schema and that `checkWorld` finds no
 * error (IDs, references and invariants). On failure the message lists the first 10 issues.
 * Warnings do not fail it.
 */
export function expectValidWorld(world: WorldView, registry: TableRegistry = TABLES): void {
  const report = checkWorld(world, registry, { validateRows: true });
  if (report.ok) {
    return;
  }
  const errors = report.issues.filter((issue) => issue.severity !== 'warning');
  const shown = errors
    .slice(0, PRINTED_ISSUE_LIMIT)
    .map((issue) => `  [${issue.code}] ${issue.message}`);
  const hidden = errors.length - shown.length + report.truncated;
  const more = hidden > 0 ? `\n  ...and ${String(hidden)} more` : '';
  expect.fail(
    `The world has ${String(errors.length + report.truncated)} issues:\n${shown.join('\n')}${more}`,
  );
}

export interface ExpectedChange {
  readonly table: string;
  /** The IDs the transaction inserted into `table`, in any order. Left out = not checked. */
  readonly inserted?: readonly string[];
  readonly updated?: readonly string[];
  readonly deleted?: readonly string[];
}

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort(compareIds);
}

/**
 * Asserts that a transaction committed and changed `table` exactly as listed. Each list given is
 * compared in full; a list left out is not checked.
 */
export function expectChange<T>(txResult: TxResult<T>, expected: ExpectedChange): void {
  if (!txResult.ok) {
    expect.fail(`Transaction "${txResult.label}" failed: ${txResult.error.message}`);
  }
  const changes = txResult.changes.tables[expected.table] ?? {
    inserted: [],
    updated: [],
    deleted: [],
  };
  if (expected.inserted !== undefined) {
    expect(sortedIds(changes.inserted), `${expected.table} inserted`).toEqual(
      sortedIds(expected.inserted),
    );
  }
  if (expected.updated !== undefined) {
    expect(sortedIds(changes.updated), `${expected.table} updated`).toEqual(
      sortedIds(expected.updated),
    );
  }
  if (expected.deleted !== undefined) {
    expect(sortedIds(changes.deleted), `${expected.table} deleted`).toEqual(
      sortedIds(expected.deleted),
    );
  }
}
