/**
 * The columns of the promotion history the Office can read back (DAY2-03): the built-in columns
 * and every registered field, each with its name, unit, who may see it and how to read it from a
 * row.
 *
 * Built-in keys: `cash` and `averageMorale` (owner only: rival finances and morale are hidden, as
 * WRK1 hides rival morale), `prestige`, `popularity.headline`, `popularity.world`,
 * `popularity.homeRegionValue` and `rosterSize` (public). A registered field's key is its own.
 *
 * Design: docs/design/office.md#queries.
 */

import type { PromotionSnapshot } from '../../../model/entities/promotion-snapshot';
import {
  promotionSnapshotFields,
  type PromotionSnapshotFieldSpec,
  type SnapshotFieldUnit,
  type SnapshotFieldVisibility,
} from './snapshotFields';

/** One readable history column. */
export interface OfficeMetric {
  readonly key: string;
  readonly label: string;
  readonly unit: SnapshotFieldUnit;
  readonly visibility: SnapshotFieldVisibility;
  /** What a rival may not see, in plain words ("cash", "morale"), for the refusal. */
  readonly privateNoun: string;
  /** The value in `row`, or null when the row holds none (not recorded, or nobody to average). */
  readonly fromRow: (row: PromotionSnapshot) => number | null;
  /** The registered field behind the metric, or null for a built-in column. */
  readonly field: PromotionSnapshotFieldSpec | null;
}

/** The built-in columns, in the order the Office shows them. */
export const BUILT_IN_OFFICE_METRICS: readonly OfficeMetric[] = [
  {
    key: 'cash',
    label: 'Cash',
    unit: 'money',
    visibility: 'owner',
    privateNoun: 'cash',
    fromRow: (row) => row.cash,
    field: null,
  },
  {
    key: 'popularity.headline',
    label: 'Popularity',
    unit: 'points',
    visibility: 'public',
    privateNoun: 'popularity',
    fromRow: (row) => row.popularity.headline,
    field: null,
  },
  {
    key: 'prestige',
    label: 'Prestige',
    unit: 'points',
    visibility: 'public',
    privateNoun: 'prestige',
    fromRow: (row) => row.prestige,
    field: null,
  },
  {
    key: 'rosterSize',
    label: 'Roster',
    unit: 'count',
    visibility: 'public',
    privateNoun: 'roster',
    fromRow: (row) => row.rosterSize,
    field: null,
  },
  {
    key: 'averageMorale',
    label: 'Average morale',
    unit: 'points',
    visibility: 'owner',
    privateNoun: 'morale',
    fromRow: (row) => row.averageMorale,
    field: null,
  },
  {
    key: 'popularity.world',
    label: 'Popularity worldwide',
    unit: 'points',
    visibility: 'public',
    privateNoun: 'popularity',
    fromRow: (row) => row.popularity.world,
    field: null,
  },
  {
    key: 'popularity.homeRegionValue',
    label: 'Popularity in the home region',
    unit: 'points',
    visibility: 'public',
    privateNoun: 'popularity',
    fromRow: (row) => row.popularity.homeRegionValue,
    field: null,
  },
];

/** A registered field as a metric: read from the row's `extra`, absent when not recorded. */
export function fieldMetric(field: PromotionSnapshotFieldSpec): OfficeMetric {
  return {
    key: field.key,
    label: field.label,
    unit: field.unit,
    visibility: field.visibility,
    privateNoun: field.label.toLowerCase(),
    fromRow: (row) => row.extra[field.key] ?? null,
    field,
  };
}

/** The metric with this key (a built-in column, then a registered field), or undefined. */
export function officeMetric(key: string): OfficeMetric | undefined {
  const builtIn = BUILT_IN_OFFICE_METRICS.find((metric) => metric.key === key);
  if (builtIn !== undefined) {
    return builtIn;
  }
  const field = promotionSnapshotFields().find((candidate) => candidate.key === key);
  return field === undefined ? undefined : fieldMetric(field);
}
