/**
 * The promotion history field registry (DAY2-01): how other features add a number to every weekly
 * promotion snapshot without changing the save schema.
 *
 * A registered field is stored in the row's sparse `extra` map under its key from the next
 * snapshot on; rows written before it was registered simply lack the key. `extract` returning null
 * means "nothing to record this week" and leaves the key out. A traced extract stores only its
 * value: the Office re-runs it live when it shows the current Why? (DAY2-03).
 *
 * `visibility` decides who may read the column: `public` fields are shown for every promotion,
 * `owner` fields only to the player who runs it (the history query enforces this, DAY2-03).
 *
 * A module-level registry, like the setup steps: register once when the module loads. Design:
 * docs/design/office.md#history.
 */

import type { GameDate } from '../../../core/date';
import { InvariantError, RegistryError } from '../../../core/errors';
import type { Traced } from '../../../core/trace/types';
import type { Promotion } from '../../../model/entities/promotion';
import {
  SNAPSHOT_FIELD_KEY_PATTERN,
  type SnapshotFieldKey,
} from '../../../model/entities/promotion-snapshot';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';

/** What a field's number measures, for formatting on the Office. */
export type SnapshotFieldUnit = 'points' | 'money' | 'count' | 'percent' | 'ratio';

/** Who may see a field: anyone, or only the player running the promotion. */
export type SnapshotFieldVisibility = 'public' | 'owner';

/** How the Office shows a field as a KPI tile, when it does. */
export interface SnapshotFieldKpi {
  /** Position among the KPI tiles; lower comes first. */
  readonly order: number;
  /** Whether a rise is good news (`up`) or bad news (`down`). */
  readonly goodWhen: 'up' | 'down';
  /** A short line under the tile, in plain words. */
  readonly footer?: string;
}

/** What a feature registers to add a column to the promotion history. */
export interface PromotionSnapshotFieldSpec {
  /** Lower camelCase words joined by dots, for example `morale.trend`. */
  readonly key: SnapshotFieldKey;
  /** The column's name in plain words. */
  readonly label: string;
  readonly unit: SnapshotFieldUnit;
  readonly visibility: SnapshotFieldVisibility;
  /** The value for `promotion` on `date`, or null to record nothing. Reads only its arguments. */
  readonly extract: (
    promotion: DeepReadonly<Promotion>,
    read: GameWorldView,
    date: GameDate,
  ) => number | Traced<number> | null;
  readonly kpi?: SnapshotFieldKpi;
}

/** The built-in columns a registered key may not shadow. `popularity` covers `popularity.*`. */
export const BUILT_IN_SNAPSHOT_COLUMNS = [
  'cash',
  'prestige',
  'popularity',
  'rosterSize',
  'averageMorale',
] as const;

const registry = new Map<string, PromotionSnapshotFieldSpec>();

function clashesWithBuiltIn(key: string): boolean {
  return BUILT_IN_SNAPSHOT_COLUMNS.some((column) => key === column || key.startsWith(`${column}.`));
}

/**
 * Adds a column to the promotion history. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError naming the key for a malformed key, a key already registered, or a key
 *   that clashes with a built-in column (`cash`, `prestige`, `popularity.*`, `rosterSize`,
 *   `averageMorale`).
 */
export function registerPromotionSnapshotField(spec: PromotionSnapshotFieldSpec): () => void {
  const fail = (message: string): never => {
    throw new RegistryError(`Promotion snapshot field "${spec.key}": ${message}`, {
      fieldKey: spec.key,
    });
  };
  if (!SNAPSHOT_FIELD_KEY_PATTERN.test(spec.key)) {
    fail('the key must be lower camelCase words joined by dots, for example "morale.trend"');
  }
  if (clashesWithBuiltIn(spec.key)) {
    fail('the key clashes with a built-in column');
  }
  if (registry.has(spec.key)) {
    fail('a field with this key is already registered');
  }
  const stored: PromotionSnapshotFieldSpec = { ...spec };
  registry.set(spec.key, stored);
  return () => {
    if (registry.get(spec.key) === stored) {
      registry.delete(spec.key);
    }
  };
}

/** Every registered field, in key order. */
export function promotionSnapshotFields(): PromotionSnapshotFieldSpec[] {
  return [...registry.values()].sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
}

function valueOf(extracted: number | Traced<number>): number {
  return typeof extracted === 'number' ? extracted : extracted.value;
}

/**
 * The `extra` map of one snapshot: every registered field's value, in key order. A field whose
 * extract returns null is left out.
 *
 * @throws InvariantError naming the key when an extract returns a number that is not finite.
 */
export function extractSnapshotFields(
  promotion: DeepReadonly<Promotion>,
  read: GameWorldView,
  date: GameDate,
): Record<SnapshotFieldKey, number> {
  const extra: Record<SnapshotFieldKey, number> = {};
  for (const field of promotionSnapshotFields()) {
    const extracted = field.extract(promotion, read, date);
    if (extracted === null) {
      continue;
    }
    const value = valueOf(extracted);
    if (!Number.isFinite(value)) {
      throw new InvariantError(
        `Promotion snapshot field "${field.key}" returned ${String(value)} for ${promotion.id}`,
      );
    }
    extra[field.key] = value;
  }
  return extra;
}
