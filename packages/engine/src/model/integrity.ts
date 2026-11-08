/**
 * World integrity checks.
 *
 * `checkWorld` walks a world and reports what is broken instead of throwing on the first problem:
 *
 * - **rows**: every row parses with its table's schema (off unless asked for; it is the slow one);
 * - **ids**: every row is stored under its own ID, and the ID has its table's kind prefix;
 * - **refs**: every `RefSpec` resolves to an existing row (or a listed player), with the exact
 *   path of each dangling value;
 * - **invariants**: every table's cross-row rules.
 *
 * Tests, save loading and the data tools all use it. Reports are capped so one systematic fault
 * cannot produce a million-line report; `truncated` counts what was left out.
 */

import { isId, kindOfId, ENTITY_KINDS, type EntityKind } from '../core/ids';
import { resolveRefPath } from './ref-path';
import type { ReadonlyTable } from './table';
import {
  PLAYER_REF_TARGET,
  type RefSpec,
  type RefTarget,
  type TableDef,
  type TableName,
  type TableRegistry,
} from './table-def';
import type { WorldView } from './world';

export interface IntegrityIssue {
  /** Stable code such as `ref.dangling` or `id.wrongKind`. Invariants use their own codes. */
  readonly code: string;
  readonly table: TableName;
  /** The row the issue is about, when there is one. */
  readonly id?: string;
  /** The concrete path inside the row, for example `members[1].personId`. */
  readonly path?: string;
  /** For reference issues: what the path should point at. */
  readonly target?: RefTarget;
  /** For dangling references: the ID (or player ID) that was not found. */
  readonly missingId?: string;
  readonly message: string;
}

export interface IntegrityReport {
  /** True when no issue was found (and so none was truncated either). */
  readonly ok: boolean;
  /** At most `MAX_INTEGRITY_ISSUES` issues, in a stable order. */
  readonly issues: readonly IntegrityIssue[];
  /** How many more issues were found beyond the cap. */
  readonly truncated: number;
}

export type IntegrityCheck = 'rows' | 'refs' | 'ids' | 'invariants';

export interface CheckWorldOptions {
  /** Run only these checks. When omitted: ids, refs and invariants, plus rows if `validateRows`. */
  readonly only?: readonly IntegrityCheck[];
  /** Also parse every row with its schema. Ignored when `only` is given. */
  readonly validateRows?: boolean;
}

/** The most issues a report lists. */
export const MAX_INTEGRITY_ISSUES = 200;

class IssueCollector {
  readonly issues: IntegrityIssue[] = [];
  truncated = 0;

  add(issue: IntegrityIssue): void {
    if (this.issues.length < MAX_INTEGRITY_ISSUES) {
      this.issues.push(issue);
    } else {
      this.truncated += 1;
    }
  }
}

function checksToRun(options: CheckWorldOptions): ReadonlySet<IntegrityCheck> {
  if (options.only !== undefined) {
    return new Set(options.only);
  }
  const checks = new Set<IntegrityCheck>(['ids', 'refs', 'invariants']);
  if (options.validateRows === true) {
    checks.add('rows');
  }
  return checks;
}

function compareNames(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function checkRows(table: ReadonlyTable, def: TableDef, collector: IssueCollector): void {
  for (const [key, row] of table.entries()) {
    const result = def.schema.safeParse(row);
    if (result.success) {
      continue;
    }
    for (const problem of result.error.issues) {
      const path = problem.path.map(String).join('.');
      collector.add({
        code: 'row.invalid',
        table: def.name,
        id: key,
        ...(path === '' ? {} : { path }),
        message: `${def.name} ${key}: ${path === '' ? '' : `${path}: `}${problem.message}`,
      });
    }
  }
}

function checkIds(table: ReadonlyTable, def: TableDef, collector: IssueCollector): void {
  for (const [storedKey, row] of table.entries()) {
    // Widened to string: a corrupt table can hold keys that are not IDs of the table's kind.
    const key: string = storedKey;
    const rowId: unknown = row.id;
    if (rowId !== key) {
      collector.add({
        code: 'id.keyMismatch',
        table: def.name,
        id: key,
        message: `${def.name}: row stored under ${key} has id ${JSON.stringify(rowId)}`,
      });
    }
    if (!isId(def.kind, key)) {
      const actualKind = kindOfId(key);
      collector.add({
        code: actualKind === null ? 'id.malformed' : 'id.wrongKind',
        table: def.name,
        id: key,
        message:
          actualKind === null
            ? `${def.name}: ${key} is not a well-formed ID`
            : `${def.name}: ${key} is a ${actualKind} ID; this table holds ${def.kind} IDs (${ENTITY_KINDS[def.kind]}_)`,
      });
    }
  }
}

interface RefContext {
  readonly tableByKind: ReadonlyMap<EntityKind, ReadonlyTable>;
  readonly playerIds: ReadonlySet<string>;
  readonly collector: IssueCollector;
}

function targetExists(context: RefContext, target: RefTarget, value: string): boolean {
  if (target === PLAYER_REF_TARGET) {
    return context.playerIds.has(value);
  }
  const targetTable = context.tableByKind.get(target);
  return targetTable !== undefined && isId(target, value) && targetTable.has(value);
}

function checkRefSpec(
  table: ReadonlyTable,
  def: TableDef,
  spec: RefSpec,
  context: RefContext,
): void {
  if (spec.target !== PLAYER_REF_TARGET && !context.tableByKind.has(spec.target)) {
    context.collector.add({
      code: 'ref.targetUnregistered',
      table: def.name,
      path: spec.path,
      target: spec.target,
      message: `${def.name}.${spec.path} points at ${spec.target}, which has no table in this registry`,
    });
    return;
  }
  for (const [key, row] of table.entries()) {
    for (const found of resolveRefPath(row, spec.path)) {
      const value = found.value;
      if (value === null) {
        if (!spec.nullable) {
          context.collector.add({
            code: 'ref.null',
            table: def.name,
            id: key,
            path: found.path,
            target: spec.target,
            message: `${def.name} ${key}: ${found.path} is null but is not nullable`,
          });
        }
        continue;
      }
      if (typeof value !== 'string') {
        context.collector.add({
          code: 'ref.invalidValue',
          table: def.name,
          id: key,
          path: found.path,
          target: spec.target,
          message: `${def.name} ${key}: ${found.path} should hold a ${spec.target} reference`,
        });
        continue;
      }
      if (!targetExists(context, spec.target, value)) {
        context.collector.add({
          code: spec.target === PLAYER_REF_TARGET ? 'ref.unknownPlayer' : 'ref.dangling',
          table: def.name,
          id: key,
          path: found.path,
          target: spec.target,
          missingId: value,
          message: `${def.name} ${key}: ${found.path} points at missing ${spec.target} ${value}`,
        });
      }
    }
  }
}

function checkInvariants(def: TableDef, view: WorldView, collector: IssueCollector): void {
  for (const invariant of def.invariants ?? []) {
    let found: readonly IntegrityIssue[];
    try {
      found = invariant.check(view);
    } catch (error: unknown) {
      collector.add({
        code: 'invariant.threw',
        table: def.name,
        message: `${def.name} invariant ${invariant.name} threw: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    for (const issue of found) {
      collector.add(issue);
    }
  }
}

/**
 * Checks a world against its registry and returns every problem found (up to the cap). Never
 * throws for bad data; a throwing invariant becomes an `invariant.threw` issue.
 *
 * Tables are visited in table-name order and rows in ID order, so the same world always produces
 * the same report.
 */
export function checkWorld(
  view: WorldView,
  registry: TableRegistry,
  options: CheckWorldOptions = {},
): IntegrityReport {
  const checks = checksToRun(options);
  const collector = new IssueCollector();
  const tables = view.tables;

  const present: { readonly def: TableDef; readonly table: ReadonlyTable }[] = [];
  for (const name of Object.keys(registry).sort(compareNames)) {
    const def = registry[name];
    const table = tables[name];
    if (def === undefined) {
      continue;
    }
    if (table === undefined) {
      collector.add({
        code: 'registry.missingTable',
        table: name,
        message: `The world has no table ${name}`,
      });
      continue;
    }
    present.push({ def, table });
  }

  const tableByKind = new Map<EntityKind, ReadonlyTable>(
    present.map(({ def, table }) => [def.kind, table]),
  );
  const refContext: RefContext = {
    tableByKind,
    playerIds: new Set(view.meta.players.map((player) => player.playerId)),
    collector,
  };

  for (const { def, table } of present) {
    if (checks.has('rows')) {
      checkRows(table, def, collector);
    }
    if (checks.has('ids')) {
      checkIds(table, def, collector);
    }
    if (checks.has('refs')) {
      for (const spec of def.refs) {
        checkRefSpec(table, def, spec, refContext);
      }
    }
  }
  if (checks.has('invariants')) {
    for (const { def } of present) {
      checkInvariants(def, view, collector);
    }
  }

  return {
    ok: collector.issues.length === 0 && collector.truncated === 0,
    issues: collector.issues,
    truncated: collector.truncated,
  };
}
