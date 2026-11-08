/**
 * Plain, serialisable rows describing every tunable: the data behind the tunables list query and
 * the future tunables editor.
 */

import type { TunableDefinitions, TunableKind, TunableRawValue, TunableUnit } from './define';
import type { TunableReader } from './resolver';

/** One tunable as a JSON-safe row. Optional fields are left out when they do not apply. */
export interface TunableRow {
  key: string;
  category: string;
  kind: TunableKind;
  unit: TunableUnit;
  description: string;
  default: TunableRawValue;
  value: TunableRawValue;
  overridden: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  docRef?: string;
}

/** Narrows the rows returned by `describeTunables`. Every field that is set must match. */
export interface TunableFilter {
  /** Only this category (exact match). */
  category?: string;
  /** Only keys starting with this text, for example `sim.`. */
  keyPrefix?: string;
  /** Only tunables the save overrides. */
  overriddenOnly?: boolean;
}

function compareText(left: string, right: string): number {
  // Plain code-unit order, not localeCompare, so the order is the same on every machine.
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function matchesFilter(row: TunableRow, filter: TunableFilter): boolean {
  if (filter.category !== undefined && row.category !== filter.category) {
    return false;
  }
  if (filter.keyPrefix !== undefined && !row.key.startsWith(filter.keyPrefix)) {
    return false;
  }
  return !(filter.overriddenOnly === true && !row.overridden);
}

/**
 * Describes every tunable a reader knows about, sorted by category and then key. The rows hold
 * copies of plain data only, so they can cross the Web Worker boundary or be written as JSON.
 */
export function describeTunables<Defs extends TunableDefinitions>(
  reader: TunableReader<Defs>,
  filter: TunableFilter = {},
): TunableRow[] {
  const rows: TunableRow[] = [];
  for (const key of Object.keys(reader.definitions)) {
    const def = reader.def(key);
    const row: TunableRow = {
      key,
      category: def.category,
      kind: def.kind,
      unit: def.unit,
      description: def.description,
      default: def.default,
      value: reader.get(key),
      overridden: reader.isOverridden(key),
    };
    if (def.kind === 'number' || def.kind === 'integer') {
      row.min = def.min;
      row.max = def.max;
    }
    if (def.kind === 'number' && def.step !== undefined) {
      row.step = def.step;
    }
    if (def.kind === 'enum') {
      row.options = [...def.options];
    }
    if (def.docRef !== undefined) {
      row.docRef = def.docRef;
    }
    if (matchesFilter(row, filter)) {
      rows.push(row);
    }
  }
  return rows.sort(
    (left, right) => compareText(left.category, right.category) || compareText(left.key, right.key),
  );
}
